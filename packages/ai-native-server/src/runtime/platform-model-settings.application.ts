/** Platform configuration uses the original Vault/Profile CAS transaction;
 * capability reads only verify existing evidence, without probe or dispatch.
 * First setup and read after lost reply grant no invocation or budget rights;
 * current configuration is not an original save receipt. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AiPlatformModelSettingsInputDraft, AiPlatformModelDirectoryDraft, AiPlatformModelCapabilityObservationDraft } from '@rental-os/platform-contracts/ai-usage';
import { runWithRequestIdentity } from '@rental-os/platform-server/request-identity';
import { PlatformModelConfigurationAuthority } from './platform-model-config.authority';
import { createAuthorizedPlatformModelConfiguration } from './platform-model-config.composition';
import { registerCurrentPlatformAiConfigurationScope } from './configuration-scope-registration';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { ModelGatewayError } from './model-gateway.ports';
import { AiModelConfigurationResultUnknownError } from './model-config-compatibility';
import { originalIdentityHash } from './task-request/original-request.authority';
import { modelConfigurationOperationKey, validModelConfigurationOperation } from './model-configuration-operation';
import { hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';

import { platformModelProfileId as identifier, platformModelDirectoryQuery as directoryQuery, validPlatformSettingsInput as validInput,
  validPlatformSettingsRead as validRead, validPlatformSettingsSaved as validSaved, type PlatformModelSettingsHttpRequest } from '../configuration/platform-model-settings-transport';
import { readPlatformModelDirectory, readPlatformCapabilityEvidence, type PlatformSettingsEvidenceDatabase } from '../configuration/platform-model-settings-observations';
export { AiPlatformModelSettingsController, AI_NATIVE_PLATFORM_MODEL_SETTINGS_REQUESTS } from '../configuration/platform-model-settings-transport';

type Request = PlatformModelSettingsHttpRequest;
type Dependencies = Omit<Parameters<typeof createAuthorizedPlatformModelConfiguration>[0], 'credentials' | 'invocation' | 'profileId'>
  & { capabilityDb?: PlatformSettingsEvidenceDatabase };
const bearer = z.string().max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
export function composeRequestBoundPlatformModelSettings(dependencies: Dependencies) {
  // The selected host already owns the original Guard identity and lifetime.
  // Only the legacy host creates a new isolated outer request context.
  const inRequest = <T>(work: () => Promise<T>) => hasRentalBusinessTenantFence()
    ? work() : runWithRequestIdentity({}, work);
  const list = async (request: Request, value: unknown, signal?: AbortSignal): Promise<AiPlatformModelDirectoryDraft> => {
    const header = bearer.safeParse(request?.headers?.authorization), query = directoryQuery.safeParse(structuredClone(value));
    if (!header.success) throw new ModelGatewayError('FORBIDDEN');
    if (!query.success) throw new ModelGatewayError('INVALID_REQUEST');
    if (typeof dependencies.db.aiProviderProfile.findMany !== 'function') throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
    const command = query.data, requestId = randomUUID(); let active = !signal?.aborted;
    const close = () => { active = false; }, credentials = { current: async () => {
      if (!active) throw new ModelGatewayError('FORBIDDEN');
      return { authorization: header.data, requestId, audience: 'operator' as const };
    } };
    const noInvocation = { resolve: async (): Promise<never> => { throw new ModelGatewayError('FORBIDDEN'); } };
    signal?.addEventListener('abort', close, { once: true });
    try {
      return await waitForTaskApplicationDependency(() => inRequest(async () => {
        const authority = new PlatformModelConfigurationAuthority(dependencies.guard, credentials, undefined, noInvocation);
        return readPlatformModelDirectory(dependencies.db, { resolve: () => authority.resolveDirectoryRead() }, command, signal);
      }), false, signal);
    } finally { close(); signal?.removeEventListener('abort', close); }
  };
  const capabilities = async (request: Request, profileId: unknown, signal?: AbortSignal): Promise<AiPlatformModelCapabilityObservationDraft> => {
    const header = bearer.safeParse(request?.headers?.authorization), target = identifier.safeParse(profileId);
    if (!header.success) throw new ModelGatewayError('FORBIDDEN');
    if (!target.success) throw new ModelGatewayError('INVALID_REQUEST');
    const db = dependencies.capabilityDb;
    if (!db || !Object.is(db, dependencies.db)) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
    let active = !signal?.aborted;
    const close = () => { active = false; }, requestId = randomUUID();
    const credentials = { current: async () => {
      if (!active) throw new ModelGatewayError('FORBIDDEN');
      return { authorization: header.data, requestId, audience: 'operator' as const };
    } };
    signal?.addEventListener('abort', close, { once: true });
    try {
      return await waitForTaskApplicationDependency(() => inRequest(async () => {
        const noInvocation = { resolve: async (): Promise<never> => { throw new ModelGatewayError('FORBIDDEN'); } };
        const authority = new PlatformModelConfigurationAuthority(dependencies.guard, credentials, target.data, noInvocation);
        return readPlatformCapabilityEvidence(db, { resolve: () => authority.resolveRead() }, target.data, signal);
      }), false, signal);
    } finally { close(); signal?.removeEventListener('abort', close); }
  };
  const call = async (request: Request, profileId: unknown, value: unknown, write: boolean, signal?: AbortSignal, operation = false) => {
    const header = bearer.safeParse(request?.headers?.authorization), target = identifier.safeParse(profileId);
    if (!header.success) throw new ModelGatewayError('FORBIDDEN');
    if (!target.success) throw new ModelGatewayError('INVALID_REQUEST');
    let command: unknown;
    try {
      command = structuredClone(value);
      if (Buffer.byteLength(JSON.stringify(command) ?? '', 'utf8') > 32768) throw Error();
    } catch { throw new ModelGatewayError('INVALID_REQUEST'); }
    if (write && !validInput(command)) throw new ModelGatewayError('INVALID_REQUEST');
    if (operation && !modelConfigurationOperationKey.safeParse(command).success) throw new ModelGatewayError('INVALID_REQUEST');
    const requestId = randomUUID();
    let active = true;
    const close = () => { active = false; };
    const credentials = { current: async () => {
      if (!active) throw new ModelGatewayError('FORBIDDEN');
      return { authorization: header.data, requestId, audience: 'operator' as const };
    } };
    // Management-only composition cannot be reused as a tenant invocation
    // authority. In particular the route resource id confers no execution scope.
    const invocation = { resolve: async (): Promise<never> => { throw new ModelGatewayError('FORBIDDEN'); } };
    signal?.addEventListener('abort', close, { once: true });
    if (signal?.aborted) close();
    try {
      return await waitForTaskApplicationDependency(() => inRequest(async () => {
        const authority = new PlatformModelConfigurationAuthority(dependencies.guard, credentials, target.data, invocation);
        const current = () => write ? authority.resolve() : authority.resolveRead();
        const before = await current();
        if (write) await registerCurrentPlatformAiConfigurationScope({ db: dependencies.db, authority });
        const root = createAuthorizedPlatformModelConfiguration({ ...dependencies, credentials, invocation, profileId: target.data });
        const result = write ? await root.management.save({ ...(command as AiPlatformModelSettingsInputDraft), profileId: target.data })
          : operation ? await root.management.readOperation(target.data, command as string) : await root.management.read(target.data);
        try {
          if (!active || originalIdentityHash(await current()) !== originalIdentityHash(before)) throw new ModelGatewayError('FORBIDDEN');
          if (operation ? !validModelConfigurationOperation(result) || result.operationKey !== command
            : !(write ? validSaved : validRead)(result) || !('profileId' in result) || result.profileId !== target.data) throw new ModelGatewayError('INVALID_RESPONSE');
          return structuredClone(result);
        } catch (error) {
          if (write) throw new AiModelConfigurationResultUnknownError();
          throw error;
        }
      }), write, signal);
    } finally {
      active = false;
      signal?.removeEventListener('abort', close);
    }
  };
  return Object.freeze({ list, capabilities, read: (request: Request, profileId: unknown, signal?: AbortSignal) => call(request, profileId, undefined, false, signal),
    operation: (request: Request, profileId: unknown, operationKey: unknown, signal?: AbortSignal) => call(request, profileId, operationKey, false, signal, true),
    save: (request: Request, profileId: unknown, body: unknown, signal?: AbortSignal) => call(request, profileId, body, true, signal) });
}
