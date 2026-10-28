/** Human-only local-business policy configuration. It does not configure a model or release business execution. */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { parseRentalDesktopBusinessPolicy } from '@rental-os/shared';
import { desktopBusinessPolicyApi } from '@/api/desktopBusiness';
import { currentSessionEpoch } from '@/app/queryClient';
import { useLocale } from '@/app/locale';
import { ActionButton, Alert, Button, DatePicker, Form, Input, SaveButton, Select, Switch } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { DesktopPolicySession } from './desktop-policy-session';

interface Values { enabled: boolean; maxRows: number; expiresAt: string; destinations: Array<{ provider: string; baseUrl: string }>;
  modelRoutes: Array<{ provider: string; baseUrl: string; model: string; protocol: string }> }
const messages = {
  idle: '默认不允许桌面客户端读取业务资料。目前可授权的范围仅为当前空间的商品目录预览，不包含建单或其他业务操作。',
  saved: '授权设置已保存，请刷新查看。AI 服务连接需单独配置。',
  recorded: '上次保存结果已确认，请刷新后再编辑。',
  unknown: '上次保存结果尚未确认，请先核对保存结果，不要重复提交。',
  conflict: '授权设置已被其他管理员修改，请刷新后再编辑。',
  denied: '当前没有管理客户端授权的权限。',
  invalid: '请检查服务地址、返回条数和到期时间。',
  unavailable: '授权设置暂不可用，请稍后读取。保存结果未确认前不要重复提交。'
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
  return <section aria-label={t('桌面客户端数据访问')} aria-busy={state.busy}>
    <h3>{t('桌面客户端数据访问')}</h3>
    <Alert type={state.feedback === 'saved' || state.feedback === 'recorded' ? 'success' : state.feedback === 'idle' ? 'info' : 'warning'} title={t(messages[state.feedback])} />
    <div className="panel-toolbar">
      <ActionButton label={t('刷新授权设置')} successLabel={t('已刷新')} disabled={state.busy} onAction={() => session.load()} />
      {state.pending && <ActionButton label={t('核对上次保存结果')} successLabel={t('核对结束')} disabled={state.busy} onAction={() => session.reconcile()} />}
    </div>
    {state.pending && <p role="status">{t('原操作编号')}: <code>{state.pending.operationKey}</code></p>}
    {state.policy && <>
      <Form form={form} layout="vertical" disabled={blocked} onFinish={values => { void save(values).catch(() => undefined); }}>
        <Form.Item name="enabled" label={t('允许桌面客户端查看商品目录')} valuePropName="checked"><Switch /></Form.Item>
        <Form.Item name="maxRows" label={t('每次最多查看商品条数')} getValueFromEvent={(event: { target: { value: string } }) => event.target.value === '' ? undefined : Number(event.target.value)}
          rules={[{ required: true, type: 'integer', min: 1, max: 50 }]}><Input type="number" min={1} max={50} step={1} /></Form.Item>
        <Form.Item name="expiresAt" label={t('授权到期时间')}
          getValueProps={(value: string) => ({ value: value && dayjs(value).isValid() ? dayjs(value) : null })}
          getValueFromEvent={(value: Dayjs | null) => value?.isValid() ? value.toISOString() : ''}
          rules={[{ required: true, message: t('请选择授权到期时间') }]}>
          <DatePicker showTime format="YYYY-MM-DD HH:mm" placeholder={t('选择到期日期和时间')} />
        </Form.Item>
        <details open><summary>{t('允许接收业务资料的 AI 服务')}</summary>
        <p className="muted">{t('仅允许向下列服务预览资料。这里不填写 API Key，也不会启用自动业务操作。')}</p>
        <Form.List name="destinations">{(fields, { add, remove }) => <>
          {fields.map(field => <div key={field.key} className="panel-toolbar">
            <Form.Item name={[field.name, 'provider']} label={t('供应商名称')} rules={[{ required: true }]}><Input maxLength={128} /></Form.Item>
            <Form.Item name={[field.name, 'baseUrl']} label={t('服务地址（HTTPS）')} rules={[{ required: true }]}><Input maxLength={2048} /></Form.Item>
            <Button disabled={blocked} onClick={() => remove(field.name)}>{t('移除服务')}</Button>
          </div>)}
          <Button disabled={blocked || fields.length >= 16} onClick={() => add({ provider: '', baseUrl: '' })}>{t('添加允许的服务')}</Button>
        </>}</Form.List>
        <Form.List name="modelRoutes">{(fields, { add, remove }) => <>
          {fields.map(field => <div key={field.key} className="panel-toolbar">
            <Form.Item name={[field.name, 'provider']} label={t('供应商名称')} rules={[{ required: true }]}><Input maxLength={128} /></Form.Item>
            <Form.Item name={[field.name, 'baseUrl']} label={t('模型服务地址（HTTPS）')} rules={[{ required: true }]}><Input maxLength={2048} /></Form.Item>
            <Form.Item name={[field.name, 'model']} label={t('允许使用的模型名称')} rules={[{ required: true }]}><Input maxLength={256} /></Form.Item>
            <Form.Item name={[field.name, 'protocol']} label={t('接口协议')} rules={[{ required: true }]}><Select options={[
              { value: 'openai-responses', label: 'OpenAI Responses' }, { value: 'openai-completions', label: 'OpenAI Chat Completions' },
              { value: 'anthropic-messages', label: 'Anthropic Messages' }]} /></Form.Item>
            <Button disabled={blocked} onClick={() => remove(field.name)}>{t('移除模型')}</Button>
          </div>)}
          <Button disabled={blocked || fields.length >= 32} onClick={() => add({ provider: '', baseUrl: '', model: '', protocol: undefined })}>{t('添加允许的模型')}</Button>
        </>}</Form.List>
        <p className="muted">{t('只有匹配上述服务、模型及协议的客户端才能预览资料。未添加模型时不允许模型读取；这项授权不包含建单。')}</p>
        </details>
        <SaveButton form={form} label={t('保存授权设置')} disabled={blocked} onSave={save} />
      </Form>
    </>}
  </section>;
}
