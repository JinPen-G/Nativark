/** Own original-order progress and single-dispatch employee expense consent.
 * Neither consent nor its receipt confirms inspection or physical execution. */
import { useEffect, useRef, useState } from 'react';
import { formatRentalMoney, type EnterpriseExchangeApprovalView } from '@rental-os/shared';
import { enterpriseHref } from '@rental-os/web-client';
import { captureEnterpriseHostSession, sessionApi, subscribeCustomerSession } from '../data/authClient';
import { useSite } from '../SiteContext';
import { exchangeExpenseConfirmation } from './enterprise-exchange-confirmation';

export function EnterpriseExchangeProgress({ orderId, identity, english }: { orderId: string; identity: string; english: boolean }) {
  const { tenantCode, enterpriseDomainBound } = useSite(), host = captureEnterpriseHostSession();
  const viewOwner = JSON.stringify([identity, orderId, host?.identity, tenantCode, enterpriseDomainBound]), owner = useRef(viewOwner); owner.current = viewOwner;
  const mounted = useRef(true), sequence = useRef(0), working = useRef<string | undefined>(undefined);
  const [result, setResult] = useState<{ owner: string; rows: EnterpriseExchangeApprovalView[] }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [pending, setPending] = useState(false), [selected, setSelected] = useState(''), [reason, setReason] = useState(''), [agreed, setAgreed] = useState(false);
  const current = () => mounted.current && owner.current === viewOwner && Boolean(host?.current()) && host?.tenantCode === tenantCode;
  const operation = () => {
    if (!host || !current()) throw new Error('原客户页面已变化');
    return exchangeExpenseConfirmation(orderId, host, () => { if (!current()) throw new Error('原客户页面已变化'); });
  };
  const read = async () => {
    if (!current()) return;
    const request = ++sequence.current; setBusy(true); setError(''); setResult(undefined); setSelected(''); setReason(''); setAgreed(false);
    try {
      setPending(Boolean(operation().pending()));
      const rows = await sessionApi.enterpriseOrderExchangeApprovals(orderId);
      if (!current() || sequence.current !== request) return;
      if (!Array.isArray(rows) || rows.length > 200 || rows.some(row => row.orderId !== orderId || row.applicantCustomerId !== host?.customerId || !row.workspaceId)) throw new Error('本单换货申请引用不可核对 / Original exchange references do not match');
      setResult({ owner: viewOwner, rows });
    } catch (e) {
      if (current() && sequence.current === request) setError(e instanceof Error ? e.message : '本单换货进度不可读取');
    } finally { if (current() && sequence.current === request) setBusy(false); }
  };
  useEffect(() => {
    mounted.current = true; setResult(undefined); setError(''); setBusy(false); setPending(false); setSelected(''); setReason(''); setAgreed(false);
    if (current()) void read();
    const unsubscribe = host ? subscribeCustomerSession(host.tenantCode, () => {
      if (!host.current() && mounted.current) { sequence.current++; setResult(undefined); setError(''); setBusy(false); setSelected(''); setReason(''); setAgreed(false); setPending(false); }
    }) : () => {};
    return () => { mounted.current = false; sequence.current++; unsubscribe(); };
  }, [viewOwner]);
  const act = async (recover: boolean) => {
    if (!current() || working.current === viewOwner) return;
    const row = result?.owner === viewOwner ? result.rows.find(row => row.id === selected) : undefined;
    if (!recover && (busy || error || pending || !row || !reason.trim() || !agreed)) return;
    working.current = viewOwner; setBusy(true); setError('');
    try {
      const action = operation();
      if (recover) await action.recover(); else await action.confirm(row!, reason);
      action.current(); await read();
    } catch (e) { if (current()) setError(e instanceof Error ? e.message : '原确认结果待核对'); }
    finally {
      if (working.current === viewOwner) working.current = undefined;
      if (current()) { try { setPending(Boolean(operation().pending())); } catch (e) { setError(e instanceof Error ? e.message : '原引用不可读取'); } setBusy(false); }
    }
  };
  if (!current()) return null;
  const rows = result?.owner === viewOwner ? result.rows : undefined;
  if (rows && !rows.length && !pending) return null;
  const state = (row: EnterpriseExchangeApprovalView) => (english
    ? { pending: 'Awaiting enterprise approval', approved: row.employeeConfirmation ? 'Expense confirmed; exchange not executed' : 'Approved; applicant expense confirmation pending', rejected: 'Rejected', withdrawn: 'Withdrawn', expired: 'Expired; original consent is not an execution grant' }
    : { pending: '待企业批准', approved: row.employeeConfirmation ? '本人已确认费用，换货未执行' : '已批准，待本人确认费用', rejected: '已拒绝', withdrawn: '已撤回', expired: '已失效，原费用确认不是执行授权' })[row.state];
  const money = (value: number, currency: string) => Number.isFinite(value) && currency ? `${formatRentalMoney(value, currency)} ${currency}` : english ? 'Not recorded' : '原金额缺失';
  const time = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(english ? 'en-US' : 'zh-CN', { timeZoneName: 'short' }) : english ? 'Not recorded' : '原时间缺失';
  const link = `${enterpriseHref(tenantCode!, enterpriseDomainBound)}/exchange-approvals`;
  return <section className="booking-card">
    <h2>{english ? 'This order’s exchange spending requests' : '本单企业换货费用申请'}</h2>
    <p className="mock-note">{english ? 'Approval and expense consent do not reserve stock, confirm merchant inspection, collect payment or execute an exchange.' : '批准和费用同意不预占库存、不确认商户检查、不收款，也不执行换货。'}</p>
    {busy && <p role="status">{english ? 'Reading original requests' : '正在读取原申请'}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {rows?.map(row => <article key={row.id}>
      <h3>{row.preview.originalItemGroupName} — {row.preview.replacementItemGroupName}</h3>
      <dl className="spec-list">
        <div><dt>{english ? 'Request state' : '申请状态'}</dt><dd>{state(row)}</dd></div>
        <div><dt>{english ? 'Added spending' : '新增支出'}</dt><dd>{money(row.preview.additionalAmount, row.preview.currency)}</dd></div>
        <div><dt>{english ? 'Deposit / preauthorization delta' : '押金／预授权差额'}</dt><dd>{money(row.preview.depositDelta, row.preview.currency)} / {money(row.preview.preAuthDelta, row.preview.currency)}</dd></div>
        <div><dt>{english ? 'Approval expires' : '批准有效期'}</dt><dd>{time(row.expiresAt)}</dd></div>
        <div><dt>{english ? 'Purpose' : '原用途'}</dt><dd>{row.reason}</dd></div>
        {row.employeeConfirmation && <div><dt>{english ? 'Applicant expense consent' : '本人费用确认'}</dt><dd>{time(row.employeeConfirmation.confirmedAt)}</dd></div>}
      </dl>
      {row.state === 'approved' && !row.employeeConfirmation && <button type="button" className="button button-outline" disabled={busy || pending || Boolean(error)} onClick={() => { if (!current()) return; setSelected(row.id); setReason(''); setAgreed(false); }}>{english ? 'Review this approved expense' : '核对本次已批准费用'}</button>}
      {selected === row.id && row.state === 'approved' && !row.employeeConfirmation && <div>
        <label className="booking-field">{english ? 'Reason for this expense consent' : '本次费用确认原因'}<textarea value={reason} maxLength={500} disabled={busy || pending} onChange={event => setReason(event.target.value)} /></label>
        <label className="login-agree"><input type="checkbox" checked={agreed} disabled={busy || pending} onChange={event => setAgreed(event.target.checked)} /><span>{english ? 'I reviewed this approved expense; this is not merchant inspection, payment or exchange execution' : '我已核对本次已批准费用；不代表商户检查、收付款或换货执行'}</span></label>
        <button type="button" className="button button-dark" disabled={busy || pending || Boolean(error) || !reason.trim() || !agreed} onClick={() => void act(false)}>{english ? 'Confirm this expense only' : '仅确认本次费用'}</button>
      </div>}
    </article>)}
    {pending && <><p className="mock-note">{english ? 'Original expense consent is unresolved; read its result, do not confirm again.' : '原费用确认结果待核对，只能回读，不重新确认。'}</p><button type="button" className="button button-outline" disabled={busy} onClick={() => void act(true)}>{english ? 'Read original expense consent' : '核对原费用确认结果'}</button></>}
    <button type="button" className="button button-outline" disabled={busy} onClick={() => void read()}>{english ? 'Read original exchange progress' : '读取原换货进度'}</button>
    <a className="button button-dark" href={link}>{english ? 'Open enterprise exchange requests' : '进入企业换货申请'}</a>
  </section>;
}
