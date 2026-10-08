import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
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

export interface AiOriginalRequestAccess { context: AiExecutionContext; scopeId: string }
export interface AiOriginalRequestCreationAccess extends AiOriginalRequestAccess {
  sceneVersion: string; policyRevision: number; policyHash: string; expiresAt: string;
}
export interface AiOriginalRequestAuthority {
  current(): Promise<AiOriginalRequestAccess>;
  read(body: AiSceneRequestBody, sceneVersion: string): Promise<AiOriginalRequestAccess>;
  create(body: AiSceneRequestBody): Promise<AiOriginalRequestCreationAccess>;
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

export class AiCurrentOriginalRequestAuthority implements AiOriginalRequestAuthority {
  private readonly scopes: AiScopeRepository;
  private readonly entitlements: PrismaSubscriptionBudgetReader;
  private readonly rules: readonly AiSceneCreationRule[];
  constructor(private readonly db: Pick<PrismaClient, '$transaction' | 'aiScope' | 'aiTaskPlanPolicy'>,
    input: { auth: Pick<AuthService, 'resolveAccessContext'>; credentials: AiTaskCredentialSource;
      subscriptions: Pick<SubscriptionService, 'readCategoryCommercialContext'>;
      creationRules: readonly AiSceneCreationRule[];
      authorizeResources(body: AiSceneRequestBody): Promise<AiExecutionContext> },
    private readonly clock: () => Date = () => new Date()) {
    this.rules = freezeOriginalInput(z.array(ruleSchema).max(3).parse(input.creationRules));
    if (new Set(this.rules.map(rule => rule.sceneCode)).size !== this.rules.length) throw unavailable();
    this.scopes = new AiScopeRepository(db, new AiTaskCurrentIdentityAuthority(input.auth, input.credentials, clock), clock);
    this.entitlements = new PrismaSubscriptionBudgetReader(db, input.subscriptions, clock);
    this.resources = input.authorizeResources;
  }
  private readonly resources: (body: AiSceneRequestBody) => Promise<AiExecutionContext>;
  async current() {
    const current = await this.scopes.resolveCurrent();
    if (current.scope.kind !== 'WORKSPACE' || current.context.actor.kind !== 'user'
      || !['operator', 'staff'].includes(current.context.audience)) throw denied();
    return { context: current.context, scopeId: current.scope.id };
  }
  private rule(sceneCode: AiSceneCode) {
    const rule = this.rules.find(row => row.sceneCode === sceneCode);
    if (!rule) throw unavailable();
    return rule;
  }
  async read(body: AiSceneRequestBody, sceneVersion: string) {
    if (this.rule(body.sceneCode).sceneVersion !== sceneVersion) throw unavailable();
    const before = await this.current();
    let authorized: AiExecutionContext;
    try { authorized = await this.resources(freezeOriginalInput(structuredClone(body))); }
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
    const rule = this.rule(body.sceneCode), access = await this.read(body, rule.sceneVersion);
    if (!rule.audiences.includes(access.context.audience as 'operator' | 'staff') || !('access' in access.context)
      || rule.requiredPermissions.some(permission => !('access' in access.context) || !access.context.access.permissions.includes(permission))) throw denied();
    let row;
    try { row = await this.db.aiTaskPlanPolicy.findFirst({ where: { scopeId: access.scopeId, sceneCode: rule.sceneCode, sceneVersion: rule.sceneVersion } }); }
    catch { throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE'); }
    if (!row || row.scopeId !== access.scopeId || row.sceneCode !== rule.sceneCode || row.sceneVersion !== rule.sceneVersion
      || !row.enabled || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.expiresAt.getTime() <= this.clock().getTime()) throw unavailable();
    if (access.context.scope.kind !== 'workspace') throw denied();
    let entitlement;
    try { entitlement = await this.entitlements.read(access.context.scope.tenantId, 'ai.native.use'); }
    catch { throw unavailable(); }
    if (entitlement.entitlements.length !== 1 || !entitlement.entitlements[0].available) throw unavailable();
    return { ...access, sceneVersion: rule.sceneVersion, policyRevision: row.revision,
      policyHash: requestFingerprint({ rule, plan: { revision: row.revision, expiresAt: row.expiresAt.toISOString(), allowedTools: row.allowedTools, limits: row.limits }, entitlement }),
      expiresAt: new Date(Math.min(row.expiresAt.getTime(), this.clock().getTime() + rule.maxInputAgeMs)).toISOString() };
  }
  async create(body: AiSceneRequestBody) {
    const frozen = freezeOriginalInput(structuredClone(body));
    const before = await this.policy(frozen), after = await this.policy(frozen);
    if (before.scopeId !== after.scopeId || originalIdentityHash(before.context) !== originalIdentityHash(after.context)
      || before.policyHash !== after.policyHash) throw denied();
    return { ...after, expiresAt: before.expiresAt };
  }
}
