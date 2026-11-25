/** Current scene/service admission shared by Task execution and human approval.
 * Read through the caller's existing snapshot or transaction. This does not grant
 * a model invocation, reserve money, decrypt credentials or consume approval. */
import type { Prisma } from '@prisma/client';
import type { AiExecutionContext, AiUsageSettingsDraft } from '@rental-os/shared';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { AiTaskRepositoryError } from './ai-task.repository';
import { aiPersistenceScopeColumns } from './persistence-scope';
import { validateBudgetSettings } from './budget/budget-settings';
import { checkedTenantModelRecord } from './tenant-model-config.repository';
import { tenantModelMode, tenantModelServiceEnabled } from './model-config-compatibility';
import { aiPersistedPlanToolsSchema } from './runner/prisma-task-plan-input.source';
import { aiTaskRunnerLimitsSchema } from './runner/prisma-task-run-evidence.repository';

const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const validRevision = (value: number) => Number.isSafeInteger(value) && value > 0 && value <= 4294967294;
type Reader = Pick<Prisma.TransactionClient, 'aiTenantModelConfiguration' | 'aiScope' | 'aiBudgetPolicy' | 'aiTaskPlanPolicy'>;

export async function readTaskServiceAdmission(tx: Reader, context: AiExecutionContext, taskScopeId: string,
  sceneCode: string, sceneVersion: string, clock: () => Date) {
  if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user') throw denied();
  const tenantId = context.scope.tenantId;
  const columns = [aiPersistenceScopeColumns({ kind: 'platform' }), aiPersistenceScopeColumns({ kind: 'tenant', tenantId }), aiPersistenceScopeColumns(context.scope)];
  // The current settings row selects the new admission contract. Its disabled
  // or malformed state never falls back to legacy grants. No credential is
  // decrypted, no meter policy is seeded and no Gateway is called here.
  if (typeof tx.aiTenantModelConfiguration?.findUnique !== 'function') throw unavailable();
  const configured = structuredClone(await tx.aiTenantModelConfiguration.findUnique({ where: { tenantId }, select: {
    tenantId: true, revision: true, mode: true, serviceEnabled: true, settings: true, credentialsEncrypted: true
  } }));
  const record = configured ? checkedTenantModelRecord({ tenantId: configured.tenantId,
    revision: configured.revision, mode: configured.mode,
    ...(configured.serviceEnabled !== null ? { serviceEnabled: configured.serviceEnabled } : {}),
    ...(configured.settings !== null ? { settings: configured.settings } : {}),
    ...(configured.credentialsEncrypted !== null ? { credentialsEncrypted: configured.credentialsEncrypted } : {}) }) : null;
  if (record && (record.tenantId !== tenantId || !tenantModelServiceEnabled(record))) throw unavailable();
  // Only an explicitly saved mode + service switch selects the new path.
  // An old BYOK row without that binding keeps its original three policies.
  const modern = record !== null && record.mode !== undefined && typeof record.serviceEnabled === 'boolean';
  // All six original leaves belong to this same consistent read snapshot.
  // Batch only transport, never cache across the two admission snapshots or
  // remove a policy/owner check. The fourth row detects invalid duplicates.
  const foundScopes = await tx.aiScope.findMany({ where: { OR: columns }, take: 4,
    select: { id: true, kind: true, scopeKey: true, tenantId: true, workspaceId: true } });
  if (foundScopes.length !== columns.length) throw denied();
  const currentScopes = columns.map(expected => {
    const matches = foundScopes.filter(scope => Object.entries(expected).every(([key, value]) => scope[key as keyof typeof scope] === value));
    if (matches.length !== 1 || (matches[0].kind === 'WORKSPACE' && matches[0].id !== taskScopeId)) throw denied();
    return matches[0];
  });
  const policyKeys = currentScopes.map(scope => ({ scopeId: scope.id, scopeKind: scope.kind, sceneCode }));
  const foundPolicies = await tx.aiBudgetPolicy.findMany({ where: { OR: policyKeys }, take: 4, select: {
    id: true, scopeId: true, scopeKind: true, sceneCode: true, configRevision: true, enabled: true, settingsJson: true
  } });
  if (foundPolicies.length > policyKeys.length || foundPolicies.some(row => !policyKeys.some(key =>
    Object.entries(key).every(([name, value]) => row[name as keyof typeof row] === value)))) throw unavailable();
  const results = [];
  for (const [index, scope] of currentScopes.entries()) {
    const key = policyKeys[index];
    const matches = foundPolicies.filter(row => Object.entries(key).every(([name, value]) => row[name as keyof typeof row] === value));
    if (matches.length > 1) throw unavailable();
    const row = matches[0] ?? null;
    // New settings need only the SaaS scene policy; the tenant/workspace
    // money intersections are created later by the original locked ledger.
    // Existing legacy policies still restrict admission, never get replaced.
    if (modern && scope.kind !== 'PLATFORM' && !row) continue;
    if (!row || Object.entries(key).some(([name, value]) => row[name as keyof typeof row] !== value)
      || !validRevision(row.configRevision)) throw unavailable();
    const settings = structuredClone(row.settingsJson) as unknown as AiUsageSettingsDraft;
    validateBudgetSettings(settings);
    const requiredScope = scope.kind === 'PLATFORM' ? { kind: 'platform' } : { kind: 'tenant', tenantId };
    // The indexed enabled flag also includes monetary availability. BYOK
    // still obeys the explicit scene/service gates and operational limits,
    // but a zero/unconfigured platform amount is not its spending ceiling.
    const byok = modern && tenantModelMode(record) === 'tenant_managed';
    const financialOnlyStop = byok && scope.kind === 'PLATFORM' && row.enabled === false
      && (settings.budget.state === 'not_configured'
        || settings.budget.state === 'zero' && settings.budget.quantity.unit === 'money');
    if (requestFingerprint(settings.scope) !== requestFingerprint(requiredScope) || settings.sceneCode !== sceneCode
      || !settings.allowedScenes.includes(sceneCode) || !settings.allowedModels.length
      || (!byok && settings.budget.state !== 'limited') || (row.enabled !== true && !financialOnlyStop)
      || settings.maxConcurrent < 1 || settings.maxCallsPerRun < 1 || !Object.values(settings.gates).every(gate => gate.enabled === true)) throw unavailable();
    results.push({ key, id: row.id, revision: row.configRevision, settings });
  }
  if (!modern) return { contract: 'legacy-scene-budget', policies: results,
    configuration: record ? { tenantId, revision: record.revision, mode: tenantModelMode(record),
      enabled: tenantModelServiceEnabled(record), binding: requestFingerprint(record) } : null };
  if (tenantModelMode(record) === 'tenant_managed' && (!record.settings?.enabled || !record.credentialsEncrypted)) throw unavailable();
  const key = { scopeId: taskScopeId, sceneCode, sceneVersion };
  const plan = typeof tx.aiTaskPlanPolicy?.findFirst === 'function'
    ? structuredClone(await tx.aiTaskPlanPolicy.findFirst({ where: key })) : null;
  if (!plan || Object.entries(key).some(([name, value]) => plan[name as keyof typeof plan] !== value)
    || !validRevision(plan.revision) || plan.enabled !== true || !(plan.expiresAt instanceof Date)
    || !Number.isFinite(plan.expiresAt.getTime()) || plan.expiresAt <= clock()) throw unavailable();
  const tools = aiPersistedPlanToolsSchema.parse(plan.allowedTools);
  const limits = aiTaskRunnerLimitsSchema.parse(plan.limits);
  if (limits.maxStepMs > limits.maxTotalMs) throw unavailable();
  return { contract: 'service-plan-policy', configuration: { tenantId, revision: record.revision,
    mode: tenantModelMode(record), enabled: tenantModelServiceEnabled(record), binding: requestFingerprint(record) }, policies: results,
    plan: { ...key, revision: plan.revision, tools, limits, expiresAt: plan.expiresAt.toISOString() } };
}
