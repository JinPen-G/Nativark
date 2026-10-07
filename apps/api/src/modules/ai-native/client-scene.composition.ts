import type { ClientApiService } from '../client/client-api.service';
import type { ClientRequestContext } from '../client/client-auth.service';
import type { ClientMyOrdersQuery } from '@rental-os/shared';

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
}

type ClientReadPort = Pick<ClientApiService,
  'channelBootstrap' | 'publicCatalog' | 'catalog' | 'availability' | 'myOrders' | 'getOrder' | 'corporateIdentities'>;

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
  if (!input?.client || typeof input.client.channelBootstrap !== 'function'
    || typeof input.client.publicCatalog !== 'function') throw new Error('AI_CLIENT_CAPABILITY_UNAVAILABLE');
  if (input.session) assertContextSource(input.session);

  const member = () => {
    if (!input.session) throw new Error('AI_CLIENT_CONTEXT_UNAVAILABLE');
    return input.session.current().then(assertClientContext);
  };
  return Object.freeze({
    guest: Object.freeze({
      bootstrap: (tenantCode: string, channel: 'wechat_miniprogram' | 'app' | 'web' = 'wechat_miniprogram', appId?: string) =>
        input.client.channelBootstrap(tenantCode, channel, appId),
      catalog: (tenantCode: string, serviceCode: string) => input.client.publicCatalog(tenantCode, serviceCode)
    }),
    member: Object.freeze({
      catalog: async () => input.client.catalog(await member()),
      availability: async (value: { locationId: string; startAt: string; endAt: string; lines: Array<{ itemGroupId: string; quantity: number }> }) =>
        input.client.availability(await member(), structuredClone(value)),
      orders: async (query: ClientMyOrdersQuery = {}) => input.client.myOrders(await member(), structuredClone(query)),
      order: async (orderId: string) => input.client.getOrder(await member(), orderId),
      corporateIdentities: async () => input.client.corporateIdentities(await member())
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

