/** Shared reviewed-rate editor over the original platform/BYOK services.
 * Configuration, capability, counting and dispatch stay server decisions. */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { aiBudgetSettingsApi } from '@/api/aiBudgetSettings';
import { currentSessionEpoch } from '@/app/queryClient';
import { useLocale } from '@/app/locale';
import { ActionButton, Alert, Form, Input, SaveButton, Select, Switch } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { PlatformPriceReviewSession, type PlatformPriceForm } from './platform-price-review-session';
import { safeDisplayText } from './safe-display';

const identityKey = () => JSON.stringify([useAuthStore.getState().user, currentSessionEpoch()]);
const tenantIdentity = () => { const a = useAuthStore.getState(); return JSON.stringify([a.tenant?.tenantId, a.currentWorkspaceId, a.user]); };
const messages = { idle: '仅登记管理员核对的预算费率，不是供应商账单或计数证明，也不会启用模型。',
  recorded: '原费率审阅已记录。以下是原版本，不证明当前配置仍相同；计数、预算与派发仍独立校验。',
  unknown: '原审阅待核对。禁止换编号或版本重发；核对原收据不会再次发布费率。',
  denied: '当前权限或身份已变化，已清除旧费率。原操作可能已经保存，只能在重新授权后核对原收据。',
  invalid: '请明确场景、费率版本、带时区的有效期和六位小数费率，并确认已核对。',
  conflict: '配置修订或费率版本冲突，没有覆盖旧费率；请重新读取配置并审阅。',
  unavailable: '当前配置、计价管理依赖或本地原键存储不可用，未发布新的费率。' };
export function PlatformPriceReview({ profileId, identity, profile, blocked, audience = 'platform' }: {
  profileId: string; identity: string; profile: { profileId: string; revision: number } | null; blocked: boolean; audience?: 'platform' | 'tenant';
}) {
  const { t } = useLocale(), [form] = Form.useForm<PlatformPriceForm>();
  const currentProfile = useRef({ profile, blocked }); currentProfile.current = { profile, blocked };
  const managePermission = audience === 'platform' ? 'system:ai-provider:manage' : 'system:params:manage';
  const canManage = useAuthStore(s => s.hasPermission(managePermission));
  const session = useMemo(() => {
    const epoch = currentSessionEpoch();
    let storage: Storage | undefined; try { storage = window.sessionStorage; } catch { /* no safe unknown recovery */ }
    const ports = audience === 'platform' ? aiBudgetSettingsApi : {
      platformReviewPrice: aiBudgetSettingsApi.reviewPrice, platformPriceReviewReceipt: aiBudgetSettingsApi.readPriceReview };
    return new PlatformPriceReviewSession(profileId, ports, () => {
      const a = useAuthStore.getState();
      return currentSessionEpoch() === epoch && !!a.token && !document.hidden && (audience === 'platform'
        ? identityKey() === identity && !!a.user?.isSaasAdmin && a.hasPermission('system:ai-provider:view')
        : tenantIdentity() === identity && !a.user?.isSaasAdmin && !!a.tenant?.tenantId && !!a.currentWorkspaceId
          && !!a.user?.id && a.hasPermission('system:params:manage'));
    }, () => useAuthStore.getState().hasPermission(managePermission), () => {
      const current = currentProfile.current;
      return current.blocked || !current.profile ? null : { profileId: current.profile.profileId, revision: current.profile.revision };
    }, storage, audience === 'platform' ? `rental_platform_ai_rate:${JSON.stringify([useAuthStore.getState().user?.id, profileId])}`
      : `rental_tenant_ai_rate:${JSON.stringify([useAuthStore.getState().tenant?.tenantId, useAuthStore.getState().currentWorkspaceId,
          useAuthStore.getState().user?.id])}`, () => globalThis.crypto.randomUUID(), audience);
  }, [profileId, identity, audience, managePermission]);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useEffect(() => { if (blocked) session.clearObservation(); }, [session, blocked]);
  useEffect(() => { form.setFieldValue('confirmReviewedRate', false); }, [form, profile?.profileId, profile?.revision]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const unit = Form.useWatch('unit', form), cache = Form.useWatch('includeCache', form);
  const disabled = blocked || state.busy || state.locked || !canManage || !profile;
  const result = state.result;
  const title = audience === 'platform' ? t('平台预算费率审阅') : t('BYOK 预算费率审阅');
  return <section aria-label={title} aria-busy={state.busy}>
    <h3>{title}</h3>
    <Alert type={state.feedback === 'recorded' ? 'success' : state.locked || state.feedback === 'denied' ? 'warning' : 'info'} title={t(messages[state.feedback])} />
    <p>{t('新审阅绑定已读取的配置修订')}: {profile?.revision ?? t('尚未读取')}。{t('此入口不查询供应商，不重算业务金额；非服务器指定的计价 Profile 会被拒绝。')}</p>
    {state.pending && <><p role="status">{t('原场景')}: {safeDisplayText(state.pending.sceneCode, 128)}；{t('原操作编号')}: <code>{state.pending.operationKey}</code></p>
      <ActionButton label={t('核对原费率收据')} successLabel={t('原费率已核对')} disabled={state.busy} onAction={session.reconcile} /></>}
    {state.locked && !state.pending && <p role="status">{t('本地原引用不可用，已禁止发布；请由管理员核对，不能用清缓存或新版本冒充恢复。')}</p>}
    <Form form={form} layout="vertical" disabled={disabled} onFinish={session.save}
      onValuesChange={changes => { if (Object.keys(changes).some(key => key !== 'confirmReviewedRate')) form.setFieldValue('confirmReviewedRate', false); }}
      initialValues={{ unit: 'money', includeCache: false, confirmReviewedRate: false }}>
      <Form.Item name="sceneCode" label={t('正式场景编号')} rules={[{ required: true, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u }]}><Input maxLength={128} /></Form.Item>
      <Form.Item name="priceVersion" label={t('不可变费率版本')} rules={[{ required: true, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u }]}><Input maxLength={64} /></Form.Item>
      <Form.Item name="validFrom" label={t('生效时间（ISO 8601，必须含时区）')} rules={[{ required: true }]}><Input maxLength={64} placeholder="YYYY-MM-DDTHH:mm:ss+09:00" /></Form.Item>
      <Form.Item name="expiresAt" label={t('失效时间（ISO 8601，必须含时区）')} rules={[{ required: true }]}><Input maxLength={64} placeholder="YYYY-MM-DDTHH:mm:ss+09:00" /></Form.Item>
      <Form.Item name="unit" label={t('计量方式')} rules={[{ required: true }]}><Select options={[
        { value: 'money', label: t('明确币种的金额费率') }, { value: 'tokens', label: t('Token 原量计量（不换算金额）') }]} /></Form.Item>
      {unit === 'money' && <>
        <Form.Item name="currency" label={t('币种')} rules={[{ required: true, pattern: /^[A-Z]{3}$/u }]}><Input maxLength={3} /></Form.Item>
        {(['inputPerMillion', 'outputPerMillion'] as const).map((name, i) => <Form.Item key={name} name={name}
          label={t(i === 0 ? '每百万输入 Token 费率（六位小数）' : '每百万输出 Token 费率（六位小数）')}
          rules={[{ required: true, pattern: /^(0|[1-9][0-9]{0,17})\.[0-9]{6}$/u }]}><Input maxLength={25} /></Form.Item>)}
        <Form.Item name="includeCache" label={t('已核实独立缓存读写费率')} valuePropName="checked"><Switch /></Form.Item>
        {cache && (['readPerMillion', 'writePerMillion'] as const).map((name, i) => <Form.Item key={name} name={name}
          label={t(i === 0 ? '每百万缓存读取 Token 费率（六位小数）' : '每百万缓存写入 Token 费率（六位小数）')}
          rules={[{ required: true, pattern: /^(0|[1-9][0-9]{0,17})\.[0-9]{6}$/u }]}><Input maxLength={25} /></Form.Item>)}
        <p>{t('未提供缓存费率不代表免费；实际用量含未定义计费维度时仍待核对，不猜折扣或汇率。')}</p>
      </>}
      <Form.Item name="confirmReviewedRate" label={t('我已核对本次配置、版本、有效期与费率')} valuePropName="checked"
        rules={[{ validator: async (_, value) => { if (value !== true) throw Error(t('须由管理员明确确认费率。')); } }]}><Switch /></Form.Item>
      <SaveButton form={form} disabled={disabled} label={t('登记已审阅费率')} successLabel={t('费率审阅已记录')} onSave={session.save} />
    </Form>
    {result && <section aria-label={t('原费率审阅收据')}>
      <p>{t('费率引用')}: <code>{result.id}</code></p>
      <p>{t('版本')}: {safeDisplayText(result.priceVersion, 64)}；{t('原配置修订')}: {result.configRevision}</p>
      <p>{t('原有效期')}: {safeDisplayText(result.validFrom, 64)} — {safeDisplayText(result.expiresAt, 64)}</p>
      {result.billing.unit === 'money' ? <>
        <p>{t('币种')}: {result.billing.currency}；{t('每百万输入 / 输出')}: {result.billing.inputPerMillion} / {result.billing.outputPerMillion}</p>
        {result.billing.inputCache && <p>{t('每百万缓存读取 / 写入')}: {result.billing.inputCache.readPerMillion} / {result.billing.inputCache.writePerMillion}</p>}
      </> : <p>{t('输入与输出 Token 原量合计，无金额换算。')}</p>}
      <p>{t('未授予执行权限；不是供应商账单、能力验证或输入计数证明。')}</p>
    </section>}
  </section>;
}
