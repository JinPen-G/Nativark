import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { BadRequestException, ForbiddenException, HttpException, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { z } from 'zod';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../common/request-identity';
import type { ClientRequestContext } from '../client/client-auth.service';
import type { ClientApiService } from '../client/client-api.service';
import { ClientCreateQuoteRequestDto } from '../client/client-request.dto';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

const reference = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const readSchema = z.object({ reference }).strict();
const createSchema = readSchema.extend({ input: z.unknown(), prepared: z.object({
  inputHash: z.string().regex(/^[a-f0-9]{64}$/u), configurationHash: z.string().regex(/^[a-f0-9]{64}$/u)
}).strict().optional() }).strict();
export class AiClientQuoteResultUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN'; readonly retryable = false;
  readonly nextAction = 'read_original_quote';
  constructor() { super('AI_RESULT_UNKNOWN'); }
}

/** Explicit R1 server adapter. No production route, arbitrary operator identity,
 * automatic retries or task/approval bypass. The scene consumer must bind this
 * reference/input to its original request and human choice before create. */
export function composeGuardedClientOriginalQuotes(input: {
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: { current(): Promise<{ authorization: string; ip?: string }> };
  client: Pick<ClientApiService, 'createQuoteForOriginalOperation' | 'readQuoteForOriginalOperation'>
    & Partial<Pick<ClientApiService, 'prepareQuoteForOriginalOperation'>>;
}) {
  if ([input?.guard?.canActivate, input?.credentials?.current, input?.client?.createQuoteForOriginalOperation,
    input?.client?.readQuoteForOriginalOperation].some(method => typeof method !== 'function')) throw new ServiceUnavailableException();
  const validation = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const authorize = async (method: 'GET' | 'POST', path: 'auth/me' | 'quotes', body: unknown) => {
    const credential = structuredClone(await input.credentials.current());
    if (typeof credential.authorization !== 'string' || credential.authorization.length > 8192
      || !/^Bearer [A-Za-z0-9._~+/-]+=*$/u.test(credential.authorization)) throw new ForbiddenException();
    const request = { method, url: `/api/client/v1/${path}`, originalUrl: `/api/client/v1/${path}`,
      headers: { authorization: credential.authorization }, ip: credential.ip, query: {}, body: structuredClone(body),
      client: undefined as ClientRequestContext | undefined };
    if (await input.guard.canActivate(new ExecutionContextHost([request])) !== true || !request.client) throw new ForbiddenException();
    const context = structuredClone(request.client), identity = getRequestIdentity();
    if (context.membershipStatus !== 'active' || !identity || identity.tenantId !== context.tenantId
      || identity.workspaceId !== context.workspaceId || identity.userId !== context.customerId
      || identity.isSaasAdmin !== false || identity.staffApi === true) throw new ForbiddenException();
    return context;
  };
  const current = <T>(method: 'GET' | 'POST', path: 'auth/me' | 'quotes', body: unknown,
    work: (context: ClientRequestContext) => Promise<T>) => runWithRequestIdentity({}, async () => {
    const before = await authorize(method, path, body);
    const recheck = async () => { if (requestFingerprint(await authorize(method, path, body)) !== requestFingerprint(before)) throw new ForbiddenException(); };
    try { const result = await work(before); await recheck(); return result; }
    catch (error) { await recheck(); throw error; }
  });
  return Object.freeze({
    async prepare(value: unknown) {
      const parsed = z.object({ input: z.unknown() }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new BadRequestException();
      if (typeof input.client.prepareQuoteForOriginalOperation !== 'function') throw new ServiceUnavailableException();
      const body = await validation.transform(parsed.data.input, { type: 'body', metatype: ClientCreateQuoteRequestDto });
      return current('POST', 'quotes', body, context => input.client.prepareQuoteForOriginalOperation!(context, body));
    },
    async create(value: unknown) {
      const parsed = createSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new BadRequestException();
      const command = parsed.data;
      const body = await validation.transform(command.input, { type: 'body', metatype: ClientCreateQuoteRequestDto });
      return current('POST', 'quotes', body, async context => {
        try {
          const quote = await input.client.createQuoteForOriginalOperation(context, body, command.reference, command.prepared);
          return { quote, quotePersistence: 'saved' as const, inventoryReservation: 'not_attempted' as const,
            orderExecution: 'not_attempted' as const, retryable: false as const };
        } catch (error) {
          if (error instanceof HttpException && error.getStatus() < 500) throw error;
          // COMMIT acknowledgement loss cannot become permission to resend.
          throw new AiClientQuoteResultUnknownError();
        }
      });
    },
    async readOriginal(value: unknown) {
      const parsed = readSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new BadRequestException();
      return current('GET', 'auth/me', {}, async context => {
        const quote = await input.client.readQuoteForOriginalOperation(context, parsed.data.reference);
        return { state: quote ? 'observed' as const : 'unknown' as const, quote: quote ?? null,
          quotePersistence: quote ? 'saved' as const : 'unknown' as const,
          inventoryReservation: 'not_attempted' as const, orderExecution: 'not_attempted' as const, retryable: false as const };
      });
    },
  });
}
