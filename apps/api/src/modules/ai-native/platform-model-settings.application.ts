/** Platform manager -> original Vault/Profile transaction. First setup is a
 * revision-zero CAS, not an invocation, capability proof or budget grant.
 * Read after lost reply observes current configuration, never retries a save. */
import { Body, Controller, Get, Header, HttpCode, HttpException, Inject, Param, Put, Query, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT, AI_USAGE_DRAFT_SCHEMAS,
  type AiPlatformModelSettingsInputDraft, type AiPlatformModelDirectoryDraft } from '@rental-os/shared';
import type { Prisma } from '@prisma/client';
import { runWithRequestIdentity } from '../../common/request-identity';
import { PlatformModelConfigurationAuthority } from './platform-model-config.authority';
import { createAuthorizedPlatformModelConfiguration } from './platform-model-config.composition';
import { registerCurrentPlatformAiConfigurationScope } from './configuration-scope-registration';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { withRequestAbort } from './scenes/request-abort';
import { ModelGatewayError } from './model-gateway.ports';
import { AiModelConfigurationResultUnknownError } from './model-config-compatibility';
import { originalIdentityHash } from './task-request/original-request.authority';
import { modelConfigurationOperationKey, validModelConfigurationOperation } from './model-configuration-operation';
import { AiScopeRepository } from './ai-scope.repository';

type Request = { headers: { authorization?: unknown } } & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
type Dependencies = Omit<Parameters<typeof createAuthorizedPlatformModelConfiguration>[0], 'credentials' | 'invocation' | 'profileId'>;
const bearer = z.string().max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const identifier = z.string().regex(/^[A-Za-z0-9][\w.:-]{0,35}$/u);
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const validInput = ajv.compile<AiPlatformModelSettingsInputDraft>(AI_USAGE_DRAFT_SCHEMAS.AiPlatformModelSettingsInputDraft);
const validRead = ajv.compile(AI_USAGE_DRAFT_SCHEMAS.AiPlatformModelSettingsSummaryDraft);
const validSaved = ajv.compile(AI_USAGE_DRAFT_SCHEMAS.AiPlatformModelSettingsSaveDraft);
const validDirectory = ajv.compile<AiPlatformModelDirectoryDraft>(AI_USAGE_DRAFT_SCHEMAS.AiPlatformModelDirectoryDraft);
const directoryQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), after: identifier.optional() }).strict();
const directorySelect = { id: true, scopeId: true, scopeKind: true, serviceMode: true, profileKey: true, role: true,
  protocol: true, provider: true, model: true, configRevision: true, enabled: true, disabledAt: true } satisfies Prisma.AiProviderProfileSelect;
export const AI_NATIVE_PLATFORM_MODEL_SETTINGS_REQUESTS = Symbol('AI_NATIVE_PLATFORM_MODEL_SETTINGS_REQUESTS');

export function composeRequestBoundPlatformModelSettings(dependencies: Dependencies) {
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
      return await waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
        const authority = new PlatformModelConfigurationAuthority(dependencies.guard, credentials, undefined, noInvocation);
        const scopes = new AiScopeRepository(dependencies.db, { resolve: () => authority.resolveDirectoryRead() });
        const before = await scopes.resolveCurrent();
        if (before.scope.kind !== 'PLATFORM' || before.context.actor.kind !== 'saas_admin') throw new ModelGatewayError('FORBIDDEN');
        const rows = structuredClone(await dependencies.db.aiProviderProfile.findMany({ where: {
          scopeId: before.scope.id, scopeKind: 'PLATFORM', serviceMode: 'platform_managed',
          ...(command.after ? { id: { gt: command.after } } : {}) }, select: directorySelect, orderBy: { id: 'asc' }, take: command.limit + 1 }));
        if (rows.length > command.limit + 1 || new Set(rows.map(row => row.id)).size !== rows.length
          || rows.some(row => row.scopeId !== before.scope.id || row.scopeKind !== 'PLATFORM' || row.serviceMode !== 'platform_managed'
            || typeof row.enabled !== 'boolean' || row.disabledAt !== null && !(row.disabledAt instanceof Date)))
          throw new ModelGatewayError('INVALID_RESPONSE');
        const result = { items: rows.slice(0, command.limit).map(row => ({ profileId: row.id, profileKey: row.profileKey, role: row.role,
          protocol: row.protocol, provider: row.provider, model: row.model, revision: row.configRevision,
          enabled: row.enabled && row.disabledAt === null })), nextCursor: rows.length > command.limit ? rows[command.limit - 1].id : null,
          observation: 'configuration_catalog_not_capability_evidence' as const };
        const after = await scopes.resolveCurrent();
        if (!active || before.scope.id !== after.scope.id || originalIdentityHash(before.context) !== originalIdentityHash(after.context))
          throw new ModelGatewayError('FORBIDDEN');
        if (!validDirectory(result)) throw new ModelGatewayError('INVALID_RESPONSE');
        return structuredClone(result);
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
      return await waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
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
  return Object.freeze({ list, read: (request: Request, profileId: unknown, signal?: AbortSignal) => call(request, profileId, undefined, false, signal),
    operation: (request: Request, profileId: unknown, operationKey: unknown, signal?: AbortSignal) => call(request, profileId, operationKey, false, signal, true),
    save: (request: Request, profileId: unknown, body: unknown, signal?: AbortSignal) => call(request, profileId, body, true, signal) });
}

@Controller(AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT.basePath)
export class AiPlatformModelSettingsController {
  constructor(@Inject(AI_NATIVE_PLATFORM_MODEL_SETTINGS_REQUESTS) private readonly settings: ReturnType<typeof composeRequestBoundPlatformModelSettings>) {}
  private async respond(request: Request, profileId: string, write: boolean, body?: unknown, operation = false, directory = false) {
    try { return await withRequestAbort<unknown>(request, signal => directory ? this.settings.list(request, body, signal) : write ? this.settings.save(request, profileId, body, signal)
      : operation ? this.settings.operation(request, profileId, body, signal) : this.settings.read(request, profileId, signal)); }
    catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      const mapping: Record<string, [string, number]> = {
        FORBIDDEN: ['AI_ACCESS_DENIED', 403], AI_ACCESS_DENIED: ['AI_ACCESS_DENIED', 403],
        INVALID_REQUEST: ['AI_INVALID_INPUT', 400], CONFIG_INVALID: ['AI_INVALID_INPUT', 400],
        CREDENTIAL_UNAVAILABLE: ['AI_INVALID_INPUT', 400], AI_REVISION_CONFLICT: ['AI_REVISION_CONFLICT', 409],
        AI_RESULT_UNKNOWN: [write ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE', write ? 409 : 503]
      };
      const [safe, status] = typeof code === 'string' && Object.hasOwn(mapping, code) ? mapping[code] : ['AI_RESOURCE_UNAVAILABLE', 503];
      const original = write && validInput(body) && body.operationKey !== undefined;
      throw new HttpException({ code: safe, retryable: false,
        ...(safe === 'AI_RESULT_UNKNOWN' ? original ? { nextAction: 'read_original_configuration_operation' }
          : { nextAction: 'read_current_configuration', observation: 'not_original_write_receipt' } : {}) }, status);
    }
  }
  @Get() @Header('Cache-Control', 'no-store')
  list(@Req() request: Request, @Query() query: unknown) { return this.respond(request, '', false, query, false, true); }
  @Get(':profileId') @Header('Cache-Control', 'no-store')
  read(@Req() request: Request, @Param('profileId') profileId: string) { return this.respond(request, profileId, false); }
  @Put(':profileId') @HttpCode(200) @Header('Cache-Control', 'no-store')
  save(@Req() request: Request, @Param('profileId') profileId: string, @Body() body: unknown) { return this.respond(request, profileId, true, body); }
  @Get(':profileId/operations/:operationKey') @Header('Cache-Control', 'no-store')
  operation(@Req() request: Request, @Param('profileId') profileId: string, @Param('operationKey') operationKey: string) {
    return this.respond(request, profileId, false, operationKey, true);
  }
}
