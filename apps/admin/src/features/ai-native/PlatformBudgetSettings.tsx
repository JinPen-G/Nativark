/** Explicit global platform/scene policy editor, not the selected Profile's
 * enable switch. Settings writes and original receipts use the one budget API. */
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { aiBudgetSettingsApi } from '@/api/aiBudgetSettings';
import { currentSessionEpoch } from '@/app/queryClient';
import { useAiManagementLocale as useLocale } from './management-locale';
import { ActionButton, Alert, Form, FormSection, Input, SaveButton, Select, Switch } from '@/components/ui';
import { SettingsWorkspace } from '@/components/settings/SettingsWorkspace';
import { useAuthStore } from '@/features/auth/authStore';
import { PlatformBudgetSettingsSession, type PlatformBudgetForm } from './platform-budget-settings-session';
import styles from './AiManagement.module.css';

const messages = { idle: '读取平台全局场景政策；不查询供应商、不调用模型。',
  saved: '平台预算政策已保存；租户、空间、场景、能力和计数仍分别校验，不代表模型已可执行。',
  recorded: '原保存收据已核对；只证明原修订已提交，请重新读取当前政策再编辑。',
  unknown: '原保存结果待核对，已禁止再次保存。当前政策相同也不证明原保存成功；只能核对原操作。',
  conflict: '政策或模型配置修订已变化，未覆盖其他修改；请重新读取。',
  denied: '当前平台权限或身份已变化，已清除旧政策。', invalid: '请核对精确额度、上限、白名单及明确确认。',
  unavailable: '预算、配置或原引用存储不可用，未视为零费用或不限额。' };
export function PlatformBudgetSettings({ identity }: { identity: string }) {
  const { t } = useLocale(), label = useId();
  const [scene, setScene] = useState(''), [selected, setSelected] = useState('');
  return <section className={styles.stack} aria-label={t('平台 AI 预算')}>
    <FormSection title={t('平台 AI 预算')} description={t('此处管理平台全局的场景政策；服务器绑定正式配置，未配置、零额度或停用均不放行。')}>
    <div className={styles.requestRow}>
      <div className={styles.field}><label htmlFor={label}>{t('正式场景编号')}</label>
      <Input id={label} maxLength={128} value={scene} onChange={event => { setScene(event.currentTarget.value); setSelected(''); }} /></div>
      <ActionButton label={t('选择平台预算对象')} successLabel={t('对象已选，请读取')} onAction={async () => {
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(scene)) throw Error('AI_INVALID_INPUT'); setSelected(scene);
      }} />
    </div>
    </FormSection>
    {selected && <PlatformBudgetEditor key={`${identity}:${selected}`} identity={identity} sceneCode={selected} />}
  </section>;
}
function PlatformBudgetEditor({ identity, sceneCode }: { identity: string; sceneCode: string }) {
  const { t } = useLocale(), [form] = Form.useForm<PlatformBudgetForm>();
  const canManage = useAuthStore(s => s.hasPermission('system:ai-provider:manage'));
  const session = useMemo(() => {
    const epoch = currentSessionEpoch(), actor = useAuthStore.getState().user?.id; let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* read-only without original-key recovery */ }
    return new PlatformBudgetSettingsSession(sceneCode, aiBudgetSettingsApi, () => {
      const a = useAuthStore.getState();
      return !!a.token && !!a.user?.isSaasAdmin && a.hasPermission('system:ai-provider:view') && !document.hidden
        && currentSessionEpoch() === epoch && JSON.stringify([a.user, currentSessionEpoch()]) === identity;
    }, () => useAuthStore.getState().hasPermission('system:ai-provider:manage'), storage,
    `rental_ai_platform_budget:${JSON.stringify([actor, sceneCode])}`);
  }, [sceneCode, identity]);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot), policy = state.policy;
  useEffect(() => {
    if (!policy) return;
    const settings = policy.settings, limit = settings?.budget, quantity = limit && limit.state !== 'not_configured' ? limit.quantity : null;
    form.setFieldsValue({ state: limit?.state ?? 'not_configured', unit: quantity?.unit ?? 'calls',
      amount: quantity?.unit === 'money' ? quantity.amount : String(quantity?.value ?? 0), currency: quantity?.unit === 'money' ? quantity.currency : '',
      concurrent: String(settings?.maxConcurrent ?? 0), calls: String(settings?.maxCallsPerRun ?? 0),
      allowedModels: settings?.allowedModels.join('\n') ?? '', allowedScenes: settings?.allowedScenes.join('\n') ?? '',
      platformEnabled: settings?.gates.platform.enabled ?? false, tenantEnabled: settings?.gates.tenant.enabled ?? false,
      sceneEnabled: settings?.gates.scene.enabled ?? false, confirmed: false });
  }, [policy, form]);
  const unit = Form.useWatch('unit', form), budgetState = Form.useWatch('state', form), disabled = state.busy || state.locked || !canManage;
  return <section className={styles.stack} aria-label={t('当前平台预算政策')} aria-busy={state.busy}>
    <Alert type={state.feedback === 'saved' || state.feedback === 'recorded' ? 'success' : state.locked ? 'warning' : 'info'} title={t(messages[state.feedback])} />
    <div className={styles.toolbar}><ActionButton variant="secondary" label={t('读取当前平台政策')} successLabel={t('平台政策已读取')} disabled={state.busy} onAction={session.read} />
    {state.locked && <ActionButton label={t('核对原预算保存收据')} successLabel={t('原保存已核对，请重新读取')} disabled={state.busy} onAction={session.reconcile} />}
    </div>
    {!canManage && <p role="status">{t('当前仅可读取平台政策与本人原保存收据，不能发布新政策。')}</p>}
    {policy && <>
      <p>{t('场景')}: <code>{sceneCode}</code>；{t('政策修订')}: {policy.revision ?? t('未配置')}</p>
      <Form form={form} layout="vertical" disabled={disabled} onFinish={session.save}
        onValuesChange={changes => { if (Object.keys(changes).some(key => key !== 'confirmed')) form.setFieldValue('confirmed', false); }}>
        <SettingsWorkspace sections={[
        { key: 'amount', label: t('额度与计量'), content: <FormSection title={t('额度与计量')}>
        <Form.Item name="state" label={t('额度状态')} rules={[{ required: true }]}><Select options={[
          { value: 'not_configured', label: t('未配置（拒绝准入）') }, { value: 'zero', label: t('零额度') }, { value: 'limited', label: t('有限额度') }]} /></Form.Item>
        <Form.Item name="unit" label={t('计量单位')} rules={[{ required: true }]}><Select disabled={disabled || budgetState === 'not_configured'} options={[
          { value: 'calls', label: t('调用次数') }, { value: 'tokens', label: 'Tokens' }, { value: 'money', label: t('金额（六位小数）') }]} /></Form.Item>
        <Form.Item name="amount" label={t('精确额度')} rules={[{ validator: async (_, value) => {
          if (budgetState !== 'not_configured' && (typeof value !== 'string'
            || !(unit === 'money' ? /^(0|[1-9][0-9]{0,17})\.[0-9]{6}$/u : /^(0|[1-9][0-9]*)$/u).test(value)))
            throw Error(t('金额须六位小数，次数或 Token 须整数。'));
        } }]}><Input maxLength={25} disabled={disabled || budgetState === 'not_configured'} /></Form.Item>
        {unit === 'money' && budgetState !== 'not_configured' && <Form.Item name="currency" label={t('币种')}
          rules={[{ required: true, pattern: /^[A-Z]{3}$/u }]}><Input maxLength={3} /></Form.Item>}
        </FormSection> },
        { key: 'limits', label: t('调用限制'), content: <FormSection title={t('调用限制')}>
        <div className={styles.formGrid}>
        <Form.Item name="concurrent" label={t('并发上限（0–10000）')} rules={[{ required: true, pattern: /^(0|[1-9][0-9]{0,3}|10000)$/u }]}><Input inputMode="numeric" maxLength={5} /></Form.Item>
        <Form.Item name="calls" label={t('单次运行调用上限（0–10000）')} rules={[{ required: true, pattern: /^(0|[1-9][0-9]{0,3}|10000)$/u }]}><Input inputMode="numeric" maxLength={5} /></Form.Item>
        </div>
        <Form.Item name="allowedModels" label={t('模型白名单（每行一项，最多100项）')}><Input.TextArea maxLength={25700} rows={3} /></Form.Item>
        <Form.Item name="allowedScenes" label={t('场景白名单（每行一项，最多100项）')}><Input.TextArea maxLength={12900} rows={3} /></Form.Item>
        </FormSection> },
        { key: 'admission', label: t('准入开关'), content: <FormSection title={t('准入开关')}>
        {(['platform', 'tenant', 'scene'] as const).map((name, index) => <Form.Item key={name} name={`${name}Enabled`}
          label={t(['平台门', '租户门', '场景门'][index])} valuePropName="checked"><Switch disabled={disabled || policy.state === 'not_configured'} /></Form.Item>)}
        {policy.state === 'not_configured' && <p className={styles.help}>{t('首次保存保持三门停用；保存后重新读取并明确审阅，不能自动开放调用。')}</p>}
        </FormSection> },
        { key: 'confirmation', label: t('确认保存'), content: <FormSection title={t('确认保存')}>
        <Form.Item name="confirmed" label={t('我已核对本次平台全局政策')} valuePropName="checked"
          rules={[{ validator: async (_, value) => { if (value !== true) throw Error(t('请明确确认本次政策。')); } }]}><Switch /></Form.Item>
        </FormSection> },
        ]} footer={<SaveButton form={form} label={t('保存平台预算政策')} successLabel={t('平台政策已保存')} disabled={disabled} onSave={session.save} />} />
      </Form>
      <p className={styles.help}>{t('更改计量单位或币种不能抹去原占用和债务；不兼容时由原预算仓储拒绝。不修改供应商费率，也不自动重置历史用量。')}</p>
    </>}
  </section>;
}
