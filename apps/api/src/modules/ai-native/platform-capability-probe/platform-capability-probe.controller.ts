import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AI_PLATFORM_CAPABILITY_HTTP_DRAFT as routes } from '@rental-os/shared';
import { PlatformCapabilityProbeRequestFactory,
  type PlatformCapabilityProbeHttpRequest } from './platform-capability-probe-request.factory';

export const PLATFORM_CAPABILITY_PROBE_REQUESTS = Symbol('PLATFORM_CAPABILITY_PROBE_REQUESTS');
type Request = PlatformCapabilityProbeHttpRequest & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
type Response = Pick<ServerResponse, 'once' | 'removeListener' | 'writableFinished' | 'destroyed'>;

type Method = Exclude<keyof ReturnType<PlatformCapabilityProbeRequestFactory['open']>, 'close'>;
const unknownRead: Record<Method, string> = { prepareOriginal: 'readOriginal', readOriginal: 'readOriginal',
  createTask: 'readTask', readCreation: 'readTask', start: 'reconcile', inspect: 'inspect', requestCancellation: 'inspect',
  reconcile: 'reconcile', readCapabilityReceipt: 'readHistory', readHistory: 'readHistory',
  readTaskPolicyMutation: 'readTaskPolicyMutation', readAccounting: 'readAccounting',
  readAccountingOperation: 'readAccountingOperation', releaseUnsent: 'readAccountingOperation', reconcileAccounting: 'readAccountingOperation' };

const statuses = { AI_INVALID_INPUT: 400, AI_ACCESS_DENIED: 403, AI_SCOPE_CHANGED: 403, AI_RESOURCE_UNAVAILABLE: 404,
  AI_REVISION_CONFLICT: 409, AI_STORAGE_UNAVAILABLE: 503, AI_RESULT_UNKNOWN: 409 } as const;
const gatewayCodes: Record<string, keyof typeof statuses> = { FORBIDDEN: 'AI_ACCESS_DENIED', INVALID_REQUEST: 'AI_INVALID_INPUT',
  CONFIG_INVALID: 'AI_RESOURCE_UNAVAILABLE', PROVIDER_UNAVAILABLE: 'AI_RESOURCE_UNAVAILABLE', CREDENTIAL_UNAVAILABLE: 'AI_RESOURCE_UNAVAILABLE',
  CAPABILITY_UNSUPPORTED: 'AI_RESOURCE_UNAVAILABLE', BUDGET_UNAVAILABLE: 'AI_RESOURCE_UNAVAILABLE',
  ACCOUNTING_PENDING: 'AI_RESULT_UNKNOWN', CANCELLED: 'AI_RESULT_UNKNOWN' };

/** Platform capability probe HTTP transport. The Guard must map
 * `POST /ai-native/platform-capability/*` to platform permissions
 * (mainline wiring); without that mapping every request fails closed.
 * The request factory enforces per-request credentials and the composition
 * re-verifies the SaaS principal on every operation. */
@Controller(routes.basePath)
export class PlatformCapabilityProbeController {
  constructor(@Inject(PLATFORM_CAPABILITY_PROBE_REQUESTS) private readonly requests: PlatformCapabilityProbeRequestFactory) {}

  private call(method: Method, request: Request, body: unknown, response?: Response): Promise<unknown> {
    return (async () => {
      let current: ReturnType<PlatformCapabilityProbeRequestFactory['open']> | undefined;
      const controller = new AbortController(), abort = () => controller.abort();
      const onResponseClose = () => { if (!response?.writableFinished) abort(); };
      const responds = (method === 'start' || method === 'reconcile') && response
        && typeof response.once === 'function' && typeof response.removeListener === 'function';
      const listens = (method === 'start' || method === 'reconcile') && typeof request?.once === 'function'
        && typeof request?.removeListener === 'function';
      try {
        if (request?.aborted) abort();
        else if (listens) request.once!('aborted', abort);
        if (responds) {
          if (response.destroyed) onResponseClose();
          else response.once('close', onResponseClose);
        }
        current = this.requests.open(request);
        const operation = (current as Record<string, (...args: unknown[]) => unknown>)[method];
        if (typeof operation !== 'function') throw Object.assign(new Error('AI_INVALID_INPUT'), { code: 'AI_INVALID_INPUT' });
        return await (operation as (v: unknown, s?: AbortSignal) => Promise<unknown>)(body, controller.signal);
      } catch (error) {
        const raw = error instanceof Error && 'code' in error ? error.code : undefined;
        const mapped = typeof raw === 'string' && Object.prototype.hasOwnProperty.call(gatewayCodes, raw) ? gatewayCodes[raw] : raw;
        const code = typeof mapped === 'string' && Object.prototype.hasOwnProperty.call(statuses, mapped) ? mapped as keyof typeof statuses : 'AI_STORAGE_UNAVAILABLE';
        throw new HttpException({ code, retryable: false,
          ...(code === 'AI_RESULT_UNKNOWN' ? { nextAction: unknownRead[method] } : {}) }, statuses[code]);
      } finally {
        current?.close();
        if (listens) request.removeListener!('aborted', abort);
        if (responds) response.removeListener('close', onResponseClose);
      }
    })();
  }

  @Post(routes.publish) @HttpCode(200) @Header('Cache-Control', 'no-store')
  publish(@Req() request: Request, @Body() body: unknown) { return this.call('prepareOriginal', request, body); }
  @Post(routes.readOriginal) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readOriginal(@Req() request: Request, @Body() body: unknown) { return this.call('readOriginal', request, body); }
  @Post(routes.createTask) @HttpCode(200) @Header('Cache-Control', 'no-store')
  createTask(@Req() request: Request, @Body() body: unknown) { return this.call('createTask', request, body); }
  @Post(routes.readTask) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTask(@Req() request: Request, @Body() body: unknown) { return this.call('readCreation', request, body); }
  @Post(routes.start) @HttpCode(200) @Header('Cache-Control', 'no-store')
  start(@Req() request: Request, @Body() body: unknown, @Res({ passthrough: true }) response?: Response) {
    return this.call('start', request, body, response);
  }
  @Post(routes.inspect) @HttpCode(200) @Header('Cache-Control', 'no-store')
  inspect(@Req() request: Request, @Body() body: unknown) { return this.call('inspect', request, body); }
  @Post(routes.cancel) @HttpCode(200) @Header('Cache-Control', 'no-store')
  cancel(@Req() request: Request, @Body() body: unknown) { return this.call('requestCancellation', request, body); }
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
  @Post(routes.readAccountingOperation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readAccountingOperation(@Req() request: Request, @Body() body: unknown) { return this.call('readAccountingOperation', request, body); }
  @Post(routes.releaseUnsent) @HttpCode(200) @Header('Cache-Control', 'no-store')
  releaseUnsent(@Req() request: Request, @Body() body: unknown) { return this.call('releaseUnsent', request, body); }
  @Post(routes.reconcileAccounting) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcileAccounting(@Req() request: Request, @Body() body: unknown) { return this.call('reconcileAccounting', request, body); }
}
