import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_PROPOSAL_DRAFT_VERSION, type AiExecutionContext, type AiProposalPayloadDraft, type CreateRentalOrderRequest, type RentalQuoteSnapshotV1 } from '@rental-os/shared';
import { getRequestIdentity } from '../../../common/request-identity';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiProposalRepository, AiProposalRepositoryError } from '../ai-proposal-repository';
import { AiTaskRepositoryError, aiTaskAccessFromContext } from '../ai-task.repository';
import type { PersistedApprovedOrderDependencies } from './approved-order-composition.ports';
import { AiApprovedOrderRouteAuthority } from './approved-order-route.authority';
import type { PersistedApprovedOrderPolicyAuthority } from './persisted-approved-order-policy.authority';
import { approvedOrderPreviewSchema, approvedOrderSnapshotJson, type PrismaApprovedOrderSnapshotSource } from './prisma-approved-order-snapshot.source';
import { approvedOrderCommandSchema, deniedOrder, orderContextHash } from './prisma-approved-order.source';
import { AiApprovedOrderResultUnknownError } from './approved-order.errors';

const commandSchema = approvedOrderCommandSchema.omit({ approvalId: true, reviewedPayloadHash: true })
  .extend({ expiresAt: z.string().datetime({ offset: true }) }).strict();
type Command = z.infer<typeof commandSchema>;
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');

export class ApprovedOrderPreparationService {
  private readonly route: AiApprovedOrderRouteAuthority;
  private readonly proposals: AiProposalRepository;
  private readonly clock: () => Date;
  constructor(private readonly d: PersistedApprovedOrderDependencies,
    private readonly policy: PersistedApprovedOrderPolicyAuthority, private readonly snapshots: PrismaApprovedOrderSnapshotSource) {
    this.clock = d.clock ?? (() => new Date());
    this.route = new AiApprovedOrderRouteAuthority(d.guard, d.credentials, this.clock);
    this.proposals = new AiProposalRepository(d.db);
  }

  private async lock(tx: Prisma.TransactionClient, command: Command, context: AiExecutionContext, scopeId: string) {
    const access = aiTaskAccessFromContext(context, command.taskId, this.clock());
    const taskWhere = { ...access.where, scopeId, status: 'RUNNING' as const, cancelRequestedAt: null };
    const task = await tx.aiTask.findFirst({ where: taskWhere, select: { revision: true } });
    if (!task || (await tx.aiTask.updateMany({ where: { ...taskWhere, revision: task.revision }, data: { revision: task.revision } })).count !== 1) throw deniedOrder();
    const held = await tx.aiRun.updateMany({ where: { scopeId, taskId: command.taskId, id: command.lease.runId,
      revision: command.lease.revision, fencingToken: new Prisma.Decimal(command.lease.fencingToken), leaseOwnerId: command.lease.holderId,
      leaseExpiresAt: { gt: access.now }, actorKind: access.actorKind, actorId: access.actorId, status: 'RUNNING' },
    data: { authorizedAt: access.authorizedAt } });
    if (held.count !== 1) throw conflict();
    const key = { scopeId, taskId: command.taskId, runId: command.lease.runId, actionId: command.actionId,
      toolCode: 'rental.order.commit', toolVersion: this.d.toolVersion, status: 'RUNNING' as const };
    const step = await tx.aiStep.findFirst({ where: key });
    if (!step || Object.entries(key).some(([name, value]) => step[name as keyof typeof step] !== value)
      || !/^[a-f0-9]{64}$/u.test(step.requestFingerprint)) throw deniedOrder();
    if ((await tx.aiStep.updateMany({ where: { ...key, id: step.id, revision: step.revision,
      inputRef: step.inputRef, requestFingerprint: step.requestFingerprint }, data: { revision: step.revision } })).count !== 1) throw conflict();
    if (Date.parse(command.expiresAt) <= this.clock().getTime()) throw deniedOrder();
    return { fingerprint: step.requestFingerprint,
      binding: requestFingerprint({ id: step.id, revision: step.revision, inputRef: step.inputRef, fingerprint: step.requestFingerprint }) };
  }

  private async quote(context: AiExecutionContext, body: CreateRentalOrderRequest, tx: Prisma.TransactionClient) {
    const identity = getRequestIdentity();
    if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user' || !identity || identity.isSaasAdmin
      || identity.tenantId !== context.scope.tenantId || identity.workspaceId !== context.scope.workspaceId || identity.userId !== context.actor.userId
      || this.d.core.resolveWorkspaceId(context.scope.tenantId) !== context.scope.workspaceId) throw deniedOrder();
    const quote = await this.d.quoteFacts.findQuote(context.scope.tenantId, body.quoteId, tx);
    if (!quote || quote.id !== body.quoteId || quote.tenantId !== context.scope.tenantId) throw deniedOrder();
    approvedOrderPreviewSchema.parse(quote);
    if (quote.consumedAt || quote.consumedOrderId || Date.parse(quote.expiresAt) <= this.clock().getTime()) throw conflict();
    const amounts = [quote.rentalAmount, quote.discountAmount, quote.couponAmount, quote.serviceAmount, quote.fulfillmentAmount,
      quote.depositAmount, quote.preAuthAmount, quote.payableAmount, quote.receivableAmount];
    if (amounts.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      || [quote.chargeLines, quote.rateSnapshot, quote.calendarSnapshot, quote.calendarWarnings, quote.appliedDiscountPlanIds,
        quote.discountEvaluations, quote.serviceSnapshots].some(value => !Array.isArray(value))
      || !quote.ruleSnapshot || !quote.quoteNo || !quote.categoryCode || !quote.pricingPlanVersion || !quote.ruleVersion
      || !Number.isFinite(Date.parse(quote.createdAt))) throw deniedOrder();
    this.d.confirmation.assertOrderMatchesQuote(body, quote);
    return structuredClone(quote);
  }

  private async persist(tx: Prisma.TransactionClient, command: Command, context: AiExecutionContext, scopeId: string,
    body: CreateRentalOrderRequest, quote: RentalQuoteSnapshotV1) {
    if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || !['operator', 'staff'].includes(context.audience)) throw deniedOrder();
    const inputJson = approvedOrderSnapshotJson(body), previewJson = approvedOrderSnapshotJson(quote);
    const inputHash = requestFingerprint(inputJson), previewHash = requestFingerprint(previewJson);
    const base = { scopeId, taskId: command.taskId, proposalId: command.proposalId, proposalRevision: command.proposalRevision,
      actionId: command.actionId, actionFingerprint: inputHash };
    const prior = await tx.aiProposalVersion.findFirst({ where: { scopeId, taskId: command.taskId, proposalId: command.proposalId, revision: command.proposalRevision } });
    const records: Prisma.AiApprovedOrderSnapshotUncheckedCreateInput[] = [];
    for (const kind of ['INPUT', 'PREVIEW'] as const) {
      const payload = kind === 'INPUT' ? inputJson : previewJson, contentHash = kind === 'INPUT' ? inputHash : previewHash;
      const key = { ...base, kind };
      const existing = prior ? await tx.aiApprovedOrderSnapshot.findFirst({ where: key }) : null;
      if (prior && (!existing || Object.entries(key).some(([name, value]) => existing[name as keyof typeof existing] !== value)
        || existing.contentHash !== contentHash || requestFingerprint(existing.payload) !== contentHash
        || existing.actorKind !== 'USER' || existing.actorId !== context.actor.userId || existing.audience !== context.audience.toUpperCase())) throw conflict();
      records.push({ ...key, recordId: existing?.recordId ?? randomUUID(), revision: existing?.revision ?? 1, contentHash, payload,
        actorKind: 'USER' as const, actorId: context.actor.userId, audience: context.audience === 'operator' ? 'OPERATOR' as const : 'STAFF' as const });
    }
    const ref = (row: typeof records[number]) => ({ recordId: row.recordId, revision: row.revision, contentHash: row.contentHash });
    const action = { actionId: command.actionId, toolCode: 'rental.order.commit' as const, toolVersion: this.d.toolVersion,
      input: ref(records[0]), preview: ref(records[1]), target: { resourceType: 'quote' as const, resourceId: quote.id, version: quote.pricingPlanVersion } };
    const payload: AiProposalPayloadDraft = { contractVersion: AI_PROPOSAL_DRAFT_VERSION, taskId: command.taskId, proposalId: command.proposalId,
      revision: command.proposalRevision, audience: context.audience === 'operator' ? 'operator' : 'staff', scope: context.scope,
      actions: [action], atomicity: 'single_action', failurePolicy: 'stop_and_reconcile', expiresAt: command.expiresAt };
    await this.proposals.createPending({ scopeId, taskId: command.taskId, payload, actions: [{ actionId: command.actionId, requestFingerprint: inputHash }] }, tx);
    if (!prior) for (const data of records) await tx.aiApprovedOrderSnapshot.create({ data });
    await this.snapshots.read({ context, scopeId, taskId: command.taskId, proposalId: command.proposalId, proposalRevision: command.proposalRevision, action }, tx);
    return { taskId: command.taskId, proposalId: command.proposalId, proposalRevision: command.proposalRevision,
      actionId: command.actionId, reviewedPayloadHash: requestFingerprint(payload) };
  }

  async prepare(value: unknown) {
    let transactionSubmitted = false;
    try {
      const parsed = commandSchema.safeParse(value);
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const command = structuredClone(parsed.data), original = await this.policy.authorizePreparation(command.taskId);
      // Once the transaction is submitted, a driver error cannot prove rollback.
      // Reconcile the same immutable proposal; never imply approval or dispatch.
      transactionSubmitted = true;
      const saved = await this.d.db.$transaction(async tx => {
        const current = await this.policy.authorizePreparation(command.taskId, tx);
        if (current.scopeId !== original.scopeId || orderContextHash(current.context) !== orderContextHash(original.context)) throw deniedOrder();
        const step = await this.lock(tx, command, current.context, current.scopeId);
        const reference = { context: structuredClone(current.context), scopeId: current.scopeId,
          taskId: command.taskId, actionId: command.actionId, runId: command.lease.runId };
        const input = structuredClone(await this.d.inputSource.read(reference, tx));
        if (!input || requestFingerprint(input) !== step.fingerprint) throw deniedOrder();
        return this.route.withOrderPreparation(current.context, input, async (context, body) => {
          const quote = await this.quote(context, body, tx);
          if (Date.parse(command.expiresAt) > Date.parse(quote.expiresAt)) throw deniedOrder();
          const result = await this.persist(tx, command, context, current.scopeId, body, quote);
          const latest = await this.policy.authorizePreparation(command.taskId, tx);
          if (latest.scopeId !== current.scopeId || orderContextHash(latest.context) !== orderContextHash(context)
            || requestFingerprint(await this.quote(latest.context, body, tx)) !== requestFingerprint(quote)) throw deniedOrder();
          const latestInput = await this.d.inputSource.read({ ...reference, context: structuredClone(latest.context) }, tx);
          if (!latestInput || requestFingerprint(latestInput) !== step.fingerprint
            || (await this.lock(tx, command, latest.context, latest.scopeId)).binding !== step.binding) throw deniedOrder();
          return { result, body: structuredClone(body) };
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      return await this.route.withOrderPreparation(original.context, saved.body, async context => {
        const current = await this.policy.authorizePreparation(command.taskId);
        if (current.scopeId !== original.scopeId || orderContextHash(current.context) !== orderContextHash(context)) throw deniedOrder();
        return saved.result;
      });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw new AiTaskRepositoryError(error.code);
      if (error instanceof AiProposalRepositoryError && error.code === 'CONFLICT') throw conflict();
      if (transactionSubmitted) throw new AiApprovedOrderResultUnknownError();
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
  }
}
