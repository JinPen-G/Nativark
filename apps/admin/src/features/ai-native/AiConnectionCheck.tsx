/** Tenant-facing text check over the original probe task/receipts. A further
 * check is explicit and requires the original task/observation/ledger to end;
 * changing configuration never sends another call or clears an unknown one. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { aiCapabilityProbeApi } from '@/api/aiCapabilityProbe';
import { currentSessionEpoch } from '@/app/queryClient';
import { useAiManagementLocale as useLocale } from './management-locale';
import { ActionButton, Alert, ConfirmAction } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { CapabilityProbeSession, type ConnectionCheck } from './capability-probe-session';
import styles from './AiManagement.module.css';

export function AiConnectionCheck({ identity, configurationRevision, disabled }: {
  identity: string; configurationRevision: number; disabled: boolean;
}) {
  const { t } = useLocale();
  useAuthStore();
  const epoch = currentSessionEpoch();
  const owner = useMemo(() => ({}), [identity, epoch, configurationRevision]);
  const mounted = useRef(true);
  const active = useRef(owner); active.current = owner;
  const [working, setWorking] = useState<object | null>(null);
  const [result, setResult] = useState<{ owner: object; value: ConnectionCheck } | null>(null);
  const [failed, setFailed] = useState<object | null>(null);
  const current = () => {
    const a = useAuthStore.getState();
    return mounted.current && active.current === owner && !!a.token && !!a.user?.id && !a.user.isSaasAdmin
      && a.hasPermission('system:params:manage') && !document.hidden && epoch === currentSessionEpoch()
      && identity === JSON.stringify([a.tenant?.tenantId, a.currentWorkspaceId, a.user]);
  };
  const session = useMemo(() => {
    const auth = useAuthStore.getState(); let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* A missing recovery store cannot authorize a test. */ }
    return new CapabilityProbeSession(aiCapabilityProbeApi, current, storage,
      `rental_ai_capability_probe:${JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id])}`);
  }, [owner]);
  useEffect(() => {
    mounted.current = true; session.activate(); let withdrawn = false;
    const changed = () => {
      if (!current()) {
        withdrawn = true; session.dispose(); setResult(null); setWorking(null); setFailed(null);
      } else if (withdrawn) { withdrawn = false; session.activate(); }
    };
    document.addEventListener('visibilitychange', changed);
    const unsubscribe = useAuthStore.subscribe(changed);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', changed); unsubscribe(); session.dispose(); };
  }, [session]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const journal = state.journal, busy = working === owner || state.busy;
  const uncertain = state.locked || !!journal?.uncertain || state.feedback === 'unknown';
  const visible = result?.owner === owner && current() && state.feedback !== 'denied' ? result.value : null;
  const perform = async (action: 'test' | 'observe' | 'new') => {
    if (!current()) throw Error(t('当前没有检测权限，请联系管理员。'));
    setWorking(owner); setFailed(null); setResult(null);
    try {
      const value = await (action === 'observe' ? session.observeConnection(configurationRevision)
        : action === 'new' ? session.startNewConnection(configurationRevision) : session.testConnection(configurationRevision));
      if (current()) setResult({ owner, value });
    } catch { if (current()) setFailed(owner); throw Error(t('连接检测尚未确认，请查看提示。')); }
    finally { if (active.current === owner) setWorking(value => value === owner ? null : value); }
  };
  return <section className={styles.section} aria-label={t('连接检测')} aria-busy={busy}>
    <div className={styles.toolbar}>
      {!journal?.started && <ConfirmAction tone="neutral" label={t(journal ? '继续连接检测' : '测试连接')}
        prompt={t('使用已保存的 AI 配置发送一条测试消息？费用由你的供应商收取，不会执行租赁业务操作。')}
        doneLabel={t('检测请求已返回')} disabled={disabled || busy || uncertain} onConfirm={() => perform('test')} />}
      {journal && <ActionButton label={t('查看检测结果')} disabled={busy} onAction={() => perform('observe')} />}
      {journal?.started && state.connectionReady && <ConfirmAction tone="neutral" label={t('开始新的检测')}
        prompt={t('上次检测已结束。使用当前已保存的 AI 配置发送新的测试消息？费用由你的供应商收取。')}
        doneLabel={t('检测请求已返回')} disabled={disabled || busy || uncertain} onConfirm={() => perform('new')} />}
      <span className={styles.help}>{t('测试可能产生供应商费用。')}</span>
    </div>
    {disabled && <p className="muted">{t('请先启用并保存供应商配置。')}</p>}
    {state.connectionReady && <p className={styles.help} role="status">{t('上次检测已结束，可以发起新的检测。')}</p>}
    {visible && <Alert type={visible.state === 'supported' ? 'success' : 'warning'} title={t(
      visible.state === 'supported' ? '文本连接检测通过。'
        : visible.state === 'unsupported' ? '当前服务未通过文本回复检测，请核对供应商配置。'
          : visible.state === 'stale' ? '检测结果已过期或与当前配置不一致，请联系平台管理员。'
            : '检测结果仍待确认，请稍后查看结果。')} />}
    {(uncertain || failed === owner) && !visible && <Alert type="warning" title={t(
      state.feedback === 'denied' ? '当前没有检测权限，请联系管理员。'
        : state.locked ? '检测记录不可读取，为避免重复调用，暂不能发起新检测。'
          : uncertain ? '上次检测结果尚未确认，请先查看检测结果，不要重复发起。'
          : '连接检测暂不可用，请检查已保存的配置或联系平台管理员。')} />}
  </section>;
}
