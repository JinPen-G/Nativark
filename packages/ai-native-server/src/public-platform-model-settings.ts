/** Opt-in SaaS model management on the host's verified session and selected Client.
 * The original Guard owns ingress; current Auth and the original principal lock
 * fence observations and saves. The module neither installs AI nor calls a model. */
import { Module, type DynamicModule, type FactoryProvider, type ModuleMetadata } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PlatformAuthenticationRepository, PlatformAuthService, PlatformPrincipalAuthority, PLATFORM_AUTH_DATA_STORE,
  type RegisteredCoreHttpAccess } from '@rental-os/platform-server';
import { SecretBox } from '@rental-os/platform-server/secret-box';
import type { AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import type { SystemUserRow } from '@rental-os/platform-contracts';
import { ModelGatewayError } from '@rental-os/platform-server/ai-gateway';
import { AiTaskRunnerError, callAiTaskRunnerDependency } from '@rental-os/platform-server/ai-runtime';
import { bindPlatformAiRequest, withPlatformAiHttpAccess } from './configuration/platform-ai-request';
import { createPlatformAiManagementTransactions } from './platform-transactions';
import { createPublicPlatformModelConfiguration } from './model-configuration';
import { AiModelConfigurationResultUnknownError } from './runtime/model-config-compatibility';
import { modelConfigurationOperationKey, validModelConfigurationOperation } from './runtime/model-configuration-operation';
import { readPlatformModelDirectory, readPlatformCapabilityEvidence, type PlatformSettingsEvidenceDatabase } from './configuration/platform-model-settings-observations';
import { AiPlatformModelSettingsController, AI_NATIVE_PLATFORM_MODEL_SETTINGS_REQUESTS, platformModelDirectoryQuery,
  platformModelProfileId, validPlatformSettingsInput, validPlatformSettingsRead, validPlatformSettingsSaved,
  type PlatformModelSettingsHttpPorts, type PlatformModelSettingsHttpRequest } from './configuration/platform-model-settings-transport';
import { PLATFORM_AI_MODEL_VIEW, PLATFORM_AI_MODEL_MANAGE, platformModelSettingsRoute } from './configuration/platform-model-settings-policy';

export { AiPlatformModelSettingsController, AI_NATIVE_PLATFORM_MODEL_SETTINGS_REQUESTS };
export { createPlatformModelSettingsOpenApi, PLATFORM_AI_MODEL_SETTINGS_PERMISSIONS } from './configuration/platform-model-settings-policy';

/** Extend the existing ingress registration with only these five SaaS actions. */
export function withPublicPlatformModelSettingsHttpAccess(original?: RegisteredCoreHttpAccess): RegisteredCoreHttpAccess {
  return withPlatformAiHttpAccess((method, path) => platformModelSettingsRoute(method, path)?.permission, original);
}

type SettingsDatabase = Parameters<typeof createPublicPlatformModelConfiguration>[0]['db'] & PlatformSettingsEvidenceDatabase;
export interface PublicPlatformModelSettingsHost {
  db: SettingsDatabase;
  /** Reopen the selected public AI data and old migration receipts through this database or its original transaction. */
  assertDataAvailable(database: Pick<Prisma.TransactionClient, '$queryRaw'>): Promise<void>;
}
type Dependencies = PublicPlatformModelSettingsHost & {
  auth: Pick<PlatformAuthService, 'resolveAccessContext'>;
  principals: Pick<PlatformPrincipalAuthority<Prisma.TransactionClient>, 'lock'>;
  secrets: SecretBox;
};
const denied = () => new ModelGatewayError('FORBIDDEN');
const invalid = () => new ModelGatewayError('INVALID_REQUEST');

export function createPublicPlatformModelSettingsRequests(dependencies: Dependencies): PlatformModelSettingsHttpPorts {
  if (typeof dependencies?.auth?.resolveAccessContext !== 'function' || typeof dependencies.principals?.lock !== 'function'
    || typeof dependencies.assertDataAvailable !== 'function' || !dependencies.secrets || !dependencies.db)
    throw new ModelGatewayError('PROVIDER_UNAVAILABLE');

  async function request<T>(source: PlatformModelSettingsHttpRequest, write: boolean, signal: AbortSignal | undefined,
    action: (authority: { resolve(): Promise<AiExecutionContext>; assertDataAvailable: Dependencies['assertDataAvailable'];
      assertCurrentUser(user: SystemUserRow): void }) => Promise<T>) {
    const permission = write ? PLATFORM_AI_MODEL_MANAGE : PLATFORM_AI_MODEL_VIEW;
    const authority = bindPlatformAiRequest(dependencies.auth, source, permission, signal);
    const { assertActive, close } = authority;
    const assertDataAvailable: Dependencies['assertDataAvailable'] = async db => {
      assertActive(); await dependencies.assertDataAvailable(db); assertActive();
    };
    try {
      return await callAiTaskRunnerDependency(async () => {
        const identity = ({ requestId: _request, authorizedAt: _time, ...rest }: AiExecutionContext) => requestFingerprint(rest);
        const initial = await authority.resolve(), fingerprint = identity(initial);
        if (!('permissions' in initial)) throw denied();
        const permissions = requestFingerprint(initial.permissions);
        const resolve = async () => {
          const current = await authority.resolve();
          if (identity(current) !== fingerprint) throw denied();
          return current;
        };
        const assertCurrentUser = (user: SystemUserRow) => {
          assertActive();
          if (user.id !== initial.actor.userId || requestFingerprint(user.permissions) !== permissions) throw denied();
        };
        await assertDataAvailable(dependencies.db);
        return action({ resolve, assertDataAvailable, assertCurrentUser });
      }, 5000, 'platform_model_settings', signal);
    } catch (error) {
      if (error instanceof AiTaskRunnerError && ['AI_RESULT_UNKNOWN', 'AI_RUN_LIMIT'].includes(error.code) && write)
        throw new AiModelConfigurationResultUnknownError();
      throw error;
    } finally { close(); }
  }

  const target = (id: unknown) => {
    const parsed = platformModelProfileId.safeParse(id);
    if (!parsed.success) throw invalid();
    return parsed.data;
  };
  const settings = (source: PlatformModelSettingsHttpRequest, id: unknown, action: 'read' | 'save' | 'operation', value: unknown,
    signal?: AbortSignal) => {
    const profileId = target(id), write = action === 'save';
    let command: unknown;
    try {
      command = structuredClone(value);
      if (Buffer.byteLength(JSON.stringify(command) ?? '', 'utf8') > 32768) throw invalid();
    } catch { throw invalid(); }
    if (write && !validPlatformSettingsInput(command)
      || action === 'operation' && !modelConfigurationOperationKey.safeParse(command).success) throw invalid();
    return request(source, write, signal, async ({ resolve, assertDataAvailable, assertCurrentUser }) => {
      const current = async (requested: string) => { if (requested !== profileId) throw denied(); await resolve(); };
      const configuration = createPublicPlatformModelConfiguration({ db: dependencies.db, secrets: dependencies.secrets,
        authority: { read: current, manage: current, resolve, resolveRead: resolve, invoke: async () => { throw denied(); } },
        transactionParticipant: createPlatformAiManagementTransactions<Prisma.TransactionClient>({ principalAuthority: dependencies.principals,
          requiredPermission: PLATFORM_AI_MODEL_MANAGE, assertDataAvailable, assertCurrentUser }) });
      if (write) await configuration.registerScope();
      const result = write && validPlatformSettingsInput(command) ? await configuration.configuration.save({ ...command, profileId })
        : action === 'operation' ? await configuration.configuration.readOperation(profileId, command as string)
        : await configuration.configuration.read(profileId);
      try {
        await resolve();
        if (action === 'operation' ? !validModelConfigurationOperation(result) || result.operationKey !== command
          : !(write ? validPlatformSettingsSaved : validPlatformSettingsRead)(result) || !('profileId' in result) || result.profileId !== profileId)
          throw new ModelGatewayError('INVALID_RESPONSE');
        return result;
      } catch (error) {
        if (write) throw new AiModelConfigurationResultUnknownError();
        throw error;
      }
    });
  };
  const ports: PlatformModelSettingsHttpPorts = {
    list(source, value, signal) {
      const query = platformModelDirectoryQuery.safeParse(value);
      if (!query.success) throw invalid();
      return request(source, false, signal, authority => readPlatformModelDirectory(dependencies.db, authority, query.data, signal));
    },
    capabilities: (source, id, signal) => request(source, false, signal, authority => readPlatformCapabilityEvidence(dependencies.db, authority, target(id), signal)),
    read: (source, id, signal) => settings(source, id, 'read', undefined, signal),
    operation: (source, id, key, signal) => settings(source, id, 'operation', key, signal),
    save: (source, id, input, signal) => settings(source, id, 'save', input, signal)
  };
  return Object.freeze(ports);
}

const SETTINGS_HOST = Symbol('public.ai-model-settings.host');
@Module({})
export class PublicPlatformModelSettingsModule {
  static register<Args extends unknown[]>(host: {
    imports: NonNullable<ModuleMetadata['imports']>;
    inject?: FactoryProvider['inject'];
    useFactory(...args: Args): PublicPlatformModelSettingsHost | Promise<PublicPlatformModelSettingsHost>;
  }): DynamicModule {
    return { module: PublicPlatformModelSettingsModule, imports: host.imports, controllers: [AiPlatformModelSettingsController], providers: [
      { provide: SETTINGS_HOST, inject: host.inject ?? [], useFactory: host.useFactory },
      { provide: AI_NATIVE_PLATFORM_MODEL_SETTINGS_REQUESTS,
        inject: [SETTINGS_HOST, PLATFORM_AUTH_DATA_STORE, PlatformAuthService, PlatformAuthenticationRepository, SecretBox],
        useFactory: (selected: PublicPlatformModelSettingsHost, authDatabase: object, auth: PlatformAuthService,
          users: PlatformAuthenticationRepository, secrets: SecretBox) => {
          if (!Object.is(selected.db, authDatabase)) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
          return createPublicPlatformModelSettingsRequests({ ...selected, auth, secrets,
            principals: new PlatformPrincipalAuthority<Prisma.TransactionClient>(users) });
        } }
    ] };
  }
}
