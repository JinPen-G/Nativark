/** Human-only local-business policy configuration. It does not configure a model or release business execution. */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { parseRentalDesktopBusinessPolicy } from '@rental-os/shared';
import { desktopBusinessPolicyApi } from '@/api/desktopBusiness';
import { currentSessionEpoch } from '@/app/queryClient';
import { useLocale } from '@/app/locale';
import { ActionButton, Alert, Button, Form, Input, SaveButton, Select, Switch } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { DesktopPolicySession } from './desktop-policy-session';

interface Values { enabled: boolean; maxRows: number; expiresAt: string; destinations: Array<{ provider: string; baseUrl: string }>;
  modelRoutes: Array<{ provider: string; baseUrl: string; model: string; protocol: string }> }
const messages = {
  idle: '本地业务默认不开放。这里只管理当前经营空间的人工目录预览许可，不配置模型 Key、不开放模型自动工具或建单。',
  saved: '政策已保存。请重新读取当前政策；这不代表模型已连接或业务 Agent 已启用。',
  recorded: '原保存已确认。该收据是历史事实，请重新读取当前政策后再编辑。',
  unknown: '保存结果待核对。只可读取原操作收据；未观察到收据不代表回滚，不能换编号再次保存。',
  conflict: '政策已被修改。请重新读取并核对，不自动覆盖。',
  denied: '当前身份或配置管理权限已变化，旧政策不可继续使用。',
  invalid: '政策字段未通过校验，请核对 HTTPS 地址、启停、数量和 UTC 有效期。',
  unavailable: '政策、原保存记录或浏览器恢复存储不可用。未确认前不发送新保存，请保留原操作编号。'
} as const;
export function DesktopBusinessPolicySettings({ identity }: { identity: string }) {
  const auth = useAuthStore(), { t } = useLocale();
  if (!auth.token || !auth.sessionVerified || !auth.tenant?.tenantId || !auth.currentWorkspaceId || !auth.user?.id
    || auth.user.isSaasAdmin || auth.user.mustChangePassword || !auth.hasPermission('system:params:manage'))
    return <Alert type="warning" title={t(messages.denied)} />;
  return <DesktopBusinessPolicyEditor key={`${identity}:${currentSessionEpoch()}`} identity={identity} />;
}
function DesktopBusinessPolicyEditor({ identity }: { identity: string }) {
  const { t } = useLocale(), [form] = Form.useForm<Values>();
  const session = useMemo(() => {
    const epoch = currentSessionEpoch(), owner = useAuthStore.getState();
    let journal: Storage | undefined;
    try { journal = window.sessionStorage; } catch { /* No persistent original-key location means no save. */ }
    return new DesktopPolicySession(desktopBusinessPolicyApi, () => {
      const current = useAuthStore.getState();
      return currentSessionEpoch() === epoch && !!current.token && current.sessionVerified && !current.user?.isSaasAdmin
        && !current.user?.mustChangePassword && current.hasPermission('system:params:manage')
        && JSON.stringify([current.tenant?.tenantId, current.currentWorkspaceId, current.user]) === identity;
    }, () => window.crypto.randomUUID(), journal,
    `rental_desktop_policy_operation:${JSON.stringify([owner.tenant?.tenantId, owner.currentWorkspaceId, owner.user?.id])}`);
  }, [identity]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { session.activate(); void session.load().catch(() => undefined); return () => session.dispose(); }, [session]);
  useEffect(() => {
    if (!state.policy) { form.resetFields(); return; }
    form.setFieldsValue(state.policy.state === 'configured' ? { ...state.policy.policy, modelRoutes: state.policy.policy.modelRoutes ?? [] }
      : { enabled: false, maxRows: 10, expiresAt: '', destinations: [{ provider: '', baseUrl: '' }], modelRoutes: [] });
  }, [state.policy, form]);
  const save = async (values: Values) => session.save(parseRentalDesktopBusinessPolicy({ ...values,
    toolCodes: values.enabled ? ['rental.catalog.search'] : [] }));
  const blocked = state.busy || !!state.pending || !state.policy || !session.recoveryAvailable;
  return <section aria-label={t('本地客户端业务政策')} aria-busy={state.busy}>
    <h3>{t('本地客户端业务政策')}</h3>
    <Alert type={state.feedback === 'saved' || state.feedback === 'recorded' ? 'success' : state.feedback === 'idle' ? 'info' : 'warning'} title={t(messages[state.feedback])} />
    <div className="panel-toolbar">
      <ActionButton label={t('读取当前本地业务政策')} successLabel={t('政策已读取')} disabled={state.busy} onAction={() => session.load()} />
      {state.pending && <ActionButton label={t('核对原政策保存')} successLabel={t('核对结束，以原收据状态为准')} disabled={state.busy} onAction={() => session.reconcile()} />}
    </div>
    {state.pending && <p role="status">{t('原操作编号')}: <code>{state.pending.operationKey}</code></p>}
    {state.policy && <>
      <p>{t('当前政策修订')}: {state.policy.state === 'configured' ? state.policy.revision : 0} · {t('允许工具仅限受控目录预览')}</p>
      <Form form={form} layout="vertical" disabled={blocked} onFinish={values => { void save(values).catch(() => undefined); }}>
        <Form.Item name="enabled" label={t('允许本地目录预览')} valuePropName="checked"><Switch /></Form.Item>
        <Form.Item name="maxRows" label={t('单次返回上限')} getValueFromEvent={(event: { target: { value: string } }) => event.target.value === '' ? undefined : Number(event.target.value)}
          rules={[{ required: true, type: 'integer', min: 1, max: 50 }]}><Input type="number" min={1} max={50} step={1} /></Form.Item>
        <Form.Item name="expiresAt" label={t('有效期（UTC，例如 2026-12-31T23:59:59.000Z）')} rules={[{ required: true },
          { pattern: /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u, message: t('请输入完整的 UTC 时间，包括毫秒及 Z') }]}><Input maxLength={24} /></Form.Item>
        <Form.List name="destinations">{(fields, { add, remove }) => <>
          {fields.map(field => <div key={field.key} className="panel-toolbar">
            <Form.Item name={[field.name, 'provider']} label={t('获准 Provider 标识')} rules={[{ required: true }]}><Input maxLength={128} /></Form.Item>
            <Form.Item name={[field.name, 'baseUrl']} label={t('获准 HTTPS Base URL')} rules={[{ required: true }]}><Input maxLength={2048} /></Form.Item>
            <Button disabled={blocked} onClick={() => remove(field.name)}>{t('移除目的地')}</Button>
          </div>)}
          <Button disabled={blocked || fields.length >= 16} onClick={() => add({ provider: '', baseUrl: '' })}>{t('添加获准目的地')}</Button>
        </>}</Form.List>
        <Form.List name="modelRoutes">{(fields, { add, remove }) => <>
          {fields.map(field => <div key={field.key} className="panel-toolbar">
            <Form.Item name={[field.name, 'provider']} label={t('精确模型的 Provider')} rules={[{ required: true }]}><Input maxLength={128} /></Form.Item>
            <Form.Item name={[field.name, 'baseUrl']} label={t('精确模型的 HTTPS Base URL')} rules={[{ required: true }]}><Input maxLength={2048} /></Form.Item>
            <Form.Item name={[field.name, 'model']} label={t('获准模型 ID')} rules={[{ required: true }]}><Input maxLength={256} /></Form.Item>
            <Form.Item name={[field.name, 'protocol']} label={t('获准协议')} rules={[{ required: true }]}><Select options={[
              { value: 'openai-responses', label: 'OpenAI Responses' }, { value: 'openai-completions', label: 'OpenAI Chat Completions' },
              { value: 'anthropic-messages', label: 'Anthropic Messages' }]} /></Form.Item>
            <Button disabled={blocked} onClick={() => remove(field.name)}>{t('移除模型许可')}</Button>
          </div>)}
          <Button disabled={blocked || fields.length >= 32} onClick={() => add({ provider: '', baseUrl: '', model: '', protocol: undefined })}>{t('添加精确模型许可')}</Button>
        </>}</Form.List>
        <p>{t('模型预览需同时匹配目的地和精确模型、协议；空列表不授权任何模型，不支持通配符。旧目的地许可仅保留原人工预览。这里不开放模型发送、工具执行或建单。')}</p>
        <SaveButton form={form} label={t('保存本地业务政策')} disabled={blocked} onSave={save} />
      </Form>
    </>}
  </section>;
}
