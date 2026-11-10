import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext, type AiUsageSettingsDraft } from '@rental-os/shared';
import type { ClientRequestContext } from '../../client/client-auth.service';
import type { SubscriptionService } from '../../subscription/subscription.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { PrismaSubscriptionBudgetReader } from '../budget/prisma-subscription-budget-reader';
import { validateBudgetSettings } from '../budget/budget-settings';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { AiClientMaterialDb, AiClientMaterialScope, AiClientSceneMaterial } from './prisma-client-scene-material.repository';
import { clientSqlPolicyRevisionSchema } from './client-sql-revisions';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const clientTaskSceneSchema = z.object({ sceneCode: id.max(128), sceneVersion: id.max(64) }).strict();
export type AiClientTaskScene = z.infer<typeof clientTaskSceneSchema>;
export type AiClientTaskDb = AiClientMaterialDb & Pick<PrismaClient, 'aiScope' | 'aiTask' | 'aiRun' | 'aiBudgetPolicy'>;
export type AiClientTaskDependencies = AiClientTaskScene & {
  db: AiClientTaskDb;
  subscriptions: Pick<SubscriptionService, 'readCategoryCommercialContext'>;
};
export type AiAuthorizedClientMaterial = { row: AiClientSceneMaterial; identity: ClientRequestContext };
const sqlBoolean = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(value => value === true || value === 1);
const policySchema = z.object({ id: z.string().uuid(), tenantId: id, workspaceId: id,
  channel: z.enum(['wechat_miniprogram', 'app', 'web']), customerType: z.enum(['personal', 'corporate']),
  sceneCode: id.max(128), sceneVersion: id.max(64), enabled: sqlBoolean, allowCreate: sqlBoolean, allowRead: sqlBoolean,
  allowExecute: sqlBoolean.optional().default(false),
  allowRequestInput: sqlBoolean.optional().default(false), allowSubmitInput: sqlBoolean.optional().default(false),
  allowResumeInput: sqlBoolean.optional().default(false),
  allowCancel: sqlBoolean.optional().default(false),
  revision: clientSqlPolicyRevisionSchema, expiresAt: z.date() }).strict();
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
type ClientPolicyOperation = 'create' | 'read' | 'capabilities' | 'execute' | 'request_input' | 'submit_input' | 'resume_input' | 'cancel';
const permits = (policy: z.infer<typeof policySchema>, operation: ClientPolicyOperation) => {
  switch (operation) {
    case 'create': return policy.allowCreate;
    case 'execute': return policy.allowExecute;
    case 'request_input': return policy.allowRequestInput;
    case 'submit_input': return policy.allowSubmitInput;
    case 'resume_input': return policy.allowResumeInput;
    case 'cancel': return policy.allowCancel;
    case 'read': case 'capabilities': return policy.allowRead;
  }
};

type ClientPolicySubject = Pick<AiClientMaterialScope, 'tenantId' | 'workspaceId' | 'channel' | 'principalKind'>
  & { identity: ClientRequestContext };

export class AiClientPolicyAuthority {
  private readonly entitlements: PrismaSubscriptionBudgetReader;
  constructor(private readonly dependencies: AiClientTaskDependencies, private readonly scene: AiClientTaskScene,
    private readonly requestId: string, private readonly clock: () => Date) {
    this.entitlements = new PrismaSubscriptionBudgetReader(dependencies.db, dependencies.subscriptions, clock);
  }
  async policy(subject: ClientPolicySubject, operation: ClientPolicyOperation) {
    subject = structuredClone(subject);
    const { identity } = subject;
    let rows: unknown[];
    try {
      rows = await this.dependencies.db.$queryRaw<unknown[]>(Prisma.sql`SELECT * FROM ai_client_task_policies
        WHERE tenantId = ${subject.tenantId} AND workspaceId = ${subject.workspaceId} AND channel = ${subject.channel}
        AND customerType = ${subject.principalKind} AND sceneCode = ${this.scene.sceneCode} AND sceneVersion = ${this.scene.sceneVersion} LIMIT 1`);
    } catch { throw unavailable(); }
    const parsed = policySchema.safeParse(Array.isArray(rows) && rows.length === 1 ? rows[0] : null);
    if (!parsed.success) throw unavailable();
    const policy = parsed.data;
    if (identity.tenantId !== subject.tenantId || identity.workspaceId !== subject.workspaceId || identity.customerType !== subject.principalKind
      || identity.membershipStatus !== 'active' || !identity.sessionId || !identity.customerId
      || policy.tenantId !== subject.tenantId || policy.workspaceId !== subject.workspaceId || policy.channel !== subject.channel
      || policy.customerType !== subject.principalKind || policy.sceneCode !== this.scene.sceneCode || policy.sceneVersion !== this.scene.sceneVersion
      || !policy.enabled || !permits(policy, operation)
      || policy.expiresAt <= this.clock()) throw denied();
    return policy;
  }
  private async gates(context: AiExecutionContext) {
    if (context.scope.kind !== 'workspace') throw denied();
    const tenantId = context.scope.tenantId, sceneCode = this.scene.sceneCode;
    const columns = [aiPersistenceScopeColumns({ kind: 'platform' }), aiPersistenceScopeColumns({ kind: 'tenant', tenantId }), aiPersistenceScopeColumns(context.scope)];
    return this.dependencies.db.$transaction(async tx => {
      const gates = [];
      for (const expected of columns) {
        const scope = await tx.aiScope.findFirst({ where: expected, select: { id: true, kind: true, scopeKey: true, tenantId: true, workspaceId: true } });
        if (!scope || Object.entries(expected).some(([key, value]) => scope[key as keyof typeof scope] !== value)) throw denied();
        const key = { scopeId: scope.id, scopeKind: scope.kind, sceneCode };
        const row = await tx.aiBudgetPolicy.findUnique({ where: { scopeId_scopeKind_sceneCode: key } });
        if (!row || Object.entries(key).some(([name, value]) => row[name as keyof typeof row] !== value)
          || !row.enabled || !Number.isSafeInteger(row.configRevision) || row.configRevision < 1) throw unavailable();
        const settings = structuredClone(row.settingsJson) as unknown as AiUsageSettingsDraft;
        validateBudgetSettings(settings);
        const expectedScope = scope.kind === 'PLATFORM' ? { kind: 'platform' } : { kind: 'tenant', tenantId };
        if (requestFingerprint(settings.scope) !== requestFingerprint(expectedScope) || settings.sceneCode !== sceneCode
          || !settings.allowedScenes.includes(sceneCode) || !settings.allowedModels.length || settings.budget.state !== 'limited'
          || settings.maxConcurrent < 1 || settings.maxCallsPerRun < 1 || !Object.values(settings.gates).every(gate => gate.enabled)) throw unavailable();
        gates.push({ key, id: row.id, revision: row.configRevision, settings });
      }
      return gates;
    // This is an authorization snapshot, not an atomic reservation. Non-locking
    // reads must not wait on the caller's budget transaction's own policy locks.
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
  }
  async authorize(subject: ClientPolicySubject, operation: ClientPolicyOperation) {
    subject = structuredClone(subject);
    const policy = await this.policy(subject, operation);
    const context: AiExecutionContext = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: this.requestId,
      authorizedAt: this.clock().toISOString(), audience: 'client', actor: { kind: 'customer', customerId: subject.identity.customerId },
      scope: { kind: 'workspace', tenantId: subject.tenantId, workspaceId: subject.workspaceId } };
    let policyHash: string | null = null;
    // Stopping an original task does not reserve/dispatch another AI call.
    // Its current independent policy remains mandatory, but exhausted usage
    // must not force the customer to keep an existing task running.
    if (operation !== 'read' && operation !== 'cancel') {
      const gates = await this.gates(context), entitlement = await this.entitlements.read(subject.tenantId, 'ai.native.use');
      if (entitlement.entitlements.length !== 1 || entitlement.entitlements[0].code !== 'ai.native.use' || !entitlement.entitlements[0].available) throw unavailable();
      policyHash = requestFingerprint({ policy: { ...policy, expiresAt: policy.expiresAt.toISOString() }, gates, entitlement });
    }
    const latest = await this.policy(subject, operation);
    if (requestFingerprint({ ...policy, expiresAt: policy.expiresAt.toISOString() })
      !== requestFingerprint({ ...latest, expiresAt: latest.expiresAt.toISOString() })) throw denied();
    return { context, policy, policyHash };
  }
}

export class AiClientTaskAuthority {
  private readonly authority: AiClientPolicyAuthority;
  constructor(dependencies: AiClientTaskDependencies, scene: AiClientTaskScene,
    private readonly loadMaterial: (materialRef: string) => Promise<AiAuthorizedClientMaterial>,
    requestId: string, clock: () => Date) {
    this.authority = new AiClientPolicyAuthority(dependencies, scene, requestId, clock);
  }
  async authorize(materialRef: string, operation: Exclude<ClientPolicyOperation, 'capabilities'>) {
    const material = structuredClone(await this.loadMaterial(materialRef));
    const grant = await this.authority.authorize({ ...material.row, identity: material.identity }, operation);
    const current = structuredClone(await this.loadMaterial(materialRef));
    const latest = await this.authority.policy({ ...current.row, identity: current.identity }, operation);
    if (requestFingerprint({ ...grant.policy, expiresAt: grant.policy.expiresAt.toISOString() }) !== requestFingerprint({ ...latest, expiresAt: latest.expiresAt.toISOString() })
      || current.row.bindingHash !== material.row.bindingHash || current.row.materialHash !== material.row.materialHash
      || current.identity.customerId !== material.identity.customerId || current.identity.sessionId !== material.identity.sessionId) throw denied();
    return { ...grant, material: current.row };
  }
}
