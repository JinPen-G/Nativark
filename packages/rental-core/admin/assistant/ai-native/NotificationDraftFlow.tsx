import { useRentalAssistant } from "../host";
import { createAiNotificationDraftsApi } from "../api/aiNotificationDrafts";
import { createRentalGovernanceApi } from "../../governance/client";
/** Customer-bound original unsent draft consumer. Templates and contacts remain
 * governed by their original routes. The user reviews masked material and saves
 * once; result recovery reads the original key without a send or retry action. */
import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import type { RentalNotificationTemplateV1 } from '@rental-os/shared';
import { ActionButton, Alert, ConfirmAction, Input, Select } from "@rental-os/platform-admin/ui";




import { createNotificationDraftSession, notificationDraftStore } from './notification-draft-session';
import { useAiManagementLocale } from "@rental-os/ai-native-admin/source/ai-native/management-locale";
import { safeDisplayText, displayTextContent } from "@rental-os/ai-native-admin/source/ai-native/safe-display";
import { formatTimestamp } from "@rental-os/ai-native-admin/source/ai-native/formatters";
import styles from "@rental-os/ai-native-admin/source/ai-native/AiManagement.module.css";


export function NotificationDraftFlow({ customerId, current, visible = true }: {
  customerId: string; current(): boolean; visible?: boolean;
}) {
  const { session: hostSession, useAuthStore, currentSessionEpoch, currentSessionSignal } = useRentalAssistant();
  const aiNotificationDraftsApi = useMemo(() => createAiNotificationDraftsApi(hostSession), [hostSession]);
  const rentalCoreApi = useMemo(() => createRentalGovernanceApi(hostSession.runtime.request), [hostSession]);
  const fingerprint = () => {
    const auth = useAuthStore.getState();
    return JSON.stringify([auth.token, auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user, currentSessionEpoch()]);
  };

  const auth = useAuthStore(), { t } = useAiManagementLocale(), [, changed] = useReducer(value => value + 1, 0);
  const name = useId(), identity = fingerprint(), epoch = currentSessionEpoch();
  const [templates, setTemplates] = useState<RentalNotificationTemplateV1[]>([]), [templateId, setTemplateId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({}), [key, setKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState(false), [loading, setLoading] = useState(false), [activation, setActivation] = useState(0);
  const owner = useRef({ identity, customerId, current, visible }); owner.current = { identity, customerId, current, visible };
  const mounted = useRef(true), templateRequest = useRef<AbortController | null>(null), templateGeneration = useRef(0);
  const live = () => mounted.current && owner.current.visible && owner.current.identity === identity
    && owner.current.customerId === customerId && identity === fingerprint() && epoch === currentSessionEpoch()
    && !document.hidden && !currentSessionSignal().aborted && owner.current.current();
  const allowed = !!auth.token && !!auth.tenant?.tenantId && !!auth.currentWorkspaceId && !!auth.user && !auth.user.isSaasAdmin
    && auth.hasPermission('system:integration:manage') && auth.hasTenantMembershipPermission('rental-os:customer:reveal-sensitive')
    && (auth.hasTenantMembershipPermission('rental-os:member:view') || auth.hasTenantMembershipPermission('rental-os:member:manage'));
  const session = useMemo(() => {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* The store refuses saving without a durable original key. */ }
    return createNotificationDraftSession({ api: aiNotificationDraftsApi, customerId,
      current: live, changed, scope: { tenantId: auth.tenant?.tenantId ?? '', workspaceId: auth.currentWorkspaceId ?? '' },
      store: notificationDraftStore(`rental-os:notification-draft:${auth.tenant?.tenantId}:${auth.currentWorkspaceId}:${auth.user?.id}:${customerId}`, storage) });
  }, [identity, customerId, visible, activation]);
  useEffect(() => {
    mounted.current = true;
    session.activate(); setTemplates([]); setTemplateId(''); setValues({}); setLoading(false); setError(false);
    setKey(crypto.randomUUID()); changed();
    const clear = () => { templateGeneration.current++; templateRequest.current?.abort(); templateRequest.current = null;
      session.dispose(); setTemplates([]); setTemplateId(''); setValues({}); setLoading(false); setError(false); setKey(crypto.randomUUID()); };
    const visibility = () => { clear(); if (!document.hidden) setActivation(value => value + 1); else changed(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', visibility);
      templateGeneration.current++; templateRequest.current?.abort(); templateRequest.current = null; session.dispose(); };
  }, [session]);
  const observed = session.view.frame;
  useEffect(() => {
    if (observed?.state !== 'prepared') return;
    const remaining = Math.min(120000, Date.parse(observed.expiresAt) - Date.now());
    if (!(remaining > 0)) { session.invalidate(); return; }
    const timer = setTimeout(() => session.invalidate(), remaining);
    return () => clearTimeout(timer);
  }, [session, observed]);
  if (!allowed || !visible || !live()) return null;
  const view = session.view, template = templates.find(row => row.id === templateId), busy = !!view.busy || loading;
  const action = (work: () => Promise<unknown>) => async () => {
    if (!live()) throw Error('AI_SCOPE_CHANGED');
    try { return await work(); } catch (failure) { if (live()) { session.invalidate(); setError(true); } throw failure; }
  };
  const readTemplates = action(async () => {
    if (busy || templateRequest.current) throw Error('AI_OPERATION_BUSY');
    const generation = ++templateGeneration.current, controller = new AbortController(); templateRequest.current = controller;
    setLoading(true); setError(false); setTemplates([]); setTemplateId(''); setValues({}); session.invalidate();
    try {
      const found = await rentalCoreApi.notificationTemplates();
      if (!live() || controller.signal.aborted || generation !== templateGeneration.current) throw Error('AI_SCOPE_CHANGED');
      setTemplates(found.filter(row => row.status === 'enabled' && ['sms', 'email'].includes(row.channel)
        && row.tenantId === auth.tenant!.tenantId && Object.keys(row.variableSchema).length <= 64));
    } finally { if (templateRequest.current === controller) { templateRequest.current = null; setLoading(false); } }
  });
  const material = view.frame?.state === 'prepared' ? view.frame.material : view.frame?.state === 'saved' ? view.frame.draft : null;
  const original = view.operationKey !== null;
  return <section className={styles.stack} aria-label={t('未发送通知草稿')}>
    <p className={styles.help}>{t('核对原客户收件人和通知模板，只保存草稿；发送须另行在原通知流程办理。')}</p>
    {view.damaged && <Alert type="warning" title={t('原操作定位无法读取，已阻止新草稿。')} />}
    {(view.pending || view.frame?.state === 'unknown') && <Alert type="warning" title={t('草稿保存结果待核对。')}
      description={t('只读取原操作；未观察到收据不表示未保存，不重新发送。')} />}
    {view.operationKey && <ActionButton label={t('核对原通知草稿')} disabled={busy || view.damaged} onAction={action(() => session.read())} />}
    {!original && !view.damaged && <>
      <ActionButton label={t('读取原通知模板')} pendingLabel={t('正在读取')} disabled={busy} onAction={readTemplates} />
      <label className={styles.field} htmlFor={`${name}-template`}>{t('通知模板')}
        <Select id={`${name}-template`} value={templateId || undefined} disabled={busy} placeholder={t('请选择原模板')}
          options={templates.map(row => ({ value: row.id, label: `${safeDisplayText(row.name, 191)} · ${row.channel} · v${row.version}` }))}
          onChange={value => { session.invalidate(); setTemplateId(value ?? ''); setValues({}); }} />
      </label>
      {template && Object.entries(template.variableSchema).map(([field, rule]) => <label key={field} className={styles.field} htmlFor={`${name}-${field}`}>
        {safeDisplayText(rule.label || field, 191)}{rule.required ? ' *' : ''}
        <Input id={`${name}-${field}`} value={values[field] ?? ''} maxLength={2000} disabled={busy}
          onChange={event => { session.invalidate(); setValues(before => ({ ...before, [field]: event.target.value })); }} />
      </label>)}
      <ActionButton label={t('核对通知草稿')} pendingLabel={t('正在核对')} disabled={busy || !template}
        onAction={action(() => session.prepare({ operationKey: key, customerId, templateId: template!.id,
          templateVersion: template!.version, variables: values }))} />
    </>}
    {(error || !!view.error) && <Alert type="warning" title={t('通知草稿不可用，请核对当前权限、原模板和原操作。')} />}
    {material && <section className={styles.section}>
      <dl className={styles.facts}>
        <div><dt>{t('收件人')}</dt><dd>{material.recipient === null ? t('正文已按保留政策清除') : safeDisplayText(material.recipient, 191)}</dd></div>
        <div><dt>{t('原模板版本')}</dt><dd>{safeDisplayText(material.templateId, 191)} · v{material.templateVersion}</dd></div>
        <div><dt>{t('查询时点')}</dt><dd>{formatTimestamp(view.frame!.observedAt).value}</dd></div>
        <div><dt>{t('状态')}</dt><dd>{t(view.frame?.state === 'saved' ? '草稿已保存，未发送。' : '草稿未保存，未发送。')}</dd></div>
      </dl>
      {'bodyRetention' in material ? <Alert type="info" title={t('正文已按保留政策清除')}
        description={`${t('原未发送收据仍保留')} · ${formatTimestamp(material.bodyRetention.erasedAt).value}`} />
        : <><p>{displayTextContent(material.renderedTitle)}</p><p className={styles.help}>{displayTextContent(material.renderedBody)}</p></>}
      {view.frame?.state === 'prepared' && <>
        <p className={styles.help}>{t('按已核对的原收件人和模板保存草稿？本次不发送通知。')}</p>
        <ConfirmAction label={t('保存未发送草稿')} onConfirm={action(() => session.save())} disabled={busy} />
      </>}
      {view.frame?.state === 'saved' && <ActionButton label={t('准备另一份草稿')} disabled={busy} onAction={action(async () => {
        session.newDraft(); setKey(crypto.randomUUID()); setTemplates([]); setTemplateId(''); setValues({}); setError(false);
      })} />}
    </section>}
  </section>;
}
