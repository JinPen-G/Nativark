/** Native public browse continuation. Lifecycle callbacks restore local locator
 * presence only; original reads and continuation require explicit user intents.
 * Hidden/context-changed hosts withdraw views without deleting original keys. */
import { createAiClientPublicContinuitySession } from '../../../vendor/shared-ai-client';
import type { AiClientPublicContinuityView } from '@rental-os/shared';
import { clientPublicApi } from '../../../api/ai-public';
import { PUBLIC_CONFIG } from '../../../config/public';
import { serverNow } from '../../../core/clock';
import { newKey } from '../../../core/keys';
import { contextVersion, currentSession, sessionEvents } from '../../../core/session';
import { writeRequiredStorage } from '../../../core/storage';
import { ROUTES, buildUrl, navigate } from '../../../core/ui';

type Session = ReturnType<typeof createAiClientPublicContinuitySession>;
const empty: AiClientPublicContinuityView = { status: 'idle', expiresAt: null, canPrepare: false, canContinue: false,
  canRead: false, loginRequired: false };
const owners = new WeakMap<object, Session>(), epochs = new WeakMap<object, number>(), releases = new WeakMap<object, () => void>();
const visible = new WeakSet<object>(), busy = new WeakSet<object>();
const failedWrites = new WeakMap<object, { key: string; reference: string | undefined; previous: string | undefined }>();
const read = (key: string): unknown => {
  const value: unknown = wx.getStorageSync(key);
  return value === '' || value === undefined || value === null ? undefined : value;
};
/** Non-authoritative local equality only. The original server ClientAuth still
 * verifies this token and session; this extracts no permission or shared login. */
function clientSessionMarker(token: string): string | null {
  try {
    const encoded = token.split('.')[1]; if (!encoded || encoded.length > 4096) return null;
    const base64 = encoded.replace(/-/gu, '+').replace(/_/gu, '/'), padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const value = JSON.parse(String.fromCharCode(...new Uint8Array(wx.base64ToArrayBuffer(padded)))) as { typ?: unknown; sid?: unknown };
    return value.typ === 'client' && typeof value.sid === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value.sid) ? value.sid : null;
  } catch { return null; }
}
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { serviceCode: { type: String, value: '' }, kind: { type: String, value: 'catalog' } },
  data: { ...empty, working: false },
  lifetimes: {
    attached() { visible.add(this); releases.set(this, sessionEvents.on(() => { if (!visible.has(this)) return; this.invalidate(); this.restoreLocal(); })); this.invalidate(); this.restoreLocal(); },
    detached() { visible.delete(this); this.invalidate(); releases.get(this)?.(); releases.delete(this); },
  },
  pageLifetimes: { show() { visible.add(this); this.invalidate(); this.restoreLocal(); }, hide() { visible.delete(this); this.invalidate(); } },
  observers: { 'serviceCode, kind'() { this.invalidate(); this.restoreLocal(); } },
  methods: {
    invalidate() {
      epochs.set(this, (epochs.get(this) ?? 0) + 1); busy.delete(this); owners.get(this)?.dispose(); owners.delete(this);
      this.setData({ ...empty, working: false });
    },
    restoreLocal() {
      if (!visible.has(this) || !this.data.serviceCode || !['catalog', 'help'].includes(this.data.kind)) return;
      try {
        const key = `rental-os:public-ai:${PUBLIC_CONFIG.tenantCode}:${this.data.serviceCode}:${this.data.kind}`;
        const present = read(key) !== undefined || failedWrites.get(this)?.key === key;
        this.setData({ ...empty, status: present ? 'unknown' : 'idle', canRead: present, canPrepare: !present });
      } catch { this.setData({ ...empty, status: 'unavailable', canRead: true }); }
    },
    async ensure(): Promise<{ session: Session; opened: boolean } | null> {
      if (!visible.has(this) || !this.data.serviceCode || !['catalog', 'help'].includes(this.data.kind)) return null;
      const existing = owners.get(this); if (existing) return { session: existing, opened: false };
      const epoch = epochs.get(this), version = contextVersion(), serviceCode = this.data.serviceCode, kind = this.data.kind as 'catalog' | 'help';
      const current = () => visible.has(this) && epochs.get(this) === epoch && contextVersion() === version
        && this.data.serviceCode === serviceCode && this.data.kind === kind;
      const key = `rental-os:public-ai:${PUBLIC_CONFIG.tenantCode}:${serviceCode}:${kind}`;
      let held = JSON.stringify(read(key));
      const original = () => {
        const value = read(key);
        if (!current() || JSON.stringify(value) !== held) throw Error('public_original_reference_changed');
        return value;
      };
      const owner = createAiClientPublicContinuitySession({ target: { tenantCode: PUBLIC_CONFIG.tenantCode, serviceCode },
        channel: 'wechat_miniprogram', kind, current, api: clientPublicApi, now: serverNow, newKey: () => newKey('public-browse'),
        client: () => {
          const value = currentSession(); if (!value?.accessToken || value.serviceCode !== serviceCode) return null;
          const marker = clientSessionMarker(value.accessToken); if (!marker) return null;
          const customerId = value.customer.customerId;
          return { ownerKey: JSON.stringify([PUBLIC_CONFIG.tenantCode, serviceCode, customerId, marker]),
            current: () => current() && currentSession() === value && value.customer.customerId === customerId };
        }, storage: { read: original, write: value => {
          const previous = held;
          try { original(); held = JSON.stringify(value); writeRequiredStorage(key, value); }
          catch (error) { failedWrites.set(this, { key, reference: held, previous }); throw error; }
        } },
        changed: value => { if (current()) this.setData(failedWrites.get(this)?.key === key
          ? { ...value, canPrepare: false, canContinue: false, canRead: true } : { ...value }); } });
      owners.set(this, owner); await owner.open(); return current() ? { session: owner, opened: true } : null;
    },
    async run(action: 'prepare' | 'refresh' | 'continueOriginal') {
      if (busy.has(this) || !visible.has(this)) return;
      const key = `rental-os:public-ai:${PUBLIC_CONFIG.tenantCode}:${this.data.serviceCode}:${this.data.kind}`;
      if (failedWrites.get(this)?.key === key && action !== 'refresh') return;
      const available = owners.get(this)?.snapshot() ?? this.data;
      if (action === 'prepare' && !available.canPrepare || action === 'continueOriginal' && !available.canContinue) return;
      const epoch = epochs.get(this); busy.add(this); this.setData({ working: true });
      try {
        if (failedWrites.get(this)?.key === key) {
          const retained = read(key), fingerprint = JSON.stringify(retained), failed = failedWrites.get(this)!;
          // Keep the original pending journal readable after a failed response
          // write, without accepting a different page's replacement locator.
          if (retained === undefined || fingerprint !== failed.reference && fingerprint !== failed.previous) {
            throw Error('public_original_reference_not_retained');
          }
          owners.get(this)?.dispose(); owners.delete(this); failedWrites.delete(this);
        }
        const opened = await this.ensure();
        if (!opened || epochs.get(this) !== epoch || !visible.has(this)) return;
        if (action !== 'refresh' || !opened.opened) await opened.session[action]();
      }
      catch { if (epochs.get(this) === epoch) this.setData({ ...empty, canRead: true, status: 'unavailable' }); }
      finally { if (epochs.get(this) === epoch) { busy.delete(this); this.setData({ working: false }); } }
    },
    onPrepare() { return this.run('prepare'); },
    onRead() { return this.run('refresh'); },
    onContinue() { return this.run('continueOriginal'); },
    onLogin() { navigate(buildUrl(ROUTES.login, { redirect: this.data.kind === 'help' ? buildUrl(ROUTES.legal, { doc: 'help' }) : ROUTES.catalog })); },
  },
});
