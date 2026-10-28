/** Tenant model management, not execution or capability testing. Current
 * Auth/Guard/ALS -> original config/Profile CAS + Vault; mode and gate save
 * once. Reads never migrate legacy settings or initialize budgets. */
import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { AI_MODEL_SETTINGS_HTTP_DRAFT, AI_USAGE_DRAFT_SCHEMAS, type AiTenantModelSettingsSummaryDraft } from '@rental-os/shared';
import type { AuthService } from '../auth/auth.service';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import { runWithRequestIdentity } from '../../common/request-identity';
import { createPersistedTenantModelConfiguration } from './tenant-model-config.composition';
import { TenantModelConfigurationAuthority } from './tenant-model-config.authority';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { registerCurrentAiConfigurationScopes } from './configuration-scope-registration';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { withRequestAbort } from './scenes/request-abort';
import { ModelGatewayError } from './model-gateway.ports';
import { AiModelConfigurationResultUnknownError } from './model-config-compatibility';
import { originalIdentityHash } from './task-request/original-request.authority';
import { validModelConfigurationOperation } from './model-configuration-operation';
import { AI_PROVIDER_DISCOVERY_INPUT_SCHEMA, AI_PROVIDER_DISCOVERY_RESULT_SCHEMA, type AiProviderDiscoveryInputDraft } from '@rental-os/shared';
import type { ModelEgressTransport } from './model-egress.transport';
import { discoverProviderMetadata } from './provider-discovery.service';
import { callAiTaskRunnerDependency } from './runner/ai-task-runner.service';

type Request = { headers: { authorization?: unknown } } & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
type Dependencies = Omit<Parameters<typeof createPersistedTenantModelConfiguration>[0], 'authorize'> & {
  auth: Pick<AuthService, 'resolveAccessContext'>; guard: Pick<ApiAuthGuard, 'canActivate'>;
  discovery?: Pick<ModelEgressTransport, 'getModelDirectory'>;
};
const bearer = z.string().max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const validSave = ajv.compile(AI_USAGE_DRAFT_SCHEMAS.AiTenantModelSettingsInputDraft);
const validRead = ajv.compile({ type: 'object', properties: {}, additionalProperties: false });
const validOperation = ajv.compile<{ operationKey: string }>(AI_USAGE_DRAFT_SCHEMAS.AiModelConfigurationOperationReadDraft);
const validSummary = ajv.compile<AiTenantModelSettingsSummaryDraft>(AI_USAGE_DRAFT_SCHEMAS.AiTenantModelSettingsSummaryDraft);
const validLegacy = ajv.compile(AI_USAGE_DRAFT_SCHEMAS.AiLegacyModelConfigurationDraft);
const validDiscovery = ajv.compile<AiProviderDiscoveryInputDraft>(AI_PROVIDER_DISCOVERY_INPUT_SCHEMA);
const validDiscoveryResult = ajv.compile(AI_PROVIDER_DISCOVERY_RESULT_SCHEMA);
type Action = 'read' | 'save' | 'operation' | 'legacy' | 'discoverModels' | 'detectProtocols';
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
export const AI_NATIVE_MODEL_SETTINGS_REQUESTS = Symbol('AI_NATIVE_MODEL_SETTINGS_REQUESTS');

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
      return await wait(() => runWithRequestIdentity({}, async () => {
        const identity = new AiTaskCurrentIdentityAuthority(dependencies.auth, credentials);
        const initial = await identity.resolve();
        if (initial.scope.kind !== 'workspace' || initial.actor.kind !== 'user' || initial.audience !== 'operator') throw new ModelGatewayError('FORBIDDEN');
        const context = { tenantId: initial.scope.tenantId, workspaceId: initial.scope.workspaceId, actorId: initial.actor.userId };
        const authority = new TenantModelConfigurationAuthority(dependencies.guard, credentials, identity);
        await authority.authorize(context, write || discovery ? 'manage' : 'read');
        if (write) {
          if ((command as { configId: string }).configId !== context.tenantId) throw new ModelGatewayError('FORBIDDEN');
          const registered = await registerCurrentAiConfigurationScopes({ ...dependencies, credentials });
          if (originalIdentityHash(initial) !== originalIdentityHash(registered)) throw new ModelGatewayError('FORBIDDEN');
        }
        const configuration = createPersistedTenantModelConfiguration({ ...dependencies, authorize: authority.authorize.bind(authority) });
        if (discovery) {
          if (!dependencies.discovery) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
          admitDiscovery(context.tenantId);
          const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), 12000);
          const bounded = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
          try {
            const input = command as AiProviderDiscoveryInputDraft;
            const result = await configuration.inspectProvider(context, input, (key, current) => discoverProviderMetadata(input,
              action === 'discoverModels' ? 'models' : 'detect', key, dependencies.discovery!, current, bounded));
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
      }), write, signal);
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

@Controller(AI_MODEL_SETTINGS_HTTP_DRAFT.basePath)
export class AiModelSettingsController {
  constructor(@Inject(AI_NATIVE_MODEL_SETTINGS_REQUESTS) private readonly settings: ReturnType<typeof composeRequestBoundModelSettings>) {}
  private async respond(request: Request, action: Action, body: unknown) {
    const write = action === 'save';
    try { return await withRequestAbort(request, signal => this.settings[action](request, body, signal)); }
    catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      const mapped: Record<string, [string, number]> = {
        FORBIDDEN: ['AI_ACCESS_DENIED', 403], AI_ACCESS_DENIED: ['AI_ACCESS_DENIED', 403],
        INVALID_REQUEST: ['AI_INVALID_INPUT', 400], CONFIG_INVALID: ['AI_INVALID_INPUT', 400],
        CREDENTIAL_UNAVAILABLE: ['AI_INVALID_INPUT', 400], AI_REVISION_CONFLICT: ['AI_REVISION_CONFLICT', 409],
        AI_RESULT_UNKNOWN: [write ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE', write ? 409 : 503],
        PENDING_RECONCILIATION: ['AI_RESULT_UNKNOWN', 409]
      };
      const [safe, status] = typeof code === 'string' && Object.hasOwn(mapped, code) ? mapped[code] : ['AI_RESOURCE_UNAVAILABLE', 503];
      const original = write && validSave(body) && typeof (body as { operationKey?: string }).operationKey === 'string';
      throw new HttpException({ code: safe, retryable: false,
        ...(safe === 'AI_RESULT_UNKNOWN' ? original ? { nextAction: 'read_original_configuration_operation' }
          : { nextAction: 'read_current_configuration', observation: 'not_original_write_receipt' } : {}) }, status);
    }
  }
  @Post(AI_MODEL_SETTINGS_HTTP_DRAFT.read) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: Request, @Body() body: unknown) { return this.respond(request, 'read', body); }
  @Post(AI_MODEL_SETTINGS_HTTP_DRAFT.save) @HttpCode(200) @Header('Cache-Control', 'no-store')
  save(@Req() request: Request, @Body() body: unknown) { return this.respond(request, 'save', body); }
  @Post(AI_MODEL_SETTINGS_HTTP_DRAFT.operation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  operation(@Req() request: Request, @Body() body: unknown) { return this.respond(request, 'operation', body); }
  @Post(AI_MODEL_SETTINGS_HTTP_DRAFT.legacy) @HttpCode(200) @Header('Cache-Control', 'no-store')
  legacy(@Req() request: Request, @Body() body: unknown) { return this.respond(request, 'legacy', body); }
  @Post(AI_MODEL_SETTINGS_HTTP_DRAFT.discoverModels) @HttpCode(200) @Header('Cache-Control', 'no-store')
  models(@Req() request: Request, @Body() body: unknown) { return this.respond(request, 'discoverModels', body); }
  @Post(AI_MODEL_SETTINGS_HTTP_DRAFT.detectProtocols) @HttpCode(200) @Header('Cache-Control', 'no-store')
  detectProtocols(@Req() request: Request, @Body() body: unknown) { return this.respond(request, 'detectProtocols', body); }
}
