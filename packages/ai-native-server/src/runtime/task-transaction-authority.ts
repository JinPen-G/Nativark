/** Request-bound participant in the ORIGINAL task transaction. This does not
 * proxy Prisma, open a second transaction, grant execution or classify results.
 * Only new-work sites enter here; original receipt/dispatch/lease settlement
 * retains its repository's exact persisted evidence and never gains a retry. */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';
import { createMysqlCoreDeploymentAdmission } from '@rental-os/core-host/mysql-deployment-admission';
import { hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import { AiTaskRepositoryError } from '../task-errors';

export type AiTaskTransactionReference =
  | { kind: 'creation'; inputRef: string; sceneCode: string }
  | { kind: 'task'; taskId: string }
  | { kind: 'task_control'; taskId: string }
  | { kind: 'step'; stepId: string }
  | { kind: 'invocation'; callId: string };
export interface AiTaskTransactionAuthority {
  /** Server-verified identity and original resource binding, never an HTTP flag. */
  readonly binding: string;
  begin(tx: Prisma.TransactionClient, reference: AiTaskTransactionReference): Promise<{
    verifyReference(reference: AiTaskTransactionReference): Promise<void>;
    revalidate(): Promise<void>;
  }>;
}
type Scope = { active: boolean; authority: AiTaskTransactionAuthority };
const scopes = new AsyncLocalStorage<Scope>();
const held = new WeakMap<Prisma.TransactionClient, { scope: Scope; lease: Awaited<ReturnType<AiTaskTransactionAuthority['begin']>> }>();
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

/** 由原参加者在 Auth/Tenant/Core 后、Order/Workspace/Task 前调用。共享锁保留到
 * 原事务提交；控制分支只观察，嵌套新工作只能使用已锁观察，不能倒序补锁。
 * 未选择标准宿主围栏时沿旧宿主准入；围栏失活仍算已选择，不能回退。 */
export async function holdAiTaskDeploymentAdmission(tx: Prisma.TransactionClient, purpose: 'new_work' | 'task_control') {
  if (!hasRentalBusinessTenantFence()) return Object.freeze({ requireNewWork() {} });
  if ('$transaction' in tx) throw denied();
  const admission = createMysqlCoreDeploymentAdmission(tx);
  let accepting = false;
  if (purpose === 'new_work') {
    try { await admission.requireAccepting('rental'); accepting = true; }
    catch { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); }
  } else accepting = (await admission.readCurrent('rental')).state === 'accepting';
  return Object.freeze({ requireNewWork() {
    if (!accepting) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  } });
}

export async function withAiTaskTransactionAuthority<T>(authority: AiTaskTransactionAuthority, consume: () => Promise<T>): Promise<T> {
  if (!authority?.binding || typeof authority.begin !== 'function') throw denied();
  const parent = scopes.getStore();
  if (parent) {
    if (!parent.active || parent.authority.binding !== authority.binding) throw denied();
    return consume();
  }
  const scope: Scope = { active: true, authority };
  return scopes.run(scope, async () => {
    try { return await consume(); }
    finally { scope.active = false; }
  });
}

/** Call at the first line of the repository's own transaction, before any
 * task/scope/run lock. A nested participant must already own this exact tx. */
export async function withAiTaskTransaction<T>(tx: Prisma.TransactionClient, reference: AiTaskTransactionReference,
  consume: () => Promise<T>): Promise<T> {
  const scope = scopes.getStore();
  if (!scope) {
    if (hasRentalBusinessTenantFence()) throw denied();
    return consume();
  }
  if (!scope.active || '$transaction' in tx) throw denied();
  const parent = held.get(tx);
  if (parent) {
    if (parent.scope !== scope) throw denied();
    // Nested original participants still verify their target. No new parent
    // lock is acquired after task/run locks.
    await parent.lease.verifyReference(structuredClone(reference));
    return consume();
  }
  const lease = await scope.authority.begin(tx, structuredClone(reference));
  if (!scope.active || scopes.getStore() !== scope) throw denied();
  held.set(tx, { scope, lease });
  try {
    const result = await consume();
    if (!scope.active || scopes.getStore() !== scope) throw denied();
    await lease.revalidate();
    if (!scope.active || scopes.getStore() !== scope) throw denied();
    return result;
  } finally { held.delete(tx); }
}

export function hasAiTaskTransactionAuthority() { return Boolean(scopes.getStore()) || hasRentalBusinessTenantFence(); }

/** An external transaction must enter at its owning callback before business/AI
 * locks. This never acquires a missing Tenant lock after a caller's fact locks. */
export async function withHeldAiTaskTransaction<T>(tx: Prisma.TransactionClient, reference: AiTaskTransactionReference,
  consume: () => Promise<T>): Promise<T> {
  const scope = scopes.getStore();
  if (scope && (!scope.active || held.get(tx)?.scope !== scope)) throw denied();
  return withAiTaskTransaction(tx, reference, consume);
}
