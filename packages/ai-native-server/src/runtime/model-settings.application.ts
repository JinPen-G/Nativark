/** Tenant model management, not execution or capability testing. Current
 * Auth/Guard/ALS -> original config/Profile CAS + Vault; mode and gate save
 * once. Reads never migrate legacy settings or initialize budgets. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthService } from './rental-adapters/auth.service';
import type { ApiAuthGuard } from './rental-adapters/api-auth.guard';
import { runWithRequestIdentity } from '@rental-os/platform-server/request-identity';
import { createPersistedTenantModelConfiguration } from './tenant-model-config.composition';
import { TenantModelConfigurationAuthority } from './tenant-model-config.authority';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { registerCurrentAiConfigurationScopes } from './configuration-scope-registration';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { ModelGatewayError } from './model-gateway.ports';
import { AiModelConfigurationResultUnknownError } from './model-config-compatibility';
import { originalIdentityHash } from './task-request/original-request.authority';
import type { ModelEgressTransport } from './model-egress.transport';
import { discoverProviderMetadata } from './provider-discovery.service';
import { callAiTaskRunnerDependency } from '@rental-os/platform-server/ai-runtime';
import { captureRentalInternalAuthority } from '@rental-os/rental-core/application-internal-authority';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import { beginTenantModelConfigurationTransaction, createTenantModelConfigurationTransactions,
  type TenantModelConfigurationTransactions } from './tenant-model-config-transactions';
import { validTenantSettingsRead as validRead, validTenantSettingsSave as validSave, validTenantSettingsOperation as validOperation,
  validTenantSettingsSummary as validSummary, validTenantSettingsLegacy as validLegacy, validTenantSettingsDiscovery as validDiscovery,
  validTenantSettingsDiscoveryResult as validDiscoveryResult, validModelConfigurationOperation,
  type TenantModelSettingsAction as Action } from '../configuration/tenant-model-settings-contract';
import type { TenantModelSettingsRequest as Request } from '../configuration/tenant-model-settings-transport';
export { AI_NATIVE_MODEL_SETTINGS_REQUESTS, AiModelSettingsController } from '../configuration/tenant-model-settings-transport';

type Dependencies = Omit<Parameters<typeof createPersistedTenantModelConfiguration>[0], 'authorize'> & {
  auth: Pick<AuthService, 'resolveAccessContext'>; guard: Pick<ApiAuthGuard, 'canActivate'>;
  discovery?: Pick<ModelEgressTransport, 'getModelDirectory'>;
  transactions?: TenantModelConfigurationTransactions;
};
const bearer = z.string().max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
// Process-local abuse bound in addition to original authenticated entry checks.
// No credential, endpoint, model or response is retained here.
const discoveryWindows = new Map<string, { since: number; calls: number }>();
function admitDiscovery(tenantId: string) {
  const now = Date.now();
  for (const [key, value] of discoveryWindows) if (now - value.since >= 60000) discoveryWindows.delete(key);
  const window = discoveryWindows.get(tenantId);
  if (window ? window.calls >= 6 : discoveryWindows.size >= 1024) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
  discoveryWindows.set(tenantId, { since: window?.since ?? now, calls: (window?.calls ?? 0) + 1 });
}
export function composeRequestBoundModelSettings(dependencies: Dependencies) {
  const call = async (request: Request, value: unknown, action: Action, signal?: AbortSignal) => {
    const write = action === 'save', operation = action === 'operation', legacy = action === 'legacy';
    const discovery = action === 'discoverModels' || action === 'detectProtocols';
    const wait = <T>(operation: () => Promise<T>, write: boolean, abort?: AbortSignal) => discovery
      ? callAiTaskRunnerDependency(operation, 14000, 'provider_metadata', abort)
      : waitForTaskApplicationDependency(operation, write, abort);
    const header = bearer.safeParse(request?.headers?.authorization);
    if (!header.success) throw new ModelGatewayError('FORBIDDEN');
    let command: unknown;
    try {
      command = structuredClone(value);
      if (Buffer.byteLength(JSON.stringify(command) ?? '', 'utf8') > 32768) throw Error();
    } catch { throw new ModelGatewayError('INVALID_REQUEST'); }
    if (!(discovery ? validDiscovery : write ? validSave : operation ? validOperation : validRead)(command)) throw new ModelGatewayError('INVALID_REQUEST');
    const requestId = randomUUID();
    let active = true;
    const close = () => { active = false; };
    const credentials = { current: async () => {
      if (!active) throw new ModelGatewayError('FORBIDDEN');
      return { authorization: header.data, requestId, audience: 'operator' as const };
    } };
    signal?.addEventListener('abort', close, { once: true });
    if (signal?.aborted) close();
    try {
      const selected = captureRentalInternalAuthority();
      const consume = async () => {
        const identity = new AiTaskCurrentIdentityAuthority(dependencies.auth, credentials);
        const initial = await identity.resolve();
        if (initial.scope.kind !== 'workspace' || initial.actor.kind !== 'user' || initial.audience !== 'operator') throw new ModelGatewayError('FORBIDDEN');
        const context = { tenantId: initial.scope.tenantId, workspaceId: initial.scope.workspaceId, actorId: initial.actor.userId };
        const transactionParticipant = createTenantModelConfigurationTransactions({ transactions: dependencies.transactions, credentials });
        const authority = new TenantModelConfigurationAuthority(dependencies.guard, credentials, identity);
        await authority.authorize(context, write || discovery ? 'manage' : 'read');
        if (write) {
          if ((command as { configId: string }).configId !== context.tenantId) throw new ModelGatewayError('FORBIDDEN');
          const registered = await registerCurrentAiConfigurationScopes({ ...dependencies, credentials, transactionParticipant });
          if (originalIdentityHash(initial) !== originalIdentityHash(registered)) throw new ModelGatewayError('FORBIDDEN');
        }
        const configuration = createPersistedTenantModelConfiguration({ ...dependencies,
          authorize: authority.authorize.bind(authority), transactionParticipant });
        if (discovery) {
          if (!dependencies.discovery) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
          admitDiscovery(context.tenantId);
          const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), 12000);
          const bounded = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
          try {
            if (!validDiscovery(command)) throw new ModelGatewayError('INVALID_REQUEST');
            const input = command;
            const result = await configuration.inspectProvider(context, input, (key, current) => discoverProviderMetadata(input,
              action === 'discoverModels' ? 'models' : 'detect', key, dependencies.discovery!, async () => {
                await current();
                if (selected) await dependencies.db.$transaction(async tx => {
                  const participant = await beginTenantModelConfigurationTransaction(tx, context, transactionParticipant);
                  try { await participant?.revalidate(); } finally { participant?.close(); }
                }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.ReadCommitted, maxWait: 2500, timeout: 5000 });
                await current();
              }, bounded));
            if (!active || bounded.aborted || originalIdentityHash(await identity.resolve()) !== originalIdentityHash(initial)) throw new ModelGatewayError('FORBIDDEN');
            if (!validDiscoveryResult(result)) throw new ModelGatewayError('INVALID_RESPONSE');
            return structuredClone(result);
          } finally { clearTimeout(timer); deadline.abort(); }
        }
        const result = write ? await configuration.saveSettings(context, command) : operation
          ? await configuration.readSettingsOperation(context, (command as { operationKey: string }).operationKey)
          : legacy ? await configuration.readLegacySettings(context) : await configuration.readSettings(context);
        try {
          if (!active || originalIdentityHash(await identity.resolve()) !== originalIdentityHash(initial)) throw new ModelGatewayError('FORBIDDEN');
          if (operation ? !validModelConfigurationOperation(result) || result.operationKey !== (command as { operationKey: string }).operationKey
            : legacy ? !validLegacy(result)
            : !validSummary(result) || result.tenantId !== context.tenantId || result.configId !== context.tenantId) throw new ModelGatewayError('INVALID_RESPONSE');
          return structuredClone(result);
        } catch (error) {
          if (write) throw new AiModelConfigurationResultUnknownError();
          throw error;
        }
      };
      // Selected hosts retain the actual Guard store. Fresh Auth and the original
      // management Guard verify it; no identity projection is written back to ALS.
      return await wait(() => selected ? consume() : runWithRequestIdentity({}, consume), write, signal);
    } finally {
      active = false;
      signal?.removeEventListener('abort', close);
    }
  };
  return Object.freeze({ read: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'read', signal),
    discoverModels: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'discoverModels', signal),
    detectProtocols: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'detectProtocols', signal),
    operation: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'operation', signal),
    legacy: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'legacy', signal),
    save: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'save', signal) });
}
