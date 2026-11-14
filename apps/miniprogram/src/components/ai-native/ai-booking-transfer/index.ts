/** Explicit transfer controls for the original Booking host. Component mounting
 * restores only local metadata; no request, consume or navigation runs in a
 * lifecycle callback. The parent receives only a rechecked original handoffRef. */
import { PUBLIC_CONFIG } from '../../../config/public';
import { currentSession, contextVersion, sessionEvents } from '../../../core/session';
import { serverNow } from '../../../core/clock';
import { writeRequiredStorage } from '../../../core/storage';
import { newKey } from '../../../core/keys';
import { createClientBookingTransferApi } from '../../../api/ai-booking-transfers';
import { clientBookingTransferStorageKey, createClientBookingTransferStorage, createClientBookingTransferSession,
  type ClientBookingTransferView } from '../client-booking-transfer-session';

type Session = ReturnType<typeof createClientBookingTransferSession>;
type Hold = Pick<ClientBookingTransferView, 'hasLocator' | 'attempted'>;
const owners = new WeakMap<object, Session>(), releases = new WeakMap<object, () => void>(),
  epochs = new WeakMap<object, number>(), currents = new WeakMap<object, () => boolean>();
const shown = new WeakSet<object>();
const holds = new WeakMap<object, Hold & { key: string }>(), reports = new WeakMap<object, (view: Hold) => void>();
const selected = new WeakMap<object, { key: string; ref: string }>();
const read = (key: string): unknown => { const value: unknown = wx.getStorageSync(key); return value === '' || value === null || value === undefined ? undefined : value; };
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { enabled: { type: Boolean, value: false }, paused: { type: Boolean, value: false },
    kind: { type: String, value: 'consume' }, handoffRef: { type: String, value: '' }, scopeKey: { type: String, value: '' } },
  data: { view: null as ClientBookingTransferView | null, reference: '', working: false, error: false, loggedIn: false },
  lifetimes: { attached() { shown.add(this); epochs.set(this, 1); this.openLocal(); }, detached() { shown.delete(this); this.closeLocal(); } },
  pageLifetimes: { show() { shown.add(this); this.openLocal(); }, hide() { shown.delete(this); this.closeLocal(); } },
  observers: { 'enabled, paused, kind, handoffRef, scopeKey'() { this.closeLocal(); if (shown.has(this)) this.openLocal(); } },
  methods: {
    closeLocal() {
      const owner = owners.get(this); if (owner) reports.get(this)?.(owner.snapshot());
      epochs.set(this, (epochs.get(this) ?? 0) + 1); owners.get(this)?.dispose(); owners.delete(this); currents.delete(this);
      reports.delete(this);
      releases.get(this)?.(); releases.delete(this);
      this.setData({ view: null, reference: '', working: false, error: false, loggedIn: false });
    },
    openLocal() {
      if (!this.data.enabled || this.data.paused || !shown.has(this) || owners.has(this)) return;
      const captured = currentSession(); if (!captured?.accessToken || captured.customer.customerType !== 'personal') return;
      if (this.data.kind !== 'issue' && this.data.kind !== 'consume') { this.setData({ error: true }); return; }
      const kind = this.data.kind as 'issue' | 'consume', generation = epochs.get(this), version = contextVersion(),
        scope = this.data.scopeKey, ref = this.data.handoffRef, tenantCode = PUBLIC_CONFIG.tenantCode;
      const current = () => shown.has(this) && this.data.enabled && !this.data.paused && epochs.get(this) === generation
        && contextVersion() === version && currentSession() === captured && captured.customer.customerType === 'personal'
        && this.data.kind === kind && this.data.scopeKey === scope && this.data.handoffRef === ref && PUBLIC_CONFIG.tenantCode === tenantCode;
      const context = { tenantCode, serviceCode: captured.serviceCode, customerId: captured.customer.customerId, surface: 'client_miniprogram' as const, current };
      try {
        const key = clientBookingTransferStorageKey(context, kind, kind === 'issue' ? ref : undefined);
        const localKey = JSON.stringify([key, scope, kind, ref]), previousRef = selected.get(this);
        const storage = createClientBookingTransferStorage({ context, kind, handoffRef: kind === 'issue' ? ref : undefined,
          initialRef: previousRef?.key === localKey ? previousRef.ref : undefined,
          read, write: (entry, value) => writeRequiredStorage(entry, value) });
        const report = (view: Hold) => {
          const holdKey = JSON.stringify([storage.key(), scope, kind, ref]), before = holds.get(this);
          const retained = before?.key === holdKey ? before : { key: holdKey, hasLocator: false, attempted: false };
          holds.set(this, retained);
          const transferRef = storage.reference(); if (transferRef) selected.set(this, { key: localKey, ref: transferRef });
          retained.hasLocator ||= view.hasLocator; retained.attempted ||= view.attempted;
          const identity = currentSession();
          // Native events use the parent's current binding. Once that binding
          // changes, cleanup cannot report an old owner's hold to the new one.
          if (this.data.scopeKey === scope && this.data.kind === kind && this.data.handoffRef === ref
            && PUBLIC_CONFIG.tenantCode === tenantCode && identity?.customer.customerType === 'personal'
            && identity.customer.customerId === captured.customer.customerId && identity.serviceCode === captured.serviceCode) {
            this.triggerEvent('hold', { hasLocator: retained.hasLocator, attempted: retained.attempted });
          }
        };
        reports.set(this, report);
        const session = createClientBookingTransferSession({ context, kind, handoffRef: kind === 'issue' ? ref : undefined,
          api: createClientBookingTransferApi(context), now: serverNow,
          newKey: () => newKey('booking-transfer'),
          storage,
          changed: view => { if (current()) { report(view); this.setData({ view, working: view.status === 'checking' }); } } });
        owners.set(this, session); currents.set(this, current); this.setData({ loggedIn: true, error: false }); session.open();
        releases.set(this, sessionEvents.on(() => this.closeLocal()));
      } catch { this.setData({ error: true }); }
    },
    async runIntent(run: (session: Session) => Promise<unknown> | void) {
      const owner = owners.get(this), generation = epochs.get(this);
      if (!owner || !currents.get(this)?.() || this.data.working) return;
      this.setData({ error: false });
      try { await run(owner); } catch { if (generation === epochs.get(this)) this.setData({ error: true }); }
    },
    onReference(event: WechatMiniprogram.CustomEvent<{ value: string }>) { if (this.data.view?.canRetain) this.setData({ reference: event.detail.value }); },
    onRetain() { return this.runIntent(session => { session.retain(this.data.reference); if (session.snapshot().hasLocator) this.setData({ reference: '' }); }); },
    onIssue() { return this.runIntent(session => session.issue()); },
    onConsume() { return this.runIntent(session => session.consume()); },
    onRead() { return this.runIntent(session => session.read()); },
    onReceipt() { return this.runIntent(async session => {
      const result = await session.readReceiptHandoff();
      if (result && owners.get(this) === session && currents.get(this)?.()) this.triggerEvent('receipt', { handoffRef: result.handoffRef });
    }); },
    onContinue() { return this.runIntent(async session => {
      const result = await session.continueHandoff();
      if (result && owners.get(this) === session && currents.get(this)?.()) this.triggerEvent('handoff', { handoffRef: result.handoffRef });
    }); }
  }
});
