/** Opt-in tenant model configuration on a public host with no business-workspace dependency. */
import { ForbiddenException, Module, UnauthorizedException, type DynamicModule, type FactoryProvider, type ModuleMetadata } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { PlatformAuthenticationRepository, PlatformAuthService, PlatformPrincipalAuthority, PLATFORM_AUTH_DATA_STORE,
  matchableRequestPath, type RegisteredCoreHttpAccess } from '@rental-os/platform-server';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import { SecretBox } from '@rental-os/platform-server/secret-box';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { AI_USAGE_DRAFT_SCHEMAS } from '@rental-os/platform-contracts/ai-usage';
import { aiLeafToOpenApi30 } from '@rental-os/platform-contracts/ai-gateway';
import { AiTaskRunnerError, callAiTaskRunnerDependency } from '@rental-os/platform-server/ai-runtime';
import { ModelGatewayError } from '@rental-os/platform-server/ai-gateway';
import { captureAiRequestBinding } from './request-binding';
import { createPublicTenantModelConfiguration } from './model-configuration';
import { createTenantConfigurationTransactions, mayManageTenantConfiguration } from './tenant-configuration-transactions';
import { createNativeModelEgressTransport, type ModelEgressTransport } from './runtime/model-egress.transport';
import { discoverProviderMetadata } from './runtime/provider-discovery.service';
import { AiModelConfigurationResultUnknownError } from './runtime/model-config-compatibility';
import { AiModelSettingsController, AI_NATIVE_MODEL_SETTINGS_REQUESTS, type TenantModelSettingsPorts,
  type TenantModelSettingsRequest } from './configuration/tenant-model-settings-transport';
import { TENANT_AI_MODEL_SETTINGS_PERMISSION as permission, tenantModelSettingsOperations, tenantModelSettingsPath,
  validTenantSettingsRead, validTenantSettingsSave, validTenantSettingsOperation, validTenantSettingsSummary,
  validTenantSettingsLegacy, validTenantSettingsDiscovery, validTenantSettingsDiscoveryResult, validModelConfigurationOperation,
  type TenantModelSettingsAction } from './configuration/tenant-model-settings-contract';

export { AiModelSettingsController, AI_NATIVE_MODEL_SETTINGS_REQUESTS };
export { TENANT_AI_MODEL_SETTINGS_PERMISSION } from './configuration/tenant-model-settings-contract';

const actions = Object.keys(tenantModelSettingsOperations) as TenantModelSettingsAction[];
const paths = new Set(actions.map(tenantModelSettingsPath));
type Identity = ReturnType<typeof getRequestIdentity>;
function tenantSettingsIdentity(identity: Identity) {
  return Boolean(identity?.tenantId && identity.userId && identity.audience === 'operator' && identity.isSaasAdmin === false
    && !identity.staffApi && identity.workspaceId === undefined && identity.accessSession && identity.accessSession.expiresAt > Date.now() / 1000
    && mayManageTenantConfiguration(identity, permission));
}
function tenantSettingsAuthorityKey(subject: Pick<NonNullable<Identity>, 'permissions' | 'dataScope' | 'isPlatformAdmin'>) {
  return requestFingerprint({ permissions: [...(subject.permissions ?? [])].sort(),
    dataScope: subject.dataScope, isPlatformAdmin: subject.isPlatformAdmin === true });
}
export function withPublicTenantModelSettingsHttpAccess(original?: RegisteredCoreHttpAccess): RegisteredCoreHttpAccess {
  const own = (method: string, path: string) => method.toUpperCase() === 'POST' && paths.has(matchableRequestPath(path));
  return Object.freeze({
    registered: (method: string, path: string, audience: 'operator') => audience === 'operator' && own(method, path)
      || original?.registered(method, path, audience) === true,
    async authorize(method: string, path: string) {
      if (!own(method, path)) {
        if (original) return original.authorize(method, path);
        throw new ForbiddenException('接口未登记');
      }
      if (!tenantSettingsIdentity(getRequestIdentity())) throw new ForbiddenException('缺少当前租户 AI 设置权限');
    }
  });
}

type Database = Parameters<typeof createPublicTenantModelConfiguration>[0]['db'] & Pick<Prisma.TransactionClient, '$queryRaw'>;
export interface PublicTenantModelSettingsHost {
  db: Database;
  assertDataAvailable(db: Pick<Prisma.TransactionClient, '$queryRaw'>): Promise<void>;
}
type Dependencies = PublicTenantModelSettingsHost & {
  auth: Pick<PlatformAuthService, 'resolveAccessContext'>;
  principals: Pick<PlatformPrincipalAuthority<Prisma.TransactionClient>, 'lock'>;
  secrets: SecretBox;
  discovery: Pick<ModelEgressTransport, 'getModelDirectory'>;
};
const bearer = z.string().max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const denied = () => new ModelGatewayError('FORBIDDEN');
const invalid = () => new ModelGatewayError('INVALID_REQUEST');
const unavailable = () => new ModelGatewayError('PROVIDER_UNAVAILABLE');

export function createPublicTenantModelSettingsRequests(dependencies: Dependencies): TenantModelSettingsPorts {
  const { db, auth, principals, secrets, discovery } = dependencies;
  if (typeof db?.$queryRaw !== 'function' || !secrets || typeof auth?.resolveAccessContext !== 'function' || typeof principals?.lock !== 'function'
    || typeof discovery?.getModelDirectory !== 'function' || typeof dependencies.assertDataAvailable !== 'function') throw unavailable();
  const windows = new Map<string, { since: number; calls: number }>();
  function admitDiscovery(tenantId: string) {
    const now = Date.now();
    for (const [key, value] of windows) if (now - value.since >= 60000) windows.delete(key);
    const current = windows.get(tenantId);
    if (current ? current.calls >= 6 : windows.size >= 1024) throw unavailable();
    windows.set(tenantId, { since: current?.since ?? now, calls: (current?.calls ?? 0) + 1 });
  }

  async function call(action: TenantModelSettingsAction, request: TenantModelSettingsRequest, raw: unknown, signal?: AbortSignal) {
    const header = bearer.safeParse(request?.headers?.authorization);
    if (!header.success || signal?.aborted) throw denied();
    const binding = captureAiRequestBinding(denied), identity = binding.identity;
    const active = () => {
      binding.assertCurrent();
      if (signal?.aborted || !tenantSettingsIdentity(identity)) throw denied();
    };
    const write = action === 'save', metadata = action === 'discoverModels' || action === 'detectProtocols';
    try {
      active();
      const context = Object.freeze({ tenantId: identity.tenantId!, actorId: identity.userId! });
      const session = identity.accessSession!;
      const expectedAuthority = tenantSettingsAuthorityKey(identity);
      const recheck = async () => {
        active();
        const current = await auth.resolveAccessContext(header.data), user = current?.tenantUser, evidence = current?.accessSession;
        active();
        if (!user || user.tenantId !== context.tenantId || user.id !== context.actorId || !user.isActive || user.mustChangePassword
          || !mayManageTenantConfiguration(user, permission) || tenantSettingsAuthorityKey(user) !== expectedAuthority
          || evidence?.sessionId !== session.sessionId || evidence.expiresAt !== session.expiresAt
          || evidence.workspaceId !== session.workspaceId || evidence.expiresAt <= Date.now() / 1000) throw denied();
      };
      let command: unknown;
      try {
        command = structuredClone(raw);
        if (Buffer.byteLength(JSON.stringify(command) ?? '', 'utf8') > 32768) throw invalid();
      } catch { throw invalid(); }
      return await callAiTaskRunnerDependency(async () => {
        await recheck();
        const participant = createTenantConfigurationTransactions<Prisma.TransactionClient>({ principalAuthority: principals,
          requiredPermission: permission,
          async assertDataAvailable(database) {
            active(); await dependencies.assertDataAvailable(database); active();
          },
          assertCurrentUser(user) {
            active();
            if (tenantSettingsAuthorityKey(user) !== expectedAuthority) throw denied();
          } });
        active(); await dependencies.assertDataAvailable(db); active();
        const application = createPublicTenantModelConfiguration({ db, secrets, transactionParticipant: participant,
          async authorize(subject, operation) {
            if (operation === 'invoke' || !isDeepStrictEqual(subject, context)) throw denied();
            await recheck();
          } });
        const config = application.configuration;
        if (metadata) {
          if (!validTenantSettingsDiscovery(command)) throw invalid();
          admitDiscovery(context.tenantId);
          const deadline = AbortSignal.timeout(12000), bounded = signal ? AbortSignal.any([signal, deadline]) : deadline;
          const result = await config.inspectProvider(context, command, (key, current) => discoverProviderMetadata(command,
            action === 'discoverModels' ? 'models' : 'detect', key, discovery, async () => {
              await current();
              // Release the original principal/data checks before provider I/O.
              await db.$transaction(async tx => {
                const lease = await participant.begin(tx, context);
                lease.close();
              }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.ReadCommitted, maxWait: 2500, timeout: 5000 });
              await current();
              if (bounded.aborted) throw new ModelGatewayError('CANCELLED');
            }, bounded));
          if (!validTenantSettingsDiscoveryResult(result)) throw new ModelGatewayError('INVALID_RESPONSE');
          await recheck();
          return result;
        }
        if (action === 'save') {
          if (!validTenantSettingsSave(command) || !command.operationKey) throw invalid();
          if (command.configId !== context.tenantId) throw denied();
          await application.registerScope(context);
          const result = await config.saveSettings(context, command);
          try {
            await recheck();
            if (!validTenantSettingsSummary(result) || result.tenantId !== context.tenantId || result.configId !== context.tenantId)
              throw new ModelGatewayError('INVALID_RESPONSE');
          } catch { throw new AiModelConfigurationResultUnknownError(); }
          return result;
        }
        if (action === 'operation') {
          if (!validTenantSettingsOperation(command)) throw invalid();
          const result = await config.readSettingsOperation(context, command.operationKey);
          await recheck();
          if (!validModelConfigurationOperation(result) || result.operationKey !== command.operationKey
            || result.state === 'recorded' && (!('tenantId' in result.result) || result.result.tenantId !== context.tenantId
              || result.result.configId !== context.tenantId)) throw new ModelGatewayError('INVALID_RESPONSE');
          return result;
        }
        if (!validTenantSettingsRead(command)) throw invalid();
        const result = action === 'read' ? await config.readSettings(context) : await config.readLegacySettings(context);
        await recheck();
        if (action === 'read' ? !validTenantSettingsSummary(result) || result.tenantId !== context.tenantId
          || result.configId !== context.tenantId : !validTenantSettingsLegacy(result)) throw new ModelGatewayError('INVALID_RESPONSE');
        return result;
      }, metadata ? 14000 : 5000, 'tenant_model_settings', signal);
    } catch (error) {
      if (write && error instanceof AiTaskRunnerError && ['AI_RESULT_UNKNOWN', 'AI_RUN_LIMIT'].includes(error.code))
        throw new AiModelConfigurationResultUnknownError();
      if (error instanceof ForbiddenException || error instanceof UnauthorizedException) throw denied();
      throw error;
    } finally { binding.close(); }
  }
  const handler = (action: TenantModelSettingsAction) => (request: TenantModelSettingsRequest, value: unknown, signal?: AbortSignal) =>
    call(action, request, value, signal);
  return Object.freeze({ read: handler('read'), save: handler('save'), operation: handler('operation'), legacy: handler('legacy'),
    discoverModels: handler('discoverModels'), detectProtocols: handler('detectProtocols') });
}

export function createPublicTenantModelSettingsOpenApi<T extends { paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown> } }>(document: T): T {
  const result = structuredClone(document);
  const prefix = '#/components/schemas/', ref = (name: string) => ({ $ref: prefix + name });
  const named = (name: string) => {
    const original = AI_USAGE_DRAFT_SCHEMAS[name];
    if (!original) throw new Error(`缺少租户 AI 设置 schema：${name}`);
    const schema = aiLeafToOpenApi30(original, name);
    if (Object.hasOwn(result.components.schemas, name) && !isDeepStrictEqual(result.components.schemas[name], schema))
      throw new Error(`租户 AI 设置 schema 与既有声明冲突：${name}`);
    result.components.schemas[name] = schema;
    return ref(name);
  };
  // Receipts share the original tenant and platform projections even when the
  // public host publishes only the tenant routes.
  named('AiPlatformModelSettingsSaveDraft');
  const body = (schema: object) => ({ 'application/json': { schema } });
  for (const action of actions) {
    const { operationId, write, request, response } = tenantModelSettingsOperations[action];
    const route = result.paths[`/api${tenantModelSettingsPath(action)}`] ??= {};
    if (Object.hasOwn(route, 'post')) throw new Error(`租户 AI 设置路由已登记：${action}`);
    const requestSchema = action === 'save'
      ? aiLeafToOpenApi30({ oneOf: AI_USAGE_DRAFT_SCHEMAS.AiTenantModelSettingsInputDraft.oneOf!.map(schema =>
        ({ ...schema, required: [...schema.required!, 'operationKey'] })) }, 'TenantModelSettingsSave')
      : typeof request === 'string' ? named(request) : aiLeafToOpenApi30(request, operationId + 'Input');
    const responseSchema = typeof response === 'string' ? named(response) : aiLeafToOpenApi30(response, operationId + 'Result');
    route.post = { operationId, tags: ['AI Native'], security: [{ bearerAuth: [] }],
      'x-requiredPermissions': [permission], 'x-effect': write ? 'write' : 'read',
      requestBody: { required: true, content: body(requestSchema) },
      responses: { '200': { description: '原租户 AI 设置结果', content: body({ type: 'object', required: ['data', 'requestId'],
        properties: { data: responseSchema, requestId: { type: 'string' } } }) },
        '400': { description: '输入不符合原合同' }, '401': { description: '原会话失效' },
        '403': { description: '需要当前租户管理员身份，或参数管理权限和完整租户数据范围' },
        '409': { description: '修订冲突或结果未知，按原键核对' },
        '503': { description: '所选数据或依赖不可用' } } };
  }
  return result;
}

const HOST = Symbol('public.tenant-ai-settings.host');
@Module({})
export class PublicTenantModelSettingsModule {
  static register<Args extends unknown[]>(host: {
    imports: NonNullable<ModuleMetadata['imports']>;
    inject?: FactoryProvider['inject'];
    useFactory(...args: Args): PublicTenantModelSettingsHost | Promise<PublicTenantModelSettingsHost>;
  }): DynamicModule {
    return { module: PublicTenantModelSettingsModule, imports: host.imports, controllers: [AiModelSettingsController], providers: [
      { provide: HOST, inject: host.inject ?? [], useFactory: host.useFactory },
      { provide: AI_NATIVE_MODEL_SETTINGS_REQUESTS,
        inject: [HOST, PLATFORM_AUTH_DATA_STORE, PlatformAuthService, PlatformAuthenticationRepository, SecretBox],
        useFactory: (selected: PublicTenantModelSettingsHost, authDatabase: object, auth: PlatformAuthService,
          users: PlatformAuthenticationRepository, secrets: SecretBox) => {
          if (!Object.is(selected.db, authDatabase)) throw unavailable();
          return createPublicTenantModelSettingsRequests({ ...selected, auth, secrets, discovery: createNativeModelEgressTransport(5000),
            principals: new PlatformPrincipalAuthority<Prisma.TransactionClient>(users) });
        } }
    ] };
  }
}
