/** Ordinary personal-name preparation and original operation receipts only.
 * Original membership Guard/ALS owns scope; the supplied original-task approval
 * participant owns authorization/consumption. No full-profile save, identity,
 * phone, enterprise relation, notification update or approval is synthesized. */
import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { Prisma, type CustomerApprovedProfileChange, type CustomerApprovedProfileOperation } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaService } from '../database/prisma.service';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { SharedCustomerRepository } from './shared-customer.repository';
import { ApprovedProfileRouteAuthority, type ApprovedProfileActor } from './approved-profile-route.authority';
import { ApprovedProfileResultUnknownError, type ApprovedProfileBinding, type ApprovedProfileParticipant,
  type ApprovedProfileOperationReceipt } from './approved-profile-change.ports';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9._:-]+$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.number().int().min(1).max(4294967294);
const name = z.string().trim().min(1).refine(value => Array.from(value).length <= 120);
const target = z.object({ customerId: id }).strict();
const reference = target.extend({ changeId: z.string().uuid(), changeHash: hash }).strict();
const prepare = target.extend({ changeKey: id.max(128), baseRevision: revision, name,
  expiresAt: z.string().datetime({ offset: true }) }).strict();
const approval = z.object({ approvalId: id, proposalId: id, proposalRevision: revision, payloadHash: hash }).strict();
const commit = reference.extend({ operationKey: id, approval }).strict();
const readOperation = target.extend({ operationKey: id }).strict();
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(structuredClone(value));
  if (!parsed.success) throw new BadRequestException('普通姓名变更参数无效');
  return parsed.data;
}
function receipt(row: CustomerApprovedProfileOperation): ApprovedProfileOperationReceipt {
  return { receiptId: row.id, operationKey: row.operationKey, changeId: row.changeId, changeHash: row.changeHash,
    customerId: row.customerId, baseRevision: row.baseRevision, resultRevision: row.resultRevision,
    resultName: row.resultName, resultHash: row.resultHash, committedAt: row.createdAt.toISOString() };
}
function material(row: Omit<CustomerApprovedProfileChange, 'changeHash' | 'createdAt'>) {
  return { ...row, expiresAt: row.expiresAt.toISOString() };
}

export class ApprovedProfileChangeService {
  constructor(private readonly db: PrismaService, private readonly customers: SharedCustomerRepository,
    private readonly authority: ApprovedProfileRouteAuthority, private readonly participant: ApprovedProfileParticipant,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof participant?.authorize !== 'function' || typeof participant?.consume !== 'function'
      || typeof participant?.replay !== 'function') throw new ConflictException('普通姓名原批准参与者未装配');
  }

  private async profile(actor: ApprovedProfileActor, customerId: string, tx: Prisma.TransactionClient, writable: boolean) {
    const row = await tx.customerProfile.findFirst({ where: { tenantId: actor.tenantId, id: customerId, customerType: 'personal' },
      select: { id: true, tenantId: true, name: true, ordinaryRevision: true, status: true, mergedIntoCustomerId: true } });
    const membership = row && await tx.customerMembership.findUnique({ where: {
      tenantId_customerId: { tenantId: actor.tenantId, customerId } }, select: { tenantId: true, customerId: true } });
    if (!row || !membership || membership.tenantId !== actor.tenantId || membership.customerId !== customerId) throw new NotFoundException('个人会员主档不存在');
    if (!Number.isSafeInteger(row.ordinaryRevision) || row.ordinaryRevision < 1) throw new ConflictException('普通资料真实版本未就绪');
    if (writable && (row.status !== 'active' || row.mergedIntoCustomerId !== null)) throw new ConflictException('该主档不允许新的普通资料修改');
    return row;
  }
  private async lock(actor: ApprovedProfileActor, customerId: string, tx: Prisma.TransactionClient) {
    // All ordinary writers use the same customer row. The name CAS still
    // checks its real revision; this mutex is not an authorization substitute.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM customer_profiles WHERE tenantId = ${actor.tenantId} AND id = ${customerId} FOR UPDATE`);
  }
  private verifyChange(row: CustomerApprovedProfileChange, actor: ApprovedProfileActor, customerId: string) {
    if (row.tenantId !== actor.tenantId || row.workspaceId !== actor.workspaceId || row.actorId !== actor.actorId
      || row.customerId !== customerId) throw new ForbiddenException();
    const { changeHash, createdAt: _createdAt, ...original } = row;
    if (requestFingerprint(material(original)) !== changeHash || !revision.safeParse(row.baseRevision).success
      || !z.string().min(1).max(191).safeParse(row.beforeName).success || !name.safeParse(row.afterName).success) throw new ConflictException('原普通姓名变更材料已损坏');
  }
  private async findChange(command: z.infer<typeof reference>, actor: ApprovedProfileActor, tx: Prisma.TransactionClient) {
    const row = await tx.customerApprovedProfileChange.findUnique({ where: { id: command.changeId } });
    if (!row) throw new NotFoundException('原普通姓名变更不存在');
    this.verifyChange(row, actor, command.customerId);
    if (row.changeHash !== command.changeHash) throw new ConflictException('普通姓名变更引用不一致');
    return row;
  }
  private async assertCurrent(row: CustomerApprovedProfileChange, actor: ApprovedProfileActor, tx: Prisma.TransactionClient) {
    const current = await this.profile(actor, row.customerId, tx, true);
    if (row.expiresAt.getTime() <= this.clock().getTime() || current.ordinaryRevision !== row.baseRevision
      || current.name !== row.beforeName) throw new ConflictException('普通资料版本或变更有效期已变化，请刷新差异并重新确认');
    return current;
  }
  private review(row: CustomerApprovedProfileChange) {
    return { changeId: row.id, changeHash: row.changeHash, customerId: row.customerId, baseRevision: row.baseRevision,
      expiresAt: row.expiresAt.toISOString(), fields: [{ field: 'name' as const, before: row.beforeName, after: row.afterName }],
      sharing: 'tenant_member_master_not_workspace_order_access' as const,
      persistence: 'immutable_change_saved_not_profile_updated' as const, approval: 'not_created_by_preparation' as const };
  }

  readCurrent(value: unknown) {
    const command = parse(target, value);
    return this.authority.withAuthorization('read', command.customerId, (actor, revalidate) => this.db.$transaction(async tx => {
      const current = await this.profile(actor, command.customerId, tx, false);
      await revalidate();
      return { customerId: current.id, name: current.name, ordinaryRevision: current.ordinaryRevision,
        sharing: 'tenant_member_master_not_workspace_order_access' as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  }
  prepareChange(value: unknown) {
    const command = parse(prepare, value);
    return this.authority.withAuthorization('write', command.customerId, (actor, revalidate) => this.db.$transaction(async tx => {
      await this.lock(actor, command.customerId, tx);
      const current = await this.profile(actor, command.customerId, tx, true);
      if (current.ordinaryRevision !== command.baseRevision || Date.parse(command.expiresAt) <= this.clock().getTime()) throw new ConflictException('普通资料版本或变更有效期已变化');
      if (current.name === command.name) throw new BadRequestException('普通姓名变更不能为空');
      const previous = await tx.customerApprovedProfileChange.findUnique({ where: { tenantId_customerId_actorId_changeKey: {
        tenantId: actor.tenantId, customerId: command.customerId, actorId: actor.actorId, changeKey: command.changeKey } } });
      const original = { id: previous?.id ?? randomUUID(), ...actor, customerId: command.customerId, changeKey: command.changeKey,
        baseRevision: current.ordinaryRevision, beforeName: current.name, afterName: command.name, expiresAt: new Date(command.expiresAt) };
      const changeHash = requestFingerprint(material(original));
      if (previous) {
        this.verifyChange(previous, actor, command.customerId);
        if (previous.changeHash !== changeHash) throw new ConflictException('同一普通姓名变更键不能换内容');
      }
      await revalidate();
      const row = previous ?? await tx.customerApprovedProfileChange.create({ data: { ...original, changeHash } });
      return this.review(row);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 }));
  }
  private readChange(value: unknown, historical: boolean) {
    const command = parse(reference, value);
    return this.authority.withAuthorization('read', command.customerId, (actor, revalidate) => this.db.$transaction(async tx => {
      const row = await this.findChange(command, actor, tx);
      await this.profile(actor, command.customerId, tx, false);
      if (!historical) await this.assertCurrent(row, actor, tx);
      await revalidate();
      return this.review(row);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  }
  readAuthorizedChange(value: unknown) { return this.readChange(value, false); }
  readHistoricalChange(value: unknown) { return this.readChange(value, true); }

  private verifyOperation(row: CustomerApprovedProfileOperation, actor: ApprovedProfileActor, customerId: string): ApprovedProfileBinding {
    const reference = parse(approval, row.approvalRef);
    const binding = { ...actor, customerId, changeId: row.changeId, changeHash: row.changeHash,
      baseRevision: row.baseRevision, operationKey: row.operationKey, approval: reference };
    if (row.tenantId !== actor.tenantId || row.workspaceId !== actor.workspaceId || row.actorId !== actor.actorId || row.customerId !== customerId) throw new ForbiddenException();
    if (row.commandHash !== requestFingerprint({ ...actor, customerId, operationKey: row.operationKey,
      changeId: row.changeId, changeHash: row.changeHash, approval: reference }) || row.resultRevision !== row.baseRevision + 1
      || row.resultHash !== requestFingerprint({ customerId, name: row.resultName, ordinaryRevision: row.resultRevision })) throw new ConflictException('原普通姓名操作收据不一致');
    return binding;
  }
  commitApprovedChange(value: unknown) {
    const command = parse(commit, value);
    return this.authority.withAuthorization('write', command.customerId, async (actor, revalidate) => {
      const commandHash = requestFingerprint({ ...actor, ...command });
      let operation: CustomerApprovedProfileOperation, callbackCompleted = false;
      try {
        operation = await this.db.$transaction(async tx => {
          await this.lock(actor, command.customerId, tx);
          const previous = await tx.customerApprovedProfileOperation.findUnique({ where: { tenantId_customerId_operationKey: {
            tenantId: actor.tenantId, customerId: command.customerId, operationKey: command.operationKey } } });
          if (previous) {
            this.verifyOperation(previous, actor, command.customerId);
            if (previous.commandHash !== commandHash) throw new ConflictException('原操作键不能换变更或批准');
            await revalidate();
            callbackCompleted = true;
            return previous;
          }
          const change = await this.findChange(command, actor, tx);
          if (await tx.customerApprovedProfileOperation.findUnique({ where: { tenantId_customerId_changeId: {
            tenantId: actor.tenantId, customerId: command.customerId, changeId: change.id } } })) throw new ConflictException('该变更已有原提交收据，请读取原操作');
          await this.assertCurrent(change, actor, tx);
          const binding: ApprovedProfileBinding = { ...actor, customerId: command.customerId, changeId: change.id,
            changeHash: change.changeHash, baseRevision: change.baseRevision, operationKey: command.operationKey, approval: command.approval };
          await revalidate();
          await this.participant.authorize(structuredClone(binding), tx);
          const changed = await this.customers.updateOrdinaryNameAtRevision(actor.tenantId, command.customerId,
            change.baseRevision, change.beforeName, change.afterName, tx);
          if (!changed || changed.ordinaryRevision !== change.baseRevision + 1 || changed.name !== change.afterName) throw new ConflictException('普通姓名 CAS 冲突');
          if (change.expiresAt.getTime() <= this.clock().getTime()) throw new ConflictException('原普通姓名变更已过期');
          const created = await tx.customerApprovedProfileOperation.create({ data: { id: randomUUID(), ...actor, customerId: command.customerId,
            operationKey: command.operationKey, commandHash, changeId: change.id, changeHash: change.changeHash, baseRevision: change.baseRevision,
            resultRevision: changed.ordinaryRevision, resultName: changed.name,
            resultHash: requestFingerprint({ customerId: changed.id, name: changed.name, ordinaryRevision: changed.ordinaryRevision }),
            approvalRef: command.approval, createdAt: this.clock() } });
          await this.participant.consume(structuredClone(binding), receipt(created), tx);
          await revalidate();
          callbackCompleted = true;
          return created;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      } catch (error) {
        if (!callbackCompleted && error instanceof HttpException && error.getStatus() < 500) throw error;
        throw new ApprovedProfileResultUnknownError();
      }
      // After COMMIT, even a permission-shaped failure suppresses delivery; it
      // cannot attest that the name CAS/consumption did not happen.
      try {
        const binding = this.verifyOperation(operation, actor, command.customerId);
        await this.participant.replay(binding, receipt(operation));
        await revalidate();
        return receipt(operation);
      } catch { throw new ApprovedProfileResultUnknownError(); }
    });
  }
  readOriginalOperation(value: unknown) {
    const command = parse(readOperation, value);
    return this.authority.withAuthorization('read', command.customerId, async (actor, revalidate) => {
      await this.db.$transaction(tx => this.profile(actor, command.customerId, tx, false), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      const operation = await this.db.customerApprovedProfileOperation.findUnique({ where: { tenantId_customerId_operationKey: {
        tenantId: actor.tenantId, customerId: command.customerId, operationKey: command.operationKey } } });
      if (!operation) { await revalidate(); return { state: 'not_observed' as const, retryable: false as const, nextAction: 'read_original_profile_operation' as const }; }
      const binding = this.verifyOperation(operation, actor, command.customerId);
      await this.participant.replay(binding, receipt(operation));
      await revalidate();
      return { state: 'committed' as const, receipt: receipt(operation), retryable: false as const };
    });
  }
}
