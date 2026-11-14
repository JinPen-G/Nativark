/** Human rental-condition candidates, not price/stock/identity facts.
 * Employee identity needs an original authorized company and explicit personal
 * payer; missing values remain for the original scene to clarify. */
import { RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES, type AiSceneQuoteCandidate, type AiSceneQuotePreparationDraft } from '@rental-os/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_ROUTES, canAccessRoute } from '@/app/navigation';
import { currentSessionEpoch } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import { Input, Select, Button, Alert } from '@/components/ui';
import { useAiManagementLocale } from './management-locale';
import { safeDisplayText } from './safe-display';
import styles from './AiManagement.module.css';

export function QuoteCandidateFields({ value, onChange, disabled = false, preparation }: {
  value: AiSceneQuoteCandidate; onChange?: (value: AiSceneQuoteCandidate) => void; disabled?: boolean; preparation?: AiSceneQuotePreparationDraft | null;
}) {
  const { t } = useAiManagementLocale(), locked = disabled || !onChange;
  const employee = value.customerType === 'personal' && value.bookingIdentity?.bookingIdentity === 'enterprise_employee';
  const unboundIdentity = () => value.bookingIdentity?.bookingIdentity === 'enterprise_employee'
    ? { bookingIdentity: 'enterprise_employee' as const } : value.bookingIdentity ? { bookingIdentity: 'personal' as const } : undefined;
  const change = (next: AiSceneQuoteCandidate) => { if (!locked) onChange?.({ ...next, selectionRevision: undefined }); };
  const edit = (key: 'customerName' | 'start' | 'end' | 'locationName' | 'returnLocationName', text: string) => {
    const next = { ...value, [key]: text || undefined };
    // A displayed name cannot retarget an already-resolved object implicitly.
    if (key === 'customerName') { next.customerId = undefined; next.bookingIdentity = unboundIdentity(); next.deliveryAddressId = undefined; }
    if (key === 'locationName') next.locationId = undefined;
    if (key === 'returnLocationName') next.returnLocationId = undefined;
    change(next);
  };
  const items = value.items ?? [];
  const clarifications = preparation && 'clarifications' in preparation ? preparation.clarifications ?? [] : [];
  const choose = (field: string, id: string) => {
    const row = clarifications.find(row => row.field === field), candidate = row?.candidates.find(candidate => candidate.id === id);
    if (locked || !candidate) return;
    const next = structuredClone(value), line = /^items\.(\d+)(?:\.(pricingUnit))?$/u.exec(field);
    if (field === 'customerId') {
      if (next.customerId !== id) next.bookingIdentity = unboundIdentity();
      next.customerId = id; next.customerName = candidate.label; next.deliveryAddressId = undefined;
    }
    else if (field === 'location') { next.locationId = id; next.locationName = candidate.label; }
    else if (field === 'returnLocation') { next.returnLocationId = id; next.returnLocationName = candidate.label; }
    else if (field === 'fulfillmentMode' && RENTAL_FULFILLMENT_MODES.includes(id as NonNullable<AiSceneQuoteCandidate['fulfillmentMode']>)) {
      next.fulfillmentMode = id as NonNullable<AiSceneQuoteCandidate['fulfillmentMode']>; next.deliveryAddressId = undefined;
    } else if (field === 'deliveryAddressId') next.deliveryAddressId = id;
    else if (field === 'bookingIdentity.corporateCustomerId' && employee) {
      // A different employer cannot inherit a previously chosen payer.
      next.bookingIdentity = { bookingIdentity: 'enterprise_employee', corporateCustomerId: id };
    } else if (field === 'bookingIdentity.enterpriseContractAndPayer' && employee
      && next.bookingIdentity?.bookingIdentity === 'enterprise_employee') {
      if (id !== 'personal_payer') return; next.bookingIdentity.enterpriseContractAndPayer = false;
    } else if (field === 'items') next.items = [{ productName: candidate.label, itemGroupId: id, quantity: 1 }];
    else if (line && next.items?.[Number(line[1])]) {
      const item = next.items[Number(line[1])];
      if (line[2]) { if (!RENTAL_PRICING_UNIT_CODES.includes(id as NonNullable<typeof item.pricingUnit>)) return; item.pricingUnit = id as NonNullable<typeof item.pricingUnit>; item.usageQuantity = undefined; }
      else { item.itemGroupId = id; item.productName = candidate.label; item.pricingUnit = undefined; item.usageQuantity = undefined; }
    } else return;
    change(next);
  };
  const choiceLabel = (field: string) => ({ customerId: '选择客户', location: '选择领取地点', returnLocation: '选择归还地点',
    fulfillmentMode: '选择履约方式', deliveryAddressId: '选择配送地址', items: '选择商品',
    'bookingIdentity.corporateCustomerId': '选择当前受权企业', 'bookingIdentity.enterpriseContractAndPayer': '选择签约与付款方' }[field]
    ?? (/^items\.\d+\.pricingUnit$/u.test(field) ? '选择计价单位' : /^items\.\d+$/u.test(field) ? '选择商品' : null));
  return <div className={styles.section} aria-label={t('租赁条件')}>
    <label>{t('客户类型')}<Select value={value.customerType} disabled={locked}
      options={[{ value: 'personal', label: t('个人客户') }, { value: 'corporate', label: t('企业客户') }]}
      onChange={next => change({ ...value, customerType: next as AiSceneQuoteCandidate['customerType'], customerId: undefined,
        customerName: undefined, bookingIdentity: undefined, deliveryAddressId: undefined })} /></label>
    <label>{t('客户名称')}<Input value={value.customerName ?? ''} maxLength={191} disabled={locked}
      onChange={event => edit('customerName', event.currentTarget.value)} /></label>
    {value.customerType === 'personal' && <label>{t('预约身份')}<Select value={value.bookingIdentity?.bookingIdentity}
      placeholder={t('预约身份')} disabled={locked}
      options={[{ value: 'personal', label: t('个人') }, { value: 'enterprise_employee', label: t('企业员工') }]}
      onChange={identity => {
        if (!['personal', 'enterprise_employee'].includes(String(identity))) return;
        change({ ...value, customerType: 'personal', bookingIdentity: identity === 'personal'
          ? { bookingIdentity: 'personal' } : { bookingIdentity: 'enterprise_employee' } });
      }} /></label>}
    {employee && value.bookingIdentity?.bookingIdentity === 'enterprise_employee' && <>
      <QuoteEmployeeBoundary disabled={locked} />
      {value.bookingIdentity.corporateCustomerId && <span>{t('企业编号')}: {safeDisplayText(value.bookingIdentity.corporateCustomerId, 191)}</span>}
      {value.bookingIdentity.enterpriseContractAndPayer === false && <span>{t('选择签约与付款方')}: {t('个人')}</span>}
    </>}
    {items.map((item, index) => <div key={index} className={styles.toolbar}>
      <label>{t('商品名称')}<Input value={item.productName ?? ''} maxLength={191} disabled={locked} onChange={event =>
        change({ ...value, items: items.map((row, i) => i === index ? { ...row, productName: event.currentTarget.value || undefined,
          itemGroupId: undefined, pricingUnit: undefined, usageQuantity: undefined } : row) })} /></label>
      <label>{t('数量')}<Input type="number" value={item.quantity} min={1} max={10000} step={1} disabled={locked} onChange={event =>
        change({ ...value, items: items.map((row, i) => i === index ? { ...row, quantity: Number(event.currentTarget.value) } : row) })} /></label>
      {item.pricingUnit && <><span>{t('计价单位')}: {t(item.pricingUnit)}</span><Button disabled={locked} onClick={() => change({ ...value,
        items: items.map((row, i) => i === index ? { ...row, pricingUnit: undefined, usageQuantity: undefined } : row) })}>{t('重新选择计价单位')}</Button></>}
      {item.pricingUnit === 'usage' && <label>{t('使用量')}<Input type="number" value={item.usageQuantity ?? ''} min={0} max={1000000} disabled={locked}
        onChange={event => change({ ...value, items: items.map((row, i) => i === index ? { ...row,
          usageQuantity: event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value) } : row) })} /></label>}
      <Button disabled={locked} onClick={() => change({ ...value, items: items.length > 1 ? items.filter((_, i) => i !== index) : undefined })}>{t('移除商品')}</Button>
    </div>)}
    <Button disabled={locked || items.length >= 50} onClick={() => change({ ...value, items: [...items, { quantity: 1 }] })}>{t('添加商品')}</Button>
    {(['start', 'end', 'locationName', 'returnLocationName'] as const).map((key, index) => <label key={key}>
      {t(['开始时间', '结束时间', '领取地点', '归还地点'][index])}<Input value={value[key] ?? ''}
        maxLength={key === 'start' || key === 'end' ? 80 : 191} disabled={locked} onChange={event => edit(key, event.currentTarget.value)} />
    </label>)}
    {clarifications.map(row => {
      if (row.field.startsWith('bookingIdentity.') && !employee) return null;
      const candidates = row.field === 'bookingIdentity.enterpriseContractAndPayer'
        ? row.candidates.filter(candidate => candidate.id === 'personal_payer') : row.candidates;
      const label = choiceLabel(row.field); return label && candidates.length > 0 ? <label key={row.field}>
      {t(label)}<Select disabled={locked} placeholder={t(label)} options={candidates.map(candidate => ({ value: candidate.id,
        label: `${t(candidate.label)}${candidate.phoneMasked ? ` · ${candidate.phoneMasked}` : ''}` }))}
        onChange={id => choose(row.field, String(id))} />{row.truncated && <span>{t('候选仅覆盖当前读取范围。')}</span>}
    </label> : null; })}
    {preparation && 'selectionRevision' in preparation && typeof preparation.selectionRevision === 'string'
      && 'missingFields' in preparation && preparation.missingFields?.includes('selectionRevision') && <Button disabled={locked}
        onClick={() => { if (!locked) onChange?.({ ...value, selectionRevision: preparation.selectionRevision }); }}>{t('确认当前候选选择')}</Button>}
    <p>{t('这些是待核对条件。缺项和歧义由原场景澄清，身份、可租性与金额以 Core 为准。')}</p>
  </div>;
}

/** The original operator Core refuses delegated employee notice/payer claims.
 * This entry only opens the registered manual form under its own route gate;
 * that form retains the same Core restriction and cannot replace self consent. */
function QuoteEmployeeBoundary({ disabled }: { disabled: boolean }) {
  useAuthStore();
  const { t, locale } = useAiManagementLocale(), navigate = useNavigate();
  const binding = () => { const auth = useAuthStore.getState(); return JSON.stringify([
    auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user, auth.token, currentSessionEpoch()]); };
  const [origin] = useState(binding);
  const permitted = () => {
    const auth = useAuthStore.getState();
    return !disabled && !document.hidden && binding() === origin && !!auth.token && !!auth.sessionVerified
      && !!auth.tenant?.tenantId && !!auth.currentWorkspaceId && !!auth.user
      && canAccessRoute(APP_ROUTES.orderCreate, auth.hasPermission, auth.hasCapability,
        auth.tenant.categoryCode, Boolean(auth.user.isSaasAdmin), auth.hasTenantMembershipPermission);
  };
  return <>
    <Alert type="warning" title={locale === 'en-US' ? 'Employee quotation is blocked by the original authorization gate.' : '企业员工报价受原授权限制。'}
      description={locale === 'en-US'
        ? 'Merchant delegation is not verified. The operator cannot confirm notice or payment authority for the employee. Company payment and credit remain unavailable. The original manual form keeps the same restriction; you may explicitly switch to personal booking.'
        : '商户代客企业委托接点尚未核验，不能代使用人声明告知或企业付费授权。企业签约付款及授信未开放。原人工建单仍受相同限制；也可明确切回个人身份。'} />
    {permitted() && <Button onClick={() => { if (permitted()) navigate(APP_ROUTES.orderCreate.path); }}>
      {t('新建订单')}
    </Button>}
  </>;
}
