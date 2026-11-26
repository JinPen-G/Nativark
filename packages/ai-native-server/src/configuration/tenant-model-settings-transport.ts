/** Original tenant AI settings HTTP transport. Authority and data are provided by the selected host. */
import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { AI_MODEL_SETTINGS_HTTP_DRAFT } from '@rental-os/platform-contracts/ai-usage';
import { withRequestAbort, type AiRequestAbortSource } from '../runtime/scenes/request-abort';
import { validTenantSettingsSave, type TenantModelSettingsAction } from './tenant-model-settings-contract';

export type TenantModelSettingsRequest = AiRequestAbortSource & { headers: { authorization?: unknown } };
export type TenantModelSettingsPorts = Readonly<Record<TenantModelSettingsAction,
  (request: TenantModelSettingsRequest, value: unknown, signal?: AbortSignal) => Promise<unknown>>>;
export const AI_NATIVE_MODEL_SETTINGS_REQUESTS = Symbol('AI_NATIVE_MODEL_SETTINGS_REQUESTS');

@Controller(AI_MODEL_SETTINGS_HTTP_DRAFT.basePath)
export class AiModelSettingsController {
  constructor(@Inject(AI_NATIVE_MODEL_SETTINGS_REQUESTS) private readonly settings: TenantModelSettingsPorts) {}
  private async respond(request: TenantModelSettingsRequest, action: TenantModelSettingsAction, body: unknown) {
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
      const original = write && validTenantSettingsSave(body) && typeof body.operationKey === 'string';
      throw new HttpException({ code: safe, retryable: false,
        ...(safe === 'AI_RESULT_UNKNOWN' ? original ? { nextAction: 'read_original_configuration_operation' }
          : { nextAction: 'read_current_configuration', observation: 'not_original_write_receipt' } : {}) }, status);
    }
  }
  @Post(AI_MODEL_SETTINGS_HTTP_DRAFT.read) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: TenantModelSettingsRequest, @Body() body: unknown) { return this.respond(request, 'read', body); }
  @Post(AI_MODEL_SETTINGS_HTTP_DRAFT.save) @HttpCode(200) @Header('Cache-Control', 'no-store')
  save(@Req() request: TenantModelSettingsRequest, @Body() body: unknown) { return this.respond(request, 'save', body); }
  @Post(AI_MODEL_SETTINGS_HTTP_DRAFT.operation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  operation(@Req() request: TenantModelSettingsRequest, @Body() body: unknown) { return this.respond(request, 'operation', body); }
  @Post(AI_MODEL_SETTINGS_HTTP_DRAFT.legacy) @HttpCode(200) @Header('Cache-Control', 'no-store')
  legacy(@Req() request: TenantModelSettingsRequest, @Body() body: unknown) { return this.respond(request, 'legacy', body); }
  @Post(AI_MODEL_SETTINGS_HTTP_DRAFT.discoverModels) @HttpCode(200) @Header('Cache-Control', 'no-store')
  models(@Req() request: TenantModelSettingsRequest, @Body() body: unknown) { return this.respond(request, 'discoverModels', body); }
  @Post(AI_MODEL_SETTINGS_HTTP_DRAFT.detectProtocols) @HttpCode(200) @Header('Cache-Control', 'no-store')
  detectProtocols(@Req() request: TenantModelSettingsRequest, @Body() body: unknown) { return this.respond(request, 'detectProtocols', body); }
}
