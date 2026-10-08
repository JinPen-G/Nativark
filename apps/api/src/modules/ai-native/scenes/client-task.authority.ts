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
import type { AiClientMaterialDb, AiClientSceneMaterial } from './prisma-client-scene-material.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const clientTaskSceneSchema = z.object({ sceneCode: id.max(128), sceneVersion: id.max(64) }).strict();
export type AiClientTaskScene = z.infer<typeof clientTaskSceneSchema>;
export type AiClientTaskDb = AiClientMaterialDb & Pick<PrismaClient, 'aiScope' | 'aiTask' | 'aiBudgetPolicy'>;
export type AiClientTaskDependencies = AiClientTaskScene & {
  db: AiClientTaskDb;
  subscriptions: Pick<SubscriptionService, 'readCategoryCommercialContext'>;
};
export type AiAuthorizedClientMaterial = { row: AiClientSceneMaterial; identity: ClientRequestContext };
const sqlBoolean = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(value => value === true || value === 1);
const policySchema = z.object({ id: z.string().uuid(), tenantId: id, workspaceId: id,
  channel: z.enum(['wechat_miniprogram', 'app', 'web']), customerType: z.enum(['personal', 'corporate']),
  sceneCode: id.max(128), sceneVersion: id.max(64), enabled: sqlBoolean, allowCreate: sqlBoolean, allowRead: sqlBoolean,
  revision: z.number().int().min(1).max(4294967294), expiresAt: z.date() }).strict();
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');

export class AiClientTaskAuthority {
  private readonly entitlements: PrismaSubscriptionBudgetReader;
  constructor(private readonly dependencies: AiClientTaskDependencies, private readonly scene: AiClientTaskScene,
    private readonly loadMaterial: (materialRef: string) => Promise<AiAuthorizedClientMaterial>,
    private readonly requestId: string, private readonly clock: () => Date) {
    this.entitlements = new PrismaSubscriptionBudgetReader(dependencies.db, dependencies.subscriptions, clock);
  }
  private async policy(material: AiAuthorizedClientMaterial, operation: 'create' | 'read') {
    const { row, identity } = material;
    let rows: unknown[];
    try {
      rows = await this.dependencies.db.$queryRaw<unknown[]>(Prisma.sql`SELECT * FROM ai_client_task_policies
        WHERE tenantId = ${row.tenantId} AND workspaceId = ${row.workspaceId} AND channel = ${row.channel}
        AND customerType = ${row.principalKind} AND sceneCode = ${this.scene.sceneCode} AND sceneVersion = ${this.scene.sceneVersion} LIMIT 1`);
    } catch { throw unavailable(); }
    const parsed = policySchema.safeParse(Array.isArray(rows) && rows.length === 1 ? rows[0] : null);
    if (!parsed.success) throw unavailable();
    const policy = parsed.data;
    if (identity.tenantId !== row.tenantId || identity.workspaceId !== row.workspaceId || identity.customerType !== row.principalKind
      || policy.tenantId !== row.tenantId || policy.workspaceId !== row.workspaceId || policy.channel !== row.channel
      || policy.customerType !== row.principalKind || policy.sceneCode !== this.scene.sceneCode || policy.sceneVersion !== this.scene.sceneVersion
      || !policy.enabled || !(operation === 'create' ? policy.allowCreate : policy.allowRead) || policy.expiresAt <= this.clock()) throw denied();
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  }
  async authorize(materialRef: string, operation: 'create' | 'read') {
    const material = await this.loadMaterial(materialRef), policy = await this.policy(material, operation);
    const context: AiExecutionContext = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: this.requestId,
      authorizedAt: this.clock().toISOString(), audience: 'client', actor: { kind: 'customer', customerId: material.identity.customerId },
      scope: { kind: 'workspace', tenantId: material.row.tenantId, workspaceId: material.row.workspaceId } };
    let policyHash: string | null = null;
    if (operation === 'create') {
      const gates = await this.gates(context), entitlement = await this.entitlements.read(material.row.tenantId, 'ai.native.use');
      if (entitlement.entitlements.length !== 1 || entitlement.entitlements[0].code !== 'ai.native.use' || !entitlement.entitlements[0].available) throw unavailable();
      policyHash = requestFingerprint({ policy: { ...policy, expiresAt: policy.expiresAt.toISOString() }, gates, entitlement });
    }
    const current = await this.loadMaterial(materialRef), latest = await this.policy(current, operation);
    if (requestFingerprint({ ...policy, expiresAt: policy.expiresAt.toISOString() }) !== requestFingerprint({ ...latest, expiresAt: latest.expiresAt.toISOString() })
      || current.row.bindingHash !== material.row.bindingHash || current.row.materialHash !== material.row.materialHash
      || current.identity.customerId !== material.identity.customerId || current.identity.sessionId !== material.identity.sessionId) throw denied();
    return { context, material: current.row, policy, policyHash };
  }
}
