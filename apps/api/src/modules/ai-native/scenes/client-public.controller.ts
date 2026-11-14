/** Registered public/client transport only. Public ownership is independent of
 * customer authentication; only continuation requires the original client Guard.
 * Closed requests and original business projections reject injected fields. */
import { Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_CLIENT_PUBLIC_HTTP, AI_CLIENT_PUBLIC_CONTRACTS, aiClientPublicReadResponseSchema,
  aiClientPublicSessionResponseSchema, aiClientPublicPreparationResponseSchema, aiClientPublicOperationResponseSchema,
  aiClientPublicContinuationResponseSchema } from '@rental-os/shared';
import { OPENAPI_COMPONENT_SCHEMAS } from '../../../contracts/openapi-document';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiClientEntryError } from './client-entry-action';
import { ClientPublicContinuityUnknownError } from './client-public-continuity.repository';
import { AiClientPublicApplication, type AiClientPublicAction, type AiClientPublicRequest } from './client-public.application';
import { withRequestAbort, type AiRequestAbortSource, AiRequestWaitError } from './request-abort';

export const AI_WEBSITE_PUBLIC_ENTRY = Symbol('AI_WEBSITE_PUBLIC_ENTRY');
export const AI_WECHAT_PUBLIC_ENTRY = Symbol('AI_WECHAT_PUBLIC_ENTRY');
type Request = AiClientPublicRequest & AiRequestAbortSource & { body?: unknown };
const needed: Record<string, unknown> = {};
const include = (name: string) => {
  if (name in needed) return;
  const schema = OPENAPI_COMPONENT_SCHEMAS[name];
  if (!schema) throw new TypeError('Public contract dependency missing');
  needed[name] = schema;
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') include(child.replace('#/components/schemas/', ''));
      else visit(child);
    }
  };
  visit(schema);
};
for (const contract of Object.values(AI_CLIENT_PUBLIC_CONTRACTS)) { include(contract.request); include(contract.response); }
const definitions = JSON.parse(JSON.stringify(needed).replaceAll('#/components/schemas/', '#/$defs/'));
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const validators = Object.fromEntries(Object.keys(needed).map(name => [name, ajv.compile({ $ref: `#/$defs/${name}`, $defs: definitions })]));
const responses = { read: aiClientPublicReadResponseSchema, issueSession: aiClientPublicSessionResponseSchema,
  prepare: aiClientPublicPreparationResponseSchema, readOriginal: aiClientPublicOperationResponseSchema,
  continueOriginal: aiClientPublicContinuationResponseSchema, readContinuation: aiClientPublicContinuationResponseSchema };

abstract class ClientPublicController {
  constructor(protected readonly application: AiClientPublicApplication) {}
  protected async respond(request: Request, action: AiClientPublicAction) {
    const write = action === 'prepare' || action === 'continueOriginal';
    try {
      const contract = AI_CLIENT_PUBLIC_CONTRACTS[action], input = structuredClone(request.body);
      if (Buffer.byteLength(JSON.stringify(input) ?? '', 'utf8') > 4096 || !validators[contract.request](input)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const current = { headers: { authorization: request.headers?.authorization,
        [AI_CLIENT_PUBLIC_HTTP.credentialHeader]: request.headers?.[AI_CLIENT_PUBLIC_HTTP.credentialHeader] }, ip: request.ip };
      const result = await withRequestAbort(request, signal => this.application.call(current, action, input, signal), { maxWaitMs: 15000 });
      const copy = JSON.parse(JSON.stringify(result));
      if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > 262144 || !validators[contract.response](copy)
        || !responses[action].safeParse(copy).success) {
        if (write) throw new ClientPublicContinuityUnknownError(action === 'continueOriginal'
          ? 'read_original_public_continuation' : 'read_original_public_operation');
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      }
      return copy;
    } catch (error) {
      const aliases: Record<string, string> = { AI_CLIENT_INVALID_INPUT: 'AI_INVALID_INPUT',
        AI_CLIENT_CONTEXT_UNAVAILABLE: 'AI_ACCESS_DENIED', AI_CLIENT_CAPABILITY_UNAVAILABLE: 'AI_RESOURCE_UNAVAILABLE',
        AI_CLIENT_MATERIAL_STALE: 'AI_REVISION_CONFLICT', AI_CLIENT_REVISION_CONFLICT: 'AI_REVISION_CONFLICT',
        AI_CLIENT_RESULT_UNKNOWN: 'AI_RESULT_UNKNOWN' };
      const raw = error instanceof AiTaskRepositoryError || error instanceof AiClientEntryError || error instanceof AiRequestWaitError
        || error instanceof ClientPublicContinuityUnknownError ? error.code
        : error instanceof HttpException ? [401, 403, 404].includes(error.getStatus()) ? 'AI_ACCESS_DENIED'
          : error.getStatus() === 400 ? 'AI_INVALID_INPUT' : 'AI_RESOURCE_UNAVAILABLE'
        : error instanceof Error ? aliases[error.message] ?? 'AI_RESOURCE_UNAVAILABLE' : 'AI_RESOURCE_UNAVAILABLE';
      const code = ['AI_INVALID_INPUT', 'AI_ACCESS_DENIED', 'AI_REVISION_CONFLICT', 'AI_RESULT_UNKNOWN'].includes(raw) ? raw : 'AI_RESOURCE_UNAVAILABLE';
      const status = code === 'AI_INVALID_INPUT' ? 400 : code === 'AI_ACCESS_DENIED' ? 403
        : code === 'AI_REVISION_CONFLICT' || code === 'AI_RESULT_UNKNOWN' ? 409 : 503;
      throw new HttpException({ code, retryable: false, executionPermission: false, businessActionRequested: false,
        ...(write ? { nextAction: action === 'continueOriginal' ? 'read_original_public_continuation' : 'read_original_public_operation' } : {}) }, status);
    }
  }
  @Post(AI_CLIENT_PUBLIC_HTTP.read) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: Request) { return this.respond(request, 'read'); }
  @Post(AI_CLIENT_PUBLIC_HTTP.issueSession) @HttpCode(200) @Header('Cache-Control', 'no-store')
  issueSession(@Req() request: Request) { return this.respond(request, 'issueSession'); }
  @Post(AI_CLIENT_PUBLIC_HTTP.prepare) @HttpCode(200) @Header('Cache-Control', 'no-store')
  prepare(@Req() request: Request) { return this.respond(request, 'prepare'); }
  @Post(AI_CLIENT_PUBLIC_HTTP.readOriginal) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readOriginal(@Req() request: Request) { return this.respond(request, 'readOriginal'); }
  @Post(AI_CLIENT_PUBLIC_HTTP.continueOriginal) @HttpCode(200) @Header('Cache-Control', 'no-store')
  continueOriginal(@Req() request: Request) { return this.respond(request, 'continueOriginal'); }
  @Post(AI_CLIENT_PUBLIC_HTTP.readContinuation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readContinuation(@Req() request: Request) { return this.respond(request, 'readContinuation'); }
}
@Controller(AI_CLIENT_PUBLIC_HTTP.basePaths[0])
export class WebsiteClientPublicController extends ClientPublicController {
  constructor(@Inject(AI_WEBSITE_PUBLIC_ENTRY) application: AiClientPublicApplication) { super(application); }
}
@Controller(AI_CLIENT_PUBLIC_HTTP.basePaths[1])
export class WechatClientPublicController extends ClientPublicController {
  constructor(@Inject(AI_WECHAT_PUBLIC_ENTRY) application: AiClientPublicApplication) { super(application); }
}
