/** Explicit review/adoption of one SaaS-reviewed rate in the current workspace.
 * No catalogue scan, automatic adoption, supplier/model call or budget gate. */
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { aiBudgetSettingsApi } from '@/api/aiBudgetSettings';
import { currentSessionEpoch } from '@/app/queryClient';
import { useLocale } from '@/app/locale';
import { ActionButton, Alert, ConfirmAction, Input } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { PlatformRateAdoptionSession } from './platform-rate-adoption-session';
import { safeDisplayText } from './safe-display';

const messages = { idle: '输入平台提供的正式费率引用。先预览再明确采用；不会启用模型、改额度或证明输入计数可信。',
  preview: '这是当前可审阅的原平台费率，尚未采用。配置或有效期变化时服务器会拒绝采用，不替换成另一费率。',
  recorded: '原费率采用已记录；历史收据不证明当前仍有效，也不代表预算、能力或派发已放行。',
  unknown: '原采用待核对，已锁住再次采用。只核对原引用，不换版本重发；没有收据不代表未保存。',
  denied: '当前身份、空间或权限已变化，已清除旧费率；原采用可能已发生，重新授权后再核对。',
  invalid: '请输入有效的正式场景编号和64位费率引用。',
  unavailable: '费率、当前平台模式、配置或权限依赖不可用；不会把失败当成免费或默认采用。' };
export function TenantPlatformRate({ identity }: { identity: string }) {
  const { t } = useLocale(), label = useId();
  const [sceneCode, setScene] = useState(''), [priceId, setPrice] = useState('');
  const session = useMemo(() => {
    const epoch = currentSessionEpoch(), auth = useAuthStore.getState(); let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* read-only, no unknown-lock bypass */ }
    return new PlatformRateAdoptionSession(aiBudgetSettingsApi, () => {
      const a = useAuthStore.getState();
      return !!a.token && !a.user?.isSaasAdmin && a.hasPermission('system:params:manage') && !document.hidden
        && currentSessionEpoch() === epoch && JSON.stringify([a.tenant?.tenantId, a.currentWorkspaceId, a.user]) === identity;
    }, storage, `rental_ai_platform_rate:${JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id])}`);
  }, [identity]);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot), result = state.recorded ?? state.preview;
  return <section aria-label={t('采用平台预算费率')} aria-busy={state.busy}>
    <h3>{t('采用平台预算费率')}</h3>
    <Alert type={state.feedback === 'recorded' ? 'success' : state.locked || state.feedback === 'denied' ? 'warning' : 'info'} title={t(messages[state.feedback])} />
    <p>{t('仅适用于当前平台统一服务模式；BYOK不能借此套用平台费率。费率只用于预算，不是供应商账单或用户收费授权。')}</p>
    <div className="panel-toolbar">
      <label htmlFor={`${label}-scene`}>{t('正式场景编号')}</label>
      <Input id={`${label}-scene`} value={sceneCode} maxLength={128} disabled={state.busy}
        onChange={event => { session.clearPreview(); setScene(event.currentTarget.value); }} />
      <label htmlFor={`${label}-rate`}>{t('平台费率引用')}</label>
      <Input id={`${label}-rate`} value={priceId} maxLength={64} disabled={state.busy}
        onChange={event => { session.clearPreview(); setPrice(event.currentTarget.value); }} />
      <ActionButton label={t('读取原费率预览')} successLabel={t('费率已读取，尚未采用')} disabled={state.busy}
        onAction={() => session.preview({ sceneCode, priceId })} />
    </div>
    {state.pending && <><p role="status">{t('待核对原场景')}: {safeDisplayText(state.pending.sceneCode, 128)}；{t('原费率引用')}: <code>{state.pending.priceId}</code></p>
      <ActionButton label={t('核对原采用收据')} successLabel={t('原采用已核对')} disabled={state.busy} onAction={session.reconcile} /></>}
    {state.locked && !state.pending && <p role="status">{t('原引用存储不可用，已禁止采用；请人工核对，不要清缓存后换键重试。')}</p>}
    {result && <>
      <p>{t('原场景')}: {safeDisplayText(result.sceneCode, 128)}；{t('费率版本')}: {safeDisplayText(result.priceVersion, 64)}</p>
      <p>{t('平台费率引用')}: <code>{result.priceId}</code></p>
      <p>{t('有效期')}: {safeDisplayText(result.validFrom, 40)} — {safeDisplayText(result.expiresAt, 40)}</p>
      {result.billing.unit === 'money' ? <>
        <p>{t('币种')}: {result.billing.currency}；{t('每百万输入 / 输出 Token 费率')}: {result.billing.inputPerMillion} / {result.billing.outputPerMillion}</p>
        {result.billing.inputCache && <p>{t('每百万缓存读取 / 写入费率')}: {result.billing.inputCache.readPerMillion} / {result.billing.inputCache.writePerMillion}</p>}
      </> : <p>{t('输入与输出 Token 原量合计，无金额换算。')}</p>}
      {state.preview && !state.recorded && <ConfirmAction label={t('明确采用此版本费率')}
        prompt={t('在当前空间采用刚读取的固定费率？不更改额度、不启用模型，也不等于可信输入计数已齐。')}
        doneLabel={t('费率采用已记录')} disabled={state.busy || state.locked} onConfirm={session.adopt} />}
    </>}
  </section>;
}
