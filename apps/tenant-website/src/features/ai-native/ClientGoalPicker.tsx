/** Customer goal picker in the existing website form system. Model conditions
 * are suggestions; every product, unit, time, location and booking identity is
 * chosen by the human. Only a current, observed original quote can hand the
 * selected request to the host's original booking page. */
import { useEffect, useRef, useState } from 'react';
import { RENTAL_PRICING_UNIT_LABELS, type ClientCreateQuoteRequest, type RentalFulfillmentMode,
  type RentalPricingUnit, type AiClientGoalProjection, type AiBookingHandoff, type ClientGoalBookingSource } from '@rental-os/shared';
import { captureEnterpriseHostSession, subscribeCustomerSession } from '../../data/authClient';
import { createClientGoalApi, createClientGoalBookingApi } from './client-goal-api';
import { createClientGoalSession, clientGoalStorageKey, clientGoalTimeOptions, clientGoalBookingSelection,
  clientGoalBookingStorageKey, clientGoalBookingStoredRequest, createClientGoalBookingSession,
  type ClientGoalView, type ClientQuoteBookingView } from './client-goal-session';
import { createClientTaskCancellationApi } from './client-task-cancellation-api';
import { createClientTaskCancellationSession, clientTaskCancellationStorageKey,
  type ClientTaskCancellationOrigin, type ClientTaskCancellationView } from './client-task-cancellation-session';
import { BookingDraftReview } from './BookingDraftReview';

const initial = (): ClientGoalView => ({ status: 'closed', hasLocator: false, task: null, question: null, receipt: null,
  projection: null, sources: null, selection: null, quote: null, canExtract: false, canRead: false, canSubmit: false,
  canContinue: false, canPrepareQuote: false, canConfirmQuote: false, canSelect: false, canStartNew: false, readOnly: true });
interface Form {
  lines: { item: string; quantity: string; unit: string; usage: string }[];
  start: string; end: string; startInstant: string; endInstant: string;
  mode: string; location: string; returnLocation: string; identity: string; payer: string; notice: boolean; address: string;
}
const emptyForm = (count: number): Form => ({ lines: Array.from({ length: count }, () => ({ item: '', quantity: '', unit: '', usage: '' })),
  start: '', end: '', startInstant: '', endInstant: '', mode: '', location: '', returnLocation: '', identity: '', payer: '', notice: false, address: '' });
const unitLabel = (unit: string, en: boolean) => {
  const english: Record<RentalPricingUnit, string> = { hour: 'Hour', shift: 'Shift', day_24h: '24 hours', calendar_day: 'Calendar day',
    night: 'Night', week: 'Week', month: '30-day month', usage: 'Usage', package: 'Package' };
  return en ? english[unit as RentalPricingUnit] ?? unit : RENTAL_PRICING_UNIT_LABELS[unit as RentalPricingUnit] ?? unit;
};
const modeLabel = (mode: string, en: boolean) => {
  const labels: Record<RentalFulfillmentMode, [string, string]> = { store_pickup_return: ['门店自取', 'Store pickup'],
    partner_pickup_return: ['合作点自取', 'Partner pickup'], warehouse_pickup_return: ['仓库自取', 'Warehouse pickup'],
    locker_pickup_return: ['柜机自取', 'Locker pickup'], delivery: ['配送', 'Delivery'], onsite_delivery: ['送达现场', 'On-site delivery'],
    carrier_shipping: ['承运寄送', 'Carrier shipping'] };
  return labels[mode as RentalFulfillmentMode]?.[en ? 1 : 0] ?? mode;
};
const candidateLabel = (choice: { id: string; label: string }, choices: { id: string; label: string }[]) =>
  choices.some(other => other.id !== choice.id && other.label === choice.label) ? `${choice.label} (${choice.id})` : choice.label;
const optionsFor = (projection: AiClientGoalProjection | null, field: string) => projection?.choices.find(group => group.field === field)?.choices ?? [];

export function ClientGoalPicker(props: {
  scopeKey: string; english: boolean; tenantCode?: string; serviceCode?: string;
  onSelected?(input: ClientCreateQuoteRequest): void; onHandoff?(handoff: AiBookingHandoff): void; onOrdinary?(): void;
}) {
  const { scopeKey, english: en } = props;
  const [record, setRecord] = useState({ scopeKey, view: initial() }), [working, setWorking] = useState(false), [error, setError] = useState(false);
  const [goal, setGoal] = useState({ scopeKey, text: '' }), [answer, setAnswer] = useState({ reference: '', text: '' });
  const [draft, setDraft] = useState({ reference: '', form: emptyForm(0) }), [formError, setFormError] = useState(false);
  const scope = useRef(scopeKey), epoch = useRef(0), busy = useRef(false), callbacks = useRef(props);
  const owner = useRef<ReturnType<typeof createClientGoalSession> | null>(null), ownerCurrent = useRef<(() => boolean) | null>(null);
  const sessionChanged = useRef<() => void>(() => undefined), unsubscribe = useRef<(() => void) | null>(null);
  const subscribedTenant = useRef<string | null>(null);
  const booking = useRef<ReturnType<typeof createClientGoalBookingSession> | null>(null);
  const bookingSource = useRef<ClientGoalBookingSource | null>(null), bookingKey = useRef<string | null>(null);
  const bookingAbort = useRef<AbortController | null>(null);
  const [bookingRecord, setBookingRecord] = useState<{ scopeKey: string; view: ClientQuoteBookingView } | null>(null);
  scope.current = scopeKey; callbacks.current = props;
  const view = record.scopeKey === scopeKey && (!ownerCurrent.current || ownerCurrent.current()) ? record.view : initial(), projection = view.projection;
  const projectionRef = projection ? `${scopeKey}:${projection.projectionHash}` : '';
  const items = projection?.candidates?.conditions.items ?? [], form = draft.reference === projectionRef ? draft.form : emptyForm(items.length);
  const goalText = goal.scopeKey === scopeKey ? goal.text : '', loggedIn = Boolean(captureEnterpriseHostSession());
  const bookingView = bookingRecord?.scopeKey === scopeKey && ownerCurrent.current?.() ? bookingRecord.view : null;
  const reviewLocations = bookingView?.draft && view.quote?.quoteId === bookingView.draft.material.quote.quoteId
    && view.selection && projection?.context.timeZone === bookingView.draft.material.selection.timeZone
    && view.selection.fulfillmentLocationId === bookingView.draft.material.selection.fulfillmentLocationId
    && view.selection.returnLocationId === bookingView.draft.material.selection.returnLocationId
    ? projection.choices.filter(group => ['fulfillmentLocationId', 'returnLocationId'].includes(group.field))
      .flatMap(group => group.choices) : undefined;
  const cancellationOrigin = (() => { try { return ownerCurrent.current?.() ? owner.current?.cancellationOrigin() ?? null : null; } catch { return null; } })();
  const question = view.question, textField = question?.contract.fields.length === 1 && question.contract.fields[0].kind === 'text'
    && question.contract.fields[0].fieldId === 'clarification_text' ? question.contract.fields[0] : null;
  const answerRef = question ? `${scopeKey}:${question.requestId}:${question.revision}` : '', answerText = answer.reference === answerRef ? answer.text : '';
  const policy = view.sources?.enterprises?.find(row => row.corporateCustomerId === form.identity);
  const delivery = ['delivery', 'onsite_delivery'].includes(form.mode) && view.sources?.fulfillment.deliveryDestination === 'customer_address';
  const times = (local: string) => { try { return projection ? clientGoalTimeOptions(local, projection.context.timeZone) : []; } catch { return []; } };
  const startOptions = times(form.start), endOptions = times(form.end);
  const startAt = startOptions.length === 1 ? startOptions[0].value : startOptions.find(option => option.value === form.startInstant)?.value;
  const endAt = endOptions.length === 1 ? endOptions[0].value : endOptions.find(option => option.value === form.endInstant)?.value;
  const edit = (patch: Partial<Form>) => { setDraft({ reference: projectionRef, form: { ...form, ...patch } }); setFormError(false); };
  const editLine = (index: number, patch: Partial<Form['lines'][number]>) =>
    edit({ lines: form.lines.map((line, at) => at === index ? { ...line, ...patch } : line) });

  useEffect(() => {
    epoch.current++; busy.current = false; owner.current?.dispose(); owner.current = null; ownerCurrent.current = null;
    booking.current?.dispose(); booking.current = null; bookingSource.current = null; bookingKey.current = null;
    bookingAbort.current?.abort(); bookingAbort.current = null; setBookingRecord(null);
    setRecord({ scopeKey, view: initial() }); setWorking(false); setError(false); setFormError(false);
    setGoal({ scopeKey, text: '' }); setAnswer({ reference: '', text: '' }); setDraft({ reference: '', form: emptyForm(0) });
    const close = () => {
      epoch.current++; busy.current = false; owner.current?.dispose(); owner.current = null; ownerCurrent.current = null;
      booking.current?.dispose(); booking.current = null; bookingSource.current = null; bookingKey.current = null;
      bookingAbort.current?.abort(); bookingAbort.current = null; setBookingRecord(null);
      setRecord({ scopeKey, view: initial() }); setWorking(false); setError(false); setFormError(false);
      setGoal({ scopeKey, text: '' }); setAnswer({ reference: '', text: '' }); setDraft({ reference: '', form: emptyForm(0) });
    };
    const hidden = () => { if (document.hidden) close(); };
    sessionChanged.current = close;
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', close);
    const captured = captureEnterpriseHostSession(); unsubscribe.current?.(); subscribedTenant.current = captured?.tenantCode ?? null;
    unsubscribe.current = captured ? subscribeCustomerSession(captured.tenantCode, close) : null;
    return () => { epoch.current++; owner.current?.dispose(); owner.current = null; ownerCurrent.current = null; unsubscribe.current?.();
      booking.current?.dispose(); booking.current = null; bookingSource.current = null; bookingKey.current = null;
      bookingAbort.current?.abort(); bookingAbort.current = null;
      unsubscribe.current = null; subscribedTenant.current = null; sessionChanged.current = () => undefined;
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', close); };
  }, [scopeKey]);
  const ensure = async () => {
    if (document.hidden || scope.current !== scopeKey) return null;
    if (owner.current && ownerCurrent.current?.()) return owner.current;
    owner.current?.dispose(); owner.current = null; ownerCurrent.current = null;
    const captured = captureEnterpriseHostSession(); if (!captured) throw Error('client_goal_login_required');
    if (props.tenantCode && props.tenantCode !== captured.tenantCode || props.serviceCode && props.serviceCode !== captured.workspaceCode)
      throw Error('client_goal_service_changed');
    if (subscribedTenant.current !== captured.tenantCode) {
      unsubscribe.current?.(); subscribedTenant.current = captured.tenantCode;
      unsubscribe.current = subscribeCustomerSession(captured.tenantCode, () => sessionChanged.current());
    }
    const generation = epoch.current, current = () => generation === epoch.current && scope.current === scopeKey && captured.current() && !document.hidden;
    const context = { tenantCode: captured.tenantCode, serviceCode: captured.workspaceCode, customerId: captured.customerId,
      surface: 'tenant_website' as const, current }, key = clientGoalStorageKey(context);
    const api = createClientGoalApi(context);
    const instance = createClientGoalSession({ context, api, now: Date.now,
      newKey: () => `client-goal-${crypto.randomUUID()}`,
      storage: { read: () => { const value = localStorage.getItem(key); return value === null ? null : JSON.parse(value); },
        write: value => {
          localStorage.setItem(key, JSON.stringify(value));
          // Make the already-observed original Task selector visible while its
          // model request is in flight, so stop controls do not wait for a reply.
          if (current()) setRecord(previous => ({ ...previous }));
        },
        archive: value => {
          const journal = value as { goal?: { operationKey?: unknown } }, operationKey = journal?.goal?.operationKey;
          if (typeof operationKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(operationKey) || !current()) throw Error('client_goal_archive_unavailable');
          const historyKey = `${key}:history:${encodeURIComponent(operationKey)}`, serialized = JSON.stringify(value), prior = localStorage.getItem(historyKey);
          if (prior !== null && prior !== serialized) throw Error('client_goal_archive_changed');
          if (prior === null) localStorage.setItem(historyKey, serialized);
          const observed = localStorage.getItem(historyKey);
          if (observed !== serialized) throw Error('client_goal_archive_not_retained');
          return JSON.parse(observed);
        } },
      changed: next => { if (current()) setRecord({ scopeKey, view: next }); } });
    owner.current = instance; ownerCurrent.current = current; await instance.open(); return current() ? instance : null;
  };
  const ensureBooking = async (instance: NonNullable<typeof owner.current>, purpose: 'read' | 'write') => {
    const source = purpose === 'write' ? await instance.selectedQuote() : null;
    const original = purpose === 'write' ? source?.original : instance.quoteRecoveryReference();
    if (!original || !ownerCurrent.current?.()) return null;
    const captured = captureEnterpriseHostSession(); if (!captured) throw Error('client_goal_booking_unavailable');
    const current = ownerCurrent.current, context = { tenantCode: captured.tenantCode, serviceCode: captured.workspaceCode,
      customerId: captured.customerId, surface: 'tenant_website' as const, current }, key = clientGoalBookingStorageKey(context, original);
    const cached = localStorage.getItem(key);
    if (purpose === 'read' && cached === null) return null;
    const request = cached === null ? null : clientGoalBookingStoredRequest(JSON.parse(cached));
    if (request && (request.original.materialRef !== original.materialRef || request.original.expectedMaterialHash !== original.expectedMaterialHash))
      throw Error('client_goal_booking_source_changed');
    const selection = request?.selection ?? (source ? clientGoalBookingSelection(source) : null);
    if (!selection || source && JSON.stringify(selection) !== JSON.stringify(clientGoalBookingSelection(source))) throw Error('client_goal_booking_selection_changed');
    if (booking.current && bookingKey.current === key) {
      if (source) bookingSource.current = source;
      if (purpose === 'read' && booking.current.snapshot().canRead) await booking.current.recover();
      return current() ? booking.current : null;
    }
    booking.current?.dispose(); bookingAbort.current?.abort(); const abort = new AbortController(); bookingAbort.current = abort;
    const api = createClientGoalApi(context), next = createClientGoalBookingSession({ context, original, selection: () => selection,
      api: createClientGoalBookingApi(context, abort.signal), readHost: () => api.readHost(abort.signal), now: Date.now,
      newKey: () => `goal-booking-${crypto.randomUUID()}`,
      storage: { read: () => { const value = localStorage.getItem(key); return value === null ? null : JSON.parse(value); },
        write: value => localStorage.setItem(key, JSON.stringify(value)) },
      changed: value => { if (current()) setBookingRecord({ scopeKey, view: value }); } });
    booking.current = next; bookingSource.current = source; bookingKey.current = key;
    await next.open(); if (cached !== null && next.snapshot().canRead) await next.recover(); return current() ? next : null;
  };
  const work = async (action: (instance: NonNullable<typeof owner.current>) => Promise<unknown>) => {
    if (busy.current || document.hidden || scope.current !== scopeKey) return;
    const generation = epoch.current; busy.current = true; setWorking(true); setError(false);
    try { const instance = await ensure(); if (instance && generation === epoch.current) await action(instance); }
    catch { if (generation === epoch.current) setError(true); }
    finally { if (generation === epoch.current) { busy.current = false; setWorking(false); } }
  };
  const buildSelection = (): ClientCreateQuoteRequest | null => {
    const selectedPolicy = policy;
    if (!projection || !startAt || !endAt || Date.parse(startAt) <= Date.now() || Date.parse(endAt) <= Date.parse(startAt)
      || !form.mode || !form.location || !form.returnLocation || !form.identity || !items.length || form.lines.some(line => !line.item || !line.unit
        || !/^[1-9][0-9]*$/u.test(line.quantity) || Number(line.quantity) > 10000
        || line.unit === 'usage' && (line.usage.trim() === '' || !Number.isFinite(Number(line.usage)) || Number(line.usage) < 0 || Number(line.usage) > 1000000))
      || delivery && !form.address
      || form.identity !== 'personal' && (!selectedPolicy?.available || !selectedPolicy.noticeVersion || !selectedPolicy.noticeText
        || !form.notice || !form.payer || (form.payer === 'enterprise' ? !selectedPolicy.enterprisePaymentAllowed : !selectedPolicy.personalPaymentAllowed))) return null;
    return { bookingIdentity: form.identity === 'personal' ? { bookingIdentity: 'personal', enterpriseContractAndPayer: false }
      : { bookingIdentity: 'enterprise_employee', corporateCustomerId: form.identity, enterpriseContractAndPayer: form.payer === 'enterprise',
        enterpriseDisclosure: { noticeVersion: selectedPolicy!.noticeVersion!, acknowledged: true } },
      fulfillmentMode: form.mode as RentalFulfillmentMode, fulfillmentLocationId: form.location,
      returnLocationId: form.returnLocation, startAt, endAt,
      lines: form.lines.map(line => ({ itemGroupId: line.item, quantity: Number(line.quantity), pricingUnit: line.unit as RentalPricingUnit,
        ...(line.unit === 'usage' ? { usageQuantity: Number(line.usage) } : {}) })),
      ...(delivery ? { deliveryAddressId: form.address } : {}) };
  };
  const prepare = () => {
    const selected = buildSelection(); if (!selected || !projection) { setFormError(true); return; }
    const hash = projection.projectionHash; void work(instance => instance.prepareQuote(selected, hash));
  };
  const generateBooking = () => work(async instance => { const next = await ensureBooking(instance, 'write'); await next?.generateDraft(); });
  const continueBooking = () => work(async instance => {
    await ensureBooking(instance, 'read');
    const next = await ensureBooking(instance, 'write'); if (!next) return;
    const observed = await next.continueBooking();
    if (observed.status !== 'handoff_ready' || observed.readOnly || !observed.handoff || !ownerCurrent.current?.() || booking.current !== next) return;
    callbacks.current.onSelected?.(bookingSource.current!.selection);
    if (ownerCurrent.current?.()) callbacks.current.onHandoff?.(observed.handoff);
  });
  const refresh = () => work(async instance => {
    await instance.refresh(); await ensureBooking(instance, 'read'); await instance.readCancellationOrigin();
  });
  const newGoal = () => work(async instance => {
    // A pending Draft/handoff has its own original operation and must be read
    // first. A new goal never erases or substitutes for that receipt.
    const originalBooking = await ensureBooking(instance, 'read'), originalView = originalBooking?.snapshot();
    if (originalView && (!originalView.observed || ['unknown','checking','unavailable'].includes(originalView.status))) return;
    await instance.beginNewGoal(); if (instance.snapshot().hasLocator) return;
    booking.current?.dispose(); booking.current = null; bookingSource.current = null; bookingKey.current = null;
    bookingAbort.current?.abort(); bookingAbort.current = null; setBookingRecord(null);
    setGoal({ scopeKey, text: '' }); setAnswer({ reference: '', text: '' }); setDraft({ reference: '', form: emptyForm(0) });
  });
  const selectedLabel = (field: string, id?: string) => optionsFor(projection, field).find(option => option.id === id)?.label ?? id ?? (en ? 'Not selected' : '未选择');
  const money = (amount: number | null) => amount === null || !view.quote?.currency ? (en ? 'Unavailable' : '未提供') : `${amount} ${view.quote.currency}`;
  const choose = (field: string, value: string, label: string, change: (value: string) => void, kind?: 'unit' | 'mode') => {
    const options = optionsFor(projection, field), group = projection?.choices.find(row => row.field === field);
    return <label className="booking-field">{label}<select value={value} disabled={working || !view.canPrepareQuote || options.length === 0}
      onChange={event => change(event.target.value)} required>
      <option value="">{en ? 'Choose explicitly' : '请选择'}</option>
      {options.map(option => <option key={option.id} value={option.id}>{kind === 'unit' ? unitLabel(option.id, en)
        : kind === 'mode' ? modeLabel(option.id, en) : candidateLabel(option, options)}</option>)}
    </select>{options.length === 0 && <small>{en ? 'No matching public option. Use ordinary booking or ask the merchant.' : '暂无匹配的公开选项，可继续普通预约或联系商户。'}</small>}
    {group?.source.truncated && <small>{en ? 'Only part of the current choices is shown.' : '当前仅展示部分候选，可在普通商品页查看完整目录。'}</small>}</label>;
  };
  return <section className="booking-card" aria-label={en ? 'Find rental items from your goal' : '按使用目标选品'} aria-busy={working}>
    <h3>{en ? 'What do you need to rent?' : '这次想租什么？'}</h3>
    <p>{en ? 'Describe your plan, extract suggested conditions, then choose the rental details before requesting a quote.' : '说说使用计划，提取建议条件，再逐项选择租赁安排并确认报价。'}</p>
    {!view.hasLocator && <label className="full-field">{en ? 'Your rental goal' : '使用目标'}<textarea value={goalText} maxLength={4096} rows={3}
      disabled={working || !loggedIn} onChange={event => setGoal({ scopeKey, text: event.target.value })} /></label>}
    {(!view.hasLocator || view.canExtract) && <button type="button" className="button button-dark button-block"
      disabled={working || !loggedIn || !view.hasLocator && !goalText.trim() || view.hasLocator && !view.canExtract}
      onClick={() => void work(instance => instance.extract(goalText))}>{view.hasLocator ? (en ? 'Continue extracting the original goal' : '继续提取原目标') : (en ? 'Extract suggested conditions' : '提取建议条件')}</button>}
    <button type="button" className="button button-outline button-block" disabled={working || !loggedIn}
      onClick={() => void refresh()}>{en ? 'Check original result' : '核对原结果'}</button>
    {!loggedIn && <p role="status">{en ? 'Sign in to extract a goal. You can browse and book through the ordinary pages.' : '登录后可提取目标；浏览商品和普通预约仍可继续。'}</p>}
    {working && <p role="status">{en ? 'Processing this request…' : '正在处理本次请求…'}</p>}
    {view.status === 'unknown' && <p role="status">{en ? 'The original result needs checking. Use the original result button to continue checking.' : '原结果待核对，请使用“核对原结果”继续读取。'}</p>}
    {view.status === 'running' && <p role="status">{en ? 'The original task is still running. Check its result later.' : '原任务仍在处理，可稍后核对结果。'}</p>}
    {textField && question && <><label className="full-field">{textField.label}<textarea rows={3} maxLength={textField.maxLength} value={answerText}
      disabled={working || !view.canSubmit} onChange={event => setAnswer({ reference: answerRef, text: event.target.value })} /></label>
      <button type="button" className="button button-outline button-block" disabled={working || !view.canSubmit || !answerText.trim()}
        onClick={() => void work(instance => instance.submitClarification(answerText))}>{en ? 'Save additional details' : '提交补充说明'}</button></>}
    {view.canContinue && <><p>{en ? 'Details saved. Continue explicitly to extract the next result.' : '补充说明已保存，请明确继续提取。'}</p>
      <button type="button" className="button button-dark button-block" disabled={working}
        onClick={() => void work(instance => instance.continueAnswer())}>{en ? 'Continue extracting' : '继续提取'}</button></>}
    {projection?.state === 'requires_input' && !view.selection && <>
      <h4>{en ? 'Suggested conditions' : '建议条件'}</h4>
      <p>{en ? 'These are unconfirmed suggestions. Product availability and charges are checked when you request the original quote.' : '以下为未确认的建议；可租性与费用在原报价流程核定。'}</p>
      <dl>{projection.candidates?.conditions.start && <><dt>{en ? 'Suggested start' : '建议开始'}</dt><dd>{projection.candidates.conditions.start}</dd></>}
        {projection.candidates?.conditions.end && <><dt>{en ? 'Suggested end' : '建议结束'}</dt><dd>{projection.candidates.conditions.end}</dd></>}
        {projection.candidates?.conditions.locationName && <><dt>{en ? 'Suggested location' : '建议地点'}</dt><dd>{projection.candidates.conditions.locationName}</dd></>}
      </dl>
      {!items.length && <p role="status">{en ? 'No product condition was extracted. Continue through the ordinary catalog.' : '未提取到商品条件，请继续使用普通商品目录。'}</p>}
      {items.length > 0 && <form className="booking-form" onSubmit={event => { event.preventDefault(); prepare(); }}>
        <h4>{en ? 'Choose rental details' : '选择租赁条件'}</h4>
        {items.map((item, index) => <fieldset key={index} className="booking-form" disabled={working || !view.canPrepareQuote}>
          <legend>{item.productName ?? (en ? `Item ${index + 1}` : `商品 ${index + 1}`)}</legend>
          {(item.quantity !== undefined || item.pricingUnit) && <p>{en ? 'Suggested' : '建议'}：{item.quantity ?? '—'} {item.pricingUnit ? unitLabel(item.pricingUnit, en) : ''}</p>}
          <div className="form-grid">{choose(`items.${index}.itemGroupId`, form.lines[index]?.item ?? '', en ? 'Product' : '商品', value => editLine(index, { item: value }))}
            {choose(`items.${index}.pricingUnit`, form.lines[index]?.unit ?? '', en ? 'Pricing unit' : '计费单位', value => editLine(index, { unit: value, usage: '' }), 'unit')}
            <label className="booking-field">{en ? 'Quantity' : '数量'}<input type="number" min={1} max={10000} step={1} required value={form.lines[index]?.quantity ?? ''}
              onChange={event => editLine(index, { quantity: event.target.value })} /></label>
            {form.lines[index]?.unit === 'usage' && <label className="booking-field">{en ? 'Usage quantity' : '使用量'}<input type="number" min={0} max={1000000} step="any" required
              value={form.lines[index].usage} onChange={event => editLine(index, { usage: event.target.value })} /></label>}
          </div>
        </fieldset>)}
        <p>{en ? 'Dates below use the merchant time zone' : '以下时间均按商户时区填写'}：{projection.context.timeZone}</p>
        <div className="form-grid">
          <label className="booking-field">{en ? 'Rental start' : '取用时间'}<input type="datetime-local" step={60} required value={form.start}
            disabled={working || !view.canPrepareQuote} onChange={event => edit({ start: event.target.value, startInstant: '' })} /></label>
          <label className="booking-field">{en ? 'Rental end' : '归还时间'}<input type="datetime-local" step={60} required value={form.end}
            disabled={working || !view.canPrepareQuote} onChange={event => edit({ end: event.target.value, endInstant: '' })} /></label>
          {startOptions.length > 1 && <label className="booking-field">{en ? 'Choose start time offset' : '确认取用时间偏移'}<select required value={form.startInstant}
            disabled={working || !view.canPrepareQuote} onChange={event => edit({ startInstant: event.target.value })}><option value="">{en ? 'Choose time offset' : '请选择时间偏移'}</option>
            {startOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
          {endOptions.length > 1 && <label className="booking-field">{en ? 'Choose end time offset' : '确认归还时间偏移'}<select required value={form.endInstant}
            disabled={working || !view.canPrepareQuote} onChange={event => edit({ endInstant: event.target.value })}><option value="">{en ? 'Choose time offset' : '请选择时间偏移'}</option>
            {endOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
          {choose('fulfillmentMode', form.mode, en ? 'Fulfillment' : '取还方式', value => edit({ mode: value, location: '', returnLocation: '', address: '' }), 'mode')}
          {choose('fulfillmentLocationId', form.location, en ? 'Fulfillment location' : '取用／配送地点', value => edit({ location: value, returnLocation: '' }))}
          <label className="booking-field">{en ? 'Return location' : '归还地点'}<select required value={form.returnLocation}
            disabled={working || !view.canPrepareQuote || !form.location} onChange={event => edit({ returnLocation: event.target.value })}><option value="">{en ? 'Choose explicitly' : '请选择'}</option>
            {optionsFor(projection, 'returnLocationId').filter(option => view.sources?.fulfillment.allowDifferentReturnLocation || option.id === form.location)
              .map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          {choose('bookingIdentity', form.identity, en ? 'Booking identity' : '预约身份', value => edit({ identity: value, payer: '', notice: false }))}
          {form.identity && form.identity !== 'personal' && <label className="booking-field">{en ? 'Contract and payer' : '签约与付款主体'}<select required value={form.payer}
            disabled={working || !view.canPrepareQuote || !policy?.available} onChange={event => edit({ payer: event.target.value, notice: false })}>
            <option value="">{en ? 'Choose explicitly' : '请选择'}</option><option value="personal" disabled={!policy?.personalPaymentAllowed}>{en ? 'Personal payment' : '个人签约付款'}</option>
            <option value="enterprise" disabled={!policy?.enterprisePaymentAllowed}>{en ? 'Enterprise contract and payment' : '企业签约付款'}</option></select></label>}
          {delivery && <label className="booking-field">{en ? 'Your saved delivery address' : '本人配送地址'}<select value={form.address} required
            disabled={working || !view.canPrepareQuote || !view.sources?.addresses?.length} onChange={event => edit({ address: event.target.value })}>
            <option value="">{en ? 'Choose an address' : '请选择地址'}</option>{view.sources?.addresses?.map(address => <option key={address.id} value={address.id}>{address.label}</option>)}</select>
            {!view.sources?.addresses?.length && <small>{en ? 'No address is available. Manage addresses through the ordinary account page.' : '暂无可用地址，请到原账户页面管理地址。'}</small>}</label>}
        </div>
        {form.identity && form.identity !== 'personal' && <>
          {policy?.noticeText && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{policy.noticeText}</p>}
          <label className="login-agree"><input type="checkbox" checked={form.notice} disabled={working || !view.canPrepareQuote || !policy?.available || !policy.noticeVersion || !policy.noticeText}
            onChange={event => edit({ notice: event.target.checked })} />{en ? 'I have reviewed and accept the current enterprise notice.' : '我已阅读并接受当前企业订单告知。'}</label>
          {(!policy?.available || !policy.noticeVersion || !policy.noticeText) && <p role="status">{en ? 'This enterprise option is currently unavailable. Choose a different available identity.' : '当前企业身份不可用，请选择其他可用预约身份。'}</p>}
        </>}
        {startAt && endAt && <p>{en ? 'Selected absolute interval' : '已选绝对时间区间'}：<time dateTime={startAt}>{form.start} {startOptions.find(option => option.value === startAt)?.label}</time> — <time dateTime={endAt}>{form.end} {endOptions.find(option => option.value === endAt)?.label}</time></p>}
        {(formError || form.start && startOptions.length === 0 || form.end && endOptions.length === 0) && <p role="alert">{en ? 'Check every selection and choose valid dates in the merchant time zone.' : '请逐项完成选择，并核对商户时区下有效的取还时间。'}</p>}
        <button type="submit" className="button button-dark button-block" disabled={working || !view.canPrepareQuote}>{en ? 'Confirm selections and prepare quote parameters' : '确认所选条件并准备报价参数'}</button>
      </form>}
    </>}
    {view.selection && <><h4>{en ? 'Selected rental details' : '已选租赁条件'}</h4>
      <ul>{view.selection.lines.map((line, index) => <li key={`${index}:${line.itemGroupId}`}>{selectedLabel(`items.${index}.itemGroupId`, line.itemGroupId)} · {line.quantity} · {unitLabel(line.pricingUnit ?? '', en)}</li>)}</ul>
      <dl><dt>{en ? 'Rental interval' : '租赁区间'}</dt><dd><time dateTime={view.selection.startAt}>{view.selection.startAt}</time> — <time dateTime={view.selection.endAt}>{view.selection.endAt}</time></dd>
        <dt>{en ? 'Fulfillment' : '取还方式'}</dt><dd>{modeLabel(view.selection.fulfillmentMode, en)} · {selectedLabel('fulfillmentLocationId', view.selection.fulfillmentLocationId)}</dd>
        <dt>{en ? 'Booking identity' : '预约身份'}</dt><dd>{view.selection.bookingIdentity?.bookingIdentity === 'personal' ? (en ? 'Personal' : '个人')
          : `${selectedLabel('bookingIdentity', view.selection.bookingIdentity?.corporateCustomerId)} · ${view.selection.bookingIdentity?.enterpriseContractAndPayer ? (en ? 'Enterprise payment' : '企业付款') : (en ? 'Personal payment' : '个人付款')}`}</dd></dl>
    </>}
    {view.canConfirmQuote && <><p>{en ? 'Parameters are prepared. Confirm separately to obtain the original quote.' : '参数已准备，请另行确认取得原报价。'}</p>
      <button type="button" className="button button-dark button-block" disabled={working} onClick={() => void work(instance => instance.confirmQuote())}>{en ? 'Confirm parameters and get quote' : '确认参数并取得报价'}</button></>}
    {view.quote && <><h4>{en ? 'Original quote' : '原报价'}</h4><dl><dt>{en ? 'Payable' : '应付'}</dt><dd>{money(view.quote.payableAmount)}</dd>
      <dt>{en ? 'Deposit' : '押金'}</dt><dd>{money(view.quote.depositAmount)}</dd><dt>{en ? 'Preauthorization' : '预授权'}</dt><dd>{money(view.quote.preAuthAmount)}</dd></dl>
      <p>{en ? 'No order has been submitted. Continue on the original booking page.' : '尚未提交订单，请在原预约页继续办理。'}</p></>}
    {view.canSelect && (!bookingView || bookingView.canPrepare || bookingView.canSave) && <button type="button" className="button button-dark button-block"
      disabled={working || Boolean(bookingView?.readOnly)} onClick={() => void generateBooking()}>{en ? 'Generate reservation draft from this quote' : '按原报价生成预约草稿'}</button>}
    {bookingView?.draft && <p>{en ? 'Reservation draft saved. Review it before continuing.' : '预约草稿已保存，请核对后明确继续。'}</p>}
    <BookingDraftReview draft={bookingView?.draft ?? null} english={en}
      locations={reviewLocations} />
    {bookingView && !bookingView.readOnly && (bookingView.canChoose || bookingView.canHandoff || bookingView.handoff) && <button type="button" className="button button-dark button-block"
      disabled={working} onClick={() => void continueBooking()}>{en ? 'Confirm draft and continue to original booking' : '确认草稿并前往原预约页'}</button>}
    {bookingView?.status === 'unknown' && <p role="status">{en ? 'The original reservation operation needs checking. No draft is created again.' : '原预约操作待核对，请读取原结果，不重复生成草稿。'}</p>}
    {bookingView?.readOnly && bookingView.observed && <p role="status">{en ? 'Original reservation recorded; it is available only for checking.' : '原预约操作已记录，当前仅供核对。'}</p>}
    {view.canStartNew && <button type="button" className="button button-outline button-block" disabled={working || Boolean(bookingView && !bookingView.observed)}
      onClick={() => void newGoal()}>{en ? 'Start a new rental goal' : '填写新的使用目标'}</button>}
    {cancellationOrigin && <GoalTaskCancellation origin={cancellationOrigin} scopeKey={scopeKey} english={en}
      current={() => Boolean(ownerCurrent.current?.())} onObserved={() => { if (!busy.current && ownerCurrent.current?.()) void refresh(); }} />}
    {view.hasLocator && view.readOnly && <p role="status">{en ? 'The original record is available for reading. Continuing is currently unavailable.' : '已有原记录可核对，当前暂不能继续办理。'}</p>}
    {(error || view.status === 'unavailable') && <p role="status">{en ? 'This step is unavailable. Keep the original reference and check its result, or use ordinary booking.' : '当前步骤暂不可用。请保留原引用并核对结果，也可继续普通预约。'}</p>}
    {props.onOrdinary && <button type="button" className="button button-outline button-block" disabled={working}
      onClick={() => { if (!document.hidden && scope.current === scopeKey) callbacks.current.onOrdinary?.(); }}>{en ? 'Use ordinary booking' : '继续普通预约'}</button>}
  </section>;
}

/** Stop only the current original Goal Task. The synthetic orderId below is a
 * local cache namespace; the HTTP API receives only the original Task selector. */
function GoalTaskCancellation(props: {
  origin: ClientTaskCancellationOrigin; scopeKey: string; english: boolean; current(): boolean; onObserved(): void;
}) {
  const identity = JSON.stringify([props.scopeKey, props.origin.reference, props.origin.taskId]);
  const blank = (): ClientTaskCancellationView => ({ status: 'closed', taskStatus: null, canRequest: false, canRead: false, canSettle: false, observation: null });
  const [state, setState] = useState({ identity, view: blank() }), [working, setWorking] = useState(false);
  const epoch = useRef(0), busy = useRef(false), active = useRef(true), latest = useRef(props);
  const owner = useRef<ReturnType<typeof createClientTaskCancellationSession> | null>(null);
  const api = useRef<ReturnType<typeof createClientTaskCancellationApi> | null>(null);
  latest.current = props;
  const view = state.identity === identity && props.current() ? state.view : blank();
  useEffect(() => {
    active.current = true; epoch.current++; busy.current = false; owner.current?.dispose(); api.current?.dispose(); owner.current = null; api.current = null;
    setState({ identity, view: blank() }); setWorking(false);
    return () => { active.current = false; epoch.current++; owner.current?.dispose(); api.current?.dispose(); owner.current = null; api.current = null; };
  }, [identity]);
  const work = async (action: 'requestCancellation' | 'refresh' | 'finishCancellation') => {
    if (busy.current || !active.current || !props.current() || document.hidden) return;
    const generation = epoch.current; busy.current = true; setWorking(true);
    try {
      if (!owner.current) {
        const captured = captureEnterpriseHostSession(); if (!captured) throw Error('client_goal_stop_unavailable');
        const current = () => active.current && epoch.current === generation && captured.current() && latest.current.current() && !document.hidden;
        const context = { tenantCode: captured.tenantCode, serviceCode: captured.workspaceCode, customerId: captured.customerId,
          orderId: `goal:${props.origin.reference.materialRef}`, surface: 'tenant_website' as const, current };
        const key = clientTaskCancellationStorageKey(context, props.origin), transport = createClientTaskCancellationApi(context); api.current = transport;
        owner.current = createClientTaskCancellationSession({ context, origin: props.origin, api: transport,
          storage: { read: () => { const value = localStorage.getItem(key); return value === null ? null : JSON.parse(value); },
            write: value => localStorage.setItem(key, JSON.stringify(value)) },
          changed: next => { if (current()) setState({ identity, view: next }); } });
      }
      await owner.current[action]();
      if (owner.current.snapshot().observation && props.current() && epoch.current === generation) latest.current.onObserved();
    } catch { if (props.current() && epoch.current === generation) setState({ identity, view: { ...blank(), status: 'unavailable' } }); }
    finally { if (active.current && epoch.current === generation) { busy.current = false; setWorking(false); } }
  };
  const en = props.english;
  return <div aria-label={en ? 'Stop the original rental task' : '停止原选品任务'} aria-busy={working}>
    {!['settled','finished'].includes(view.status) && <button type="button" className="button button-outline button-block"
      disabled={working || view.status !== 'closed' && !view.canRequest} onClick={() => void work('requestCancellation')}>{en ? 'Request cancellation of the original task' : '请求取消原选品任务'}</button>}
    <button type="button" className="button button-outline button-block" disabled={working} onClick={() => void work('refresh')}>{en ? 'Check original cancellation result' : '核对原取消结果'}</button>
    {view.canSettle && <button type="button" className="button button-outline button-block" disabled={working}
      onClick={() => void work('finishCancellation')}>{en ? 'Confirm original cancellation settlement' : '核对并完成原取消善后'}</button>}
    {view.status !== 'closed' && <p role="status">{view.status === 'settled' ? (en ? 'Cancellation settled. Existing effects remain.' : '取消请求已收口，已发生的结果保留。')
      : view.status === 'finished' ? (en ? 'The original task has ended.' : '原任务已结束。')
        : view.status === 'requested' ? (en ? 'Cancellation requested. Read the original result to confirm settlement.' : '取消请求已记录，请读取原结果核对善后。')
          : (en ? 'The original cancellation result needs checking.' : '原取消结果待核对。')}</p>}
  </div>;
}
