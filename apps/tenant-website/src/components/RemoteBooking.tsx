import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader as LoadingOutlined } from './SiteIcon';
import { useSite } from '../SiteContext';
import { useAuth } from '../AuthContext';
import { useToast } from './Toast';
import { captureEnterpriseHostSession, sessionApi } from '../data/authClient';
import { useEnterpriseOrderSubmission } from './useEnterpriseOrderSubmission';
import { rentalDays } from '../data/siteRepository';
import { toIsoDateTime } from '../data/datetime';
import type { Product } from '../types';
import type { AiBookingHandoff, AiBookingSelection, AiClientQuoteFacts, ClientCreateQuoteRequest, EnterpriseOwnRentalPolicy, RentalFulfillmentMode, RentalQuoteSnapshotV1 } from "@rental-os/shared";
import { formatRentalMoney } from "@rental-os/shared";
import { EnterpriseBookingApproval } from "./EnterpriseBookingApproval";
import { readOriginalBookingQuote, originalBookingUnitLabel, type OriginalBookingQuoteFacts } from '../features/ai-native/booking-handoff';
import { ClientQuotePreparation } from '../features/ai-native/ClientQuotePreparation';
import { clientQuoteStorageKey } from '../features/ai-native/client-quote-session';

/** 真实租户 + 已登录：走后端 可用性 → 报价 → 下单。金额与库存全部以服务端为准。 */
interface RemoteBookingProps {
  product: Product; startDate: string; endDate: string; quantity: number; fulfillment: 'pickup' | 'delivery'; preferredLocationId?: string;
  handoff?: AiBookingHandoff;
  originalFacts?: OriginalBookingQuoteFacts | null;
}

export function RemoteBooking(props: RemoteBookingProps) {
  // Never mount the automatic quote/create-order lifecycle for an original handoff.
  return props.handoff ? <OriginalHandoffBooking handoff={props.handoff} suppliedFacts={props.originalFacts} /> : <ManualRemoteBooking {...props} />;
}

export function OriginalHandoffBooking({ handoff, suppliedFacts }: { handoff: AiBookingHandoff; suppliedFacts?: OriginalBookingQuoteFacts | null }) {
  const { language } = useSite();
  const { session, currentWorkspace } = useAuth();
  const quoteOwner = useMemo(() => ({}), [handoff, session, currentWorkspace?.workspaceCode]);
  const [quoteRead, setQuoteRead] = useState<{ owner: object; facts: OriginalBookingQuoteFacts | null } | null>(null);
  const originalQuote = suppliedFacts ?? (quoteRead?.owner === quoteOwner ? quoteRead.facts : null);
  useEffect(() => {
    let disposed = false;
    setQuoteRead(null);
    if (suppliedFacts !== undefined) return;
    // Read only after the user's explicit continue. Never create/recalculate a quote.
    const current = captureEnterpriseHostSession();
    void readOriginalBookingQuote(handoff, session?.customer.customerId, sessionApi.getQuote, Date.now, sessionApi.enterpriseRentalPolicies).then(quote => {
      if (disposed || !current?.current()) return;
      setQuoteRead({ owner: quoteOwner, facts: quote });
    }).catch(() => { if (!disposed) setQuoteRead(null); });
    return () => { disposed = true; };
  }, [handoff, session, quoteOwner, suppliedFacts]);
  const en = language === 'en';
  return <section className="booking-card booking-total">
    <h2>{en ? 'Original booking material' : '原预约材料'}</h2>
    <p style={{ overflowWrap: 'anywhere' }}>{en ? 'Quote reference' : '报价引用'}：{handoff.fields.quoteId}</p>
    {originalQuote ? <dl>
      <dt>{en ? 'Original payable' : '原应付'}</dt><dd>{originalQuote.payableAmount} {originalQuote.currency}</dd>
      <dt>{en ? 'Deposit' : '押金'}</dt><dd>{originalQuote.depositAmount} {originalQuote.currency}</dd>
      <dt>{en ? 'Preauthorization' : '预授权'}</dt><dd>{originalQuote.preAuthAmount} {originalQuote.currency}</dd>
      <dt>{en ? 'Original rules / pricing version' : '原规则 / 计价版本'}</dt><dd>{originalQuote.ruleVersion} / {originalQuote.pricingPlanVersion}</dd>
    </dl> : <p>{en ? 'Original amounts are not loaded or unavailable; no recalculation.' : '原金额未加载或不可用，不重算、不覆盖原报价。'}</p>}
    {originalQuote && <><ul>{originalQuote.lines.map((line, index) => <li key={`${index}:${line.itemGroupId}`}>
      {line.itemName ?? line.itemGroupId} · {line.quantity} · {originalBookingUnitLabel(line.pricingUnit, en)}
      {line.usageQuantity !== null && <> · {en ? 'Usage' : '使用量'}：{line.usageQuantity}</>}</li>)}</ul>
      {originalQuote.enterprise && <p>{originalQuote.enterprise.corporateName} · {originalQuote.enterprise.enterpriseContractAndPayer ? (en ? 'Enterprise contract and payment' : '企业签约付款') : (en ? 'Personal payment' : '个人签约付款')}</p>}</>}
    <p>{en ? 'Not submitted / not reserved' : '尚未提交 / 资源未预占'}</p>
    <p role="status">{en ? 'Use the explicit acceptance and submission controls above when the server host provides them. No new quote is created here.' : '宿主提供正式能力时，使用上方受理与明确提交入口；这里不创建新报价。'}</p>
  </section>;
}

function ManualRemoteBooking({ product, startDate, endDate, quantity, fulfillment, preferredLocationId }: RemoteBookingProps) {
  const { href, t, language } = useSite();
  const { currentWorkspace, switchWorkspace } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [locationId, setLocationId] = useState<string | null>(null);
  const [enabledModes, setEnabledModes] = useState<string[]>([]);
  const [addresses, setAddresses] = useState<any[]>([]);
  const [addressId, setAddressId] = useState<string>('');
  const [coupons, setCoupons] = useState<any[]>([]);
  const [couponId, setCouponId] = useState<string>('');
  const [ready, setReady] = useState(false);
  const [quote, setQuote] = useState<RentalQuoteSnapshotV1 | null>(null);
  const [policies, setPolicies] = useState<EnterpriseOwnRentalPolicy[]>([]), [policyError, setPolicyError] = useState('');
  const [enterprise, setEnterprise] = useState(''), [paymentMode, setPaymentMode] = useState('personal'), [noticeAccepted, setNoticeAccepted] = useState(false);
  const policy = policies.find(row => row.corporateCustomerId === enterprise);
  const quoteVersion = useRef(0), host = captureEnterpriseHostSession();
  const hostIdentity = host?.identity;
  const quoteModeRef = useRef(false), [quoteMode, setQuoteMode] = useState(false);
  const personalScope = host && { tenantCode: host.tenantCode, serviceCode: host.workspaceCode, customerId: host.customerId,
    surface: 'tenant_website' as const };
  const identity = JSON.stringify([hostIdentity, enterprise, paymentMode]);
  const enterpriseOrder = useEnterpriseOrderSubmission(id => navigate(href(`/orders/${encodeURIComponent(id)}`)));
  useEffect(() => { let cancelled = false; setPolicies([]); setPolicyError(''); setEnterprise(''); setPaymentMode('personal'); setNoticeAccepted(false); setQuote(null); quoteVersion.current++;
    void sessionApi.enterpriseRentalPolicies().then(rows => { if (!cancelled) setPolicies(rows); }).catch(e => { if (!cancelled) setPolicyError(e instanceof Error ? e.message : '企业身份不可用'); });
    return () => { cancelled = true; quoteVersion.current++; };
  }, [hostIdentity]);
  useEffect(() => {
    let retained = false;
    try { retained = Boolean(personalScope && localStorage.getItem(clientQuoteStorageKey(personalScope)) !== null); }
    catch { retained = quoteModeRef.current; }
    quoteModeRef.current = retained; setQuoteMode(retained);
    return () => { quoteVersion.current++; };
  }, [hostIdentity]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const days = rentalDays(startDate, endDate);

  // 确保会话切到该商品所属经营空间，再取该空间的履约地点、本人地址簿与可用优惠券。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setReady(false); setError(''); setQuote(null);
      try {
        if (!currentWorkspace || currentWorkspace.workspaceCode !== product.categoryId) {
          await switchWorkspace(product.categoryId);
        }
        const [cat, addressRes, couponRes] = await Promise.all([
          sessionApi.catalog(),
          sessionApi.addresses().catch(() => ({ items: [] })),
          sessionApi.coupons().catch(() => []),
        ]);
        if (cancelled) return;
        // 优先用首页搜索选定的取货门店（若该门店在本空间履约地点内），否则取第一个。
        const locs = (cat.locations || []) as Array<{ id: string }>;
        const preferred = preferredLocationId && locs.some(loc => loc.id === preferredLocationId) ? preferredLocationId : null;
        setLocationId(preferred ?? locs[0]?.id ?? null);
        setEnabledModes(cat.fulfillment?.enabledModes ?? []);
        const list = ((addressRes as any).items as any[]) ?? [];
        setAddresses(list);
        setAddressId(list.find((a) => a.isDefault)?.id ?? list[0]?.id ?? '');
        setCoupons(Array.isArray(couponRes) ? couponRes : ((couponRes as any).items ?? []));
        setReady(true);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || t('loadFailed'));
      }
    })();
    return () => { cancelled = true; };
  }, [product.categoryId, preferredLocationId]);

  const fulfillmentMode = useMemo(() => {
    if (fulfillment === 'delivery' && enabledModes.includes('delivery')) return 'delivery';
    return enabledModes.find(m => m.endsWith('pickup_return')) || enabledModes[0] || 'store_pickup_return';
  }, [fulfillment, enabledModes]);
  const isDelivery = fulfillmentMode === 'delivery';
  const personalSelection = useMemo<ClientCreateQuoteRequest | null>(() => {
    if (!ready || enterprise || !locationId || days < 1 || currentWorkspace?.workspaceCode !== product.categoryId || (isDelivery && !addressId)) return null;
    try { return { bookingIdentity: { bookingIdentity: 'personal' }, fulfillmentMode: fulfillmentMode as RentalFulfillmentMode,
      fulfillmentLocationId: locationId, startAt: toIsoDateTime(startDate), endAt: toIsoDateTime(endDate),
      lines: [{ itemGroupId: product.id, quantity }], ...(isDelivery ? { deliveryAddressId: addressId } : {}),
      ...(couponId ? { customerCouponId: couponId } : {}) }; } catch { return null; }
  }, [ready, enterprise, locationId, days, currentWorkspace?.workspaceCode, product.categoryId, product.id,
    isDelivery, addressId, fulfillmentMode, startDate, endDate, quantity, couponId]);
  const onQuoteMode = useCallback((active: boolean, hasLocator: boolean) => {
    quoteVersion.current++; quoteModeRef.current = active || hasLocator;
    setQuoteMode(quoteModeRef.current); setQuote(null); setBusy(false); setError('');
  }, []);
  const bookingSelection = useCallback(async (original: AiClientQuoteFacts, selected: ClientCreateQuoteRequest): Promise<AiBookingSelection> => {
    const current = captureEnterpriseHostSession();
    if (!current || enterprise || !personalSelection || JSON.stringify(selected) !== JSON.stringify(personalSelection)) throw Error('booking_selection_changed');
    const catalog = await sessionApi.catalog();
    if (!current.current() || typeof catalog.timeZone !== 'string' || !catalog.timeZone || catalog.timeZone.length > 100) throw Error('booking_catalog_unavailable');
    return { quoteId: original.quoteId, timeZone: catalog.timeZone, startAt: selected.startAt, endAt: selected.endAt,
      fulfillmentMode: selected.fulfillmentMode, fulfillmentLocationId: selected.fulfillmentLocationId,
      ...(selected.returnLocationId ? { returnLocationId: selected.returnLocationId } : {}),
      ...(selected.deliveryAddressId ? { deliveryAddressId: selected.deliveryAddressId } : {}),
      bookingIdentity: { bookingIdentity: 'personal', enterpriseContractAndPayer: false },
      lines: selected.lines.map(line => { if (!line.itemGroupId) throw Error('booking_item_unavailable'); return { itemGroupId: line.itemGroupId, quantity: line.quantity }; }),
      ...(selected.services ? { services: selected.services } : {}) };
  }, [enterprise, personalSelection]);

  const getQuote = useCallback(async () => {
    if (!enterprise && quoteModeRef.current) return;
    if (!locationId || days < 1) { setError(t('invalidDate')); return; }
    if (isDelivery && !addressId) { setError(t('deliveryNeedsAddress')); return; }
    if (enterprise && (!noticeAccepted || !policy?.available || (paymentMode === 'enterprise' ? !policy.enterprisePaymentAllowed : !policy.personalPaymentAllowed))) { setError(language === 'en' ? 'Review current enterprise authority and explicitly accept the notice.' : '请核对当前企业授权并明确同意企业订单告知。'); return; }
    const version = ++quoteVersion.current;
    setBusy(true); setError(''); setQuote(null);
    try {
      const q = await sessionApi.createQuote({
        bookingIdentity: enterprise ? { bookingIdentity: 'enterprise_employee', corporateCustomerId: enterprise, enterpriseContractAndPayer: paymentMode === 'enterprise', enterpriseDisclosure: { noticeVersion: policy!.noticeVersion, acknowledged: noticeAccepted } } : { bookingIdentity: 'personal' },
        fulfillmentMode, fulfillmentLocationId: locationId, startAt: toIsoDateTime(startDate), endAt: toIsoDateTime(endDate),
        lines: [{ itemGroupId: product.id, quantity }],
        ...(isDelivery && addressId ? { deliveryAddressId: addressId } : {}),
        ...(couponId ? { customerCouponId: couponId } : {}),
      });
      if (version === quoteVersion.current && host?.current()) setQuote(q as unknown as RentalQuoteSnapshotV1);
    } catch (e: any) { if (version === quoteVersion.current && host?.current()) setError(e?.message || t('quoteFailed')); }
    finally { if (version === quoteVersion.current && host?.current()) setBusy(false); }
  }, [locationId, fulfillmentMode, isDelivery, addressId, couponId, startDate, endDate, quantity, product.id, days, enterprise, paymentMode, noticeAccepted, policy, language, hostIdentity]);

  // 自动报价：就绪且参数有效时，输入变化后自动重新计价（防抖），无需手动点按钮。
  useEffect(() => {
    if (!ready || !locationId || days < 1 || enterpriseOrder.blocked || (!enterprise && quoteMode)) return;
    if (isDelivery && !addressId) return;
    const timer = window.setTimeout(() => { getQuote(); }, 450);
    return () => window.clearTimeout(timer);
  }, [ready, locationId, days, isDelivery, addressId, couponId, quantity, startDate, endDate, getQuote, enterpriseOrder.blocked, quoteMode, enterprise]);

  const submitOrder = useCallback(async () => {
    if (!quote?.id || enterpriseOrder.blocked || (!enterprise && quoteModeRef.current)) return;
    if (quote.membershipSnapshot?.bookingIdentity === 'enterprise_employee') {
      await enterpriseOrder.submit(quote.id).catch(() => undefined); return;
    }
    setBusy(true); setError('');
    try {
      // 幂等键按报价固定：一份报价对应一次下单，网络重试可安全重放，不会重复建单。
      const res = await sessionApi.createOrder({ quoteId: quote.id }, `order-${quote.id}`);
      const order = (res.order ?? res) as { id?: string };
      if (order?.id) { toast.success(t('orderSubmitted')); navigate(href(`/orders/${order.id}`)); }
      else { setError(t('orderFailed')); toast.error(t('orderFailed')); }
    } catch (e: any) { const msg = e?.message || t('orderFailed'); setError(msg); toast.error(msg); }
    finally { setBusy(false); }
  }, [quote, href, enterpriseOrder]);

  if (!ready) {
    return <div className="booking-card"><p className="mock-note">{error ? error : <><LoadingOutlined /> {t('loading')}</>}</p></div>;
  }

  const money = (amount: unknown, deduction = false) => {
    const currency = quote?.currency;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || typeof currency !== 'string' || !/^[A-Z]{3}$/u.test(currency)) {
      return language === 'en' ? 'Amount or currency unavailable' : '金额或币种待核对';
    }
    return `${formatRentalMoney(deduction ? -amount : amount, currency)} ${currency}`;
  };
  const addrLabel = (a: any) => `${a.recipient} ${a.phoneMasked || a.phone || ''} · ${[a.province, a.city, a.district, a.detail].filter(Boolean).join('')}`.trim();
  return <div className="booking-card booking-total">
    <h2>{t('costConfirm')}</h2>
    <label className="booking-field">{language === 'en' ? 'Booking identity' : '预约身份'}<select value={enterprise} disabled={busy} onChange={event => { quoteVersion.current++; setQuote(null); setEnterprise(event.target.value); setPaymentMode('personal'); setNoticeAccepted(false); }}><option value="">{language === 'en' ? 'Personal' : '个人签约付款'}</option>{policies.map(row => <option key={row.corporateCustomerId} value={row.corporateCustomerId} disabled={!row.available}>{row.corporateName}{row.available ? '' : '（不可用）'}</option>)}</select></label>
    {policyError && <p role="alert">{policyError}</p>}
    {enterprise && policy && <><label className="booking-field">{language === 'en' ? 'Payment responsibility' : '费用归属'}<select value={paymentMode} disabled={busy} onChange={event => { quoteVersion.current++; setQuote(null); setPaymentMode(event.target.value); setNoticeAccepted(false); }}><option value="personal" disabled={!policy.personalPaymentAllowed}>{language === 'en' ? 'Corporate benefits, personal contract/payment' : '企业优惠，个人签约付款'}</option><option value="enterprise" disabled={!policy.enterprisePaymentAllowed}>{language === 'en' ? 'Enterprise contract and payment' : '企业签约付款'}</option></select></label><p>{policy.noticeText}</p><label><input type="checkbox" checked={noticeAccepted} disabled={busy} onChange={event => { quoteVersion.current++; setQuote(null); setNoticeAccepted(event.target.checked); }} />{language === 'en' ? 'I understand authorized administrators can view enterprise identity orders, including personal-payment benefits orders.' : '我知悉受权管理员可见本企业身份订单（含企业优惠个人付款），纯个人订单不共享。'}</label><p className="mock-note">{language === 'en' ? 'Deposit defaults to the enterprise contract; no payment/freeze is implied. Employee-funded deposits are unavailable without supported payment contracts.' : '保证金按商户/企业合同默认企业承担，不代表已付款或冻结；原资金端口未支持员工承担时，该模式不可用。'}</p></>}
    {isDelivery && (addresses.length
      ? <label className="booking-field">{t('selectAddress')}<select value={addressId} onChange={e => { setAddressId(e.target.value); setQuote(null); }}>{addresses.map(a => <option key={a.id} value={a.id}>{addrLabel(a)}</option>)}</select></label>
      : <p className="mock-note">{t('noAddress')} <Link to={href('/account')}>{t('addAddress')}</Link></p>)}
    {coupons.length > 0 && <label className="booking-field">{t('useCoupon')}<select value={couponId} onChange={e => { setCouponId(e.target.value); setQuote(null); }}><option value="">{t('couponNone')}</option>{coupons.map((c, i) => <option key={c.id ?? i} value={c.id}>{c.name || c.templateName || c.title || t('coupon')}</option>)}</select></label>}
    {!enterprise && <ClientQuotePreparation selection={personalSelection} scopeKey={JSON.stringify([hostIdentity, personalSelection])}
      english={language === 'en'} onMode={onQuoteMode} bookingSelection={bookingSelection}
      onHandoff={handoff => navigate(href(`/booking/${encodeURIComponent(product.id)}`), { state: { aiBookingHandoffRef: handoff.handoffRef } })} />}
    {busy && !quote ? <p className="mock-note"><LoadingOutlined /> {t('quoting')}</p> : null}
    {quote && (!quoteMode || enterprise) && <>
      <div><span>{t('rentAmount')}</span><strong>{money(quote.rentalAmount)}</strong></div>
      {quote.discountAmount !== 0 ? <div><span>{t('discount')}</span><strong>{money(quote.discountAmount, true)}</strong></div> : null}
      {quote.couponAmount !== 0 ? <div><span>{t('couponDeducted')}</span><strong>{money(quote.couponAmount, true)}</strong></div> : null}
      <div><span>{t('deposit')}</span><strong>{money(quote.depositAmount)}</strong></div>
      <div><span>{t('preAuth')}</span><strong>{money(quote.preAuthAmount)}</strong></div>
      <div className="booking-grand-total"><span>{t('payable')}</span><strong>{money(quote.payableAmount)}</strong></div>
      <p className="mock-note">{t('quoteServerNote')}</p>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {enterpriseOrder.error && <p className="form-error" role="alert">{enterpriseOrder.error}</p>}
    {enterpriseOrder.pending && <button type="button" className="button button-outline" disabled={enterpriseOrder.busy} onClick={() => void enterpriseOrder.recover()}>{language === 'en' ? 'Read original enterprise order' : '核对原企业订单结果'}</button>}
    {(!quoteMode || enterprise) && (quote?.membershipSnapshot?.enterpriseContractAndPayer && quote.membershipSnapshot.enterpriseBasis?.approvalMode === 'per_order' ? <EnterpriseBookingApproval key={JSON.stringify([identity, quote.id])} quoteId={quote.id} identity={identity} english={language === 'en'} onOrder={id => navigate(href(`/orders/${encodeURIComponent(id)}`))} onNewQuote={() => { setQuote(null); void getQuote(); }} /> : <button type="button" className="button button-dark button-block" disabled={busy || !quote || enterpriseOrder.blocked || Boolean(enterprise && !enterpriseOrder.ready)} onClick={submitOrder}>{busy ? t('submitting') : t('submitOrder')}</button>)}
    <p className="mock-note">{language === 'en' ? 'Rental term' : '租期'}: {days} {language === 'en' ? 'day(s)' : '天'}</p>
  </div>;
}
