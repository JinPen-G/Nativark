import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { Prisma, type RentalApprovedSettingsChange, type RentalApprovedSettingsOperation } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaService } from '../database/prisma.service';
import type { RentalCoreService } from './rental-core.service';
import type { ApprovedSettingsActor } from './approved-settings-route.authority';
import { ApprovedSettingsRouteAuthority } from './approved-settings-route.authority';
import { ApprovedSettingsResultUnknownError, type ApprovedSettingsBinding, type ApprovedSettingsOperationReceipt, type ApprovedSettingsParticipant } from './approved-settings-change.ports';
import { commitSettingsChangeSchema, prepareSettingsChangeSchema, readSettingsOperationSchema, settingsApprovalReferenceSchema, settingsChangeReferenceSchema, settingsNotificationsSchema } from './approved-settings-change.validation';
import { lockActiveCategoryBinding } from './category-active-write';
import { requestFingerprint } from './rental-idempotency.repository';

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('通知设置变更参数无效');
  return parsed.data;
}
function changeMaterial(change: Omit<RentalApprovedSettingsChange, 'createdAt' | 'changeHash'>) {
  return { ...change, expiresAt: change.expiresAt.toISOString() };
}
function verifyChange(change: RentalApprovedSettingsChange, actor: ApprovedSettingsActor) {
  if (change.tenantId !== actor.tenantId || change.workspaceId !== actor.workspaceId || change.actorId !== actor.actorId) throw new ForbiddenException();
  const { createdAt, changeHash, ...material } = change;
  if (requestFingerprint(changeMaterial(material)) !== changeHash) throw new ConflictException('冻结通知变更已损坏');
  return { before: parse(settingsNotificationsSchema, change.beforeNotifications), after: parse(settingsNotificationsSchema, change.afterNotifications) };
}
function receipt(operation: RentalApprovedSettingsOperation): ApprovedSettingsOperationReceipt {
  return { receiptId: operation.id, operationKey: operation.operationKey, changeId: operation.changeId, changeHash: operation.changeHash,
    baseRevision: operation.baseRevision, resultRevision: operation.resultRevision, resultHash: operation.resultHash, committedAt: operation.createdAt.toISOString() };
}

export class ApprovedSettingsChangeService {
  constructor(private readonly db: PrismaService, private readonly core: RentalCoreService,
    private readonly authority: ApprovedSettingsRouteAuthority, private readonly participant: ApprovedSettingsParticipant,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof participant?.authorize !== 'function' || typeof participant?.consume !== 'function' || typeof participant?.replay !== 'function') {
      throw new ConflictException('通知设置批准参与者尚未接入');
    }
  }

  readCurrent() {
    return this.authority.withAuthorization('read', async actor => {
      const current = await this.core.readVersionedBusinessSettings(actor.tenantId);
      return { settingsRevision: current.settingsRevision, notifications: parse(settingsNotificationsSchema, current.settings.notifications) };
    });
  }

  prepareChange(value: unknown) {
    const command = parse(prepareSettingsChangeSchema, value);
    return this.authority.withAuthorization('write', (actor, revalidate) => this.db.$transaction(async tx => {
      const preview = await this.core.previewNotificationSettings(actor.tenantId, command.notifications, actor.actorId, tx);
      if (preview.settingsRevision !== command.baseRevision) throw new ConflictException('经营设置版本已变化，请重新准备');
      if (new Date(command.expiresAt).getTime() <= this.clock().getTime()) throw new ConflictException('通知变更已过期');
      if (requestFingerprint(preview.before) === requestFingerprint(preview.after)) throw new BadRequestException('通知变更不能为空');
      const existing = await tx.rentalApprovedSettingsChange.findUnique({
        where: { workspaceId_actorId_changeKey: { workspaceId: actor.workspaceId, actorId: actor.actorId, changeKey: command.changeKey } }
      });
      const material = { id: existing?.id ?? randomUUID(), ...actor, changeKey: command.changeKey, baseRevision: preview.settingsRevision,
        baseSettingsHash: preview.baseSettingsHash, categoryVersionId: preview.binding.categoryVersionId, categoryAdoptionRevision: preview.binding.adoptionRevision,
        beforeNotifications: preview.before, afterNotifications: preview.after, expiresAt: new Date(command.expiresAt) };
      const changeHash = requestFingerprint(changeMaterial(material));
      if (existing) {
        verifyChange(existing, actor);
        if (existing.changeHash !== changeHash) throw new ConflictException('同一变更键不能绑定不同内容');
      }
      await revalidate();
      const change = existing ?? await tx.rentalApprovedSettingsChange.create({ data: { ...material, changeHash } });
      return this.review(change, actor);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }

  readAuthorizedChange(value: unknown) {
    const reference = parse(settingsChangeReferenceSchema, value);
    return this.authority.withAuthorization('read', (actor, revalidate) => this.db.$transaction(async tx => {
      await lockActiveCategoryBinding(tx, actor.tenantId, actor.workspaceId);
      const change = await this.findChange(reference, actor, tx);
      await this.assertCurrent(change, actor, tx);
      await revalidate();
      return this.review(change, actor);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }

  commitApprovedChange(value: unknown) {
    const command = parse(commitSettingsChangeSchema, value);
    return this.authority.withAuthorization('write', async (actor, revalidate) => {
      const commandHash = requestFingerprint({ ...actor, ...command });
      let operation: RentalApprovedSettingsOperation;
      try {
        operation = await this.db.$transaction(async tx => {
          await lockActiveCategoryBinding(tx, actor.tenantId, actor.workspaceId);
          const existing = await tx.rentalApprovedSettingsOperation.findUnique({ where: { workspaceId_operationKey: { workspaceId: actor.workspaceId, operationKey: command.operationKey } } });
          if (existing) {
            this.verifyOperation(existing, actor);
            if (existing.commandHash !== commandHash) throw new ConflictException('同一操作键不能绑定不同批准或变更');
            await revalidate();
            return existing;
          }
          const change = await this.findChange(command, actor, tx);
          if (await tx.rentalApprovedSettingsOperation.findUnique({ where: { workspaceId_changeId: { workspaceId: actor.workspaceId, changeId: change.id } } })) {
            throw new ConflictException('该冻结变更已有原操作收据，请读取原操作');
          }
          await this.assertCurrent(change, actor, tx);
          const binding: ApprovedSettingsBinding = { ...actor, operationKey: command.operationKey, changeId: change.id, changeHash: change.changeHash,
            baseRevision: change.baseRevision, approval: command.approval };
          await revalidate();
          await this.participant.authorize(structuredClone(binding), tx);
          const updated = await this.core.commitNotificationSettings(actor.tenantId, parse(settingsNotificationsSchema, change.afterNotifications), actor.actorId,
            { baseRevision: change.baseRevision, baseSettingsHash: change.baseSettingsHash,
              binding: { categoryVersionId: change.categoryVersionId, adoptionRevision: change.categoryAdoptionRevision } }, tx);
          if (change.expiresAt.getTime() <= this.clock().getTime()) throw new ConflictException('通知变更已过期');
          const created = await tx.rentalApprovedSettingsOperation.create({ data: { id: randomUUID(), ...actor, operationKey: command.operationKey,
            commandHash, changeId: change.id, changeHash: change.changeHash, baseRevision: change.baseRevision, resultRevision: updated.settingsRevision,
            resultHash: requestFingerprint(updated.settings), approvalRef: command.approval, createdAt: this.clock() } });
          await this.participant.consume(structuredClone(binding), receipt(created), tx);
          await revalidate();
          return created;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() < 500) throw error;
        throw new ApprovedSettingsResultUnknownError();
      }
      try { await this.participant.replay(this.verifyOperation(operation, actor), receipt(operation)); }
      catch (error) {
        if (error instanceof HttpException && error.getStatus() < 500) throw error;
        throw new ApprovedSettingsResultUnknownError();
      }
      return { state: 'committed' as const, receipt: receipt(operation), cacheRefreshed: await this.refreshCache(actor) };
    });
  }

  readOperation(value: unknown) {
    const command = parse(readSettingsOperationSchema, value);
    return this.authority.withAuthorization('read', async actor => {
      const operation = await this.db.rentalApprovedSettingsOperation.findUnique({ where: { workspaceId_operationKey: { workspaceId: actor.workspaceId, operationKey: command.operationKey } } });
      if (!operation) return { state: 'not_observed' as const, nextAction: 'read_operation' as const };
      try { await this.participant.replay(this.verifyOperation(operation, actor), receipt(operation)); }
      catch (error) {
        if (error instanceof HttpException && error.getStatus() < 500) throw error;
        throw new ApprovedSettingsResultUnknownError();
      }
      return { state: 'committed' as const, receipt: receipt(operation), cacheRefreshed: await this.refreshCache(actor) };
    });
  }

  private verifyOperation(operation: RentalApprovedSettingsOperation, actor: ApprovedSettingsActor): ApprovedSettingsBinding {
    if (operation.tenantId !== actor.tenantId || operation.workspaceId !== actor.workspaceId || operation.actorId !== actor.actorId) throw new ForbiddenException();
    const approval = parse(settingsApprovalReferenceSchema, operation.approvalRef);
    const command = { operationKey: operation.operationKey, changeId: operation.changeId, changeHash: operation.changeHash, approval };
    if (operation.commandHash !== requestFingerprint({ ...actor, ...command }) || operation.resultRevision !== operation.baseRevision + 1) {
      throw new ConflictException('原设置操作收据已损坏');
    }
    return { ...actor, ...command, baseRevision: operation.baseRevision };
  }

  private async findChange(reference: { changeId: string; changeHash: string }, actor: ApprovedSettingsActor, tx: Prisma.TransactionClient) {
    const change = await tx.rentalApprovedSettingsChange.findUnique({ where: { id: reference.changeId } });
    if (!change) throw new NotFoundException('通知变更不存在');
    verifyChange(change, actor);
    if (change.changeHash !== reference.changeHash) throw new ConflictException('通知变更摘要不一致');
    return change;
  }

  private async assertCurrent(change: RentalApprovedSettingsChange, actor: ApprovedSettingsActor, tx: Prisma.TransactionClient) {
    if (change.expiresAt.getTime() <= this.clock().getTime()) throw new ConflictException('通知变更已过期');
    const preview = await this.core.previewNotificationSettings(actor.tenantId, parse(settingsNotificationsSchema, change.afterNotifications), actor.actorId, tx);
    if (preview.settingsRevision !== change.baseRevision || preview.baseSettingsHash !== change.baseSettingsHash ||
        preview.binding.categoryVersionId !== change.categoryVersionId || preview.binding.adoptionRevision !== change.categoryAdoptionRevision ||
        requestFingerprint(preview.before) !== requestFingerprint(change.beforeNotifications)) throw new ConflictException('经营设置或品类绑定已变化，请重新准备');
  }

  private review(change: RentalApprovedSettingsChange, actor: ApprovedSettingsActor) {
    const { before, after } = verifyChange(change, actor);
    return { changeId: change.id, changeHash: change.changeHash, baseRevision: change.baseRevision, expiresAt: change.expiresAt.toISOString(),
      diff: { 'notifications.enabledEvents': { before: before.enabledEvents, after: after.enabledEvents },
        'notifications.editableChannels': { before: before.editableChannels, after: after.editableChannels } } };
  }

  private async refreshCache(actor: ApprovedSettingsActor) {
    try { await this.core.refreshCommittedBusinessSettings(actor.tenantId); return true; }
    catch { return false; }
  }
}
