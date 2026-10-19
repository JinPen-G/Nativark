/** Current same-staff task authority -> original invocation accounting only.
 * Deliberately independent of recognition enablement, files, profiles and leases.
 * No new reservation, transport, file read, business write or unsent refund. */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { AI_TASK_DRAFT_VERSION, aiStaffTaskAccountingRequestSchema, aiTaskAccountingObservationSchema } from '@rental-os/shared';
import { z } from 'zod';
import { runWithRequestIdentity } from '../../common/request-identity';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError, aiTaskAccessFromContext } from './ai-task.repository';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from './task-authorization.composition';
import { composePersistedTaskAccountingRecovery } from './task-model-gateway.composition';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import { BudgetError } from './budget/budget.ports';
import { freezeOriginalInput } from './task-request/original-request.validation';

export const AI_STAFF_INSPECTION_ACCOUNTING = Symbol('AI_STAFF_INSPECTION_ACCOUNTING');
type Dependencies = Omit<PersistedTaskAuthorizationDependencies, 'credentials'> & { db: PrismaClient; guard: Pick<ApiAuthGuard, 'canActivate'> };
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');

export function composeStaffInspectionAccounting(input: Dependencies, scenes: readonly { code: string; version: string }[]) {
  const selected = z.array(z.object({ code: z.string().min(1).max(128), version: z.string().min(1).max(64) }).strict())
    .min(1).max(2).parse(structuredClone(scenes));
  const clock = input.clock ?? (() => new Date());
  const observe = async (request: { headers: { authorization?: unknown } }, value: unknown, reconcile: boolean, signal?: AbortSignal) => {
    const command = freezeOriginalInput(aiStaffTaskAccountingRequestSchema.parse(structuredClone(value)));
    const header = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u).safeParse(request?.headers?.authorization);
    if (!header.success) throw denied();
    let active = true;
    const close = () => { active = false; }, requestId = randomUUID();
    const credentials = { current: async () => {
      if (!active || signal?.aborted) throw denied();
      return { authorization: header.data, requestId, audience: 'staff' as const };
    } };
    signal?.addEventListener('abort', close, { once: true });
    try {
      return await runWithRequestIdentity({}, async () => {
        const dependencies = { ...input, credentials, clock }, authorization = composePersistedTaskAuthorization(dependencies);
        const current = async () => {
          const context = await authorization.authority.resolve(command.taskId, 'read_step_terminal');
          if (context.audience !== 'staff' || context.actor.kind !== 'user' || context.scope.kind !== 'workspace') throw denied();
          const access = aiTaskAccessFromContext(context, command.taskId, clock());
          const task = await input.db.aiTask.findFirst({ where: access.where, select: { id: true, scopeId: true,
            sceneCode: true, sceneVersion: true, inputRef: true, inputRevision: true, inputHash: true, archivedAt: true } });
          const scope = await authorization.scopes.resolveCurrent();
          if (!task || task.id !== command.taskId || task.scopeId !== scope.scope.id || task.archivedAt !== null || !task.inputRef
            || !selected.some(scene => scene.code === task.sceneCode && scene.version === task.sceneVersion)) throw denied();
          const { authorizedAt: _at, requestId: _request, ...identity } = context;
          return { task, scope, actorId: context.actor.userId, binding: requestFingerprint({ task, identity }) };
        };
        const before = await current();
        const invocation = await input.db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: {
          scopeId: before.scope.scope.id, callId: command.callId } }, select: {
          id: true, taskId: true, scopeId: true, actorId: true, sceneCode: true, priceVersion: true } });
        if (invocation && (invocation.taskId !== command.taskId || invocation.scopeId !== before.scope.scope.id
          || invocation.actorId !== before.actorId || invocation.sceneCode !== before.task.sceneCode)) throw denied();
        let account = null;
        try {
          if (invocation) {
            const reservation = await input.db.aiBudgetReservation.findUnique({ where: { scopeId_scopeKind_callId: {
              scopeId: before.scope.scope.id, scopeKind: 'WORKSPACE', callId: command.callId } }, select: { id: true, unitKind: true, priceVersion: true } });
            if (reservation) {
              if (reservation.priceVersion !== invocation.priceVersion || !['calls', 'tokens', 'money'].includes(reservation.unitKind)) throw denied();
              const recovery = composePersistedTaskAccountingRecovery({ ...dependencies, taskId: command.taskId,
                pricing: { kind: reservation.unitKind === 'calls' ? 'calls' : 'recorded', priceVersion: reservation.priceVersion } });
              const record = reconcile ? await recovery.reconcile({ reservationId: reservation.id }) : await recovery.readCall({ callId: command.callId });
              account = { status: record.status, usageRecorded: record.actual !== null, dispatched: record.dispatched };
            }
          }
        } catch (error) {
          if (!(error instanceof BudgetError)) throw error;
          if (error.code === 'FORBIDDEN') throw denied();
          if (error.code !== 'PENDING_RECONCILIATION') throw unavailable();
        }
        if ((await current()).binding !== before.binding) throw denied();
        // No usage, no original reservation or a lost COMMIT acknowledgement
        // means unknown, never evidence to replace a call or release funds.
        return freezeOriginalInput(aiTaskAccountingObservationSchema.parse({ contractVersion: AI_TASK_DRAFT_VERSION,
          callId: command.callId, state: account ? 'observed' : 'unknown', account, meaning: 'ai_invocation_not_business_payment',
          observedAt: clock().toISOString(), execution: 'not_authorized_by_accounting', retryable: false, nextAction: 'read_original_accounting' }));
      });
    } finally { signal?.removeEventListener('abort', close); close(); }
  };
  return Object.freeze({
    read: (request: { headers: { authorization?: unknown } }, value: unknown, signal?: AbortSignal) => observe(request, value, false, signal),
    reconcile: (request: { headers: { authorization?: unknown } }, value: unknown, signal?: AbortSignal) => observe(request, value, true, signal)
  });
}
