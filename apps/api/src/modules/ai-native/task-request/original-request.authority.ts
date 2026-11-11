/** Original scene entry-policy/resource checks shared by Web and Native observers.
 * Web retains its original credential/Guard path. Native requires explicit current
 * scope, entitlement and original resource producers; no Web/global fallback,
 * transaction creation, task dispatch, business execution or commit attestation. */
import { hasEffectivePermission } from '../../../common/permission-match';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import { AI_SCENE_CODES, type AiSceneCode, type AiSceneRequestBody } from '@rental-os/shared';
import type { AuthService } from '../../auth/auth.service';
import type { SubscriptionService } from '../../subscription/subscription.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiScopeRepository } from '../ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { PrismaSubscriptionBudgetReader } from '../budget/prisma-subscription-budget-reader';
import { freezeOriginalInput } from './original-request.validation';
import { AiTaskCurrentActionAuthority } from '../task-current-action.authority';
import { PrismaTaskActionPolicySource } from '../prisma-task-action-policy.source';

export interface AiOriginalRequestAccess { context: AiExecutionContext; scopeId: string }
export interface AiOriginalRequestCreationAccess extends AiOriginalRequestAccess {
  sceneVersion: string; policyRevision: number; policyHash: string; expiresAt: string;
}
export interface AiOriginalRequestAuthority {
  current(): Promise<AiOriginalRequestAccess>;
  read(body: AiSceneRequestBody, sceneVersion: string): Promise<AiOriginalRequestAccess>;
  create(body: AiSceneRequestBody): Promise<AiOriginalRequestCreationAccess>;
  /** Current task read policy only, for retained business locators without
   * erased scene material. Never authorizes creation or a new effect. */
  observeTask?(taskId: string): Promise<AiOriginalRequestAccess>;
}
export interface AiOriginalRequestNativeAuthority {
  /** Internal observer bound to this active transaction and original lifecycle.
   * Owner supplies coherent isolation/locks and final adoption/commit handling.
   * This authority cannot substitute for a request locator or an execution grant. */
  bindIn(native: Prisma.TransactionClient, signal: AbortSignal): AiOriginalRequestAuthority & { assertCurrent(): void };
}
export const originalIdentityHash = (context: AiExecutionContext) => {
  const { requestId: _request, authorizedAt: _at, ...identity } = context;
  return requestFingerprint(identity);
};
const ruleSchema = z.object({ sceneCode: z.enum(AI_SCENE_CODES), sceneVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u),
  revision: z.number().int().min(1).max(4294967294), audiences: z.array(z.enum(['operator', 'staff'])).min(1).max(2),
  requiredPermissions: z.array(z.string().min(1).max(191)).min(1).max(64),
  maxInputAgeMs: z.number().int().min(1000).max(86400000) }).strict();
export type AiSceneCreationRule = z.infer<typeof ruleSchema>;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
type Entitlement = Awaited<ReturnType<PrismaSubscriptionBudgetReader['read']>>;
type Plan = Awaited<ReturnType<PrismaClient['aiTaskPlanPolicy']['findFirst']>>;
type OriginalSources = {
  current(): Promise<AiOriginalRequestAccess>;
  plan(scopeId: string, rule: AiSceneCreationRule): Promise<Plan>;
  entitlement(tenantId: string): Promise<Entitlement>;
  resources(body: AiSceneRequestBody): Promise<AiExecutionContext>;
  live(): void;
};

/** One algorithm, not a second scene/policy state machine. Sources determine
 * where current facts are observed; identity/hash/permission/expiry rules do not. */
class OriginalRequestChecks implements AiOriginalRequestAuthority {
  private readonly rules: readonly AiSceneCreationRule[];
  constructor(rules: readonly AiSceneCreationRule[], private readonly sources: OriginalSources,
    private readonly clock: () => Date) {
    this.rules = freezeOriginalInput(z.array(ruleSchema).max(3).parse(rules));
    if (new Set(this.rules.map(rule => rule.sceneCode)).size !== this.rules.length) throw unavailable();
  }
  async current() {
    this.sources.live();
    const current = await this.sources.current();
    this.sources.live();
    return current;
  }
  private rule(sceneCode: AiSceneCode) {
    const rule = this.rules.find(row => row.sceneCode === sceneCode);
    if (!rule) throw unavailable();
    return rule;
  }
  async read(body: AiSceneRequestBody, sceneVersion: string) {
    this.sources.live();
    if (this.rule(body.sceneCode).sceneVersion !== sceneVersion) throw unavailable();
    const before = await this.current();
    let authorized: AiExecutionContext;
    try { this.sources.live(); authorized = await this.sources.resources(freezeOriginalInput(structuredClone(body))); this.sources.live(); }
    catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      if (error instanceof Error && 'code' in error && (error.code === 'FORBIDDEN' || error.code === 'AI_ACCESS_DENIED')) throw denied();
      throw unavailable();
    }
    const after = await this.current();
    if (before.scopeId !== after.scopeId || originalIdentityHash(before.context) !== originalIdentityHash(after.context)
      || originalIdentityHash(authorized) !== originalIdentityHash(after.context)) throw denied();
    return after;
  }
  private async policy(body: AiSceneRequestBody) {
    // Check the persisted entry policy BEFORE collecting business material.
    // Merely registering the standard host must not enable disabled scenes.
    const rule = this.rule(body.sceneCode), access = await this.current();
    if (!rule.audiences.includes(access.context.audience as 'operator' | 'staff') || !('access' in access.context)
      || rule.requiredPermissions.some(permission => !('access' in access.context) || !hasEffectivePermission(access.context.access.permissions, permission))) throw denied();
    let row;
    this.sources.live();
    try { row = await this.sources.plan(access.scopeId, rule); }
    catch { throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE'); }
    this.sources.live();
    if (!row || row.scopeId !== access.scopeId || row.sceneCode !== rule.sceneCode || row.sceneVersion !== rule.sceneVersion
      || !row.enabled || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.expiresAt.getTime() <= this.clock().getTime()) throw unavailable();
    if (access.context.scope.kind !== 'workspace') throw denied();
    let entitlement;
    try { this.sources.live(); entitlement = await this.sources.entitlement(access.context.scope.tenantId); this.sources.live(); }
    catch { throw unavailable(); }
    if (entitlement.entitlements.length !== 1 || !entitlement.entitlements[0].available) throw unavailable();
    const resource = await this.read(body, rule.sceneVersion);
    if (resource.scopeId !== access.scopeId || originalIdentityHash(resource.context) !== originalIdentityHash(access.context)) throw denied();
    return { ...access, sceneVersion: rule.sceneVersion, policyRevision: row.revision,
      policyHash: requestFingerprint({ rule, plan: { revision: row.revision, expiresAt: row.expiresAt.toISOString(), allowedTools: row.allowedTools, limits: row.limits }, entitlement }),
      expiresAt: new Date(Math.min(row.expiresAt.getTime(), this.clock().getTime() + rule.maxInputAgeMs)).toISOString() };
  }
  async create(body: AiSceneRequestBody) {
    this.sources.live();
    const frozen = freezeOriginalInput(structuredClone(body));
    const before = await this.policy(frozen), after = await this.policy(frozen);
    if (before.scopeId !== after.scopeId || originalIdentityHash(before.context) !== originalIdentityHash(after.context)
      || before.policyHash !== after.policyHash) throw denied();
    this.sources.live();
    return { ...after, expiresAt: before.expiresAt };
  }
}

export class AiCurrentOriginalRequestAuthority extends OriginalRequestChecks {
  private readonly observations?: AiTaskCurrentActionAuthority;
  constructor(db: Pick<PrismaClient, '$transaction' | 'aiScope' | 'aiTaskPlanPolicy'>
    & Partial<Pick<PrismaClient, 'aiTaskActionPolicy'>>,
    input: { auth: Pick<AuthService, 'resolveAccessContext'>; credentials: AiTaskCredentialSource;
      subscriptions: Pick<SubscriptionService, 'readCategoryCommercialContext'>;
      creationRules: readonly AiSceneCreationRule[];
      authorizeResources(body: AiSceneRequestBody): Promise<AiExecutionContext> },
    clock: () => Date = () => new Date()) {
    const scopes = new AiScopeRepository(db, new AiTaskCurrentIdentityAuthority(input.auth, input.credentials, clock), clock);
    const entitlements = new PrismaSubscriptionBudgetReader(db, input.subscriptions, clock);
    super(input.creationRules, {
      async current() {
        const current = await scopes.resolveCurrent();
        if (current.scope.kind !== 'WORKSPACE' || current.context.actor.kind !== 'user'
          || !['operator', 'staff'].includes(current.context.audience)) throw denied();
        return { context: current.context, scopeId: current.scope.id };
      },
      plan: (scopeId, rule) => db.aiTaskPlanPolicy.findFirst({ where: { scopeId, sceneCode: rule.sceneCode, sceneVersion: rule.sceneVersion } }),
      entitlement: tenantId => entitlements.read(tenantId, 'ai.native.use'),
      resources: input.authorizeResources, live: () => {}
    }, clock);
    if (typeof db.aiTaskActionPolicy?.findUnique === 'function') this.observations = new AiTaskCurrentActionAuthority(
      input.auth, input.credentials, new PrismaTaskActionPolicySource({ aiTaskActionPolicy: db.aiTaskActionPolicy }, scopes, clock), clock);
  }
  async observeTask(taskId: string) {
    if (!this.observations) throw unavailable();
    const context = await this.observations.resolve(taskId, 'read_metadata'), current = await this.current();
    if (originalIdentityHash(context) !== originalIdentityHash(current.context)) throw denied();
    return current;
  }
}

/** Required producers are captured once; observations remain current per call.
 * No implicit Web authority, transaction or resource-success default is supplied. */
export function createNativeOriginalRequestAuthority(input: {
  creationRules: readonly AiSceneCreationRule[];
  currentIn(native: Prisma.TransactionClient, signal: AbortSignal): Promise<AiOriginalRequestAccess>;
  entitlements: Pick<PrismaSubscriptionBudgetReader, 'readIn'>;
  authorizeResourcesIn(body: AiSceneRequestBody, native: Prisma.TransactionClient, signal: AbortSignal): Promise<AiExecutionContext>;
  assertCurrent(): void;
}, clock: () => Date = () => new Date()): AiOriginalRequestNativeAuthority {
  if (typeof input?.currentIn !== 'function' || typeof input.entitlements?.readIn !== 'function'
    || typeof input.authorizeResourcesIn !== 'function' || typeof input.assertCurrent !== 'function') throw unavailable();
  const current = input.currentIn.bind(input), resources = input.authorizeResourcesIn.bind(input);
  const entitlement = input.entitlements.readIn.bind(input.entitlements), assertCurrent = input.assertCurrent.bind(input);
  const rules = freezeOriginalInput(z.array(ruleSchema).max(3).parse(input.creationRules));
  return Object.freeze({ bindIn(native: Prisma.TransactionClient, signal: AbortSignal): AiOriginalRequestAuthority & { assertCurrent(): void } {
    const live = () => { if (signal.aborted) throw denied(); assertCurrent(); };
    live();
    if (!native || '$transaction' in native || typeof native.aiTaskPlanPolicy?.findFirst !== 'function') throw unavailable();
    // Capture the delegate too: replacing caller fields cannot redirect the read.
    const findPlan = native.aiTaskPlanPolicy.findFirst.bind(native.aiTaskPlanPolicy);
    const checks = new OriginalRequestChecks(rules, {
      live,
      current: () => current(native, signal),
      plan: (scopeId, rule) => findPlan({ where: { scopeId, sceneCode: rule.sceneCode, sceneVersion: rule.sceneVersion } }),
      entitlement: tenantId => entitlement(tenantId, 'ai.native.use', native, signal),
      resources: body => resources(body, native, signal)
    }, clock);
    const observed = async <T>(operation: () => Promise<T>) => { live(); const result = await operation(); live(); return freezeOriginalInput(structuredClone(result)); };
    return Object.freeze({
      assertCurrent: live,
      current: () => observed(() => checks.current()),
      read: (body: AiSceneRequestBody, version: string) => observed(() => checks.read(body, version)),
      async create(body: AiSceneRequestBody) {
        const result = await observed(() => checks.create(body)), now = clock();
        live();
        // Native metadata must not outlive the entry/input deadline during slow
        // resource checks. This is not an extension of the original expiry.
        if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || new Date(result.expiresAt) <= now) throw unavailable();
        return result;
      }
    });
  } });
}
