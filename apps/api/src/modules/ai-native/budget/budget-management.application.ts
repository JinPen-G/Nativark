import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runWithRequestIdentity } from '../../../common/request-identity';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import { createAuthorizedPersistedGatewayBudget, createPersistedGatewayBudget } from './gateway-budget.composition';
import { createAuthorizedPlatformBudgetSettings } from './platform-budget-settings.composition';
import { PrismaTaskBudgetAuthorizationSource } from './prisma-task-budget-authorization.source';
import { PrismaGatewayCallPricing } from './prisma-gateway-call-pricing';
import { BudgetError, type BudgetPolicy } from './budget.ports';
import { presentBudgetSettingsFields } from './budget-settings';

const code = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const read = z.object({ scope: z.enum(['tenant', 'workspace']), sceneCode: code }).strict();
const count = z.number().int().min(0).max(10000);
const quantity = z.discriminatedUnion('unit', [
  z.object({ unit: z.literal('calls'), value: z.number().int().min(0).max(4294967295) }).strict(),
  z.object({ unit: z.literal('tokens'), value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ unit: z.literal('money'), amount: z.string().regex(/^(0|[1-9][0-9]{0,17})\.[0-9]{6}$/u),
    currency: z.string().regex(/^[A-Z]{3}$/u), scale: z.literal(6) }).strict()
]);
const zeroQuantity = z.discriminatedUnion('unit', [
  z.object({ unit: z.literal('calls'), value: z.literal(0) }).strict(),
  z.object({ unit: z.literal('tokens'), value: z.literal(0) }).strict(),
  z.object({ unit: z.literal('money'), amount: z.literal('0.000000'), currency: z.string().regex(/^[A-Z]{3}$/u), scale: z.literal(6) }).strict()
]);
const budget = z.union([
  z.object({ state: z.literal('not_configured') }).strict(),
  z.object({ state: z.literal('zero'), quantity: zeroQuantity }).strict(),
  z.object({ state: z.literal('limited'), quantity }).strict().refine(value => value.quantity.unit === 'money'
    ? value.quantity.amount !== '0.000000' : value.quantity.value > 0)
]);
const revision = z.number().int().min(0).max(4294967294);
const change = read.extend({ expectedRevision: revision, changes: z.object({ budget: budget.optional(),
  maxConcurrent: count.optional(), maxCallsPerRun: count.optional(), enabled: z.boolean().optional() })
  .strict().refine(value => Object.keys(value).length > 0) }).strict();
const gate = z.object({ enabled: z.boolean(), revision: z.number().int().min(1).max(4294967295) }).strict();
const platformRead = z.object({ sceneCode: code }).strict();
const platformSave = platformRead.extend({ expectedRevision: revision, settings: z.object({
  gates: z.object({ platform: gate, tenant: gate, scene: gate }).strict(), allowedModels: z.array(z.string().min(1).max(256)).max(100),
  allowedScenes: z.array(code).max(100), budget, maxConcurrent: count, maxCallsPerRun: count }).strict() }).strict();

export type BudgetManagementDependencies = {
  tenant?: Omit<Parameters<typeof createAuthorizedPersistedGatewayBudget>[0], 'credentials' | 'pricing' | 'taskId'> & { callPriceVersion: string };
  platform?: Omit<Parameters<typeof createAuthorizedPlatformBudgetSettings>[0], 'credentials'>;
};
export type BudgetManagementRequest = { headers: { authorization?: unknown } };
const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const platformView = (sceneCode: string, policy: BudgetPolicy | null) => !policy
  ? { scope: 'platform' as const, sceneCode, state: 'not_configured' as const, revision: null,
    settings: null, admission: 'not_granted' as const }
  : { scope: 'platform' as const, sceneCode, state: 'configured' as const, revision: policy.revision,
    settings: { ...presentBudgetSettingsFields(policy.settings), allowedModels: [...policy.settings.allowedModels] },
    admission: 'not_granted' as const };

/** Request-bound management consumer, inert until explicit server enablement.
 * Credentials come only from the actual HTTP request. Original Guard/ALS,
 * entitlement/CAS and one financial root remain mandatory; no task/model call.
 */
export function composeRequestBoundBudgetManagement(dependencies: BudgetManagementDependencies, options: { enabled: boolean }) {
  if (options?.enabled !== true || !dependencies || (!dependencies.tenant && !dependencies.platform)
    || (dependencies.tenant && ('credentials' in dependencies.tenant || 'pricing' in dependencies.tenant || 'taskId' in dependencies.tenant))
    || (dependencies.platform && 'credentials' in dependencies.platform)) throw new BudgetError('UNAVAILABLE');
  const tenant = dependencies.tenant && { ...dependencies.tenant }, platform = dependencies.platform && { ...dependencies.platform };
  const call = async <T>(request: BudgetManagementRequest, value: unknown,
    consume: (credentials: AiTaskCredentialSource, command: unknown) => Promise<T>) => {
    const header = bearer.safeParse(request?.headers?.authorization);
    if (!header.success) throw new BudgetError('FORBIDDEN');
    let command: unknown;
    try {
      if (Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') > 65536) throw new Error();
      command = structuredClone(value);
    } catch { throw new BudgetError('INVALID'); }
    const requestId = randomUUID();
    const credentials: AiTaskCredentialSource = { current: async () => ({ authorization: header.data,
      audience: 'operator', requestId: requestId }) };
    return runWithRequestIdentity({}, () => consume(credentials, command));
  };
  const tenantRoot = (credentials: AiTaskCredentialSource) => {
    if (!tenant) throw new BudgetError('UNAVAILABLE');
    const source = new PrismaTaskBudgetAuthorizationSource({ ...tenant, credentials });
    const pricing = new PrismaGatewayCallPricing(tenant.db, source.scopes, tenant.callPriceVersion, tenant.clock);
    return createPersistedGatewayBudget({ ...tenant, authorization: source, scopes: source.scopes, pricing });
  };
  const platformRoot = (credentials: AiTaskCredentialSource) => {
    if (!platform) throw new BudgetError('UNAVAILABLE');
    return createAuthorizedPlatformBudgetSettings({ ...platform, credentials });
  };
  return Object.freeze({
    read: (request: BudgetManagementRequest, value: unknown) => call(request, value, (credentials, command) => tenantRoot(credentials).settings.summary(command)),
    change: (request: BudgetManagementRequest, value: unknown) => call(request, value, async (credentials, value) => {
      const parsed = change.safeParse(value);
      if (!parsed.success) throw new BudgetError('INVALID');
      const command = parsed.data, root = tenantRoot(credentials), selector = { scope: command.scope, sceneCode: command.sceneCode };
      const previous = await root.settings.read(selector);
      // Initial provisioning needs the server's selected, verified Profile.
      // Never invent one or accept config/credential fields from this body.
      if (!previous) throw new BudgetError('UNAVAILABLE');
      if (previous.revision !== command.expectedRevision) throw new BudgetError('REVISION_CONFLICT');
      const settings = structuredClone(previous.settings), patch = command.changes;
      if (patch.budget !== undefined) settings.budget = patch.budget;
      if (patch.maxConcurrent !== undefined) settings.maxConcurrent = patch.maxConcurrent;
      if (patch.maxCallsPerRun !== undefined) settings.maxCallsPerRun = patch.maxCallsPerRun;
      if (patch.enabled !== undefined) {
        const layer = command.scope === 'tenant' ? 'tenant' : 'scene';
        settings.gates[layer] = { enabled: patch.enabled, revision: previous.revision + 1 };
      }
      const saved = await root.settings.save({ ...selector, settings, expectedRevision: command.expectedRevision });
      try {
        const policy = await root.settings.summary(selector);
        if (policy.revision !== null && policy.revision < saved.revision) throw new BudgetError('PENDING_RECONCILIATION');
        return { savedRevision: saved.revision, policy,
          observation: policy.revision === saved.revision ? 'same_revision' as const : 'changed_after_save' as const };
      }
      catch { throw new BudgetError('PENDING_RECONCILIATION'); }
    }),
    platformRead: (request: BudgetManagementRequest, value: unknown) => call(request, value, async (credentials, value) => {
      const parsed = platformRead.safeParse(value);
      if (!parsed.success) throw new BudgetError('INVALID');
      return platformView(parsed.data.sceneCode, await platformRoot(credentials).read(parsed.data));
    }),
    platformSave: (request: BudgetManagementRequest, value: unknown) => call(request, value, async (credentials, value) => {
      const parsed = platformSave.safeParse(value);
      if (!parsed.success) throw new BudgetError('INVALID');
      return platformView(parsed.data.sceneCode, await platformRoot(credentials).save(parsed.data));
    })
  });
}
