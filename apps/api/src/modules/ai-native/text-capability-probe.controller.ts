import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runWithRequestIdentity } from '../../common/request-identity';
import { AI_TEXT_CAPABILITY_HTTP_DRAFT as routes, type AiTextCapabilityHttpErrorDraft,
  type AiTextCapabilityHttpResponsesDraft } from '@rental-os/shared';
import { TextCapabilityProbeRequestFactory, type TextCapabilityHttpRequest, type TextCapabilityRequest } from './text-capability-probe-request.factory';

export const TEXT_CAPABILITY_PROBE_REQUESTS = Symbol('TEXT_CAPABILITY_PROBE_REQUESTS');
type Request = TextCapabilityHttpRequest & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
type Response = Pick<ServerResponse, 'once' | 'removeListener' | 'writableFinished' | 'destroyed'>;
type Method = keyof AiTextCapabilityHttpResponsesDraft;
const unknownRead: Record<Method, NonNullable<AiTextCapabilityHttpErrorDraft['nextAction']>> = {
  prepare: 'readOriginal', publish: 'readOriginal', readOriginal: 'readOriginal', createTask: 'readTask', readTask: 'readTask',
  start: 'reconcile', inspect: 'inspect', cancel: 'inspect', reconcile: 'reconcile', readCapabilityReceipt: 'readCapabilityReceipt', preflight: 'readCapabilityReceipt',
  readHistory: 'readHistory',
  readAccounting: 'readAccounting', releaseUnsent: 'readAccounting', reconcileAccounting: 'readAccounting',
  configureTaskAction: 'readTaskAction', readTaskAction: 'readTaskAction',
};
const statuses = { AI_INVALID_INPUT: 400, AI_ACCESS_DENIED: 403, AI_SCOPE_CHANGED: 403, AI_RESOURCE_UNAVAILABLE: 404,
  AI_REVISION_CONFLICT: 409, AI_STORAGE_UNAVAILABLE: 503, AI_RESULT_UNKNOWN: 409 } as const;
const gatewayCodes: Record<string, keyof typeof statuses> = { FORBIDDEN: 'AI_ACCESS_DENIED', INVALID_REQUEST: 'AI_INVALID_INPUT',
  CONFIG_INVALID: 'AI_RESOURCE_UNAVAILABLE', PROVIDER_UNAVAILABLE: 'AI_RESOURCE_UNAVAILABLE', CREDENTIAL_UNAVAILABLE: 'AI_RESOURCE_UNAVAILABLE',
  CAPABILITY_UNSUPPORTED: 'AI_RESOURCE_UNAVAILABLE', BUDGET_UNAVAILABLE: 'AI_RESOURCE_UNAVAILABLE',
  ACCOUNTING_PENDING: 'AI_RESULT_UNKNOWN', CANCELLED: 'AI_RESULT_UNKNOWN' };

/** Only register through the disabled-by-default HTTP module option. POST reads
 * carry keys in the body and never start tasks; no model tools are exposed. */
@Controller(routes.basePath)
export class TextCapabilityProbeController {
  constructor(@Inject(TEXT_CAPABILITY_PROBE_REQUESTS) private readonly requests: TextCapabilityProbeRequestFactory) {}
  private call(method: Method, request: Request, body: unknown, response?: Response): Promise<AiTextCapabilityHttpResponsesDraft[Method]> {
    return runWithRequestIdentity({}, async () => {
      let current: TextCapabilityRequest | undefined;
      const controller = new AbortController(), abort = () => controller.abort();
      const onResponseClose = () => { if (!response?.writableFinished) abort(); };
      const responds = (method === 'start' || method === 'reconcile') && response
        && typeof response.once === 'function' && typeof response.removeListener === 'function';
      const listens = (method === 'start' || method === 'reconcile') && typeof request?.once === 'function'
        && typeof request?.removeListener === 'function';
      try {
        if (request?.aborted) abort();
        else if (listens) request.once!('aborted', abort); // Normal body close is not cancellation.
        if (responds) {
          if (response.destroyed) onResponseClose();
          else response.once('close', onResponseClose);
        }
        current = this.requests.open(request);
        return await current[method](body, controller.signal);
      } catch (error) {
        const raw = error instanceof Error && 'code' in error ? error.code : undefined;
        const mapped = typeof raw === 'string' && Object.prototype.hasOwnProperty.call(gatewayCodes, raw) ? gatewayCodes[raw] : raw;
        const code = typeof mapped === 'string' && Object.prototype.hasOwnProperty.call(statuses, mapped) ? mapped as keyof typeof statuses : 'AI_STORAGE_UNAVAILABLE';
        const response: AiTextCapabilityHttpErrorDraft = { code, retryable: false,
          ...(code === 'AI_RESULT_UNKNOWN' ? { nextAction: unknownRead[method] } : {}) };
        throw new HttpException(response, statuses[code]);
      } finally {
        current?.close();
        if (listens) request.removeListener!('aborted', abort);
        if (responds) response.removeListener('close', onResponseClose);
      }
    });
  }
  @Post(routes.prepare) @HttpCode(200) @Header('Cache-Control', 'no-store')
  prepare(@Req() request: Request, @Body() body: unknown) { return this.call('prepare', request, body); }
  // Policy configuration is an explicit management call, never part of task creation.
  @Post(routes.configureTaskAction) @HttpCode(200) @Header('Cache-Control', 'no-store')
  configureTaskAction(@Req() request: Request, @Body() body: unknown) { return this.call('configureTaskAction', request, body); }
  @Post(routes.readTaskAction) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskAction(@Req() request: Request, @Body() body: unknown) { return this.call('readTaskAction', request, body); }
  @Post(routes.publish) @HttpCode(200) @Header('Cache-Control', 'no-store')
  publish(@Req() request: Request, @Body() body: unknown) { return this.call('publish', request, body); }
  @Post(routes.readOriginal) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readOriginal(@Req() request: Request, @Body() body: unknown) { return this.call('readOriginal', request, body); }
  @Post(routes.createTask) @HttpCode(200) @Header('Cache-Control', 'no-store')
  createTask(@Req() request: Request, @Body() body: unknown) { return this.call('createTask', request, body); }
  @Post(routes.readTask) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTask(@Req() request: Request, @Body() body: unknown) { return this.call('readTask', request, body); }
  @Post(routes.start) @HttpCode(200) @Header('Cache-Control', 'no-store')
  start(@Req() request: Request, @Body() body: unknown, @Res({ passthrough: true }) response?: Response) {
    return this.call('start', request, body, response);
  }
  @Post(routes.inspect) @HttpCode(200) @Header('Cache-Control', 'no-store')
  inspect(@Req() request: Request, @Body() body: unknown) { return this.call('inspect', request, body); }
  @Post(routes.cancel) @HttpCode(200) @Header('Cache-Control', 'no-store')
  cancel(@Req() request: Request, @Body() body: unknown) { return this.call('cancel', request, body); }
  @Post(routes.reconcile) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcile(@Req() request: Request, @Body() body: unknown, @Res({ passthrough: true }) response?: Response) {
    return this.call('reconcile', request, body, response);
  }
  @Post(routes.readCapabilityReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCapabilityReceipt(@Req() request: Request, @Body() body: unknown) { return this.call('readCapabilityReceipt', request, body); }
  @Post(routes.readHistory) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readHistory(@Req() request: Request, @Body() body: unknown) { return this.call('readHistory', request, body); }
  @Post(routes.readAccounting) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readAccounting(@Req() request: Request, @Body() body: unknown) { return this.call('readAccounting', request, body); }
  @Post(routes.releaseUnsent) @HttpCode(200) @Header('Cache-Control', 'no-store')
  releaseUnsent(@Req() request: Request, @Body() body: unknown) { return this.call('releaseUnsent', request, body); }
  @Post(routes.reconcileAccounting) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcileAccounting(@Req() request: Request, @Body() body: unknown) { return this.call('reconcileAccounting', request, body); }
  @Post(routes.preflight) @HttpCode(200) @Header('Cache-Control', 'no-store')
  preflight(@Req() request: Request, @Body() body: unknown) { return this.call('preflight', request, body); }
}
