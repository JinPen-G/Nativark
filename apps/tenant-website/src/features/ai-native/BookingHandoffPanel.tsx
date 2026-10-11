import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSite } from '../../SiteContext';
import type { AiBookingHandoff } from '../../../../../packages/shared/src/ai-booking-draft';
import { createBookingHandoffConsumer, type BookingHandoffHost, type BookingHandoffState, type BookingPageContext } from './booking-handoff';

export function BookingHandoffPanel({ host, context, sessionIdentity, onContinue, children, english }: {
  host: BookingHandoffHost; context: BookingPageContext; sessionIdentity: unknown; english: boolean;
  onContinue: (handoff: AiBookingHandoff) => void;
  children: (handoff: AiBookingHandoff) => ReactNode;
}) {
  const [view, setView] = useState<{ owner: object; state: BookingHandoffState } | null>(null);
  const [consent, setConsent] = useState<{ owner: object; agreed: boolean } | null>(null);
  const { href } = useSite();
  const consumer = useMemo(() => {
    const owner = {};
    return { owner, controller: createBookingHandoffConsumer(host, context, state => setView({ owner, state })) };
  }, [host, sessionIdentity, context.tenantCode, context.workspaceCode, context.customerId, context.authenticated, context.productId]);
  // New context's first render cannot expose the previous instance's reference.
  const state = view?.owner === consumer.owner ? view.state : { status: 'disabled', handoff: null } as BookingHandoffState;
  const currentOwner = useRef(consumer.owner);
  const agreed = consent?.owner === consumer.owner && consent.agreed;
  currentOwner.current = consumer.owner;
  useEffect(() => {
    currentOwner.current = consumer.owner;
    consumer.controller.mount();
    const visibility = () => {
      if (document.hidden) { consumer.controller.pause(); setConsent(null); }
      else consumer.controller.resume();
    };
    document.addEventListener('visibilitychange', visibility);
    if (document.hidden) visibility();
    return () => { document.removeEventListener('visibilitychange', visibility); consumer.controller.destroy();
      if (currentOwner.current === consumer.owner) currentOwner.current = {}; };
  }, [consumer]);
  const text = (zh: string, en: string) => english ? en : zh;
  const proceed = async () => {
    const handoff = await consumer.controller.continue();
    if (handoff && currentOwner.current === consumer.owner) onContinue(handoff);
  };
  const busy = ['loading', 'accepting', 'submitting', 'checking'].includes(state.status);
  const available = consumer.controller.submissionsAvailable();
  return <>
    <section className="booking-card" aria-busy={busy}>
      <h2>{text('原预约材料交接', 'Original booking handoff')}</h2>
      <p role="status" aria-live="polite">{state.status === 'loading' ? text('读取中…', 'Reading…')
        : state.status === 'unavailable' ? text('材料不可用、已变化或无法映射，请返回原办理入口。', 'Unavailable, changed or unsupported. Return to the original booking entry.')
        : state.status === 'pending_reconcile' ? text('结果待核对，不自动再次下单。', 'Pending reconciliation. No automatic resubmission.')
        : state.status === 'order_observed' ? text('已找到原订单；付款与履约尚未据此确认。', 'Original order found; payment and fulfillment are not inferred.')
        : busy ? text('处理中…', 'Processing…')
        : text('材料和受理不是建单成功；资源是否占用以原业务结果为准。', 'Material and acceptance are not order creation; resource state comes from the original business result.')}</p>
      {state.handoff && <dl>
        <dt>{text('原引用 / 修订', 'Original reference / revision')}</dt><dd style={{ overflowWrap: 'anywhere' }}>{state.handoff.handoffRef} / {state.handoff.revision}</dd>
        <dt>{text('原报价', 'Original quote')}</dt><dd style={{ overflowWrap: 'anywhere' }}>{state.handoff.fields.quoteId}</dd>
        <dt>{text('有效期', 'Expires')}</dt><dd>{state.handoff.expiresAt}</dd>
        <dt>{text('租户时区', 'Tenant time zone')}</dt><dd>{state.handoff.fields.timeZone}</dd>
        <dt>{text('原起止时间', 'Original start / end')}</dt><dd>{state.handoff.fields.startAt} / {state.handoff.fields.endAt}</dd>
      </dl>}
      {['disabled', 'loading', 'available', 'unavailable'].includes(state.status) && <button type="button" className="button button-dark" disabled={busy}
        onClick={() => { void consumer.controller.read(); }}>{text('读取原材料', 'Read original handoff')}</button>}
      {state.status === 'available' && <button type="button" className="button button-dark" onClick={() => { void proceed(); }}>
        {text('人工继续：复验并填入原表单', 'Continue: recheck and fill original form')}</button>}
      {['continued', 'accepting', 'accepted'].includes(state.status) && <>
        <label><input type="checkbox" checked={Boolean(agreed)} disabled={busy}
          onChange={event => setConsent({ owner: consumer.owner, agreed: event.target.checked })} />
          {text('我已检查原预约条件并明确继续办理', 'I have reviewed the original booking conditions and wish to proceed')}</label>
        {state.status === 'accepted'
          ? <button type="button" className="button button-dark" disabled={!available || !agreed || busy}
              onClick={() => { if (agreed) void consumer.controller.submit(); }}>{text('明确提交原预约', 'Submit original booking')}</button>
          : <button type="button" className="button button-dark" disabled={!available || !agreed || busy}
              onClick={() => { if (agreed) void consumer.controller.accept(); }}>{available ? text('受理原预约材料', 'Accept original booking material') : text('提交能力未接通', 'Submission unavailable')}</button>}
      </>}
      {available && ['disabled', 'unavailable', 'pending_reconcile'].includes(state.status) && <button type="button" className="button button-dark"
        onClick={() => { void consumer.controller.reconcile(); }}>{text('只核对原提交', 'Read original receipt only')}</button>}
      {state.receipt?.state === 'observed' && <Link className="button button-dark" to={href(`/orders/${encodeURIComponent(state.receipt.orderId)}`)}>
        {text('查看原订单', 'View original order')}</Link>}
    </section>
    {['continued', 'accepting', 'accepted'].includes(state.status) && state.handoff && children(state.handoff)}
  </>;
}
