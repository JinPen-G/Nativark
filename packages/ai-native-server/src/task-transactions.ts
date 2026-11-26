/** Original Task transaction participation. The host supplies current resource
 * authority; this module opens no transaction and imports no business schema.
 * Each host owns one boundary shared by its repositories and participants. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { AiTaskRepositoryError } from './task-errors';

export type AiTaskTransactionReference =
  | { kind: 'creation'; inputRef: string; sceneCode: string }
  | { kind: 'task'; taskId: string }
  | { kind: 'task_control'; taskId: string; operation?: 'claim_recovery_run' | 'release_run' }
  | { kind: 'step'; stepId: string }
  | { kind: 'invocation'; callId: string; tenantSubject?: { tenantId: string; actorId: string } };
export interface AiTaskTransactionAuthority<Transaction extends object> {
  readonly binding: string;
  begin(transaction: Transaction, reference: AiTaskTransactionReference): Promise<{
    verifyReference(reference: AiTaskTransactionReference): Promise<void>;
    revalidate(): Promise<void>;
    close?(): void;
  }>;
}
export type AiTaskTransactionBoundary<Transaction extends object> = ReturnType<typeof createAiTaskTransactionBoundary<Transaction>>;
const strictBoundaries = new WeakSet<object>();

export function isStrictAiTaskTransactionBoundary(boundary: object | undefined): boolean {
  return boundary !== undefined && strictBoundaries.has(boundary);
}

/** Strict by default. A legacy host must explicitly supply its selection check;
 * an expired selected request must still return true and require a participant. */
export function createAiTaskTransactionBoundary<Transaction extends object>(
  selection?: { isRequired(): boolean }
) {
  type Authority = AiTaskTransactionAuthority<Transaction>;
  type Scope = { active: boolean; authority: Authority };
  const scopes = new AsyncLocalStorage<Scope>();
  const held = new WeakMap<Transaction, { scope: Scope; lease: Awaited<ReturnType<Authority['begin']>> }>();
  const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

  async function withAiTaskTransactionAuthority<T>(authority: Authority, consume: () => Promise<T>): Promise<T> {
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

  /** Enter before the first Task/Run/Scope lock in the owning transaction. */
  async function withAiTaskTransaction<T>(transaction: Transaction, reference: AiTaskTransactionReference,
    consume: () => Promise<T>): Promise<T> {
    const scope = scopes.getStore();
    if (!scope) {
      if (!selection || selection.isRequired()) throw denied();
      return consume();
    }
    if (!scope.active || '$transaction' in transaction) throw denied();
    const parent = held.get(transaction);
    if (parent) {
      if (parent.scope !== scope) throw denied();
      await parent.lease.verifyReference(structuredClone(reference));
      // An unawaited nested read may finish after its owning transaction exits.
      // The original held lease must still own this transaction before a write.
      if (!scope.active || scopes.getStore() !== scope || held.get(transaction) !== parent) throw denied();
      return consume();
    }
    const lease = await scope.authority.begin(transaction, structuredClone(reference));
    try {
      if (!scope.active || scopes.getStore() !== scope || !lease
        || typeof lease.verifyReference !== 'function' || typeof lease.revalidate !== 'function') throw denied();
      held.set(transaction, { scope, lease });
      const result = await consume();
      if (!scope.active || scopes.getStore() !== scope) throw denied();
      await lease.revalidate();
      if (!scope.active || scopes.getStore() !== scope) throw denied();
      return result;
    } finally {
      if (held.get(transaction)?.lease === lease) held.delete(transaction);
      lease?.close?.();
    }
  }

  async function withHeldAiTaskTransaction<T>(transaction: Transaction, reference: AiTaskTransactionReference,
    consume: () => Promise<T>): Promise<T> {
    const scope = scopes.getStore();
    if (scope && (!scope.active || held.get(transaction)?.scope !== scope)) throw denied();
    return withAiTaskTransaction(transaction, reference, consume);
  }

  const boundary = Object.freeze({ withAiTaskTransactionAuthority, withAiTaskTransaction, withHeldAiTaskTransaction,
    hasAiTaskTransactionAuthority: () => Boolean(scopes.getStore()) || !selection || selection.isRequired() });
  if (!selection) strictBoundaries.add(boundary);
  return boundary;
}
