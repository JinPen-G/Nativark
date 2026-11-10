/** Assembles the original Task/Step/Proposal/approval repositories around the
 * dedicated ordinary-name domain. No new runtime, controller, policy seed or
 * implicit execution: only a server-held acknowledged lease can commit. */
import { ConflictException, ForbiddenException, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_PROPOSAL_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, type AiProposalPayloadDraft,
  type AiApprovalRecordDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { SharedCustomerRepository } from '../../platform/shared-customer.repository';
import { ApprovedProfileRouteAuthority } from '../../platform/approved-profile-route.authority';
import { ApprovedProfileChangeService } from '../../platform/approved-profile-change.service';
import { ApprovedProfileResultUnknownError } from '../../platform/approved-profile-change.ports';
import { AiProposalRepository } from '../ai-proposal-repository';
import { AiApprovalService, PrismaAiApprovalRepository } from '../ai-approval-repository';
import { PrismaApprovedProfileParticipant, type ProfileProposalReference } from './prisma-approved-profile.participant';
import { ApprovedProfileTaskAuthority, PROFILE_NAME_TOOL_CODE, profileExecutionLeaseSchema, profileTransactionDb,
  profileConflict, profileDenied, profileUnavailable, type ApprovedProfileApplicationDependencies, type ProfileExecutionLease } from './approved-profile-task.authority';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.number().int().min(1).max(4294967294);
const reference = z.object({ taskId: id.max(36), proposalId: id.max(36), proposalRevision: revision, payloadHash: hash }).strict();
const preparation = z.object({ taskId: id.max(36), proposalId: id.max(36), proposalRevision: z.literal(1),
  stepId: id.max(36), customerId: id, changeId: z.string().uuid(), changeHash: hash }).strict();
const decision = reference.extend({ decision: z.enum(['approve', 'reject']) }).strict();
const commit = reference.extend({ approvalId: id, operationKey: id }).strict();
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(structuredClone(value));
  if (!parsed.success) throw profileConflict();
  return parsed.data;
}

export function composeApprovedProfileApplication(d: ApprovedProfileApplicationDependencies) {
  const authority = new ApprovedProfileTaskAuthority(d), participant = new PrismaApprovedProfileParticipant(authority);
  const route = new ApprovedProfileRouteAuthority(d.guard, d.credentials), customers = new SharedCustomerRepository(d.db);
  const domain = (tx?: Prisma.TransactionClient, lease?: ProfileExecutionLease) => new ApprovedProfileChangeService(
    tx ? profileTransactionDb(d.db, tx) : d.db, customers, route,
    lease ? new PrismaApprovedProfileParticipant(authority, lease) : participant, authority.clock);
  const sameActor = (a: object, b: object) => { if (requestFingerprint(a) !== requestFingerprint(b)) throw profileDenied(); };
  const mutation = async <T>(work: () => Promise<T>): Promise<T> => {
    try { return await work(); } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500) throw error;
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 'AI_ACCESS_DENIED' || error.code === 'FORBIDDEN') throw new ForbiddenException();
        if (error.code === 'AI_REVISION_CONFLICT' || error.code === 'CONFLICT' || error.code === 'INVALID') throw new ConflictException('原普通姓名提案依据已变化');
      }
      throw new ApprovedProfileResultUnknownError();
    }
  };
  const lockCustomer = (tx: Prisma.TransactionClient, actor: { tenantId: string }, customerId: string) =>
    tx.$queryRaw(Prisma.sql`SELECT id FROM customer_profiles WHERE tenantId = ${actor.tenantId} AND id = ${customerId} FOR UPDATE`);
  const inReference = async <T>(value: unknown, mode: 'read' | 'write',
    work: (ref: ProfileProposalReference, customerId: string, revalidate: () => Promise<void>) => Promise<T>) => {
    const ref = parse(reference, value), initial = await participant.load(ref, 'read');
    return route.withAuthorization(mode, initial.change.customerId, async (actor, revalidate) => {
      sameActor(actor, initial.grant.actor);
      const current = await participant.load(ref, 'read');
      if (requestFingerprint(current.payload) !== requestFingerprint(initial.payload)
        || current.grant.bindingHash !== initial.grant.bindingHash) throw profileConflict();
      const result = await work(ref, current.change.customerId, revalidate);
      await revalidate();
      return result;
    });
  };

  const prepareProposal = (value: unknown, acknowledgedLease?: ProfileExecutionLease) => {
    const command = parse(preparation, value), lease = profileExecutionLeaseSchema.parse(structuredClone(acknowledgedLease));
    if (lease.holderId !== d.holderId) throw profileDenied();
    return route.withAuthorization('write', command.customerId, (actor, revalidate) => mutation(() => d.db.$transaction(async tx => {
      // Same customer -> task/step order as the domain commit; never acquire a
      // task write lock and then a conflicting customer write lock.
      await lockCustomer(tx, actor, command.customerId);
      const grant = await authority.resolve(command.taskId, 'prepare', tx);
      sameActor(actor, grant.actor);
      const change = await domain(tx).readAuthorizedChange({ customerId: command.customerId, changeId: command.changeId, changeHash: command.changeHash });
      const step = await tx.aiStep.findFirst({ where: { scopeId: grant.scopeId, taskId: command.taskId, id: command.stepId } });
      if (!step) throw profileUnavailable();
      await authority.heldStep(grant, step.actionId, { id: command.changeId, changeHash: command.changeHash }, lease, tx);
      if (await tx.aiApprovalConsumption.findUnique({ where: { scopeId_taskId_actionId: {
        scopeId: grant.scopeId, taskId: command.taskId, actionId: step.actionId } } })) throw profileConflict();
      const snapshot = { recordId: command.changeId, revision: 1, contentHash: command.changeHash };
      const payload: AiProposalPayloadDraft = { contractVersion: AI_PROPOSAL_DRAFT_VERSION, taskId: command.taskId,
        proposalId: command.proposalId, revision: 1, audience: grant.context.audience, scope: grant.context.scope,
        actions: [{ actionId: step.actionId, toolCode: PROFILE_NAME_TOOL_CODE, toolVersion: AI_TOOL_DRAFT_VERSION,
          input: snapshot, preview: snapshot, target: { resourceType: 'customer', resourceId: command.customerId, version: String(change.baseRevision) } }],
        atomicity: 'single_action', failurePolicy: 'stop_and_reconcile', expiresAt: change.expiresAt };
      await new AiProposalRepository(d.db).createPending({ scopeId: grant.scopeId, taskId: command.taskId, payload,
        actions: [{ actionId: step.actionId, requestFingerprint: command.changeHash }] }, tx);
      const ref = { taskId: command.taskId, proposalId: command.proposalId, proposalRevision: 1, payloadHash: requestFingerprint(payload) };
      await participant.load(ref, 'read', tx);
      if ((await authority.resolve(command.taskId, 'prepare', tx)).bindingHash !== grant.bindingHash) throw profileDenied();
      await revalidate();
      return ref;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2500, timeout: 5000 })));
  };
  const readPreparationReceipt = async (value: unknown) => {
    const command = parse(preparation, value);
    return route.withAuthorization('read', command.customerId, async (actor, revalidate) => {
      const grant = await authority.resolve(command.taskId, 'read'); sameActor(actor, grant.actor);
      const version = await d.db.aiProposalVersion.findFirst({ where: { scopeId: grant.scopeId, taskId: command.taskId,
        proposalId: command.proposalId, revision: command.proposalRevision } });
      if (!version) { await revalidate(); return { state: 'not_observed' as const, retryable: false as const, nextAction: 'read_preparation_receipt' as const }; }
      const ref = { taskId: command.taskId, proposalId: command.proposalId, proposalRevision: 1, payloadHash: version.payloadHash };
      const loaded = await participant.load(ref, 'read');
      if (loaded.change.id !== command.changeId || loaded.change.changeHash !== command.changeHash
        || loaded.step.id !== command.stepId || loaded.change.customerId !== command.customerId) throw profileConflict();
      await revalidate(); return { state: 'prepared' as const, reference: ref };
    });
  };
  const readProposal = (value: unknown) => inReference(value, 'read', async (ref, customerId) => {
    const loaded = await participant.load(ref, 'read');
    const change = await domain().readHistoricalChange({ customerId, changeId: loaded.change.id, changeHash: loaded.change.changeHash });
    return { proposal: { payload: loaded.payload, payloadHash: loaded.version.payloadHash, status: loaded.head.status.toLowerCase() },
      change, generatedText: null };
  });
  const decide = (value: unknown) => {
    const { decision: selected, ...ref } = parse(decision, value);
    return inReference(ref, 'write', (reference, customerId, revalidate) => mutation(() => d.db.$transaction(async tx => {
      const first = await participant.load(reference, 'read', tx);
      await lockCustomer(tx, first.grant.actor, customerId);
      const initial = await participant.load(reference, 'decide', tx), { grant } = initial;
      const where = { ...grant.access.where, scopeId: grant.scopeId, revision: grant.task.revision, cancelRequestedAt: null };
      if ((await tx.aiTask.updateMany({ where, data: { revision: grant.task.revision } })).count !== 1) throw profileConflict();
      await domain(tx).readAuthorizedChange({ customerId, changeId: initial.change.id, changeHash: initial.change.changeHash });
      const service = new AiApprovalService(new PrismaAiApprovalRepository(profileTransactionDb(d.db, tx), authority.clock), {
        authorize: async (_context, input) => {
          if (input.taskId !== reference.taskId || input.proposalId !== reference.proposalId || input.proposalRevision !== reference.proposalRevision
            || input.reviewedPayloadHash !== reference.payloadHash || requestFingerprint(input.payload) !== requestFingerprint(initial.payload)) throw profileDenied();
          if ((await participant.load(reference, 'decide', tx)).grant.bindingHash !== grant.bindingHash) throw profileDenied();
          await revalidate();
          return { scopeId: grant.scopeId, actorKind: 'user' as const, actorId: grant.actor.actorId, audience: grant.context.audience };
        }
      });
      const row = await service.decide({ context: grant.context, scopeId: grant.scopeId, taskId: reference.taskId,
        proposalId: reference.proposalId, proposalRevision: reference.proposalRevision, payload: initial.payload,
        reviewedPayloadHash: reference.payloadHash, decision: selected === 'approve' ? 'approved' : 'rejected' });
      await domain(tx).readAuthorizedChange({ customerId, changeId: initial.change.id, changeHash: initial.change.changeHash });
      if ((await authority.resolve(reference.taskId, 'decide', tx)).bindingHash !== grant.bindingHash) throw profileDenied();
      await revalidate();
      const record: AiApprovalRecordDraft = { contractVersion: AI_PROPOSAL_DRAFT_VERSION, approvalId: row.approvalId,
        proposalId: row.proposalId, proposalRevision: row.proposalRevision, payloadHash: row.payloadHash,
        audience: grant.context.audience, scope: grant.context.scope, actor: { kind: 'user', userId: grant.actor.actorId },
        decision: row.decision, issuedAt: row.issuedAt.toISOString(), expiresAt: row.expiresAt.toISOString() };
      return { state: 'recorded' as const, approval: record, businessUpdate: 'not_created_by_decision' as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2500, timeout: 5000 })));
  };
  const readDecisionReceipt = (value: unknown) => inReference(value, 'read', async ref => {
    const loaded = await participant.load(ref, 'read');
    const row = await d.db.aiApproval.findFirst({ where: { scopeId: loaded.grant.scopeId, taskId: ref.taskId,
      proposalId: ref.proposalId, proposalRevision: ref.proposalRevision, actorKind: 'USER', actorId: loaded.grant.actor.actorId,
      audience: loaded.grant.access.audience } });
    if (!row) return { state: 'not_observed' as const, retryable: false as const, nextAction: 'read_decision_receipt' as const };
    if (row.payloadHash !== ref.payloadHash || row.expiresAt.getTime() !== Date.parse(loaded.payload.expiresAt)
      || row.issuedAt >= row.expiresAt || row.issuedAt > authority.clock()) throw profileConflict();
    const approval: AiApprovalRecordDraft = { contractVersion: AI_PROPOSAL_DRAFT_VERSION, approvalId: row.id,
      proposalId: row.proposalId, proposalRevision: row.proposalRevision, payloadHash: row.payloadHash,
      audience: loaded.grant.context.audience, scope: loaded.grant.context.scope,
      actor: { kind: 'user', userId: loaded.grant.actor.actorId }, decision: row.decision === 'APPROVED' ? 'approved' : 'rejected',
      issuedAt: row.issuedAt.toISOString(), expiresAt: row.expiresAt.toISOString() };
    return { state: 'recorded' as const, approval };
  });
  const commitApprovedChange = async (value: unknown, acknowledgedLease?: ProfileExecutionLease) => {
    const command = parse(commit, value), held = profileExecutionLeaseSchema.safeParse(structuredClone(acknowledgedLease));
    if (!held.success || held.data.holderId !== d.holderId) throw profileUnavailable();
    const loaded = await participant.load(command, 'read');
    return domain(undefined, held.data).commitApprovedChange({ customerId: loaded.change.customerId, changeId: loaded.change.id,
      changeHash: loaded.change.changeHash, operationKey: command.operationKey,
      approval: { approvalId: command.approvalId, proposalId: command.proposalId, proposalRevision: command.proposalRevision, payloadHash: command.payloadHash } });
  };
  return Object.freeze({ prepareChange: (value: unknown) => domain().prepareChange(value),
    readCurrent: (value: unknown) => domain().readCurrent(value),
    readChangeReceipt: (value: unknown) => domain().readHistoricalChange(value),
    readAuthorizedChange: (value: unknown) => domain().readAuthorizedChange(value),
    readOriginalOperation: (value: unknown) => domain().readOriginalOperation(value),
    prepareProposal, readPreparationReceipt, readProposal, decide, readDecisionReceipt, commitApprovedChange });
}
