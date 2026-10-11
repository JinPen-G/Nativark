import type { AiBookingHandoff } from '../../../../../packages/shared/src/ai-booking-draft';

export interface BookingHandoffHost {
  enabled: boolean;
  capability: { tenantCode: string; workspaceCode: string; customerId: string; tenantId: string; workspaceId: string; releaseRevision: string };
  handoffRef: string;
  readBookingHandoff: (input: { handoffRef: string }) => Promise<AiBookingHandoff>;
  isCurrent?(): boolean;
  dispose?(): void;
}
export interface BookingPageContext { tenantCode: string | null; workspaceCode?: string; customerId?: string; authenticated: boolean; productId: string }
export type BookingHandoffState = { status: 'disabled' | 'loading' | 'available' | 'continued' | 'unavailable'; handoff: AiBookingHandoff | null };

/** Instance-owned consumer. The host must bind the port to the current request;
 * page context is isolation input, never a server authorization credential. */
export function createBookingHandoffConsumer(host: BookingHandoffHost | null, context: BookingPageContext,
  publish: (state: BookingHandoffState) => void, clock: () => number = Date.now) {
  // Capture serializable identity separately from the private request-bound function.
  host = host ? { ...host, capability: { ...host.capability } } : null;
  context = { ...context };
  let generation = 0, destroyed = false, pending = false;
  let state: BookingHandoffState = { status: 'disabled', handoff: null };
  const emit = (next: BookingHandoffState) => { state = next; if (!destroyed) publish(next); };
  const enabled = () => Boolean(host?.enabled === true && typeof host.readBookingHandoff === 'function'
    && context.authenticated && context.tenantCode === host.capability?.tenantCode
    && context.workspaceCode === host.capability?.workspaceCode && context.customerId === host.capability?.customerId
    && host.capability?.releaseRevision && host.capability?.tenantId && host.capability?.workspaceId && host.handoffRef && (host.isCurrent?.() ?? true));
  const validate = (value: AiBookingHandoff): AiBookingHandoff => {
    const ref = (input: unknown) => typeof input === 'string' && input.length > 0 && input.length <= 512;
    if (!host || !value || JSON.stringify(value).length > 32768 || value.contractVersion !== 'ain-booking-draft-1'
      || !ref(value.handoffRef) || !ref(value.bookingDraftId) || typeof value.expiresAt !== 'string'
      || value.handoffRef !== host?.handoffRef || value.surface !== 'tenant_website' || value.audience !== 'customer'
      || value.scope?.kind !== 'workspace' || value.scope.tenantId !== host.capability.tenantId
      || value.scope.workspaceId !== host.capability.workspaceId || !Number.isSafeInteger(value.revision) || value.revision < 1
      || value.actionCode !== 'OPEN_BOOKING' || value.submission !== 'original_booking_page_required' || value.inventory !== 'not_reserved'
      || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= clock()) throw Error('unavailable');
    const fields = value.fields;
    // This page only implements one personal item and same-location pickup or delivery.
    if (!fields || fields.lines?.length !== 1 || fields.lines[0].itemGroupId !== context.productId
      || !Number.isInteger(fields.lines[0].quantity) || fields.lines[0].quantity < 1 || fields.lines[0].quantity > 10
      || fields.bookingIdentity?.bookingIdentity !== 'personal' || fields.bookingIdentity.enterpriseContractAndPayer
      || fields.bookingIdentity.corporateCustomerId || fields.services?.length
      || !['store_pickup_return', 'delivery'].includes(fields.fulfillmentMode)
      || (fields.returnLocationId && fields.returnLocationId !== fields.fulfillmentLocationId)
      || !fields.fulfillmentLocationId || (fields.fulfillmentMode === 'delivery' && !fields.deliveryAddressId)
      || !ref(fields.quoteId) || !ref(fields.fulfillmentLocationId) || !ref(fields.timeZone)
      || (fields.returnLocationId !== undefined && !ref(fields.returnLocationId))
      || (fields.deliveryAddressId !== undefined && !ref(fields.deliveryAddressId))
      || typeof fields.startAt !== 'string' || typeof fields.endAt !== 'string'
      || !Number.isFinite(Date.parse(fields.startAt)) || !Number.isFinite(Date.parse(fields.endAt))
      || Date.parse(fields.startAt) <= clock() || Date.parse(fields.endAt) <= Date.parse(fields.startAt)) throw Error('unavailable');
    new Intl.DateTimeFormat('en', { timeZone: fields.timeZone }).format(new Date(fields.startAt));
    // Whitelist: do not forward arbitrary extra fields or URLs to the page.
    return { contractVersion: value.contractVersion, handoffRef: value.handoffRef, bookingDraftId: value.bookingDraftId,
      revision: value.revision, audience: value.audience, surface: value.surface,
      scope: { kind: 'workspace', tenantId: value.scope.tenantId, workspaceId: value.scope.workspaceId }, expiresAt: value.expiresAt,
      actionCode: value.actionCode, submission: value.submission, inventory: value.inventory,
      fields: { quoteId: fields.quoteId, timeZone: fields.timeZone, startAt: fields.startAt, endAt: fields.endAt,
        fulfillmentMode: fields.fulfillmentMode, fulfillmentLocationId: fields.fulfillmentLocationId,
        ...(fields.returnLocationId ? { returnLocationId: fields.returnLocationId } : {}),
        ...(fields.deliveryAddressId ? { deliveryAddressId: fields.deliveryAddressId } : {}),
        bookingIdentity: { bookingIdentity: 'personal', enterpriseContractAndPayer: false },
        lines: [{ itemGroupId: fields.lines[0].itemGroupId, quantity: fields.lines[0].quantity }] } };
  };
  const read = async (continuing: boolean) => {
    if (destroyed || pending) return null;
    if (!enabled()) { emit({ status: 'disabled', handoff: null }); return null; }
    const before = state.handoff, epoch = ++generation; pending = true;
    emit({ status: 'loading', handoff: null });
    try {
      const result = validate(structuredClone(await host!.readBookingHandoff({ handoffRef: host!.handoffRef })));
      if (destroyed || epoch !== generation || !(host?.isCurrent?.() ?? true)) return null;
      if (continuing && (!before || JSON.stringify(before) !== JSON.stringify(result))) throw Error('changed');
      emit({ status: continuing ? 'continued' : 'available', handoff: result });
      return result;
    } catch { if (!destroyed && epoch === generation) emit({ status: 'unavailable', handoff: null }); return null; }
    finally { if (epoch === generation) pending = false; }
  };
  return { read: () => read(false), continue: () => read(true),
    mount() { generation++; destroyed = false; pending = false; state = { status: 'disabled', handoff: null }; },
    invalidate() { generation++; pending = false; host?.dispose?.(); emit({ status: 'unavailable', handoff: null }); },
    destroy() { generation++; destroyed = true; pending = false; host?.dispose?.(); state = { status: 'disabled', handoff: null }; } };
}

export function handoffLocalInput(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const part = (name: string) => parts.find(p => p.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
