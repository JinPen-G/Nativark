/** Original five SaaS model settings routes shared by public and compatibility hosts. */
import { Body, Controller, Get, Header, HttpCode, HttpException, Inject, Param, Put, Query, Req } from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT, AI_USAGE_DRAFT_SCHEMAS, type AiPlatformModelSettingsInputDraft } from '@rental-os/platform-contracts/ai-usage';
import { withRequestAbort, type AiRequestAbortSource } from '../runtime/scenes/request-abort';

export type PlatformModelSettingsHttpRequest = AiRequestAbortSource & { headers: { authorization?: unknown } };
export interface PlatformModelSettingsHttpPorts {
  list(request: PlatformModelSettingsHttpRequest, query: unknown, signal?: AbortSignal): Promise<unknown>;
  capabilities(request: PlatformModelSettingsHttpRequest, profileId: unknown, signal?: AbortSignal): Promise<unknown>;
  read(request: PlatformModelSettingsHttpRequest, profileId: unknown, signal?: AbortSignal): Promise<unknown>;
  save(request: PlatformModelSettingsHttpRequest, profileId: unknown, body: unknown, signal?: AbortSignal): Promise<unknown>;
  operation(request: PlatformModelSettingsHttpRequest, profileId: unknown, key: unknown, signal?: AbortSignal): Promise<unknown>;
}
export const platformModelProfileId = z.string().regex(/^[A-Za-z0-9][\w.:-]{0,35}$/u);
export const platformModelDirectoryQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), after: platformModelProfileId.optional() }).strict();
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
export const validPlatformSettingsInput = ajv.compile<AiPlatformModelSettingsInputDraft>(AI_USAGE_DRAFT_SCHEMAS.AiPlatformModelSettingsInputDraft);
export const validPlatformSettingsRead = ajv.compile(AI_USAGE_DRAFT_SCHEMAS.AiPlatformModelSettingsSummaryDraft);
export const validPlatformSettingsSaved = ajv.compile(AI_USAGE_DRAFT_SCHEMAS.AiPlatformModelSettingsSaveDraft);

export const AI_NATIVE_PLATFORM_MODEL_SETTINGS_REQUESTS = Symbol('AI_NATIVE_PLATFORM_MODEL_SETTINGS_REQUESTS');

@Controller(AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT.basePath)
export class AiPlatformModelSettingsController {
  constructor(@Inject(AI_NATIVE_PLATFORM_MODEL_SETTINGS_REQUESTS) private readonly settings: PlatformModelSettingsHttpPorts) {}
  private async respond(request: PlatformModelSettingsHttpRequest, profileId: string, write: boolean, body?: unknown, operation = false, directory = false) {
    try { return await withRequestAbort<unknown>(request, signal => directory ? this.settings.list(request, body, signal) : write ? this.settings.save(request, profileId, body, signal)
      : operation ? this.settings.operation(request, profileId, body, signal) : this.settings.read(request, profileId, signal)); }
    catch (error) { throw this.errorResponse(error, write, body); }
  }
  private errorResponse(error: unknown, write = false, body?: unknown) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    const mapping: Record<string, [string, number]> = {
      FORBIDDEN: ['AI_ACCESS_DENIED', 403], AI_ACCESS_DENIED: ['AI_ACCESS_DENIED', 403],
      AI_SCOPE_CHANGED: ['AI_ACCESS_DENIED', 403],
      INVALID_REQUEST: ['AI_INVALID_INPUT', 400], CONFIG_INVALID: ['AI_INVALID_INPUT', 400],
      CREDENTIAL_UNAVAILABLE: ['AI_INVALID_INPUT', 400], AI_REVISION_CONFLICT: ['AI_REVISION_CONFLICT', 409],
      AI_RESULT_UNKNOWN: [write ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE', write ? 409 : 503]
    };
    const [safe, status] = typeof code === 'string' && Object.hasOwn(mapping, code) ? mapping[code] : ['AI_RESOURCE_UNAVAILABLE', 503];
    const original = write && validPlatformSettingsInput(body) && body.operationKey !== undefined;
    return new HttpException({ code: safe, retryable: false,
      ...(safe === 'AI_RESULT_UNKNOWN' ? original ? { nextAction: 'read_original_configuration_operation' }
        : { nextAction: 'read_current_configuration', observation: 'not_original_write_receipt' } : {}) }, status);
  }
  @Get() @Header('Cache-Control', 'no-store')
  list(@Req() request: PlatformModelSettingsHttpRequest, @Query() query: unknown) { return this.respond(request, '', false, query, false, true); }
  @Get(':profileId/capabilities') @Header('Cache-Control', 'no-store')
  async capabilities(@Req() request: PlatformModelSettingsHttpRequest, @Param('profileId') profileId: string) {
    try { return await withRequestAbort(request, signal => this.settings.capabilities(request, profileId, signal)); }
    catch (error) { throw this.errorResponse(error); }
  }
  @Get(':profileId') @Header('Cache-Control', 'no-store')
  read(@Req() request: PlatformModelSettingsHttpRequest, @Param('profileId') profileId: string) { return this.respond(request, profileId, false); }
  @Put(':profileId') @HttpCode(200) @Header('Cache-Control', 'no-store')
  save(@Req() request: PlatformModelSettingsHttpRequest, @Param('profileId') profileId: string, @Body() body: unknown) { return this.respond(request, profileId, true, body); }
  @Get(':profileId/operations/:operationKey') @Header('Cache-Control', 'no-store')
  operation(@Req() request: PlatformModelSettingsHttpRequest, @Param('profileId') profileId: string, @Param('operationKey') operationKey: string) {
    return this.respond(request, profileId, false, operationKey, true);
  }
}
