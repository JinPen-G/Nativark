import type { Prisma } from '@prisma/client';
import { AI_PROPOSAL_DRAFT_VERSION, type AiExecutionContext, type AiProposalPayloadDraft } from '@rental-os/shared';
import { z } from 'zod';
import { getRequestIdentity } from '../../../common/request-identity';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError, aiTaskAccessFromContext } from '../ai-task.repository';
import { checkAiApprovalBindingDraft, fingerprintAiProposalDraft } from '../proposal-binding-draft';
import { isAiStepExecutionContext } from '../task-contract-validation';
import type { ApprovedOrderCommand, ApprovedOrderCompositionDependencies, ApprovedOrderPolicyRequest, ApprovedOrderSnapshot } from './approved-order-composition.ports';
import type { AiApprovedOrderInput } from './approved-order.ports';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().positive().max(4294967294);
export const approvedOrderCommandSchema = z.object({
  taskId: id.max(36), proposalId: id.max(36), approvalId: id.max(36), actionId: id,
  proposalRevision: revision, reviewedPayloadHash: z.string().regex(/^[a-f0-9]{64}$/u),
  lease: z.object({ runId: id.max(36), holderId: id, revision,
    fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u) }).strict()
}).strict();
export const deniedOrder = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
export function orderContextHash(context: AiExecutionContext) {
  const { requestId: _request, authorizedAt: _at, ...identity } = context;
  return requestFingerprint(identity);
}

const taskSelect = { id: true, scopeId: true, scopeKind: true, scope: true, ownerId: true, ownerKind: true,
  audience: true, archivedAt: true, status: true, cancelRequestedAt: true } satisfies Prisma.AiTaskSelect;
const approvalSelect = { id: true, scopeId: true, taskId: true, proposalId: true, proposalRevision: true,
  payloadHash: true, audience: true, actorKind: true, actorId: true, decision: true, issuedAt: true, expiresAt: true } satisfies Prisma.AiApprovalSelect;

export class PrismaApprovedOrderSource {
  constructor(private readonly dependencies: ApprovedOrderCompositionDependencies) {}

  async read(command: ApprovedOrderCommand, phase: 'inspect' | 'execute' | 'replay', tx?: Prisma.TransactionClient) {
    const d = this.dependencies;
    const now = () => {
      const value = (d.clock ?? (() => new Date()))();
      if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw deniedOrder();
      return value;
    };
    const { lease: _lease, ...reference } = command;
    const request: ApprovedOrderPolicyRequest = structuredClone(reference);
    const context = structuredClone(await d.policy.resolve(request, 'read', tx));
    if (!isAiStepExecutionContext(context) || context.scope.kind !== 'workspace' || context.actor.kind !== 'user'
      || !['operator', 'staff'].includes(context.audience)) throw deniedOrder();
    const access = aiTaskAccessFromContext(context, command.taskId, now());
    const db = tx ?? d.db;
    const task = await db.aiTask.findFirst({ where: access.where, select: taskSelect });
    if (!task || task.id !== command.taskId || !id.max(36).safeParse(task.scopeId).success
      || task.scopeKind !== access.scope.kind || task.ownerKind !== access.actorKind || task.ownerId !== access.actorId
      || task.audience !== access.audience || task.archivedAt !== null
      || Object.entries(access.scope).some(([key, value]) => task.scope[key as keyof typeof task.scope] !== value)) throw deniedOrder();
    const base = { scopeId: task.scopeId, taskId: task.id };
    const versionWhere = { ...base, proposalId: command.proposalId, revision: command.proposalRevision };
    const head = await db.aiProposal.findFirst({ where: { ...base, id: command.proposalId },
      select: { id: true, scopeId: true, taskId: true, currentRevision: true, status: true } });
    const version = await db.aiProposalVersion.findFirst({ where: versionWhere,
      select: { scopeId: true, taskId: true, proposalId: true, revision: true, payload: true, payloadHash: true, expiresAt: true } });
    const approval = await db.aiApproval.findFirst({ where: { ...base, id: command.approvalId,
      proposalId: command.proposalId, proposalRevision: command.proposalRevision }, select: approvalSelect });
    const actionRow = await db.aiProposalAction.findFirst({ where: { ...base, proposalId: command.proposalId,
      proposalRevision: command.proposalRevision, actionId: command.actionId }, select: {
        scopeId: true, taskId: true, proposalId: true, proposalRevision: true, actionId: true, requestFingerprint: true,
        step: { select: { scopeId: true, taskId: true, actionId: true, runId: true, requestFingerprint: true, toolCode: true, toolVersion: true } }
      } });
    if (!head || head.id !== command.proposalId || head.scopeId !== base.scopeId || head.taskId !== base.taskId
      || !version || Object.entries(versionWhere).some(([key, value]) => version[key as keyof typeof version] !== value)
      || !approval || approval.id !== command.approvalId || approval.scopeId !== base.scopeId || approval.taskId !== base.taskId
      || approval.proposalId !== command.proposalId || approval.proposalRevision !== command.proposalRevision
      || approval.actorKind !== access.actorKind || approval.actorId !== access.actorId || approval.audience !== access.audience
      || approval.decision !== 'APPROVED' || approval.payloadHash !== command.reviewedPayloadHash
      || version.payloadHash !== command.reviewedPayloadHash) throw deniedOrder();
    let payload: AiProposalPayloadDraft;
    try {
      if (fingerprintAiProposalDraft(version.payload) !== command.reviewedPayloadHash) throw deniedOrder();
      payload = structuredClone(version.payload) as unknown as AiProposalPayloadDraft;
    } catch { throw deniedOrder(); }
    const action = payload.actions.find(row => row.actionId === command.actionId);
    if (payload.proposalId !== command.proposalId || payload.taskId !== base.taskId || payload.revision !== command.proposalRevision
      || payload.atomicity !== 'single_action' || payload.actions.length !== 1
      || !action || action.toolCode !== 'rental.order.commit' || action.toolVersion !== d.toolVersion
      || !actionRow || actionRow.scopeId !== base.scopeId || actionRow.taskId !== base.taskId
      || actionRow.proposalId !== command.proposalId || actionRow.proposalRevision !== command.proposalRevision
      || actionRow.actionId !== action.actionId || actionRow.requestFingerprint !== action.input.contentHash
      || !actionRow.step || actionRow.step.scopeId !== base.scopeId || actionRow.step.taskId !== base.taskId
      || actionRow.step.actionId !== action.actionId || actionRow.step.runId !== command.lease.runId
      || actionRow.step.requestFingerprint !== actionRow.requestFingerprint || actionRow.step.toolCode !== action.toolCode
      || actionRow.step.toolVersion !== action.toolVersion
      || !(version.expiresAt instanceof Date) || version.expiresAt.getTime() !== Date.parse(payload.expiresAt)
      || !(approval.issuedAt instanceof Date) || !(approval.expiresAt instanceof Date)) throw deniedOrder();
    const businessIdempotencyKey = `ai-order:${requestFingerprint([base.scopeId, base.taskId, action.actionId])}`;
    const input: AiApprovedOrderInput = { context, ...base, actionId: command.actionId, approvalId: command.approvalId,
      proposalId: command.proposalId, proposalRevision: command.proposalRevision, actionFingerprint: actionRow.requestFingerprint,
      businessIdempotencyKey, lease: structuredClone(command.lease) };
    const consumption = await db.aiApprovalConsumption.findFirst({ where: { ...base, actionId: command.actionId } });
    if (consumption && (consumption.scopeId !== base.scopeId || consumption.taskId !== base.taskId || consumption.actionId !== command.actionId
      || consumption.approvalId !== input.approvalId || consumption.proposalId !== input.proposalId
      || consumption.proposalRevision !== input.proposalRevision || consumption.actionFingerprint !== input.actionFingerprint
      || consumption.businessIdempotencyKey !== businessIdempotencyKey)) throw deniedOrder();
    const committedId = consumption?.status === 'COMMITTED' && consumption.resultRef ? consumption.resultRef : null;
    if (phase !== 'execute' && consumption && !committedId) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const operation = phase === 'execute' ? 'execute' : committedId ? 'replay' : 'execute';
    if (phase === 'replay' && !committedId) throw deniedOrder();
    if (operation === 'execute' && (head.status !== 'CONFIRMED' || head.currentRevision !== command.proposalRevision
      || task.status !== 'RUNNING' || task.cancelRequestedAt !== null)) throw deniedOrder();
    const approvalRecord = { contractVersion: AI_PROPOSAL_DRAFT_VERSION, approvalId: approval.id, proposalId: approval.proposalId,
      proposalRevision: approval.proposalRevision, payloadHash: approval.payloadHash, audience: context.audience,
      scope: context.scope, actor: context.actor, decision: 'approved', issuedAt: approval.issuedAt.toISOString(), expiresAt: approval.expiresAt.toISOString() };
    // A committed action is checked at issuance; expiry or cancellation cannot erase its historical fact.
    const bindingTime = operation === 'replay' ? approval.issuedAt.toISOString() : now().toISOString();
    if (!checkAiApprovalBindingDraft({ payload, payloadHash: version.payloadHash, status: 'confirmed' }, approvalRecord, context, action.actionId, bindingTime).valid) throw deniedOrder();
    const snapshots = structuredClone(await d.snapshots.read({ context: structuredClone(context), ...base,
      proposalId: command.proposalId, proposalRevision: command.proposalRevision, action: structuredClone(action) }, tx));
    for (const kind of ['input', 'preview'] as const) {
      const snapshot: ApprovedOrderSnapshot<unknown> | undefined = snapshots?.[kind], ref = action[kind];
      if (!snapshot || snapshot.scopeId !== base.scopeId || snapshot.taskId !== base.taskId || snapshot.actionId !== action.actionId
        || snapshot.recordId !== ref.recordId || snapshot.revision !== ref.revision || snapshot.contentHash !== ref.contentHash
        || requestFingerprint(snapshot.payload) !== ref.contentHash) throw deniedOrder();
    }
    const body = snapshots.input.payload, preview = snapshots.preview.payload;
    if (!body || !preview || action.target.resourceType !== 'quote' || action.target.resourceId !== body.quoteId
      || preview.id !== body.quoteId || preview.tenantId !== context.scope.tenantId
      || preview.consumedAt || preview.consumedOrderId) throw deniedOrder();
    if (body.capabilityExceptions !== undefined) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    if (operation === 'execute' && tx) {
      const identity = getRequestIdentity();
      if (!identity || identity.isSaasAdmin || identity.userId !== context.actor.userId
        || identity.tenantId !== context.scope.tenantId || identity.workspaceId !== context.scope.workspaceId) throw deniedOrder();
      const quote = await d.quoteFacts.findQuote(context.scope.tenantId, body.quoteId, tx);
      if (!quote) throw deniedOrder();
      const { consumedAt: _at, consumedOrderId: _order, ...immutableQuote } = quote;
      if (requestFingerprint(immutableQuote) !== action.preview.contentHash) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    }
    let inputBindingHash: string | null = null;
    if (operation === 'execute' && d.executionInput) {
      const authorizeInput = async (client: Prisma.TransactionClient) => {
        const authorized = await d.executionInput!.readAuthorized({ context: structuredClone(context), ...base,
          actionId: action.actionId, runId: command.lease.runId }, client);
        if (requestFingerprint(authorized.body) !== action.input.contentHash
          || requestFingerprint(authorized.body) !== requestFingerprint(body)) throw deniedOrder();
        return authorized.bindingHash;
      };
      inputBindingHash = tx ? await authorizeInput(tx) : await d.db.$transaction(authorizeInput,
        { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 });
    }
    const latest = structuredClone(await d.policy.resolve({ ...reference, action: structuredClone(action) }, operation, tx));
    if (!isAiStepExecutionContext(latest) || orderContextHash(context) !== orderContextHash(latest)) throw deniedOrder();
    aiTaskAccessFromContext(latest, command.taskId, now());
    if (operation === 'execute' && (approval.expiresAt <= now() || version.expiresAt <= now())) throw deniedOrder();
    return { input, binding: { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId,
      idempotencyKey: businessIdempotencyKey, requestFingerprint: input.actionFingerprint, request: body }, committedId,
      payloadHash: version.payloadHash, previewHash: action.preview.contentHash, inputBindingHash, operation };
  }
}
