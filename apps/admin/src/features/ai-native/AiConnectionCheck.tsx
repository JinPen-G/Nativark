/** Tenant-facing text connection check over the original probe task/receipts.
 * No automatic check on page load, new key after uncertainty, or fake success. */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { aiCapabilityProbeApi } from '@/api/aiCapabilityProbe';
import { currentSessionEpoch } from '@/app/queryClient';
import { useLocale } from '@/app/locale';
import { ActionButton, Alert, ConfirmAction } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { CapabilityProbeSession, type ConnectionCheck } from './capability-probe-session';

export function AiConnectionCheck({ identity, configurationRevision, disabled }: {
  identity: string; configurationRevision: number; disabled: boolean;
}) {
  const { t } = useLocale(), [working, setWorking] = useState(false);
  const [result, setResult] = useState<(ConnectionCheck & { revision: number }) | null>(null);
  const [failed, setFailed] = useState(false);
  const session = useMemo(() => {
    const epoch = currentSessionEpoch(), owner = useAuthStore.getState(); let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* A missing recovery store cannot authorize a test. */ }
    return new CapabilityProbeSession(aiCapabilityProbeApi, () => {
      const a = useAuthStore.getState();
      return !!a.token && !!a.user?.id && !a.user.isSaasAdmin && a.hasPermission('system:params:manage')
        && !document.hidden && epoch === currentSessionEpoch()
        && identity === JSON.stringify([a.tenant?.tenantId, a.currentWorkspaceId, a.user]);
    }, storage, `rental_ai_capability_probe:${JSON.stringify([owner.tenant?.tenantId, owner.currentWorkspaceId, owner.user?.id])}`);
  }, [identity]);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const journal = state.journal, busy = working || state.busy;
  const uncertain = state.locked || !!journal?.uncertain || state.feedback === 'unknown';
  const visible = result?.revision === configurationRevision && state.feedback !== 'denied' ? result : null;
  const perform = async (observe: boolean) => {
    setWorking(true); setFailed(false); setResult(null);
    try {
      const value = await (observe ? session.observeConnection(configurationRevision) : session.testConnection(configurationRevision));
      setResult({ ...value, revision: configurationRevision });
    } catch { setFailed(true); throw Error(t('连接检测尚未确认，请查看提示。')); }
    finally { setWorking(false); }
  };
  return <section aria-label={t('连接检测')} aria-busy={busy}>
    <p className="muted">{t('检测已保存配置的文本回复能力，可能产生供应商 Token 用量。其他能力由系统单独检查。')}</p>
    <div className="panel-toolbar">
      {!journal?.started && <ConfirmAction tone="neutral" label={t(journal ? '继续连接检测' : '测试连接')}
        prompt={t('使用已保存的 AI 配置发送一条测试消息？费用由你的供应商收取，不会执行租赁业务操作。')}
        doneLabel={t('检测请求已返回')} disabled={disabled || busy || uncertain} onConfirm={() => perform(false)} />}
      {journal && <ActionButton label={t('查看检测结果')} disabled={busy} onAction={() => perform(true)} />}
    </div>
    {disabled && <p className="muted">{t('请先启用并保存供应商配置。')}</p>}
    {visible && <Alert type={visible.state === 'supported' ? 'success' : 'warning'} title={t(
      visible.state === 'supported' ? '文本连接检测通过。'
        : visible.state === 'unsupported' ? '当前服务未通过文本回复检测，请核对供应商配置。'
          : visible.state === 'stale' ? '检测结果已过期或与当前配置不一致，请联系平台管理员。'
            : '检测结果仍待确认，请稍后查看结果。')} />}
    {(uncertain || failed) && !visible && <Alert type="warning" title={t(
      state.feedback === 'denied' ? '当前没有检测权限，请联系管理员。'
        : state.locked ? '检测记录不可读取，为避免重复调用，暂不能发起新检测。'
          : uncertain ? '上次检测结果尚未确认，请先查看检测结果，不要重复发起。'
          : '连接检测暂不可用，请检查已保存的配置或联系平台管理员。')} />}
  </section>;
}
