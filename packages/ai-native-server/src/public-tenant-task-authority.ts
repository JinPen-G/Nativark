/** Bind public tenant Tasks to the same signed request and Native principal.
 * The host must register real scene/source, entitlement and publication gates. */
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { PlatformAuthService, PlatformPrincipalAuthority } from '@rental-os/platform-server';
import { hasEffectivePermission } from '@rental-os/platform-server/permission-match';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import type { SystemUserRow } from '@rental-os/platform-contracts';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { captureAiRequestBinding } from './request-binding';
import { isAiStepExecutionContext } from './execution-context-validation';
import { AiTaskRepositoryError } from './task-errors';
import type { AiTaskTransactionAuthority, AiTaskTransactionReference } from './task-transactions';
import { aiTaskAccessFromContext, assertOriginalTaskRecoveryLease, type AiTaskRepositoryOperation } from './runtime/task-persistence.repository';
import type { AiTaskExecutionScopeSource } from './task-resource-ledger';
import { isRecoveryTimeLease } from './runtime/runner/task-execution-budget.repository';
import { createPublicTaskActionAuthority, type PublicTenantTaskContext as TenantContext } from './task-policy-authorization';

type Tx = Prisma.TransactionClient;
type Action = AiTaskRepositoryOperation;
type TenantIdentity = Pick<Tx, 'aiScope' | 'aiTask' | 'aiRun' | 'aiTaskActionPolicy' | '$queryRaw'>;
type Permission = (operation: Action) => string | undefined;
const bearer = z.string().max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const subjectKey = ({ requestId: _request, authorizedAt: _at, ...value }: AiExecutionContext) => requestFingerprint(value);

export function createPublicTenantTaskAuthority(input: {
  db: TenantIdentity;
  auth: Pick<PlatformAuthService, 'resolveAccessContext'>;
  principals: Pick<PlatformPrincipalAuthority<Tx>, 'lock'>;
  entryPermission: Permission;
  creationPermission: string;
  assertDataAvailable(database: Pick<Tx, '$queryRaw'>): Promise<void>;
  /** Allow only the exact scene, publication and original object for this action. */
  assertTaskAction(database: TenantIdentity, identity: TenantContext, taskId: string, operation: Action, transaction?: Tx): Promise<void>;
  /** Check the exact source, entitlement and current policy in the owning Native. */
  assertReference(transaction: Tx, identity: TenantContext, reference: AiTaskTransactionReference): Promise<void>;
  clock?: () => Date;
}) {
  if (typeof input?.db?.$queryRaw !== 'function' || typeof input.auth?.resolveAccessContext !== 'function'
    || typeof input.principals?.lock !== 'function' || typeof input.entryPermission !== 'function'
    || typeof input.assertReference !== 'function' || typeof input.assertTaskAction !== 'function'
    || typeof input.assertDataAvailable !== 'function'
    || typeof input.creationPermission !== 'string' || !input.creationPermission) throw unavailable();
  const { db, auth, principals, entryPermission, creationPermission } = input, clock = input.clock ?? (() => new Date());
  return Object.freeze({ async bind(request: { headers: { authorization?: unknown } }, signal?: AbortSignal) {
    const header = bearer.safeParse(request?.headers?.authorization);
    if (!header.success || signal?.aborted) throw denied();
    const binding = captureAiRequestBinding(denied), identity = binding.identity;
    const { tenantId, userId, accessSession } = identity, requestId = randomUUID();
    const active = () => {
      binding.assertCurrent();
      if (signal?.aborted || !tenantId || !userId || !accessSession || identity.isSaasAdmin !== false
        || identity.audience !== 'operator' || identity.staffApi || identity.workspaceId !== undefined
        || accessSession.expiresAt <= clock().getTime() / 1000) throw denied();
    };
    const project = (user: SystemUserRow): TenantContext => {
      active();
      if (user.tenantId !== tenantId || user.id !== userId || !user.isActive || user.isSaasAdmin || user.mustChangePassword) throw denied();
      // Public Task scope has no business location grants. Business scopes
      // remain separate participants and must not inherit this projection.
      const context = { contractVersion: AI_CONTRACT_DRAFT_VERSION, audience: 'operator', requestId, authorizedAt: clock().toISOString(),
        actor: { kind: 'user', userId }, scope: { kind: 'tenant', tenantId }, access: {
          permissions: [...user.permissions].sort(), dataScope: user.dataScope, locationScope: { mode: 'selected', locationIds: [] },
          ...(user.organizationId ? { organizationId: user.organizationId } : {})
        } };
      if (!isAiStepExecutionContext(context) || context.scope.kind !== 'tenant') throw denied();
      return context as TenantContext;
    };
    const resolveRoot = async () => {
      active();
      const current = await auth.resolveAccessContext(header.data), session = current?.accessSession;
      if (!current || !session || session.sessionId !== accessSession!.sessionId || session.expiresAt !== accessSession!.expiresAt
        || session.workspaceId !== accessSession!.workspaceId) throw denied();
      return project(current.tenantUser);
    };
    try {
      const initial = await resolveRoot(), currentKey = subjectKey(initial);
      const current = (value: TenantContext) => {
        active();
        if (subjectKey(value) !== currentKey) throw denied();
        return value;
      };
      const available = async (reader: Pick<Tx, '$queryRaw'>) => {
        active(); await input.assertDataAvailable(reader); active();
      };
      const identities = { async resolve() {
        await available(db);
        return current(await resolveRoot());
      } };
      const actionsFor = (reader: TenantIdentity, trusted: typeof identities, transaction?: Tx) => createPublicTaskActionAuthority({
        db: reader, identities: trusted, entryPermission, clock,
        assertTaskAction: (context, taskId, operation) => input.assertTaskAction(reader, context, taskId, operation, transaction)
      });
      const actions = actionsFor(db, identities);
      const lockPrincipal = async (tx: Tx) => {
        active();
        if (!tx || '$transaction' in tx) throw denied();
        const lease = await principals.lock(tx, { tenantId: tenantId!, subjectId: userId!, audience: 'operator' }, tenantId!);
        return { async resolve() { return current(project(await lease.revalidate())); } };
      };
      const grants = new WeakMap<Tx, ReturnType<typeof actionsFor>>();
      const resourceScopes: AiTaskExecutionScopeSource = { async resolve(taskId, lease, purpose, tx) {
        active();
        if (!lease || lease.taskId !== taskId || !['write', 'read', 'settle', 'settle_released_run', 'recovery_time'].includes(purpose)) throw denied();
        const authority = tx ? grants.get(tx) : actions;
        const reader = tx ?? db;
        if (!authority) throw denied();
        const operation = purpose === 'write' ? 'transition_task' : purpose === 'read' ? 'read_metadata'
          : purpose === 'recovery_time' ? 'claim_recovery_run' : 'read_step_terminal';
        const access = aiTaskAccessFromContext(await authority.resolve(taskId, operation), taskId, clock());
        const row = await reader.aiTask.findFirst({ where: access.where, select: { scopeId: true } });
        if (!row) throw denied();
        if (purpose === 'recovery_time') {
          if (!isRecoveryTimeLease(lease)) throw denied();
          await assertOriginalTaskRecoveryLease(reader, lease, access);
          if (Date.parse(lease.expiresAt) <= clock().getTime()) throw denied();
        }
        const verified = aiTaskAccessFromContext(await authority.resolve(taskId, operation), taskId, clock());
        if (verified.bindingKey !== access.bindingKey || tx && grants.get(tx) !== authority) throw denied();
        return { scopeId: row.scopeId, bindingKey: verified.bindingKey, taskWhere: verified.where };
      } };
      const transaction: AiTaskTransactionAuthority<Tx> = Object.freeze({ binding: requestFingerprint([requestId, currentKey, accessSession]),
        async begin(tx: Tx, reference: AiTaskTransactionReference) {
          active();
          if (!tx || '$transaction' in tx) throw denied();
          await available(tx);
          const nativeIdentity = await lockPrincipal(tx);
          const nativeActions = actionsFor(tx, nativeIdentity, tx);
          const verify = async (next: AiTaskTransactionReference) => {
            await available(tx);
            const principal = await nativeIdentity.resolve();
            if (next.kind === 'creation' && !hasEffectivePermission(principal.access.permissions, creationPermission)) throw denied();
            if (next.kind === 'task') await nativeActions.resolve(next.taskId, 'claim_run');
            if (next.kind === 'task_control' && next.operation) await nativeActions.resolve(next.taskId, next.operation);
            if (next.kind === 'invocation' && next.tenantSubject && (next.tenantSubject.tenantId !== principal.scope.tenantId
              || next.tenantSubject.actorId !== principal.actor.userId)) throw denied();
            // The host owns the exact control purpose, object and immutable
            // source. A generic 'task_control' ref does not choose a verb.
            await input.assertReference(tx, principal, structuredClone(next));
            await nativeIdentity.resolve();
          };
          await verify(reference);
          grants.set(tx, nativeActions);
          return { verifyReference: verify, revalidate: () => verify(reference), close: () => { grants.delete(tx); } };
        } });
      // Original accounting has its own action permission and can outlive a
      // run's write lease. Its enclosing ledger transaction still uses the
      // original signed principal and same Native connection.
      const principalOn = async (tx: Tx) => {
        const nativeIdentity = await lockPrincipal(tx);
        await available(tx);
        return nativeIdentity.resolve();
      };
      // Delivery can verify the original read policy under the same principal
      // lock without claiming a Run or granting a write action.
      const readActionOn = async (tx: Tx, taskId: string, operation: 'read_metadata' | 'read_step_terminal') => {
        if (operation !== 'read_metadata' && operation !== 'read_step_terminal') throw denied();
        const nativeIdentity = await lockPrincipal(tx);
        await available(tx);
        return actionsFor(tx, nativeIdentity, tx).resolve(taskId, operation);
      };
      const actionOn = (tx: Tx, taskId: string, operation: Action) => {
        const held = grants.get(tx);
        if (!held) throw denied();
        return held.resolve(taskId, operation);
      };
      return Object.freeze({ identities, actions, transaction, principalOn, actionOn, readActionOn, assertCurrent: active,
        resourceScopes: Object.freeze(resourceScopes), close: binding.close });
    } catch (error) { binding.close(); throw error; }
  } });
}
