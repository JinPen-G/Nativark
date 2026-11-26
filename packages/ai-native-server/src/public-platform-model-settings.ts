/** Opt-in SaaS model management on the host's verified session and selected Client.
 * The original Guard owns ingress; current Auth and the original principal lock
 * fence observations and saves. The module neither installs AI nor calls a model. */
import { ForbiddenException, Module, type DynamicModule, type FactoryProvider, type ModuleMetadata } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PlatformAuthenticationRepository, PlatformAuthService, PlatformPrincipalAuthority, PLATFORM_AUTH_DATA_STORE,
  type RegisteredCoreHttpAccess } from '@rental-os/platform-server';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { hasEffectivePermission } from '@rental-os/platform-server/permission-match';
import { SecretBox } from '@rental-os/platform-server/secret-box';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import { ModelGatewayError } from '@rental-os/platform-server/ai-gateway';
import { AiTaskRunnerError, callAiTaskRunnerDependency } from '@rental-os/platform-server/ai-runtime';
import { captureAiRequestBinding } from './request-binding';
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
  return Object.freeze({
    registered(method: string, path: string, audience: 'operator') {
      return audience === 'operator' && !!platformModelSettingsRoute(method, path) || original?.registered(method, path, audience) === true;
    },
    async authorize(method: string, path: string) {
      const route = platformModelSettingsRoute(method, path);
      if (!route) {
        if (!original) throw new ForbiddenException('接口未登记');
        return original.authorize(method, path);
      }
      const current = getRequestIdentity();
      if (!current?.isSaasAdmin || current.audience !== 'operator' || current.staffApi || !current.accessSession
        || !hasEffectivePermission(current.permissions ?? [], route.permission)) throw new ForbiddenException('缺少当前平台 AI 配置权限');
    }
  });
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
const bearer = z.string().max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const denied = () => new ModelGatewayError('FORBIDDEN');
const invalid = () => new ModelGatewayError('INVALID_REQUEST');

export function createPublicPlatformModelSettingsRequests(dependencies: Dependencies): PlatformModelSettingsHttpPorts {
  if (typeof dependencies?.auth?.resolveAccessContext !== 'function' || typeof dependencies.principals?.lock !== 'function'
    || typeof dependencies.assertDataAvailable !== 'function' || !dependencies.secrets || !dependencies.db)
    throw new ModelGatewayError('PROVIDER_UNAVAILABLE');

  async function request<T>(source: PlatformModelSettingsHttpRequest, write: boolean, signal: AbortSignal | undefined,
    action: (authority: { resolve(): Promise<AiExecutionContext>; assertDataAvailable: Dependencies['assertDataAvailable'] }) => Promise<T>) {
    const header = bearer.safeParse(source?.headers?.authorization);
    if (!header.success || signal?.aborted) throw denied();
    const binding = captureAiRequestBinding(denied), identity = binding.identity, requestId = randomUUID();
    const permission = write ? PLATFORM_AI_MODEL_MANAGE : PLATFORM_AI_MODEL_VIEW;
    const assertActive = () => { binding.assertCurrent(); if (signal?.aborted) throw denied(); };
    const assertDataAvailable: Dependencies['assertDataAvailable'] = async db => {
      assertActive(); await dependencies.assertDataAvailable(db); assertActive();
    };
    const resolve = async (): Promise<AiExecutionContext> => {
      assertActive();
      const session = identity.accessSession;
      if (identity.isSaasAdmin !== true || identity.audience !== 'operator' || identity.staffApi || identity.workspaceId !== undefined
        || !identity.tenantId || !identity.userId || !session || session.expiresAt <= Date.now() / 1000
        || !hasEffectivePermission(identity.permissions ?? [], permission)) throw denied();
      const current = await dependencies.auth.resolveAccessContext(header.data);
      assertActive();
      const user = current?.tenantUser, currentSession = current?.accessSession;
      if (!user || user.id !== identity.userId || user.tenantId !== identity.tenantId || user.isSaasAdmin !== true
        || !user.isActive || user.mustChangePassword || !currentSession || currentSession.sessionId !== session.sessionId
        || currentSession.expiresAt !== session.expiresAt || currentSession.expiresAt <= Date.now() / 1000
        || currentSession.workspaceId !== session.workspaceId || !hasEffectivePermission(user.permissions, permission)) throw denied();
      return { contractVersion: AI_CONTRACT_DRAFT_VERSION, audience: 'operator', actor: { kind: 'saas_admin', userId: user.id },
        scope: { kind: 'platform' }, permissions: [...user.permissions], requestId, authorizedAt: new Date().toISOString() };
    };
    try {
      return await callAiTaskRunnerDependency(async () => {
        await resolve();
        await assertDataAvailable(dependencies.db);
        return action({ resolve, assertDataAvailable });
      }, 5000, 'platform_model_settings', signal);
    } catch (error) {
      if (error instanceof AiTaskRunnerError && ['AI_RESULT_UNKNOWN', 'AI_RUN_LIMIT'].includes(error.code) && write)
        throw new AiModelConfigurationResultUnknownError();
      throw error;
    } finally { binding.close(); }
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
    return request(source, write, signal, async ({ resolve, assertDataAvailable }) => {
      const current = async (requested: string) => { if (requested !== profileId) throw denied(); await resolve(); };
      const configuration = createPublicPlatformModelConfiguration({ db: dependencies.db, secrets: dependencies.secrets,
        authority: { read: current, manage: current, resolve, resolveRead: resolve, invoke: async () => { throw denied(); } },
        transactionParticipant: createPlatformAiManagementTransactions<Prisma.TransactionClient>({ principalAuthority: dependencies.principals,
          requiredPermission: PLATFORM_AI_MODEL_MANAGE, assertDataAvailable }) });
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
