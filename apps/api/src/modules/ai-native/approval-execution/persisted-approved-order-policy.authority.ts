import type { Prisma } from '@prisma/client';
import type { AiExecutionContext, AiProposalActionDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError, aiTaskAccessFromContext } from '../ai-task.repository';
import { fingerprintAiProposalDraft } from '../proposal-binding-draft';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import type { ApprovedOrderPolicyAuthority, ApprovedOrderPolicyRequest } from './approved-order-composition.ports';
import { approvedOrderCommandSchema, deniedOrder, orderContextHash } from './prisma-approved-order.source';

export interface PersistedApprovedOrderPolicyDependencies extends PersistedTaskAuthorizationDependencies {
  toolVersion: string;
}
const taskSelect = { id: true, scopeId: true, scopeKind: true, scope: true, ownerKind: true, ownerId: true,
  audience: true, status: true, revision: true, archivedAt: true, cancelRequestedAt: true } satisfies Prisma.AiTaskSelect;
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');

export class PersistedApprovedOrderPolicyAuthority implements ApprovedOrderPolicyAuthority {
  private readonly authorization: ReturnType<typeof composePersistedTaskAuthorization>;
  private readonly clock: () => Date;

  constructor(private readonly dependencies: PersistedApprovedOrderPolicyDependencies) {
    if (typeof dependencies?.toolVersion !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(dependencies.toolVersion)
      || typeof dependencies.db?.aiProposalVersion?.findFirst !== 'function'
      || typeof dependencies.db?.aiProposalAction?.findFirst !== 'function') throw unavailable();
    this.authorization = composePersistedTaskAuthorization(dependencies);
    this.clock = dependencies.clock ?? (() => new Date());
  }

  private async task(context: AiExecutionContext, taskId: string, tx?: Prisma.TransactionClient) {
    if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user') throw deniedOrder();
    const access = aiTaskAccessFromContext(context, taskId, this.clock());
    const row = await (tx ?? this.dependencies.db).aiTask.findFirst({ where: access.where, select: taskSelect });
    if (!row || row.id !== taskId || row.ownerKind !== access.actorKind || row.ownerId !== access.actorId
      || row.scopeKind !== access.scope.kind || row.audience !== access.audience || row.archivedAt !== null
      || Object.entries(access.scope).some(([key, value]) => row.scope[key as keyof typeof row.scope] !== value)) throw deniedOrder();
    return row;
  }

  private async action(context: AiExecutionContext, reference: ApprovedOrderPolicyRequest,
    requested: AiProposalActionDraft, tx?: Prisma.TransactionClient) {
    const task = await this.task(context, reference.taskId, tx), db = tx ?? this.dependencies.db;
    const key = { scopeId: task.scopeId, taskId: task.id, proposalId: reference.proposalId, revision: reference.proposalRevision };
    const version = await db.aiProposalVersion.findFirst({ where: key });
    if (!version || Object.entries(key).some(([name, value]) => version[name as keyof typeof version] !== value)
      || version.payloadHash !== reference.reviewedPayloadHash || fingerprintAiProposalDraft(version.payload) !== version.payloadHash) throw deniedOrder();
    const payload = version.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.actions)
      || payload.taskId !== task.id || payload.proposalId !== reference.proposalId || payload.revision !== reference.proposalRevision
      || payload.audience !== context.audience || requestFingerprint(payload.scope) !== requestFingerprint(context.scope)
      || payload.atomicity !== 'single_action' || payload.actions.length !== 1
      || !requested || requested.actionId !== reference.actionId || requested.toolCode !== 'rental.order.commit'
      || requested.toolVersion !== this.dependencies.toolVersion || requestFingerprint(payload.actions[0]) !== requestFingerprint(requested)) throw deniedOrder();
    const actionKey = { scopeId: task.scopeId, taskId: task.id, proposalId: reference.proposalId,
      proposalRevision: reference.proposalRevision, actionId: reference.actionId, requestFingerprint: requested.input.contentHash };
    const row = await db.aiProposalAction.findFirst({ where: actionKey, select: {
      scopeId: true, taskId: true, proposalId: true, proposalRevision: true, actionId: true, requestFingerprint: true,
      step: { select: { scopeId: true, taskId: true, actionId: true, requestFingerprint: true, toolCode: true, toolVersion: true } }
    } });
    if (!row || Object.entries(actionKey).some(([name, value]) => row[name as keyof typeof row] !== value)
      || !row.step || row.step.scopeId !== task.scopeId || row.step.taskId !== task.id || row.step.actionId !== reference.actionId
      || row.step.requestFingerprint !== requested.input.contentHash || row.step.toolCode !== requested.toolCode
      || row.step.toolVersion !== requested.toolVersion) throw deniedOrder();
    return { task, action: row, payloadHash: version.payloadHash };
  }

  async resolve(request: ApprovedOrderPolicyRequest & { action?: AiProposalActionDraft },
    operation: 'read' | 'execute' | 'replay', tx?: Prisma.TransactionClient): Promise<AiExecutionContext> {
    try {
      if (!['read', 'execute', 'replay'].includes(operation)) throw deniedOrder();
      const { action, ...raw } = structuredClone(request);
      const reference = approvedOrderCommandSchema.omit({ lease: true }).parse(raw);
      const first = await this.authorization.authority.resolve(reference.taskId, 'read_metadata');
      const binding = async (context: AiExecutionContext) => operation === 'read' ? this.task(context, reference.taskId, tx)
        : action ? this.action(context, reference, action, tx) : Promise.reject(deniedOrder());
      const initial = await binding(first);
      const current = operation === 'execute' ? await this.authorization.execution.authorize(reference.taskId)
        : await this.authorization.authority.resolve(reference.taskId, 'read_metadata');
      const latest = await binding(current);
      const final = await this.authorization.authority.resolve(reference.taskId, 'read_metadata');
      if (orderContextHash(first) !== orderContextHash(current) || orderContextHash(first) !== orderContextHash(final)
        || requestFingerprint(initial) !== requestFingerprint(latest)) throw deniedOrder();
      return structuredClone(final);
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw new AiTaskRepositoryError(error.code);
      throw unavailable();
    }
  }

  async authorizePreparation(taskId: string, tx?: Prisma.TransactionClient) {
    try {
      approvedOrderCommandSchema.shape.taskId.parse(taskId);
      const first = await this.authorization.authority.resolve(taskId, 'read_metadata');
      const original = await this.task(first, taskId, tx);
      const current = await this.authorization.execution.authorize(taskId);
      const latest = await this.task(current, taskId, tx);
      if (orderContextHash(first) !== orderContextHash(current) || requestFingerprint(original) !== requestFingerprint(latest)
        || latest.status !== 'RUNNING' || latest.cancelRequestedAt !== null) throw deniedOrder();
      return { context: structuredClone(current), scopeId: latest.scopeId };
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw new AiTaskRepositoryError(error.code);
      throw unavailable();
    }
  }
}
