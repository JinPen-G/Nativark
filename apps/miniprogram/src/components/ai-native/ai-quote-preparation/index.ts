/** Two bounded human intents: generate a reservation draft, then confirm and
 * continue on the original page. Original-result reads never advance either
 * intent or restore cached Actions. Instance bindings are never serialized. */
import type { AiBookingSelection, ClientCreateQuoteRequest } from '@rental-os/shared';
import { clientQuoteApi } from '../../../api/ai-quotes';
import { readBookingHostCapabilities, readBookingHandoff } from '../../../api/orders';
import { PUBLIC_CONFIG } from '../../../config/public';
import { serverNow } from '../../../core/clock';
import { newKey } from '../../../core/keys';
import { contextVersion, currentSession, sessionEvents } from '../../../core/session';
import { writeRequiredStorage } from '../../../core/storage';
import { createClientQuoteSession, createClientQuoteBookingSession, clientQuoteStorageKey, clientQuoteBookingStoredRequest,
  type ClientQuoteContext, type ClientQuoteView, type ClientQuoteBookingView } from '../client-quote-session';

type Quote = ReturnType<typeof createClientQuoteSession>;
type Booking = ReturnType<typeof createClientQuoteBookingSession>;
const quotes = new WeakMap<object, Quote>(), bookings = new WeakMap<object, Booking>(), generations = new WeakMap<object, number>();
const bindings = new WeakMap<object, { key: string; context: ClientQuoteContext }>(), releases = new WeakMap<object, () => void>();
const visible = new WeakSet<object>(), busy = new WeakSet<object>();
const initial: ClientQuoteView = { status: 'closed', canPrepare: false, canConfirm: false, canRead: false,
  pendingCore: false, matchesInput: true, material: null, quote: null };
const read = (key: string): unknown => { const value: unknown = wx.getStorageSync(key); return value === '' || value === null || value === undefined ? undefined : value; };
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { selection: { type: Object, value: null }, scopeKey: { type: String, value: '' }, timeZone: { type: String, value: '' }, paused: { type: Boolean, value: false } },
  data: { ...initial, working: false, error: false, booking: null as ClientQuoteBookingView | null },
  lifetimes: { attached() { visible.add(this); generations.set(this, 1); }, detached() { visible.delete(this); this.invalidateQuote(); } },
  pageLifetimes: { show() { visible.add(this); }, hide() { visible.delete(this); this.invalidateQuote(); } },
  observers: { 'scopeKey, paused'() { this.invalidateQuote(); } },
  methods: {
    invalidateQuote() {
      generations.set(this, (generations.get(this) ?? 0) + 1); busy.delete(this);
      quotes.get(this)?.dispose(); bookings.get(this)?.dispose(); quotes.delete(this); bookings.delete(this); bindings.delete(this);
      releases.get(this)?.(); releases.delete(this); this.setData({ ...initial, working: false, error: false, booking: null });
    },
    async ensureQuote(): Promise<Quote | null> {
      if (!visible.has(this) || this.data.paused) return null;
      if (bindings.get(this)?.context.current()) return quotes.get(this) ?? null;
      const session = currentSession(), version = contextVersion(), epoch = generations.get(this), scopeKey = this.data.scopeKey;
      if (!session?.accessToken || session.customer.customerType !== 'personal') throw Error('quote_session_unavailable');
      const context: ClientQuoteContext = { tenantCode: PUBLIC_CONFIG.tenantCode, serviceCode: session.serviceCode, customerId: session.customer.customerId,
        surface: 'client_miniprogram', current: () => visible.has(this) && !this.data.paused && this.data.scopeKey === scopeKey
          && epoch === generations.get(this) && contextVersion() === version && currentSession() === session };
      const key = clientQuoteStorageKey(context);
      this.triggerEvent('mode', { active: true, hasLocator: read(key) !== undefined, pendingCore: false });
      const instance = createClientQuoteSession({ context, api: clientQuoteApi, now: serverNow, newKey: () => newKey('client-quote'),
        readHost: readBookingHostCapabilities, selection: () => { if (!this.data.selection) throw Error('quote_selection_unavailable'); return this.data.selection as ClientCreateQuoteRequest; },
        storage: { read: () => read(key), write: value => writeRequiredStorage(key, value) },
        changed: state => { if (context.current()) { this.setData({ ...state }); this.triggerEvent('mode', { active: true, hasLocator: read(key) !== undefined, pendingCore: state.pendingCore }); } } });
      quotes.set(this, instance); bindings.set(this, { key, context }); releases.set(this, sessionEvents.on(() => this.invalidateQuote()));
      await instance.open(); return context.current() ? instance : null;
    },
    async ensureBooking(purpose: 'read' | 'write'): Promise<Booking | null> {
      const quote = quotes.get(this)?.snapshot(), selected = quotes.get(this)?.originalInput(), binding = bindings.get(this);
      if (!quote?.quote || !quote.material || !selected || !binding?.context.current()) return null;
      const key = `${binding.key}:booking`, cached = read(key);
      if (purpose === 'read' && cached === undefined) return null;
      let selection: AiBookingSelection;
      if (purpose === 'read') selection = clientQuoteBookingStoredRequest(cached).selection;
      else {
        if (!this.data.timeZone || !quote.matchesInput) return null;
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
        changed: state => { if (binding.context.current()) this.setData({ booking: state }); } });
      bookings.set(this, instance); await instance.open(); if (cached !== undefined) await instance.recover(); return instance;
    },
    async runIntent(action: () => Promise<void>) {
      if (busy.has(this) || !visible.has(this) || this.data.paused) return;
      const epoch = generations.get(this); busy.add(this); this.setData({ working: true, error: false });
      try { await action(); } catch { if (epoch === generations.get(this) && visible.has(this)) this.setData({ error: true }); }
      finally { if (epoch === generations.get(this)) { busy.delete(this); this.setData({ working: false }); } }
    },
    onGenerate() { return this.runIntent(async () => {
      const quote = await this.ensureQuote(); if (!quote) return;
      if (quote.originalInput()) await quote.recover(); else await quote.prepare();
      if (quote.snapshot().canConfirm) await quote.confirm();
      const state = quote.snapshot(); if (state.status !== 'quoted' || !state.matchesInput || state.readOnly) return;
      await (await this.ensureBooking('write'))?.generateDraft();
    }); },
    onRead() { return this.runIntent(async () => {
      const quote = await this.ensureQuote(); if (!quote) return;
      if (quote.snapshot().canRead) await quote.recover(); await this.ensureBooking('read');
    }); },
    onContinue() { return this.runIntent(async () => {
      if (!quotes.get(this)?.snapshot().matchesInput || !bindings.get(this)?.context.current()) return;
      const result = await bookings.get(this)?.continueBooking();
      if (result?.status === 'handoff_ready' && result.handoff && !result.readOnly && bindings.get(this)?.context.current())
        this.triggerEvent('handoff', { handoffRef: result.handoff.handoffRef });
    }); },
    onOrdinary() {
      const binding = bindings.get(this); if (!binding?.context.current() || read(binding.key) !== undefined || busy.has(this)) return;
      this.invalidateQuote(); this.triggerEvent('mode', { active: false, hasLocator: false, pendingCore: false });
    },
  },
});
