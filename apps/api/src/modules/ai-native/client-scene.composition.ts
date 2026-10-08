import type { ClientApiService } from '../client/client-api.service';
import type { ClientRequestContext } from '../client/client-auth.service';
import type { ClientMyOrdersQuery } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { getRequestIdentity, runWithRequestIdentity } from '../../common/request-identity';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { z } from 'zod';
import { ValidationPipe } from '@nestjs/common';
import { ClientAvailabilityRequestDto, ClientMyOrdersQueryDto } from '../client/client-request.dto';

/**
 * CA08 read-only client boundary.
 *
 * The context source must be created by the existing ClientAuthService/route
 * adapter. No model, task id, operator token or caller-supplied tenant is
 * accepted here. The existing ClientApiService remains the authority for
 * published-channel filtering and ownership checks; this adapter only exposes
 * the already implemented client-safe operations to a future AI host.
 *
 * This is an explicit composition leaf: it registers no route, worker, model
 * call or local permission policy. A missing context source or client service
 * fails closed at assembly time.
 */
export interface AiClientSessionSource {
  current(): Promise<ClientRequestContext>;
  withRead?<T>(operation: ClientReadOperation, value: unknown, read: (context: ClientRequestContext) => Promise<T>): Promise<T>;
}

type ClientReadOperation = 'catalog' | 'availability' | 'orders' | 'order' | 'corporateIdentities' | 'profile' | 'cancellationPreview';

/** Request-bound production adapter: credentials are supplied by the server
 * request host, never by model/tool parameters. The existing Guard resolves
 * ClientAuthService and its rate/tenant policies; this creates no client token.
 */
export function createAiGuardedClientSession(guard: Pick<ApiAuthGuard, 'canActivate'>,
  credentials: { current(): Promise<{ authorization: string; ip?: string }> }): AiClientSessionSource {
  if (typeof guard?.canActivate !== 'function' || typeof credentials?.current !== 'function') throw new Error('AI_CLIENT_CONTEXT_UNAVAILABLE');
  const authorize = async <T>(method: string, path: string, value: unknown, consume: (context: ClientRequestContext) => Promise<T>) => {
    const credential = structuredClone(await credentials.current());
    if (typeof credential?.authorization !== 'string' || credential.authorization.length > 8192) throw new Error('AI_CLIENT_CONTEXT_UNAVAILABLE');
    return runWithRequestIdentity({}, async () => {
      const request: { method: string; url: string; originalUrl: string; headers: { authorization: string };
        ip?: string; query: unknown; body: unknown; client?: ClientRequestContext } = {
        method, url: `/api/client/v1/${path}`, originalUrl: `/api/client/v1/${path}`,
        headers: { authorization: credential.authorization }, ip: credential.ip,
        query: method === 'GET' ? structuredClone(value) : {}, body: method === 'POST' ? structuredClone(value) : {}
      };
      if (await guard.canActivate(new ExecutionContextHost([request])) !== true || !request.client) throw new Error('AI_CLIENT_CONTEXT_UNAVAILABLE');
      const context = assertClientContext(request.client), identity = getRequestIdentity();
      if (!identity || identity.tenantId !== context.tenantId || identity.workspaceId !== context.workspaceId
        || identity.userId !== context.customerId || identity.isSaasAdmin !== false || identity.staffApi === true) throw new Error('AI_CLIENT_CONTEXT_UNAVAILABLE');
      return consume(context);
    });
  };
  return Object.freeze({
    current: () => authorize('GET', 'auth/me', {}, async context => context),
    withRead: async <T>(operation: ClientReadOperation, value: unknown, read: (context: ClientRequestContext) => Promise<T>) => {
      const routes = { catalog: 'catalog', availability: 'availability', orders: 'my/orders',
        order: 'orders', corporateIdentities: 'membership/corporates', profile: 'profile', cancellationPreview: 'orders' } as const;
      if (!Object.prototype.hasOwnProperty.call(routes, operation)) throw new Error('AI_CLIENT_CAPABILITY_UNAVAILABLE');
      let path: string = routes[operation];
      const orderRead = operation === 'order' || operation === 'cancellationPreview';
      if (orderRead) {
        const parsed = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).safeParse(value);
        if (!parsed.success) throw new Error('AI_CLIENT_INVALID_INPUT');
        path += `/${parsed.data}${operation === 'cancellationPreview' ? '/cancel/preview' : ''}`;
      }
      const method = operation === 'availability' || operation === 'cancellationPreview' ? 'POST' : 'GET';
      return authorize(method, path, orderRead ? {} : value, async before => {
        const result = await read(before);
        await authorize(method, path, orderRead ? {} : value, async after => {
          if (requestFingerprint(before) !== requestFingerprint(after)) throw new Error('AI_CLIENT_CONTEXT_UNAVAILABLE');
        });
        return result;
      });
    }
  });
}

type ClientReadPort = Pick<ClientApiService,
  'channelBootstrap' | 'publicCatalog' | 'catalog' | 'availability' | 'myOrders' | 'getOrder' | 'corporateIdentities'>
  & Partial<Pick<ClientApiService, 'profile' | 'previewCancellation' | 'publicDocument'>>;

function assertContextSource(source: AiClientSessionSource) {
  if (!source || typeof source.current !== 'function') throw new Error('AI_CLIENT_CONTEXT_UNAVAILABLE');
}

function assertClientContext(context: ClientRequestContext) {
  if (!context || typeof context.tenantId !== 'string' || typeof context.workspaceId !== 'string'
    || typeof context.customerId !== 'string' || typeof context.sessionId !== 'string'
    || !['personal', 'corporate'].includes(context.customerType)
    || context.membershipStatus !== 'active') throw new Error('AI_CLIENT_CONTEXT_UNAVAILABLE');
  return structuredClone(context);
}

export function composeAiClientScenes(input: {
  client: ClientReadPort;
  session?: AiClientSessionSource;
}) {
  const validation = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const required: ReadonlyArray<keyof ClientReadPort> = ['channelBootstrap', 'publicCatalog', 'catalog',
    'availability', 'myOrders', 'getOrder', 'corporateIdentities'];
  if (!input?.client || required.some(method => typeof input.client[method] !== 'function')) {
    throw new Error('AI_CLIENT_CAPABILITY_UNAVAILABLE');
  }
  if (input.session) assertContextSource(input.session);

  const member = () => {
    if (!input.session) throw new Error('AI_CLIENT_CONTEXT_UNAVAILABLE');
    return input.session.current().then(assertClientContext);
  };
  const memberRead = async <T>(operation: ClientReadOperation, value: unknown, read: (context: ClientRequestContext) => Promise<T>) => {
    const command = structuredClone(value);
    if (input.session?.withRead) return input.session.withRead(operation, command, read);
    const before = await member();
    return runWithRequestIdentity({ tenantId: before.tenantId, workspaceId: before.workspaceId,
      userId: before.customerId, isSaasAdmin: false }, async () => {
      const result = await read(before), after = await member();
      if (requestFingerprint(before) !== requestFingerprint(after)) throw new Error('AI_CLIENT_CONTEXT_UNAVAILABLE');
      return result;
    });
  };
  return Object.freeze({
    guest: Object.freeze({
      bootstrap: (tenantCode: string, channel: 'wechat_miniprogram' | 'app' | 'web' = 'wechat_miniprogram', appId?: string) =>
        input.client.channelBootstrap(tenantCode, channel, appId),
      catalog: (tenantCode: string, serviceCode: string) => input.client.publicCatalog(tenantCode, serviceCode),
      help: (tenantCode: string) => {
        if (typeof input.client.publicDocument !== 'function') throw new Error('AI_CLIENT_CAPABILITY_UNAVAILABLE');
        return input.client.publicDocument(tenantCode, 'help');
      }
    }),
    member: Object.freeze({
      profile: async () => {
        if (typeof input.client.profile !== 'function') throw new Error('AI_CLIENT_CAPABILITY_UNAVAILABLE');
        return memberRead('profile', {}, context => input.client.profile!(context));
      },
      cancellationPreview: async (orderId: string) => {
        if (typeof input.client.previewCancellation !== 'function') throw new Error('AI_CLIENT_CAPABILITY_UNAVAILABLE');
        return memberRead('cancellationPreview', orderId, context => input.client.previewCancellation!(context, orderId));
      },
      catalog: async () => memberRead('catalog', {}, context => input.client.catalog(context)),
      availability: async (value: { locationId: string; startAt: string; endAt: string; lines: Array<{ itemGroupId: string; quantity: number }> }) => {
        const frozen: ClientAvailabilityRequestDto = await validation.transform(structuredClone(value), {
          type: 'body', metatype: ClientAvailabilityRequestDto
        });
        return memberRead('availability', frozen, context => input.client.availability(context, frozen));
      },
      orders: async (query: ClientMyOrdersQuery = {}) => {
        const frozen: ClientMyOrdersQueryDto = await validation.transform(structuredClone(query), {
          type: 'query', metatype: ClientMyOrdersQueryDto
        });
        return memberRead('orders', frozen, context => input.client.myOrders(context, frozen));
      },
      order: async (orderId: string) => memberRead('order', orderId, context => input.client.getOrder(context, orderId)),
      corporateIdentities: async () => memberRead('corporateIdentities', {}, context => input.client.corporateIdentities(context))
    }),
    boundary: Object.freeze({
      audience: 'client' as const,
      guestData: 'published_channel_projection_only' as const,
      memberData: 'current_client_session_and_own_order_only' as const,
      excluded: ['operator_tools', 'staff_tools', 'tenant_inventory', 'costs', 'review_notes', 'model_urls'] as const,
      execution: 'not_attempted' as const
    })
  });
}
