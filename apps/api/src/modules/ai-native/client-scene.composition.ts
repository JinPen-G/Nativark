import type { ClientApiService } from '../client/client-api.service';
import type { ClientDeliveryAddressService } from '../client/client-delivery-address.service';
import type { RentalDeliveryAddressSnapshot } from '@rental-os/shared';
import type { AiBookingSavedAddressEvidence, AiBookingOneTimeAddressEvidence } from '@rental-os/shared';
import { AiClientEntryError } from './scenes/client-entry-action';
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

type ClientReadOperation = 'catalog' | 'availability' | 'orders' | 'order' | 'feeItems' | 'corporateIdentities' | 'profile' | 'cancellationPreview' | 'quote' | 'bookingOptions' | 'savedDeliveryAddress';

/** Request-bound production adapter: credentials are supplied by the server
 * request host, never by model/tool parameters. The existing Guard resolves
 * ClientAuthService and tenant policies; the public HTTP host owns request-rate
 * accounting. Internal read revalidation never spends another HTTP request or
 * skips current authentication. This creates no client token or execution grant.
 */
export function createAiGuardedClientSession(guard: Pick<ApiAuthGuard, 'canActivate'> & Partial<Pick<ApiAuthGuard, 'revalidateClientRead'>>,
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
      const execution = new ExecutionContextHost([request]);
      const allowed = typeof guard.revalidateClientRead === 'function'
        ? await guard.revalidateClientRead(execution) : await guard.canActivate(execution);
      if (allowed !== true || !request.client) throw new Error('AI_CLIENT_CONTEXT_UNAVAILABLE');
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
        order: 'orders', feeItems: 'orders', corporateIdentities: 'membership/corporates', profile: 'profile', cancellationPreview: 'orders',
        quote: 'quotes', bookingOptions: 'membership/booking-options', savedDeliveryAddress: 'profile/addresses' } as const;
      if (!Object.prototype.hasOwnProperty.call(routes, operation)) throw new Error('AI_CLIENT_CAPABILITY_UNAVAILABLE');
      let path: string = routes[operation];
      const orderRead = operation === 'order' || operation === 'cancellationPreview' || operation === 'quote';
      if (orderRead || operation === 'feeItems') {
        const parsed = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).safeParse(value);
        if (!parsed.success) throw new Error('AI_CLIENT_INVALID_INPUT');
        path += `/${parsed.data}${operation === 'cancellationPreview' ? '/cancel/preview' : operation === 'feeItems' ? '/fee-items' : ''}`;
      }
      const method = operation === 'availability' || operation === 'cancellationPreview' ? 'POST' : 'GET';
      const routeValue = orderRead || operation === 'savedDeliveryAddress' ? {} : value;
      return authorize(method, path, routeValue, async before => {
        const result = await read(before);
        await authorize(method, path, routeValue, async after => {
          if (requestFingerprint(before) !== requestFingerprint(after)) throw new Error('AI_CLIENT_CONTEXT_UNAVAILABLE');
        });
        return result;
      });
    }
  });
}

type ClientReadPort = Pick<ClientApiService,
  'channelBootstrap' | 'publicCatalog' | 'catalog' | 'availability' | 'myOrders' | 'getOrder' | 'corporateIdentities'>
  & Partial<Pick<ClientApiService, 'profile' | 'previewCancellation' | 'publicDocument' | 'feeItems' | 'getQuote' | 'bookingOptions' | 'readQuoteServiceAvailability' | 'readQuoteOneTimeDeliveryAvailability' | 'readQuoteBookingQualification' | 'observeQuoteDeliveryAddress'>>;

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

const addressContentSchema = z.object({
  recipient: z.string().min(1).max(120), phoneMasked: z.string().min(1).max(40), countryCode: z.string().min(1).max(8),
  province: z.string().min(1).max(64), city: z.string().min(1).max(64), detail: z.string().min(1).max(255),
  district: z.string().max(64).nullish().transform(value => value ?? null),
  postalCode: z.string().max(16).nullish().transform(value => value ?? null),
  latitude: z.number().finite().min(-90).max(90).nullish().transform(value => value ?? null),
  longitude: z.number().finite().min(-180).max(180).nullish().transform(value => value ?? null)
});

export function composeAiClientScenes(input: {
  client: ClientReadPort;
  addresses?: Pick<ClientDeliveryAddressService, 'list' | 'requireOwnAddress'>;
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
      oneTimeQuoteDeliveryAddress: async (quoteId: string): Promise<AiBookingOneTimeAddressEvidence> => {
        if (typeof input.client.observeQuoteDeliveryAddress !== 'function') {
          throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'one_time_delivery_address_recheck_missing');
        }
        // Reuse the registered original GET quote Guard/ALS, not address-book
        // authority. Only a minimal server observation may cross this boundary.
        return memberRead('quote', quoteId, async context => {
          if (context.customerType !== 'personal') throw new AiClientEntryError('AI_ACCESS_DENIED', 'personal_quote_required');
          const schema: z.ZodType<AiBookingOneTimeAddressEvidence> = z.object({ source: z.literal('original_quote_one_time_address'),
            quoteId: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
            quoteCreatedAt: z.string().datetime({ offset: true }), quoteExpiresAt: z.string().datetime({ offset: true }),
            snapshotFingerprint: z.string().regex(/^[a-f0-9]{64}$/u), serviceAreaFingerprint: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
          try {
            const result = schema.safeParse(structuredClone(await input.client.observeQuoteDeliveryAddress!(context, quoteId)));
            if (!result.success || result.data.quoteId !== quoteId)
              throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'one_time_quote_address_evidence_invalid');
            return result.data;
          } catch (error) {
            if (error instanceof AiClientEntryError) throw error;
            const status = error instanceof Error && 'getStatus' in error && typeof error.getStatus === 'function' ? error.getStatus() : null;
            if (status === 409) throw new AiClientEntryError('AI_PROPOSAL_STALE', 'one_time_quote_address_changed', 'reprepare');
            if (status === 403) throw new AiClientEntryError('AI_ACCESS_DENIED', 'one_time_quote_address_scope');
            throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'one_time_quote_address_read_unavailable');
          }
        });
      },
      savedDeliveryAddress: async (addressId: string, quoteSnapshot: RentalDeliveryAddressSnapshot): Promise<AiBookingSavedAddressEvidence> => {
        const addresses = input.addresses;
        if (typeof addresses?.list !== 'function' || typeof addresses.requireOwnAddress !== 'function') {
          throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'current_delivery_address_recheck_missing');
        }
        const snapshot = structuredClone(quoteSnapshot), parsed = addressContentSchema.safeParse(snapshot);
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(addressId) || snapshot?.addressId !== addressId || !parsed.success
          || typeof snapshot.phone !== 'string' || !/^\+?[0-9]{6,20}$/u.test(snapshot.phone)) {
          throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'quote_address_basis_missing');
        }
        const staleAddress = () => new AiClientEntryError('AI_PROPOSAL_STALE', 'saved_address_changed', 'reprepare');
        return memberRead('savedDeliveryAddress', addressId, async context => {
          try {
            if (context.customerType !== 'personal') throw new AiClientEntryError('AI_ACCESS_DENIED', 'personal_address_required');
            const before = await addresses.list(context);
            if (before.items.length > 20) throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'address_list_limit');
            const listed = before.items.filter(row => row.id === addressId);
            if (listed.length !== 1) throw staleAddress();
            const current = await addresses.requireOwnAddress(context, addressId);
            const content = addressContentSchema.parse({ ...current,
              latitude: current.latitude === null ? null : Number(current.latitude), longitude: current.longitude === null ? null : Number(current.longitude) });
            const contentHash = requestFingerprint(content), updatedAt = current.updatedAt.toISOString();
            if (current.id !== addressId || current.tenantId !== context.tenantId || current.customerId !== context.customerId
              || current.status !== 'active' || !Number.isSafeInteger(current.revision) || current.revision < 1
              || current.phone !== snapshot.phone || current.deliveryServiceAreaDecision.allowed !== true
              || contentHash !== requestFingerprint(parsed.data) || listed[0].revision !== current.revision
              || listed[0].updatedAt !== updatedAt || requestFingerprint(addressContentSchema.parse(listed[0])) !== contentHash) throw staleAddress();
            const after = await addresses.list(context), latest = await addresses.requireOwnAddress(context, addressId);
            const visible = after.items.filter(row => row.id === addressId);
            const latestContent = addressContentSchema.parse({ ...latest,
              latitude: latest.latitude === null ? null : Number(latest.latitude), longitude: latest.longitude === null ? null : Number(latest.longitude) });
            if (after.items.length > 20 || visible.length !== 1 || visible[0].revision !== current.revision
              || visible[0].updatedAt !== updatedAt || requestFingerprint(addressContentSchema.parse(visible[0])) !== contentHash
              || latest.id !== current.id || latest.tenantId !== context.tenantId || latest.customerId !== context.customerId
              || latest.status !== 'active' || latest.revision !== current.revision || latest.phone !== snapshot.phone
              || latest.updatedAt.toISOString() !== updatedAt || requestFingerprint(latestContent) !== contentHash
              || requestFingerprint(latest.deliveryServiceAreaDecision) !== requestFingerprint(current.deliveryServiceAreaDecision)) throw staleAddress();
            return { addressId, observedRevision: current.revision, observedUpdatedAt: updatedAt, quoteAddressRevision: null,
              snapshotFingerprint: contentHash, serviceAreaFingerprint: requestFingerprint(latest.deliveryServiceAreaDecision),
              source: 'current_client_saved_address' as const };
          } catch (error) {
            if (error instanceof AiClientEntryError) throw error;
            const status = error instanceof Error && 'getStatus' in error && typeof error.getStatus === 'function' ? error.getStatus() : null;
            if ([400, 403, 404].includes(status)) throw staleAddress();
            throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'saved_address_read_unavailable');
          }
        });
      },
      bookingOptions: async () => {
        if (typeof input.client.bookingOptions !== 'function') throw new Error('AI_CLIENT_CAPABILITY_UNAVAILABLE');
        return memberRead('bookingOptions', {}, context => input.client.bookingOptions!(context));
      },
      quote: async (quoteId: string) => {
        if (typeof input.client.getQuote !== 'function') throw new Error('AI_CLIENT_CAPABILITY_UNAVAILABLE');
        return memberRead('quote', quoteId, context => input.client.getQuote!(context, quoteId));
      },
      // Original quote route/Guard and Membership business gate. No payer grant
      // or certificate details are exposed; missing current producer fails closed.
      bookingQualification: async (quoteId: string) => {
        if (typeof input.client.readQuoteBookingQualification !== 'function')
          throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'current_booking_qualification_recheck_missing');
        return memberRead('quote', quoteId, async context => {
          try { return await input.client.readQuoteBookingQualification!(context, quoteId); }
          catch (error) {
            const status = error instanceof Error && 'getStatus' in error && typeof error.getStatus === 'function' ? error.getStatus() : null;
            if (status === 409) throw new AiClientEntryError('AI_PROPOSAL_STALE', 'current_booking_qualification_changed', 'reprepare');
            if (status === 403) throw new AiClientEntryError('AI_ACCESS_DENIED', 'current_booking_qualification_scope');
            throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'current_booking_qualification_read_unavailable');
          }
        });
      },
      // Same original owned-quote read route, never a new capability/write
      // route or client-selected service IDs. Missing real Core port fails closed.
      serviceAvailability: async (quoteId: string) => {
        if (typeof input.client.readQuoteServiceAvailability !== 'function') {
          throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'current_service_capacity_recheck_missing');
        }
        return memberRead('quote', quoteId, context => input.client.readQuoteServiceAvailability!(context, quoteId));
      },
      // An original one-time quote snapshot is NOT a saved-address revision or
      // a Booking confirmation. This leaf only observes current delivery policy.
      oneTimeDeliveryAvailability: async (quoteId: string) => {
        if (typeof input.client.readQuoteOneTimeDeliveryAvailability !== 'function') {
          throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'one_time_delivery_address_recheck_missing');
        }
        return memberRead('quote', quoteId, context => input.client.readQuoteOneTimeDeliveryAvailability!(context, quoteId));
      },
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
      ...(typeof input.client.feeItems === 'function' ? {
        feeItems: async (orderId: string) => memberRead('feeItems', orderId,
          context => input.client.feeItems!(context, orderId))
      } : {}),
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
