/** Explicit current BYOK reference discovery. Original receipts are independent
 * of this live read; the journal is owner-partitioned, never an enable switch. */
import { useEffect, useId, useRef, useState } from 'react';
import { aiBudgetSettingsApi } from '@/api/aiBudgetSettings';
import { currentSessionEpoch } from '@/app/queryClient';
import { useLocale } from '@/app/locale';
import { ActionButton, Alert, Input } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { PlatformPriceReview } from './PlatformPriceReview';
import { byokPriceConfiguration } from './platform-price-review-session';

export function TenantByokRate({ identity, tenantId }: { identity: string; tenantId: string }) {
  const { t } = useLocale(), label = useId(), [sceneCode, setScene] = useState('');
  const [profile, setProfile] = useState<{ profileId: string; revision: number } | null>(null);
  const [feedback, setFeedback] = useState<'idle' | 'loaded' | 'unavailable'>('idle'), [busy, setBusy] = useState(false);
  const flight = useRef<AbortController | null>(null), alive = useRef(false), epoch = useRef(currentSessionEpoch());
  const current = () => {
    const a = useAuthStore.getState();
    return alive.current && !document.hidden && !!a.token && !a.user?.isSaasAdmin && a.hasPermission('system:params:manage')
      && currentSessionEpoch() === epoch.current && JSON.stringify([a.tenant?.tenantId, a.currentWorkspaceId, a.user]) === identity;
  };
  useEffect(() => {
    alive.current = true;
    const hidden = () => { if (document.hidden) { flight.current?.abort(); setProfile(null); setBusy(false); } };
    document.addEventListener('visibilitychange', hidden);
    return () => { alive.current = false; flight.current?.abort(); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  const load = async () => {
    if (flight.current || !current()) throw Error('AI_ACCESS_DENIED');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(sceneCode)) throw Error('AI_INVALID_INPUT');
    const controller = new AbortController(), requestedScene = sceneCode;
    flight.current = controller; setBusy(true); setProfile(null); setFeedback('idle');
    try {
      const result = byokPriceConfiguration(await aiBudgetSettingsApi.readPriceConfiguration({ sceneCode: requestedScene }, controller.signal), requestedScene);
      if (controller.signal.aborted || !current()) throw Error('AI_SCOPE_CHANGED');
      setProfile({ profileId: result.configId, revision: result.configRevision }); setFeedback('loaded');
    } catch (error) {
      if (alive.current && !controller.signal.aborted) { setProfile(null); setFeedback('unavailable'); }
      throw error;
    } finally {
      if (flight.current === controller) flight.current = null;
      if (alive.current) setBusy(false);
    }
  };
  return <section aria-label={t('BYOK 计价配置')} aria-busy={busy}>
    <h3>{t('BYOK 计价配置')}</h3>
    <Alert type={feedback === 'unavailable' ? 'warning' : 'info'} title={t(feedback === 'loaded'
      ? '已读取当前 BYOK 配置引用，请核对费率后明确保存；不代表能力、计数或预算已放行。'
      : feedback === 'unavailable' ? '当前 BYOK 配置或读取权限不可用，未登记新费率。历史操作仍只能核对原收据。'
        : '先按正式场景读取服务器选定的 BYOK 配置。平台统一服务请使用平台费率采用入口。')} />
    <div className="panel-toolbar">
      <label htmlFor={`${label}-scene`}>{t('读取配置所用场景编号')}</label>
      <Input id={`${label}-scene`} value={sceneCode} maxLength={128} disabled={busy}
        onChange={event => { setScene(event.currentTarget.value); setProfile(null); setFeedback('idle'); }} />
      <ActionButton label={t('读取 BYOK 计价配置')} successLabel={t('当前配置引用已读取')} disabled={busy} onAction={load} />
    </div>
    <PlatformPriceReview audience="tenant" profileId={tenantId} identity={identity} profile={profile}
      blocked={busy} />
  </section>;
}
