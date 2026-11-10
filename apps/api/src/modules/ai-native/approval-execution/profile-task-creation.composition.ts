/** Immutable personal-name change -> original Task metadata. The original change
 * determines the creation key; no model/client-minted replacement task, policy
 * seed, lease or approval. Historical reads do not require today's execution gates. */
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ApprovedProfileRouteAuthority } from '../../platform/approved-profile-route.authority';
import { AiTaskCreationRepository } from '../ai-task-creation.repository';
import { AiScopeRepository } from '../ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { PrismaSubscriptionBudgetReader } from '../budget/prisma-subscription-budget-reader';
import { aiPersistedPlanToolsSchema, profileChangeInputSchema } from '../runner/prisma-task-plan-input.source';
import { aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import { composeApprovedProfileApplication } from './approved-profile-application.composition';
import { profileConflict, profileDenied, profileUnavailable, type ApprovedProfileApplicationDependencies } from './approved-profile-task.authority';

export class AiProfileTaskCreationUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN' as const;
  readonly retryable = false;
  readonly nextAction = 'read_original_profile_task' as const;
  constructor() { super('AI_RESULT_UNKNOWN'); }
}
const identity = (context: object) => { const { requestId: _, authorizedAt: __, ...bound } = context as Record<string, unknown>; return requestFingerprint(bound); };
export function composeProfileTaskCreation(d: ApprovedProfileApplicationDependencies) {
  const app = composeApprovedProfileApplication(d), clock = d.clock ?? (() => new Date());
  const scopes = new AiScopeRepository(d.db, new AiTaskCurrentIdentityAuthority(d.auth, d.credentials, clock), clock);
  const route = new ApprovedProfileRouteAuthority(d.guard, d.credentials), entitlements = new PrismaSubscriptionBudgetReader(d.db, d.subscriptions, clock);
  const use = async (value: unknown, creating: boolean) => {
    const parsed = profileChangeInputSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw profileConflict();
    const reference = parsed.data;
    let expectedPolicy: string | undefined;
    const read = () => route.withAuthorization(creating ? 'write' : 'read', reference.customerId, async (actor, revalidate) => {
      const before = await scopes.resolveCurrent();
      if (before.scope.kind !== 'WORKSPACE' || before.context.actor.kind !== 'user' || before.context.audience !== 'operator'
        || before.context.actor.userId !== actor.actorId || before.scope.tenantId !== actor.tenantId
        || before.scope.workspaceId !== actor.workspaceId) throw profileDenied();
      const change = await (creating ? app.readAuthorizedChange(reference) : app.readChangeReceipt(reference));
      // A collation match is not the immutable logical identity. Reject aliases
      // before deriving the original creation key or returning input authority.
      if (change.changeId !== reference.changeId || change.customerId !== reference.customerId
        || change.changeHash !== reference.changeHash) throw profileDenied();
      if (creating) {
        const policy = await d.db.aiTaskPlanPolicy.findFirst({ where: { scopeId: before.scope.id, sceneCode: d.scene.code, sceneVersion: d.scene.version } });
        const tools = aiPersistedPlanToolsSchema.safeParse(policy?.allowedTools), limits = aiTaskRunnerLimitsSchema.safeParse(policy?.limits);
        if (!policy || policy.scopeId !== before.scope.id || policy.sceneCode !== d.scene.code || policy.sceneVersion !== d.scene.version
          || !Number.isInteger(policy.revision) || policy.revision < 1 || policy.revision > 4294967294 || !policy.enabled
          || !(policy.expiresAt instanceof Date) || !Number.isFinite(policy.expiresAt.getTime()) || policy.expiresAt <= clock()
          || !tools.success || !limits.success || limits.data.maxStepMs > limits.data.maxTotalMs
          || !tools.data.some(tool => tool.code === 'membership.profile.commit' && tool.version === AI_TOOL_DRAFT_VERSION)) throw profileUnavailable();
        const entitlement = await entitlements.read(actor.tenantId, 'ai.native.use');
        if (entitlement.entitlements.length !== 1 || entitlement.entitlements[0].code !== 'ai.native.use'
          || !entitlement.entitlements[0].available) throw profileUnavailable();
        const fingerprint = requestFingerprint({ scene: d.scene, scopeId: before.scope.id, policyRevision: policy.revision,
          tools: tools.data, limits: limits.data, expiresAt: policy.expiresAt.toISOString(), entitlement });
        if (expectedPolicy !== undefined && fingerprint !== expectedPolicy) throw profileConflict();
        expectedPolicy = fingerprint;
      }
      await revalidate();
      const after = await scopes.resolveCurrent();
      if (after.scope.id !== before.scope.id || identity(after.context) !== identity(before.context)) throw profileDenied();
      return { context: after.context, change };
    });
    const original = await read();
    const resolve = async (sceneCode: string, inputRef: string) => {
      if (sceneCode !== d.scene.code || inputRef !== reference.changeId) throw profileDenied();
      const current = await read();
      if (requestFingerprint(current.change) !== requestFingerprint(original.change) || identity(current.context) !== identity(original.context)) throw profileDenied();
      return { context: current.context, sceneCode: d.scene.code, sceneVersion: d.scene.version,
        inputRef: reference.changeId, inputRevision: 1, inputHash: reference.changeHash };
    };
    const repository = creating ? new AiTaskCreationRepository(d.db, { resolve: async (sceneCode, inputRef) =>
      ({ ...await resolve(sceneCode, inputRef), creationAllowed: true as const }) }, clock)
      : AiTaskCreationRepository.receiptReader(d.db, { resolve }, clock);
    const target = { creationKey: `profile-create-${reference.changeId}`, sceneCode: d.scene.code, inputRef: reference.changeId };
    let receipt;
    try { receipt = creating && repository instanceof AiTaskCreationRepository ? await repository.create(target) : await repository.readCreation(target); }
    catch (error) {
      if (creating && error && typeof error === 'object' && 'code' in error && error.code === 'AI_STORAGE_UNAVAILABLE') throw new AiProfileTaskCreationUnknownError();
      throw error;
    }
    if (creating) {
      try {
        const current = await read();
        if (requestFingerprint(current.change) !== requestFingerprint(original.change) || identity(current.context) !== identity(original.context)) throw profileDenied();
      } catch { throw new AiProfileTaskCreationUnknownError(); }
    }
    return Object.freeze({ original: reference, receipt, execution: 'not_attested' as const, approval: 'not_granted' as const });
  };
  return Object.freeze({ create: (value: unknown) => use(value, true), read: (value: unknown) => use(value, false) });
}
