/** Native public browse continuation; opaque original locators are stored
 * before dispatch. Hidden/detached/context-changed hosts withdraw all callbacks;
 * login never consumes a public reference automatically. */
import { createAiClientPublicContinuitySession } from '../../../vendor/shared-ai-client';
import type { AiClientPublicContinuityView } from '@rental-os/shared';
import { clientPublicApi } from '../../../api/ai-public';
import { PUBLIC_CONFIG } from '../../../config/public';
import { serverNow } from '../../../core/clock';
import { newKey } from '../../../core/keys';
import { contextVersion, currentSession, sessionEvents } from '../../../core/session';
import { readStorage, writeRequiredStorage } from '../../../core/storage';
import { ROUTES, buildUrl, navigate } from '../../../core/ui';

type Session = ReturnType<typeof createAiClientPublicContinuitySession>;
const empty: AiClientPublicContinuityView = { status: 'idle', expiresAt: null, canPrepare: true, canContinue: false,
  canRead: false, loginRequired: false };
const owners = new WeakMap<object, Session>(), epochs = new WeakMap<object, number>(), releases = new WeakMap<object, () => void>();
const visible = new WeakSet<object>(), busy = new WeakSet<object>();
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
    attached() { visible.add(this); releases.set(this, sessionEvents.on(() => { this.invalidate(); if (visible.has(this)) void this.reopen(); })); void this.reopen(); },
    detached() { visible.delete(this); this.invalidate(); releases.get(this)?.(); releases.delete(this); },
  },
  pageLifetimes: { show() { visible.add(this); void this.reopen(); }, hide() { visible.delete(this); this.invalidate(); } },
  observers: { 'serviceCode, kind'() { this.invalidate(); if (visible.has(this)) void this.reopen(); } },
  methods: {
    invalidate() {
      epochs.set(this, (epochs.get(this) ?? 0) + 1); busy.delete(this); owners.get(this)?.dispose(); owners.delete(this);
      this.setData({ ...empty, working: false });
    },
    async ensure(): Promise<Session | null> {
      if (!visible.has(this) || !this.data.serviceCode || !['catalog', 'help'].includes(this.data.kind)) return null;
      const existing = owners.get(this); if (existing) return existing;
      const epoch = epochs.get(this), version = contextVersion(), serviceCode = this.data.serviceCode, kind = this.data.kind as 'catalog' | 'help';
      const current = () => visible.has(this) && epochs.get(this) === epoch && contextVersion() === version
        && this.data.serviceCode === serviceCode && this.data.kind === kind;
      const key = `rental-os:public-ai:${PUBLIC_CONFIG.tenantCode}:${serviceCode}:${kind}`;
      const owner = createAiClientPublicContinuitySession({ target: { tenantCode: PUBLIC_CONFIG.tenantCode, serviceCode },
        channel: 'wechat_miniprogram', kind, current, api: clientPublicApi, now: serverNow, newKey: () => newKey('public-browse'),
        client: () => {
          const value = currentSession(); if (!value?.accessToken || value.serviceCode !== serviceCode) return null;
          const marker = clientSessionMarker(value.accessToken); if (!marker) return null;
          const customerId = value.customer.customerId;
          return { ownerKey: JSON.stringify([PUBLIC_CONFIG.tenantCode, serviceCode, customerId, marker]),
            current: () => current() && currentSession() === value && value.customer.customerId === customerId };
        }, storage: { read: () => readStorage(key), write: value => writeRequiredStorage(key, value) },
        changed: value => { if (current()) this.setData({ ...value }); } });
      owners.set(this, owner); await owner.open(); return current() ? owner : null;
    },
    async run(action: 'prepare' | 'refresh' | 'continueOriginal') {
      if (busy.has(this) || !visible.has(this)) return;
      const epoch = epochs.get(this); busy.add(this); this.setData({ working: true });
      try { await (await this.ensure())?.[action](); }
      catch { if (epochs.get(this) === epoch) this.setData({ ...empty, canPrepare: false, status: 'unavailable' }); }
      finally { if (epochs.get(this) === epoch) { busy.delete(this); this.setData({ working: false }); } }
    },
    reopen() { return this.run('refresh'); },
    onPrepare() { return this.run('prepare'); },
    onRead() { return this.run('refresh'); },
    onContinue() { return this.run('continueOriginal'); },
    onLogin() { navigate(buildUrl(ROUTES.login, { redirect: this.data.kind === 'help' ? buildUrl(ROUTES.legal, { doc: 'help' }) : ROUTES.catalog })); },
  },
});
