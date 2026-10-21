/** Human budget management over the original C07 API. No local enable switch,
 * inferred quotas, automatic model probe or financial admission. */
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { type AiBudgetSettingsReadDraft } from '@rental-os/shared';
import { aiBudgetSettingsApi } from '@/api/aiBudgetSettings';
import { currentSessionEpoch } from '@/app/queryClient';
import { useLocale } from '@/app/locale';
import { useAuthStore } from '@/features/auth/authStore';
import { ActionButton, Alert, ConfirmAction, Form, Input, SaveButton, Select, Switch } from '@/components/ui';
import { BudgetSettingsSession, type BudgetForm } from './budget-settings-session';
import { safeDisplayText } from './safe-display';

const messages = { idle: '预算读取与模型执行相互独立；不会自动测试或调用模型。',
  saved: '预算政策已保存；不代表平台、租户、场景交集已放行，也不代表模型可执行。',
  changed: '保存已确认，但政策随后发生变化；请重新读取，不能沿用旧修订。',
  unknown: '原保存结果待核对，已禁止再次保存。只能读取同一政策现状；现状不是原操作收据，需管理员核对原修订。',
  conflict: '政策修订已变化，请重新读取后审阅；未覆盖其他人的修改。',
  denied: '当前无权管理预算，已清除旧政策。', unavailable: '预算或依赖当前不可用，未视为零额度或不限额。',
  invalid: '请检查额度、单位、六位小数币种和整数上限。' };
export function TenantBudgetSettings({ identity }: { identity: string }) {
  const { t } = useLocale(), label = useId();
  const [scope, setScope] = useState<'tenant' | 'workspace'>('workspace'), [scene, setScene] = useState('');
  const [selector, setSelector] = useState<AiBudgetSettingsReadDraft | null>(null), [invalid, setInvalid] = useState(false);
  return <section aria-label={t('AI 预算与调用上限')}>
    <h3>{t('AI 预算与调用上限')}</h3>
    <p>{t('按正式场景编号选择当前租户或当前空间政策。编号不是授权；模型和场景白名单仍由服务器决定。未配置、零额度和停用都不会放行。')}</p>
    <div className="panel-toolbar">
      <label htmlFor={`${label}-scope`}>{t('政策范围')}</label>
      <Select id={`${label}-scope`} value={scope} options={[{ value: 'workspace', label: t('当前经营空间') }, { value: 'tenant', label: t('当前租户') }]}
        onChange={value => { setScope(value as 'tenant' | 'workspace'); setSelector(null); }} />
      <label htmlFor={`${label}-scene`}>{t('正式场景编号')}</label>
      <Input id={`${label}-scene`} maxLength={128} value={scene} placeholder="order_explanation"
        onChange={event => { setScene(event.currentTarget.value); setSelector(null); }} aria-describedby={`${label}-error`} />
      <ActionButton label={t('选择预算对象')} successLabel={t('对象已选，请读取')} onAction={async () => {
        const valid = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(scene); setInvalid(!valid);
        if (!valid) throw Error('AI_INVALID_INPUT'); setSelector({ scope, sceneCode: scene });
      }} />
    </div>
    {invalid && <p id={`${label}-error`} role="alert">{t('请输入有效的正式场景编号。')}</p>}
    {selector && <BudgetEditor key={`${identity}:${selector.scope}:${selector.sceneCode}`} identity={identity} selector={selector} />}
  </section>;
}
function BudgetEditor({ identity, selector }: { identity: string; selector: AiBudgetSettingsReadDraft }) {
  const { t } = useLocale(), [form] = Form.useForm<BudgetForm>();
  const session = useMemo(() => {
    const epoch = currentSessionEpoch(); let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* read-only without durable unknown lock */ }
    return new BudgetSettingsSession(selector, aiBudgetSettingsApi, () => {
      const a = useAuthStore.getState();
      return !!a.token && !a.user?.isSaasAdmin && a.hasPermission('system:params:manage') && !document.hidden
        && currentSessionEpoch() === epoch && JSON.stringify([a.tenant?.tenantId, a.currentWorkspaceId, a.user]) === identity;
    }, storage, `ai-budget-policy:${identity}:${selector.scope}:${selector.sceneCode}`);
  }, [identity, selector.scope, selector.sceneCode]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot), policy = state.policy;
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useEffect(() => {
    if (!policy) return;
    const settings = policy.settings, budget = settings?.budget, quantity = budget && budget.state !== 'not_configured' ? budget.quantity : null;
    form.setFieldsValue({ state: budget?.state ?? 'not_configured', unit: quantity?.unit ?? 'calls',
      amount: quantity?.unit === 'money' ? quantity.amount : String(quantity?.value ?? 0), currency: quantity?.unit === 'money' ? quantity.currency : '',
      concurrent: String(settings?.maxConcurrent ?? 0), calls: String(settings?.maxCallsPerRun ?? 0),
      enabled: settings?.gates[selector.scope === 'tenant' ? 'tenant' : 'scene'].enabled ?? false });
  }, [policy, form, selector.scope]);
  const budgetState = Form.useWatch('state', form), unit = Form.useWatch('unit', form);
  return <section aria-label={t('当前预算政策')} aria-busy={state.busy}>
    <Alert type={state.feedback === 'saved' ? 'success' : state.locked ? 'warning' : 'info'} title={t(messages[state.feedback])} />
    <ActionButton label={t('读取同一政策现状')} successLabel={t('现状已读取')} disabled={state.busy} onAction={session.read} />
    {policy && <>
      <p>{t('场景')}: {safeDisplayText(policy.sceneCode, 128)}；{t('修订')}: {policy.revision ?? t('未配置')}</p>
      {policy.state === 'configured' && <>
        <p>{t('平台 / 租户 / 场景门')}: {Object.values(policy.settings.gates).map(g => t(g.enabled ? '启用' : '停用')).join(' / ')}</p>
        <p>{t('允许场景')}: {safeDisplayText(policy.settings.allowedScenes.join(', '), 4000)}</p>
        <p>{t('模型政策')}: {policy.modelPolicy.mode === 'platform_managed' ? t('Rental OS AI，由平台管理') : safeDisplayText(policy.modelPolicy.allowedModels.join(', '), 4000)}</p>
      </>}
      <Form form={form} layout="vertical" disabled={state.busy || state.locked} onFinish={session.save}>
        <Form.Item name="state" label={t('额度状态')} rules={[{ required: true }]}>
          <Select options={[{ value: 'not_configured', label: t('未配置（拒绝准入）') }, { value: 'zero', label: t('零额度') }, { value: 'limited', label: t('有限额度') }]} />
        </Form.Item>
        <Form.Item name="unit" label={t('计量单位')} rules={[{ required: true }]}>
          <Select disabled={state.busy || state.locked || budgetState === 'not_configured'} options={[{ value: 'calls', label: t('调用次数') }, { value: 'tokens', label: 'Tokens' }, { value: 'money', label: t('金额（六位小数）') }]} />
        </Form.Item>
        <Form.Item name="amount" label={t('额度')} rules={[{ validator: async (_, value) => {
          if (budgetState === 'not_configured') return;
          if (typeof value !== 'string' || !(unit === 'money' ? /^(0|[1-9][0-9]{0,17})\.[0-9]{6}$/u : /^(0|[1-9][0-9]*)$/u).test(value)) throw Error(t('请填写精确额度；金额须六位小数，次数须整数。'));
        } }]}>
          <Input maxLength={25} disabled={state.busy || state.locked || budgetState === 'not_configured'} />
        </Form.Item>
        {unit === 'money' && budgetState !== 'not_configured' && <Form.Item name="currency" label={t('币种')} rules={[{ required: true, pattern: /^[A-Z]{3}$/u, message: t('填写明确的三位大写币种，不自动换汇。') }]}><Input maxLength={3} /></Form.Item>}
        <Form.Item name="concurrent" label={t('并发上限（0–10000）')} rules={[{ required: true, pattern: /^(0|[1-9][0-9]{0,3}|10000)$/u }]}><Input inputMode="numeric" maxLength={5} /></Form.Item>
        <Form.Item name="calls" label={t('单次运行调用上限（0–10000）')} rules={[{ required: true, pattern: /^(0|[1-9][0-9]{0,3}|10000)$/u }]}><Input inputMode="numeric" maxLength={5} /></Form.Item>
        <Form.Item name="enabled" label={t('本层政策门')} valuePropName="checked"><Switch disabled={state.busy || state.locked || policy.state === 'not_configured'} /></Form.Item>
        {policy.state === 'not_configured' && <p>{t('首次初始化保持停用；服务器依赖未齐备时会拒绝，不创建默认无限政策。')}</p>}
        <SaveButton form={form} label={t(policy.state === 'not_configured' ? '保存停用的初始预算' : '保存预算政策')}
          disabled={state.busy || state.locked} onSave={session.save} />
      </Form>
      {policy.state === 'configured' && <ConfirmAction label={t('重新绑定当前模型配置并停用')}
        prompt={t('保留原额度与历史占用，改为服务器当前配置，并关闭本层执行门？不代表旧债务已结清。')}
        doneLabel={t('重绑定已确认')} disabled={state.busy || state.locked} onConfirm={session.refresh} />}
    </>}
  </section>;
}
