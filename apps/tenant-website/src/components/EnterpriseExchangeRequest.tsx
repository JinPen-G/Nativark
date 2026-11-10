/** Minimal own-order exchange application. Candidates are not reserved; only the
 * original service creates approval. Uncertain application/closure stays read-only. */
import { useEffect, useRef, useState } from 'react';
import type { EnterpriseExchangeChoices, EnterpriseExchangeIntent, EnterpriseExchangeRequestOriginalResult } from '@rental-os/shared';
import { captureEnterpriseHostSession, sessionApi, subscribeCustomerSession } from '../data/authClient';
import { exchangeRequestOperation } from './enterprise-exchange-request';

export function EnterpriseExchangeRequest({ orderId, identity, english, allowNewRequest }: { orderId: string; identity: string; english: boolean; allowNewRequest: boolean }) {
  const host = captureEnterpriseHostSession(), viewOwner = JSON.stringify([orderId, identity, host?.identity]);
  const owner = useRef(viewOwner); owner.current = viewOwner;
  const mounted = useRef(true), sequence = useRef(0), working = useRef<string | undefined>(undefined);
  const [choices, setChoices] = useState<{ owner: string; value: EnterpriseExchangeChoices }>();
  const [allocationId, setAllocationId] = useState(''), [replacementId, setReplacementId] = useState(''), [assetId, setAssetId] = useState(''), [pricingId, setPricingId] = useState('');
  const [priceBasis, setPriceBasis] = useState<EnterpriseExchangeIntent['priceBasis']>('original_order_price'), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [closing, setClosing] = useState(false), [error, setError] = useState('');
  const [closureReason, setClosureReason] = useState(''), [closureConfirmed, setClosureConfirmed] = useState(false), [notice, setNotice] = useState('');
  const current = () => mounted.current && owner.current === viewOwner && Boolean(host?.current());
  const operation = () => {
    if (!host || !current()) throw new Error('原订单会话已变化');
    return exchangeRequestOperation(orderId, host, () => { if (!current()) throw new Error('原订单页面已变化'); });
  };
  const reset = () => { sequence.current++; setChoices(undefined); setAllocationId(''); setReplacementId(''); setAssetId(''); setPricingId(''); setReason(''); setPriceBasis('original_order_price'); setClosureReason(''); setClosureConfirmed(false); };
  const sync = () => { const value = operation().pending(); setPending(Boolean(value)); setClosing(Boolean(value?.closureKey)); };
  useEffect(() => {
    mounted.current = true; reset(); setBusy(false); setError(''); setNotice(''); setPending(false); setClosing(false);
    try { if (current()) sync(); } catch (e) { setError(e instanceof Error ? e.message : '原引用不可读取'); }
    const unsubscribe = host ? subscribeCustomerSession(host.tenantCode, () => {
      if (!host.current() && mounted.current) { reset(); setBusy(false); setError(''); setNotice(''); setPending(false); setClosing(false); }
    }) : () => {};
    return () => { mounted.current = false; sequence.current++; unsubscribe(); };
  }, [viewOwner]);
  const loadChoices = async (allocation = allocationId, replacement = replacementId) => {
    if (!current() || !allowNewRequest || working.current === viewOwner) return;
    const request = ++sequence.current; setBusy(true); setError(''); setChoices(undefined); setAssetId(''); setPricingId('');
    try {
      const action = operation(); if (action.pending()) throw new Error('须先核对原申请，不能更新候选');
      const value = await sessionApi.enterpriseExchangeChoices(orderId, { ...(allocation ? { allocationId: allocation } : {}), ...(replacement ? { replacementItemGroupId: replacement } : {}) });
      if (!current() || sequence.current !== request) return;
      if (value.orderId !== orderId || value.applicantCustomerId !== host?.customerId || !value.workspaceId || value.reservation !== 'not_reserved'
        || value.selectedAllocationId !== (allocation || undefined) || value.selectedReplacementItemGroupId !== (replacement || undefined)
        || !Number.isFinite(Date.parse(value.expectedOrderUpdatedAt))) throw new Error('原订单候选引用不匹配');
      setChoices({ owner: viewOwner, value });
    } catch (e) { if (current() && sequence.current === request) setError(e instanceof Error ? e.message : '候选不可读取'); }
    finally { if (current() && sequence.current === request) setBusy(false); }
  };
  const value = choices?.owner === viewOwner ? choices.value : undefined;
  const replacement = value?.replacements.find(row => row.itemGroupId === replacementId);
  const complete = value?.selectedAllocationId === allocationId && value.selectedReplacementItemGroupId === replacementId && replacement
    && (replacement.inventoryMode !== 'serialized' || value.assets.some(row => row.assetId === assetId));
  const observed = (result: EnterpriseExchangeRequestOriginalResult | undefined) => {
    if (!current()) throw new Error('原订单页面已变化');
    if (!result || result.state === 'not_recorded') throw new Error('原申请仍待核对，不能重新发送');
    reset(); setNotice(result.state === 'closed' ? english ? 'Original request key sealed; no existing exchange or payment was cancelled.' : '原申请键已封闭，未取消任何已成立换货或支付。'
      : english ? `Original expense request observed: ${result.approval.state}. Exchange not executed.` : `原费用申请已核对：${result.approval.state}；换货未执行。`);
  };
  const act = async (kind: 'request' | 'read' | 'close') => {
    if (!current() || busy || working.current === viewOwner) return;
    if (kind === 'request' && (!allowNewRequest || !complete || error || pending || !reason.trim())) return;
    if (kind === 'close' && (!pending || closing || !closureConfirmed || !closureReason.trim())) return;
    working.current = viewOwner; setBusy(true); setError('');
    try {
      const action = operation();
      if (kind === 'read') observed(await action.recover());
      else if (kind === 'close') observed(await action.close(closureReason));
      else {
        const line = value!.lines.find(row => row.allocationId === allocationId);
        if (!line || !replacement || replacement.inventoryMode === 'quantity' && assetId || pricingId && !replacement.pricingGroups.some(row => row.id === pricingId)) throw new Error('须重新核对本次换货候选');
        const exchange: EnterpriseExchangeIntent = { orderLineId: line.orderLineId, allocationId, replacementItemGroupId: replacementId, priceBasis,
          ...(assetId ? { replacementAssetId: assetId } : {}), ...(pricingId ? { replacementPricingGroupId: pricingId } : {}) };
        observed(await action.request({ orderId, expectedOrderUpdatedAt: value!.expectedOrderUpdatedAt, expectedRevision: 0, reason: reason.trim(), exchange }));
      }
    } catch (e) { if (current()) setError(e instanceof Error ? e.message : '原申请结果待核对'); }
    finally { if (working.current === viewOwner) working.current = undefined; if (current()) { try { sync(); } catch (e) { setError(e instanceof Error ? e.message : '原引用不可读取'); } setBusy(false); } }
  };
  if (!current() || !allowNewRequest && !pending && !error) return null;
  const blocked = busy || pending;
  return <section className="booking-card">
    <h2>{english ? 'Request exchange spending approval' : '申请本单换货费用批准'}</h2>
    <p className="mock-note">{english ? 'Own enterprise-paid order only. Candidates are not reserved; approval does not execute an exchange or confirm inspection.' : '仅本人企业付费订单；候选不预占，批准不执行换货，也不确认检查。'}</p>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <button type="button" className="button button-outline" disabled={blocked || !allowNewRequest} onClick={() => void loadChoices()}>{english ? 'Read exchange choices' : '读取换货候选'}</button>
    {value && allowNewRequest && <>
      <label className="booking-field">{english ? 'Picked-up item' : '已领取商品'}<select value={allocationId} disabled={blocked} onChange={event => { const id = event.target.value; setAllocationId(id); setReplacementId(''); void loadChoices(id, ''); }}><option value="">{english ? 'Choose original item' : '选择原商品'}</option>{value.lines.map(row => <option key={row.allocationId} value={row.allocationId}>{row.itemGroupName} × {row.quantity}{row.assetNo ? ` · ${row.assetNo}` : ''}</option>)}</select></label>
      <label className="booking-field">{english ? 'Replacement item' : '替换商品'}<select value={replacementId} disabled={blocked || !allocationId} onChange={event => { const id = event.target.value; setReplacementId(id); void loadChoices(allocationId, id); }}><option value="">{english ? 'Choose replacement' : '选择替换商品'}</option>{value.replacements.map(row => <option key={row.itemGroupId} value={row.itemGroupId}>{row.name}</option>)}</select></label>
      {replacement?.inventoryMode === 'serialized' && <label className="booking-field">{english ? 'Available replacement asset' : '可用替换资产'}<select value={assetId} disabled={blocked} onChange={event => setAssetId(event.target.value)}><option value="">{english ? 'Choose available asset' : '选择可用资产'}</option>{value.assets.map(row => <option key={row.assetId} value={row.assetId}>{row.assetNo}</option>)}</select></label>}
      {replacement?.inventoryMode === 'serialized' && !value.assets.length && <p className="mock-note">{english ? 'No replacement asset currently available' : '当前没有可用替换资产'}</p>}
      {Boolean(replacement?.pricingGroups.length) && <label className="booking-field">{english ? 'Pricing group (optional)' : '定价分组（可选）'}<select value={pricingId} disabled={blocked} onChange={event => setPricingId(event.target.value)}><option value="">{english ? 'Original service selection' : '由原服务选择'}</option>{replacement!.pricingGroups.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
      <label className="booking-field">{english ? 'Price basis' : '价格依据'}<select value={priceBasis} disabled={blocked} onChange={event => setPriceBasis(event.target.value as EnterpriseExchangeIntent['priceBasis'])}><option value="original_order_price">{english ? 'Original order price' : '原订单价格'}</option><option value="replacement_current_price">{english ? 'Replacement current price' : '替换商品当前价格'}</option></select></label>
      <label className="booking-field">{english ? 'Purpose of this request' : '本次申请用途'}<textarea value={reason} maxLength={500} disabled={blocked} onChange={event => setReason(event.target.value)} /></label>
      <button type="button" className="button button-dark" disabled={blocked || Boolean(error) || !complete || !reason.trim()} onClick={() => void act('request')}>{english ? 'Request this exchange expense approval' : '申请本次换货费用批准'}</button>
    </>}
    {pending && <>
      <p className="mock-note">{english ? 'Original request unresolved; do not submit again.' : '原申请结果待核对，不重新提交。'}</p>
      <button type="button" className="button button-outline" disabled={busy} onClick={() => void act('read')}>{english ? 'Read original exchange request' : '核对原换货申请'}</button>
      {!closing && <>
        <label className="booking-field">{english ? 'Independent closure reason' : '独立结束原因'}<textarea value={closureReason} maxLength={500} disabled={busy} onChange={event => setClosureReason(event.target.value)} /></label>
        <label className="login-agree"><input type="checkbox" checked={closureConfirmed} disabled={busy} onChange={event => setClosureConfirmed(event.target.checked)} /><span>{english ? 'Permanently seal this original key if no request exists; otherwise recover the existing request without withdrawal.' : '未成立时永久封闭原键；若申请已成立只恢复，不撤回。我独立确认结束原申请。'}</span></label>
        <button type="button" className="button button-outline" disabled={busy || !closureConfirmed || !closureReason.trim()} onClick={() => void act('close')}>{english ? 'Request original-key closure' : '请求结束原申请键'}</button>
      </>}
    </>}
  </section>;
}
