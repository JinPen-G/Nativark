/** Minimal original-order expense consumer. No payment/stock execution is inferred
 * from approval. Durable opaque references coordinate dispatch across bundles. */
import { useEffect, useRef, useState } from 'react';
import { enterpriseExtensionRequestMatches, enterpriseExtensionRequestClosureMatches, enterpriseExtensionServiceRequests, enterpriseExtensionServiceSelectionKey, formatRentalMoney, type ClientCatalogResponse, type ClientQuoteServiceRequest, type EnterpriseExtensionApprovalView, type EnterpriseExtensionEligibility, type EnterpriseExtensionOriginalResult } from '@rental-os/shared';
import { captureEnterpriseHostSession, sessionApi, subscribeCustomerSession } from '../data/authClient';
import { zoneSupported, zonedToInstant } from '../../../miniprogram/src/core/time';
type Pending = { key: string; orderId: string; approvalId?: string; closureKey?: string; kind: 'request' | 'submit' };
type ServiceChoice = { serviceId: string; quantity: number; start: string; end: string; locationId: string };
export function EnterpriseExtensionApproval({ orderId, identity, english }: { orderId: string; identity: string; english: boolean }) {
  const host = captureEnterpriseHostSession(), viewOwner = JSON.stringify([identity, host?.identity]), owner = useRef(viewOwner); owner.current = viewOwner;
  const mounted = useRef(true), working = useRef<string | undefined>(undefined);
  const [eligibility, setEligibility] = useState<EnterpriseExtensionEligibility>(), [rows, setRows] = useState<EnterpriseExtensionApprovalView[]>([]);
  const [catalog, setCatalog] = useState<ClientCatalogResponse>(), [services, setServices] = useState<ServiceChoice[]>([]);
  const selectionVersion = useRef(0);
  const [selected, setSelected] = useState(''), [newEndAt, setNewEndAt] = useState(''), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [closureReason, setClosureReason] = useState(''), [closureConfirmed, setClosureConfirmed] = useState(false);
  const [pending, setPending] = useState<Pending>(), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [original, setOriginal] = useState<EnterpriseExtensionOriginalResult>();
  const [requestClosed, setRequestClosed] = useState(false);
  const key = `rental-os:enterprise-extension:${JSON.stringify([host?.operationScope, orderId])}`;
  const current = () => { if (!mounted.current || owner.current !== viewOwner || !host?.current()) throw new Error('原客户或空间已变化，不能继续原续租 / Identity changed'); };
  const readPending = (): Pending | undefined => {
    const raw = localStorage.getItem(key); if (!raw) return undefined;
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['key', 'orderId', 'approvalId', 'closureKey', 'kind'].includes(key))
      || typeof value.key !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.key) || value.orderId !== orderId || !['request', 'submit'].includes(value.kind)
      || value.closureKey !== undefined && (value.closureKey === value.key || typeof value.closureKey !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.closureKey))
      || value.kind === 'submit' && typeof value.approvalId !== 'string'
      || value.approvalId !== undefined && (typeof value.approvalId !== 'string' || !value.approvalId || value.approvalId.length > 191)) throw new Error('原续租引用不可核对，不能重发');
    return value;
  };
  const remember = (value: Pending) => { current(); const raw = JSON.stringify(value); localStorage.setItem(key, raw); if (localStorage.getItem(key) !== raw) throw new Error('原续租引用未可靠保存，未发送'); setPending(value); };
  const clear = (value: Pending) => { current(); if (JSON.stringify(readPending()) !== JSON.stringify(value)) throw new Error('原续租引用已变化，不能覆盖另一请求'); localStorage.removeItem(key); if (localStorage.getItem(key) !== null) throw new Error('原结果已提交，引用尚未清除；只能回读'); setPending(undefined); };
  const refresh = async () => {
    const [policy, approvals] = await Promise.all([sessionApi.enterpriseExtensionEligibility(orderId), sessionApi.enterpriseExtensionApprovals()]); current();
    if (policy.orderId !== orderId) throw new Error('原订单准入引用不匹配');
    setEligibility(policy); setRows(approvals.filter(row => row.orderId === orderId));
    if (policy.approvalRequired) { const value = await readCatalog(); current(); setCatalog(value); }
  };
  const readCatalog = async (): Promise<ClientCatalogResponse> => {
    current(); const value = await sessionApi.catalog() as ClientCatalogResponse; current();
    if (value.tenantCode !== host?.tenantCode || value.workspace?.workspaceCode !== host?.workspaceCode
      || !Array.isArray(value.services) || !Array.isArray(value.locations) || typeof value.timeZone !== 'string' || !value.timeZone.trim()
      || !zoneSupported(value.timeZone)) throw new Error('原服务候选或营业时区不可核对');
    return value;
  };
  useEffect(() => {
    mounted.current = true; selectionVersion.current++; setCatalog(undefined); setServices([]); setRequestClosed(false); setReady(false); setRows([]); setEligibility(undefined); setConfirmed(false); setOriginal(undefined); setSelected(''); setReason(''); setNewEndAt(''); setError(''); setPending(undefined); setBusy(false); setClosureConfirmed(false); setClosureReason('');
    try { current(); setPending(readPending()); setReady(true); void refresh().catch(e => { if (host?.current() && mounted.current && owner.current === viewOwner) setError(e.message); }); }
    catch (e) { setError(e instanceof Error ? e.message : '原续租引用不可用'); }
    const unsubscribe = host ? subscribeCustomerSession(host.tenantCode, () => { if (!host.current() && mounted.current) { selectionVersion.current++; setCatalog(undefined); setServices([]); setReady(false); setRows([]); setOriginal(undefined); setEligibility(undefined); setConfirmed(false); setReason(''); setNewEndAt(''); setSelected(''); setClosureConfirmed(false); setClosureReason(''); } }) : () => {};
    return () => { mounted.current = false; unsubscribe(); };
  }, [viewOwner, key]);
  const row = rows.find(row => row.id === selected);
  useEffect(() => { setConfirmed(false); setClosureConfirmed(false); setClosureReason(''); }, [row?.id, row?.revision, JSON.stringify(row?.preview)]);
  const readResult = async (id: string) => {
    current(); const result = await sessionApi.enterpriseExtensionResult(id); current();
    if (result.approval.id !== id || result.approval.orderId !== orderId || result.approval.applicantCustomerId !== host?.customerId || result.retryable !== false || result.original.retryable !== false
      || result.original.state === 'observed' && (result.approval.state !== 'consumed' || !result.approval.extensionId || result.original.extensionId !== result.approval.extensionId)
      || result.approval.state === 'consumed' && result.original.state !== 'observed'
      || result.original.state === 'closed' && (result.approval.state !== 'closed' || !result.approval.closedOperationKey)) throw new Error('原续租结果不匹配');
    setOriginal(result); return result;
  };
  const recoverOriginal = async (value: Pending) => {
    current();
    if (value.kind === 'request') {
      const recovered = await sessionApi.enterpriseExtensionRequestOriginal(orderId, value.key); current();
      if (!host || !enterpriseExtensionRequestMatches(recovered, orderId, value.key, host.customerId, host.workspaceCode)) throw new Error('原续租申请尚待精确核对，不能重发');
      if (value.closureKey) {
        const closed = await sessionApi.enterpriseOperation(value.closureKey); current();
        if (closed.state !== 'committed' || !enterpriseExtensionRequestClosureMatches(recovered, closed.result, value.key, value.closureKey)) throw new Error('原申请结束收据尚待核对，不能重发');
      }
      if (recovered.state === 'closed') {
        clear(value); setRequestClosed(true); setOriginal(undefined); setSelected(''); setNewEndAt(''); setReason(''); setConfirmed(false); setClosureConfirmed(false); setClosureReason(''); await refresh(); return;
      }
      if (recovered.state !== 'observed') throw new Error('原申请仍待核对');
      await readResult(recovered.approval.id); clear(value); await refresh(); setSelected(recovered.approval.id); setConfirmed(false); return;
    }
    const receipt = await sessionApi.enterpriseOperation(value.key); current();
    if (value.closureKey) {
      const closed = await sessionApi.enterpriseOperation(value.closureKey); current();
      if (closed.state !== 'committed' || closed.result?.approvalId !== value.approvalId) throw new Error('原结束请求尚待核对，不能重发');
      const result = await readResult(value.approvalId!);
      if (result.original.state === 'closed' && result.approval.closedOperationKey === value.key && closed.result?.closedOperationKey === value.key
        || result.original.state === 'observed' && result.approval.extensionId === closed.result?.extensionId && closed.result?.originalOperationKey === value.key) { clear(value); await refresh(); return; }
      throw new Error('原结束收据与续租结果不一致');
    }
    if (receipt.state !== 'committed') throw new Error('尚未读到原收据，不证明未执行；保留原引用');
    const id = value.approvalId ?? (typeof receipt.result?.id === 'string' ? receipt.result.id : undefined);
    if (id && value.kind === 'submit' && receipt.result?.state === 'closed' && receipt.result.approvalId === id && receipt.result.closedOperationKey === value.key) {
      const sealed = await readResult(id);
      if (sealed.original.state !== 'closed' || sealed.approval.closedOperationKey !== value.key) throw new Error('原结束证据不匹配');
      clear(value); await refresh(); return;
    }
    if (!id || value.kind === 'submit' && (receipt.result?.approvalId !== id || typeof receipt.result?.extensionId !== 'string' || !receipt.result.extensionId)) throw new Error('原申请收据引用缺失或不一致');
    const result = await readResult(id);
    if (value.kind === 'submit' && receipt.result?.extensionId !== result.approval.extensionId) throw new Error('原收据与续租消费关联不一致');
    if (value.kind === 'submit' && (result.approval.state !== 'consumed' || result.original.state !== 'observed' || result.original.extensionId !== result.approval.extensionId)) throw new Error('原续租消费仍待核对，不能重发');
    clear(value); await refresh(); setSelected(id); setConfirmed(false);
  };
  const act = async (fn: () => Promise<void>) => {
    current(); if (working.current === viewOwner) return; working.current = viewOwner; setBusy(true); setError('');
    try { if (!navigator.locks?.request) throw new Error('缺少原操作协调能力，不能提交'); await navigator.locks.request(`${key}:dispatch`, async () => { current(); await fn(); current(); }); }
    catch (e) { if (mounted.current && owner.current === viewOwner && host?.current()) setError(e instanceof Error ? e.message : '原结果待核对'); throw e; }
    finally { if (working.current === viewOwner) working.current = undefined; if (mounted.current && owner.current === viewOwner && host?.current()) setBusy(false); }
  };
  const command = (submit: boolean) => {
    const generation = selectionVersion.current;
    return act(async () => {
    if (!ready || readPending() || !reason.trim()) throw new Error('先核对原操作和本次原因');
    if (generation !== selectionVersion.current) throw new Error('原服务选择已变化，请重新核对');
    if (!eligibility?.approvalRequired) throw new Error('当前订单没有可用的逐单企业付费准入');
    if (submit && (!confirmed || row?.state !== 'approved' || row.preview.services?.state !== 'available')) throw new Error('须本人核对本条批准后明确提交');
    const source = catalog;
    let at: string | undefined, serviceRequests: ClientQuoteServiceRequest[] = [];
    if (!submit) {
      if (!source) throw new Error('请先读取原公开服务候选');
      const instant = (value: string) => { const [date, time] = value.split('T'); return zonedToInstant(date ?? '', time ?? '', source.timeZone); };
      at = instant(newEndAt);
      serviceRequests = enterpriseExtensionServiceRequests(services.map(service => ({ serviceId: service.serviceId, quantity: service.quantity,
        ...(service.start || service.end ? { scheduledStartAt: instant(service.start), scheduledEndAt: instant(service.end) } : {}),
        ...(service.locationId ? { serviceLocationId: service.locationId } : {}) })), source);
      const originalKey = enterpriseExtensionServiceSelectionKey(serviceRequests, source), fresh = await readCatalog();
      if (generation !== selectionVersion.current || originalKey !== enterpriseExtensionServiceSelectionKey(serviceRequests, fresh)) throw new Error('原服务候选或选择已变化，请重新核对');
    }
    const value: Pending = { key: crypto.randomUUID(), orderId, kind: submit ? 'submit' : 'request', ...(submit ? { approvalId: row!.id } : {}) };
    remember(value);
    try { await sessionApi.enterpriseCommand(submit ? 'extension-approvals/submit' : 'extension-approvals', submit
      ? { approvalId: row!.id, expectedRevision: row!.revision, confirm: true, reason, operationKey: value.key }
      : { orderId, expectedOrderUpdatedAt: eligibility.expectedOrderUpdatedAt, extension: { newEndAt: at!, services: serviceRequests }, expectedRevision: 0, reason, operationKey: value.key }); }
    catch (e) { if ((e as { status?: number; code?: string }).status === 409 && (e as { code?: string }).code === 'enterprise_revision_conflict') { clear(value); await refresh(); } throw e; }
    await recoverOriginal(value);
    });
  };
  const closeOriginal = () => act(async () => {
    const value = readPending();
    if (!value || value.closureKey || !closureConfirmed || !closureReason.trim() || value.kind === 'submit' && (!value.approvalId || row?.id !== value.approvalId)) throw new Error('须本人核对原引用并明确确认受控结束');
    const reference: Pending = { ...value, closureKey: crypto.randomUUID() }; remember(reference);
    try {
      if (value.kind === 'request') await sessionApi.closeEnterpriseExtensionRequest(orderId, value.key, { operationKey: reference.closureKey!, expectedRevision: 0, reason: closureReason, confirm: true });
      else await sessionApi.enterpriseCommand(`extension-approvals/${encodeURIComponent(value.approvalId!)}/close-execution`, { operationKey: reference.closureKey, originalOperationKey: value.key, expectedRevision: row!.revision, reason: closureReason, confirm: true });
    }
    catch (error) {
      if (value.kind === 'submit' && (error as { status?: number; code?: string }).status === 409 && (error as { code?: string }).code === 'enterprise_revision_conflict') { remember(value); await refresh(); }
      throw error;
    }
    current(); await recoverOriginal(reference);
  });
  const read = () => act(async () => { const value = readPending(); if (value) await recoverOriginal(value); else { await refresh(); if (row) await readResult(row.id); } });
  const money = (value: number, currency: string) => Number.isFinite(value) && currency ? `${formatRentalMoney(value, currency)} ${currency}` : english ? 'Not recorded' : '原依据缺失';
  const blocked = !ready || busy || Boolean(pending);
  const changeService = (index: number, patch: Partial<ServiceChoice>) => { if (blocked) return; selectionVersion.current++; setConfirmed(false); setServices(items => items.map((item, position) => position === index ? { ...item, ...patch } : item)); };
  if (eligibility && !eligibility.approvalRequired && !rows.length && !pending && !requestClosed) return null;
  return <section className="booking-card">
    <h2>{english ? 'Enterprise extension approval' : '企业续租批准'}</h2>
    <p className="mock-note">{english ? 'Approval does not extend the rental or collect payment. Submit only after reviewing the original expense. Pending payment is not an effective extension.' : '批准不延长租期或收款。核对原费用后由本人提交；待补款不等于已延期。'}</p>
    {eligibility?.approvalRequired && <><label className="booking-field">{english ? 'Requested return time' : '申请归还时间'}<input type="datetime-local" value={newEndAt} disabled={blocked} onChange={event => { selectionVersion.current++; setNewEndAt(event.target.value); setConfirmed(false); }} /></label>
      {catalog && <p>{english ? 'Business time zone' : '营业时区'} · {catalog.timeZone}</p>}
      {services.map((service, index) => <fieldset key={index} disabled={blocked}>
        <label className="booking-field">{english ? 'Added service' : '新增服务'}<select value={service.serviceId} onChange={event => changeService(index, { serviceId: event.target.value })}><option value="">{english ? 'Select service' : '选择服务'}</option>{catalog?.services.filter(item => item.enabled).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="booking-field">{english ? 'Quantity' : '数量'}<input type="number" min={1} step={1} value={Number.isFinite(service.quantity) ? service.quantity : ''} onChange={event => changeService(index, { quantity: Number(event.target.value) })}/></label>
        <label className="booking-field">{english ? 'Independent start' : '独立服务开始'}<input type="datetime-local" value={service.start} onChange={event => changeService(index, { start: event.target.value })}/></label>
        <label className="booking-field">{english ? 'Independent end' : '独立服务结束'}<input type="datetime-local" value={service.end} onChange={event => changeService(index, { end: event.target.value })}/></label>
        <label className="booking-field">{english ? 'Service location' : '服务地点'}<select value={service.locationId} onChange={event => changeService(index, { locationId: event.target.value })}><option value="">{english ? 'Original default' : '原规则默认地点'}</option>{catalog?.locations.filter(location => location.status === 'enabled').map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <button type="button" className="button button-outline" onClick={() => { selectionVersion.current++; setConfirmed(false); setServices(items => items.filter((_, position) => position !== index)); }}>{english ? 'Remove selection' : '移除本次选择'}</button>
      </fieldset>)}
      <button type="button" className="button button-outline" disabled={blocked || !catalog || services.length >= 100} onClick={() => { selectionVersion.current++; setConfirmed(false); setServices(items => [...items, { serviceId: '', quantity: 1, start: '', end: '', locationId: '' }]); }}>{english ? 'Add a service selection' : '添加服务选择'}</button>
      <label className="booking-field">{english ? 'Purpose / reason' : '用途／本次原因'}<textarea value={reason} maxLength={500} disabled={blocked} onChange={event => setReason(event.target.value)} /></label>
      <button type="button" className="button button-outline" disabled={blocked || !catalog || !reason.trim()} onClick={() => void command(false).catch(() => {})}>{english ? 'Request extension approval' : '申请续租批准'}</button></>}
    {rows.length > 0 && <label className="booking-field">{english ? 'Original request' : '原续租申请'}<select value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setConfirmed(false); setOriginal(undefined); }}><option value="">{english ? 'Choose request' : '选择原申请'}</option>{rows.map(row => <option key={row.id} value={row.id}>{row.id} — {row.state}</option>)}</select></label>}
    {row && <><dl className="spec-list"><div><dt>{english ? 'Period' : '原申请租期'}</dt><dd>{new Date(row.preview.originalEndAt).toLocaleString()} — {new Date(row.preview.newEndAt).toLocaleString()}</dd></div>
      <div><dt>{english ? 'Rental payable' : '租赁应付'}</dt><dd>{money(row.preview.payableAmount, row.preview.currency)}</dd></div>
      <div><dt>{english ? 'Deposit / preauthorization delta' : '押金／预授权差额'}</dt><dd>{money(row.preview.depositDelta, row.preview.currency)} / {money(row.preview.preAuthDelta, row.preview.currency)}</dd></div>
      <div><dt>{english ? 'Approval expires' : '批准有效期'}</dt><dd>{new Date(row.expiresAt).toLocaleString()}</dd></div>
      {row.preview.chargeLines.map((line, i) => <div key={i}><dt>{line.name}</dt><dd>{money(line.amount, row.preview.currency)}</dd></div>)}</dl>
      {row.preview.services?.state === 'available' ? row.preview.services.items.length ? row.preview.services.items.map((service, index) => <section key={`${service.serviceId}:${index}`}><h4>{service.serviceName}</h4>
        <p>{service.requiredByRule ? english ? 'Required by the original business rule' : '原业务规则要求' : english ? 'Selected for this extension' : '本次续租选择'}</p>
        <p>{service.quantity} · {money(service.amount, row.preview.currency)} · {service.billingUnit}</p><p>{service.scheduledStartAt} — {service.scheduledEndAt}</p><p>{service.serviceLocationId}</p><p>{service.serviceVersion} · {service.termsVersion}</p><p>{service.terms}</p></section>)
        : <p>{english ? 'The original preview records no added services' : '原预览已记录无新增服务'}</p> : <p>{english ? 'Original service details unavailable' : '原服务明细不可用'}</p>}
      {row.state === 'approved' && <><label className="login-agree"><input type="checkbox" checked={confirmed} disabled={blocked || row.preview.services?.state !== 'available'} onChange={event => setConfirmed(event.target.checked)} /><span>{english ? 'I reviewed this original extension and expense, and explicitly submit' : '我已核对本条原续租与费用，明确提交'}</span></label><button type="button" className="button button-dark" disabled={blocked || !confirmed || !reason.trim() || row.preview.services?.state !== 'available'} onClick={() => void command(true).catch(() => {})}>{english ? 'Explicitly submit this extension' : '核对后提交本条续租'}</button></>}
    </>}
    <button type="button" className="button button-outline" disabled={busy || !ready} onClick={() => void read().catch(() => {})}>{english ? 'Read original request and result' : '核对原续租申请与结果'}</button>
    {pending && !pending.closureKey && (pending.kind === 'request' || row?.id === pending.approvalId) && <>
      <label className="booking-field">{english ? 'Reason for controlled closure' : '受控结束原因'}<textarea value={closureReason} maxLength={500} disabled={busy} onChange={event => setClosureReason(event.target.value)} /></label>
      <label className="login-agree"><input type="checkbox" checked={closureConfirmed} disabled={busy} onChange={event => setClosureConfirmed(event.target.checked)} /><span>{pending.kind === 'request' ? english ? 'Seal this original request key; if a request exists, recover it without withdrawing or retrying' : '封闭本条原申请键；若申请已成立只恢复，不撤回或重发' : english ? 'Seal this original submission; do not cancel or retry an existing extension' : '封闭本条原提交，不取消已成立续租，也不重试执行'}</span></label>
      <button type="button" className="button button-outline" disabled={busy || !closureConfirmed || !closureReason.trim()} onClick={() => void closeOriginal().catch(() => {})}>{english ? 'Request controlled closure' : '请求受控结束原提交'}</button>
    </>}
    {requestClosed && <p className="mock-note">{english ? 'Original request key sealed. No existing request or extension was cancelled; any new request needs a new preview and explicit action.' : '原申请键已封闭，未取消任何已成立申请或续租；新申请须重新试算并明确发起。'}</p>}
    {original && <p className="mock-note">{original.original.state === 'observed' ? original.original.extensionState === 'pending_payment' ? english ? 'Awaiting payment; original return time unchanged' : '待补款，原归还时间不变' : `${original.original.extensionState}: ${original.original.extensionId}` : original.original.state === 'closed' ? english ? 'Original submission sealed; any new request needs a new preview and approval' : '原提交已封闭；新申请须重新试算与批准' : english ? 'Not submitted to Core' : '尚未提交至Core'}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>;
}
