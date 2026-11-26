/** Shared action-policy checks. Identity is supplied by the authorized host; this file cannot sign in or grant a Task action. */
import { hasEffectivePermission } from '@rental-os/platform-server/permission-match';
import type { AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import type { AiTaskRepositoryAuthority, AiTaskRepositoryOperation } from './ai-task.repository';
import { AiTaskRepositoryError } from '../task-errors';
import type { AiCurrentScopeAuthority } from './ai-scope.repository';

const operations = ['read_metadata', 'read_events', 'claim_run', 'claim_recovery_run', 'release_run', 'transition_task', 'read_step_terminal', 'takeover_run', 'request_input', 'submit_input', 'resume_input'] as const;
export interface AiTaskActionPolicySource {
  /** A server-owned, versioned action policy, not a model/caller permission list.
   * Formal policy not configured => unavailable. No guessed PRO/role entitlement.
   */
  resolve(taskId: string, operation: AiTaskRepositoryOperation, context: AiExecutionContext): Promise<{
    taskId: string; operation: AiTaskRepositoryOperation; revision: number; expiresAt: string; requiredPermissions: readonly string[];
  } | null>;
}

export class AiTaskActionChecks implements AiTaskRepositoryAuthority {
  constructor(private readonly identities: AiCurrentScopeAuthority, private readonly policies: AiTaskActionPolicySource,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof identities?.resolve !== 'function' || typeof policies?.resolve !== 'function') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  }
  private async identity() {
    const context = await this.identities.resolve();
    const { requestId: _request, authorizedAt: _time, ...binding } = context;
    return { context, fingerprint: requestFingerprint(binding) };
  }

  async resolve(taskId: string, operation: AiTaskRepositoryOperation) {
    if (typeof taskId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(taskId)
      || !(operations as readonly string[]).includes(operation)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    try {
      const initial = await this.identity();
      const policy = structuredClone(await this.policies.resolve(taskId, operation, structuredClone(initial.context)));
      if (!policy) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      if (policy.taskId !== taskId || policy.operation !== operation || !Number.isSafeInteger(policy.revision) || policy.revision < 1
        || !Array.isArray(policy.requiredPermissions) || policy.requiredPermissions.length < 1 || policy.requiredPermissions.length > 64
        || policy.requiredPermissions.some(permission => typeof permission !== 'string' || permission.length < 1 || permission.length > 191)
        || new Set(policy.requiredPermissions).size !== policy.requiredPermissions.length || !Number.isFinite(Date.parse(policy.expiresAt))) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const current = await this.identity();
      const rechecked = structuredClone(await this.policies.resolve(taskId, operation, structuredClone(current.context)));
      const final = await this.identity();
      if (current.fingerprint !== initial.fingerprint || final.fingerprint !== initial.fingerprint || requestFingerprint(rechecked) !== requestFingerprint(policy)
        || Date.parse(policy.expiresAt) <= this.clock().getTime() || !('access' in final.context)
        || policy.requiredPermissions.some(permission => !('access' in final.context) || !hasEffectivePermission(final.context.access.permissions, permission))) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return structuredClone(final.context);
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
  }
}
