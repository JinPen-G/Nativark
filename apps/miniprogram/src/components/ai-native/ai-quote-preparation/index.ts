/** Prepare parameters, explicitly confirm their units, then choose the original
 * draft. Receipt reads never advance these intents or restore cached Actions.
 * Instance bindings are never serialized; ordinary mode preserves the journal. */
import type { AiBookingSelection, ClientCreateQuoteRequest } from '@rental-os/shared';
import { clientQuoteApi } from '../../../api/ai-quotes';
import { readBookingHostCapabilities, readBookingHandoff } from '../../../api/orders';
import { PUBLIC_CONFIG } from '../../../config/public';
import { serverNow } from '../../../core/clock';
import { newKey } from '../../../core/keys';
import { contextVersion, currentSession, sessionEvents } from '../../../core/session';
import { writeRequiredStorage } from '../../../core/storage';
import { formatBusinessDateTime, zoneSupported } from '../../../core/time';
import { createClientQuoteSession, createClientQuoteBookingSession, clientQuoteStorageKey,
  type ClientQuoteContext, type ClientQuoteView, type ClientQuoteBookingView } from '../client-quote-session';
import { projectBookingDraftReview, projectQuoteParameterReview, type BookingDraftReview } from '../booking-draft-review';
import { projectClientOriginalQuoteFacts } from '../client-original-quote-facts';

type Quote = ReturnType<typeof createClientQuoteSession>;
type Booking = ReturnType<typeof createClientQuoteBookingSession>;
const quotes = new WeakMap<object, Quote>(), bookings = new WeakMap<object, Booking>(), generations = new WeakMap<object, number>();
const bindings = new WeakMap<object, { key: string; context: ClientQuoteContext }>(), releases = new WeakMap<object, () => void>();
const visible = new WeakSet<object>(), busy = new WeakSet<object>(), activeIntents = new WeakSet<object>();
const ordinaryReferences = new WeakMap<object, string>();
const initial: ClientQuoteView = { status: 'closed', canPrepare: false, canConfirm: false, canRead: false,
  pendingCore: false, matchesInput: true, material: null, quote: null };
const read = (key: string): unknown => { const value: unknown = wx.getStorageSync(key); return value === '' || value === null || value === undefined ? undefined : value; };
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { selection: { type: Object, value: null }, scopeKey: { type: String, value: '' }, timeZone: { type: String, value: '' }, paused: { type: Boolean, value: false } },
  data: { ...initial, working: false, error: false, booking: null as ClientQuoteBookingView | null,
    bookingReview: null as BookingDraftReview | null, parameterReview: null as ReturnType<typeof projectQuoteParameterReview>, canOrdinary: false,
    bookingSubmitted: false, bookingNotSubmitted: false, originalQuote: null as ReturnType<typeof projectClientOriginalQuoteFacts> },
  lifetimes: { attached() { visible.add(this); generations.set(this, 1); }, detached() { visible.delete(this); this.invalidateQuote(); } },
  pageLifetimes: { show() { visible.add(this); }, hide() { visible.delete(this); this.invalidateQuote(); } },
  observers: { 'scopeKey, paused'() { this.invalidateQuote(); } },
  methods: {
    invalidateQuote() {
      generations.set(this, (generations.get(this) ?? 0) + 1); busy.delete(this); activeIntents.delete(this); ordinaryReferences.delete(this);
      quotes.get(this)?.dispose(); bookings.get(this)?.dispose(); quotes.delete(this); bookings.delete(this); bindings.delete(this);
      releases.get(this)?.(); releases.delete(this);
      this.setData({ ...initial, working: false, error: false, booking: null, bookingReview: null, parameterReview: null, canOrdinary: false,
        bookingSubmitted: false, bookingNotSubmitted: false, originalQuote: null });
    },
    reportMode(nextQuote?: ClientQuoteView, nextBooking?: ClientQuoteBookingView | null) {
      const binding = bindings.get(this); if (!binding?.context.current()) return;
      const quote = nextQuote ?? quotes.get(this)?.snapshot(), booking = nextBooking ?? bookings.get(this)?.snapshot();
      const retained = read(binding.key), retainedBooking = read(`${binding.key}:booking`);
      let pending = quote?.pendingCore === true;
      if (retained !== undefined) {
        const phase = retained && typeof retained === 'object' && 'phase' in retained ? retained.phase : undefined;
        pending ||= phase === 'quote_observed' ? quote?.status !== 'quoted' || !quote.quote
          : phase !== 'prepared' || quote?.status !== 'prepared';
      }
      if (retainedBooking !== undefined) pending ||= !booking?.observed || booking.pendingCore !== false;
      if (!pending) ordinaryReferences.set(this, JSON.stringify([binding.key, retained, retainedBooking]));
      else ordinaryReferences.delete(this);
      this.setData({ canOrdinary: !pending });
      this.triggerEvent('mode', { active: activeIntents.has(this), hasLocator: retained !== undefined, pendingCore: pending });
    },
    async ensureQuote(purpose: 'read' | 'write'): Promise<Quote | null> {
      if (!visible.has(this) || this.data.paused) return null;
      if (purpose === 'write' && (!this.data.timeZone || !zoneSupported(this.data.timeZone))) throw Error('quote_time_zone_unavailable');
      if (purpose === 'write') activeIntents.add(this);
      if (bindings.get(this)?.context.current()) { this.reportMode(); return quotes.get(this) ?? null; }
      const session = currentSession(), version = contextVersion(), epoch = generations.get(this), scopeKey = this.data.scopeKey;
      if (!session?.accessToken || session.customer.customerType !== 'personal') throw Error('quote_session_unavailable');
      const context: ClientQuoteContext = { tenantCode: PUBLIC_CONFIG.tenantCode, serviceCode: session.serviceCode, customerId: session.customer.customerId,
        surface: 'client_miniprogram', current: () => visible.has(this) && !this.data.paused && this.data.scopeKey === scopeKey
          && epoch === generations.get(this) && contextVersion() === version && currentSession() === session };
      const key = clientQuoteStorageKey(context);
      bindings.set(this, { key, context }); this.reportMode();
      const instance = createClientQuoteSession({ context, api: clientQuoteApi, now: serverNow, newKey: () => newKey('client-quote'),
        readHost: readBookingHostCapabilities, selection: () => { if (!this.data.selection) throw Error('quote_selection_unavailable'); return this.data.selection as ClientCreateQuoteRequest; },
        storage: { read: () => read(key), write: value => writeRequiredStorage(key, value) },
        changed: state => { if (context.current()) { this.setData({ ...state,
          originalQuote: projectClientOriginalQuoteFacts(state.quote, state.quoteObservedAt),
          parameterReview: state.status === 'prepared' ? projectQuoteParameterReview(state.material?.parameterReview ?? null) : null });
          this.reportMode(state); } } });
      quotes.set(this, instance); bindings.set(this, { key, context }); releases.set(this, sessionEvents.on(() => this.invalidateQuote()));
      await instance.open(); return context.current() ? instance : null;
    },
    async ensureBooking(purpose: 'read' | 'write'): Promise<Booking | null> {
      const quote = quotes.get(this)?.snapshot(), selected = quotes.get(this)?.originalInput(), binding = bindings.get(this);
      if (!quote?.quote || !quote.material || !binding?.context.current()) return null;
      const key = `${binding.key}:booking`, cached = read(key);
      if (purpose === 'read' && cached === undefined) return null;
      let selection: AiBookingSelection | null = null;
      if (purpose === 'write') {
        if (!selected || !this.data.timeZone || !zoneSupported(this.data.timeZone) || !quote.matchesInput) return null;
        selection = { quoteId: quote.quote.quoteId, timeZone: this.data.timeZone, startAt: selected.startAt, endAt: selected.endAt,
          fulfillmentMode: selected.fulfillmentMode, fulfillmentLocationId: selected.fulfillmentLocationId,
          ...(selected.returnLocationId ? { returnLocationId: selected.returnLocationId } : {}), ...(selected.deliveryAddressId ? { deliveryAddressId: selected.deliveryAddressId } : {}),
          bookingIdentity: { bookingIdentity: 'personal', enterpriseContractAndPayer: false },
          lines: selected.lines.map(line => { if (!line.itemGroupId) throw Error('booking_item_unavailable'); return { itemGroupId: line.itemGroupId, quantity: line.quantity }; }),
          ...(selected.services ? { services: selected.services } : {}) };
      }
      bookings.get(this)?.dispose();
      const instance = createClientQuoteBookingSession({ context: binding.context,
        original: { materialRef: quote.material.materialRef, expectedMaterialHash: quote.material.materialHash }, selection: () => selection,
        api: { ...clientQuoteApi, readHandoff: readBookingHandoff }, readHost: readBookingHostCapabilities, now: serverNow, newKey: () => newKey('booking'),
        storage: { read: () => read(key), write: value => writeRequiredStorage(key, value) },
        changed: state => {
          if (binding.context.current()) this.setData({ booking: state,
            // The original Draft attests a page request, never Core order/payment.
            bookingSubmitted: state.draft?.state === 'submitted' && state.draft.execution === 'submitted_request_not_business_success',
            bookingNotSubmitted: state.observed === true && !['unknown', 'checking'].includes(state.status)
              && state.draft?.execution === 'not_submitted'
              && ['draft_created', 'user_selected', 'handed_to_booking_page'].includes(state.draft.state),
            bookingReview: projectBookingDraftReview(state.draft, { formatTime: (original, timeZone) => {
              if (!zoneSupported(timeZone)) throw Error('booking_time_zone_unavailable');
              return formatBusinessDateTime(original, timeZone);
            } }) });
          if (binding.context.current()) this.reportMode(undefined, state);
        } });
      bookings.set(this, instance); await instance.open(); if (cached !== undefined) await instance.recover(); return instance;
    },
    async runIntent(action: () => Promise<void>) {
      if (busy.has(this) || !visible.has(this) || this.data.paused) return;
      const epoch = generations.get(this); busy.add(this); this.setData({ working: true, error: false });
      try { await action(); } catch { if (epoch === generations.get(this) && visible.has(this)) this.setData({ error: true }); }
      finally { if (epoch === generations.get(this)) { busy.delete(this); this.setData({ working: false }); } }
    },
    onGenerate() { return this.runIntent(async () => {
      const quote = await this.ensureQuote('write'); if (!quote) return;
      if (quote.snapshot().canRead) await quote.recover(); else await quote.prepare();
      const state = quote.snapshot(); if (state.status !== 'quoted' || !state.matchesInput || state.readOnly) return;
      await (await this.ensureBooking('write'))?.generateDraft();
    }); },
    onConfirmParameters() { return this.runIntent(async () => {
      const quote = quotes.get(this); if (!quote?.snapshot().canConfirm || !bindings.get(this)?.context.current()) return;
      if (!this.data.timeZone || !zoneSupported(this.data.timeZone)) throw Error('quote_time_zone_unavailable');
      activeIntents.add(this); this.reportMode();
      await quote.confirm();
      const state = quote.snapshot(); if (state.status !== 'quoted' || !state.matchesInput || state.readOnly) return;
      await (await this.ensureBooking('write'))?.generateDraft();
    }); },
    onRead() { return this.runIntent(async () => {
      const quote = await this.ensureQuote('read'); if (!quote) return;
      if (quote.snapshot().canRead) await quote.recover(); await this.ensureBooking('read');
    }); },
    onContinue() { return this.runIntent(async () => {
      if (!quotes.get(this)?.snapshot().matchesInput || !bindings.get(this)?.context.current()) return;
      const result = await bookings.get(this)?.continueBooking();
      if (result?.status === 'handoff_ready' && result.handoff && !result.readOnly && bindings.get(this)?.context.current())
        this.triggerEvent('handoff', { handoffRef: result.handoff.handoffRef });
    }); },
    onOrdinary() {
      const binding = bindings.get(this); if (!binding?.context.current() || !this.data.canOrdinary || busy.has(this)) return;
      if (ordinaryReferences.get(this) !== JSON.stringify([binding.key, read(binding.key), read(`${binding.key}:booking`)])) {
        ordinaryReferences.delete(this); this.setData({ canOrdinary: false }); return;
      }
      const retained = read(binding.key) !== undefined;
      this.invalidateQuote(); this.triggerEvent('mode', { active: false, hasLocator: retained, pendingCore: false });
    },
  },
});
