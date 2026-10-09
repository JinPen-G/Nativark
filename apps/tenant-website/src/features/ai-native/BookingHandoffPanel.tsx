import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AiBookingHandoff } from '../../../../../packages/shared/src/ai-booking-draft';
import { createBookingHandoffConsumer, type BookingHandoffHost, type BookingHandoffState, type BookingPageContext } from './booking-handoff';

export function BookingHandoffPanel({ host, context, sessionIdentity, onContinue, children, english }: {
  host: BookingHandoffHost; context: BookingPageContext; sessionIdentity: unknown; english: boolean;
  onContinue: (handoff: AiBookingHandoff) => void;
  children: (handoff: AiBookingHandoff) => ReactNode;
}) {
  const [view, setView] = useState<{ owner: object; state: BookingHandoffState } | null>(null);
  const consumer = useMemo(() => {
    const owner = {};
    return { owner, controller: createBookingHandoffConsumer(host, context, state => setView({ owner, state })) };
  }, [host, sessionIdentity, context.tenantCode, context.workspaceCode, context.customerId, context.authenticated, context.productId]);
  // New context's first render cannot expose the previous instance's reference.
  const state = view?.owner === consumer.owner ? view.state : { status: 'disabled', handoff: null } as BookingHandoffState;
  const currentOwner = useRef(consumer.owner);
  currentOwner.current = consumer.owner;
  useEffect(() => {
    currentOwner.current = consumer.owner;
    consumer.controller.mount();
    return () => { consumer.controller.destroy(); if (currentOwner.current === consumer.owner) currentOwner.current = {}; };
  }, [consumer]);
  const text = (zh: string, en: string) => english ? en : zh;
  const proceed = async () => {
    const handoff = await consumer.controller.continue();
    if (handoff && currentOwner.current === consumer.owner) onContinue(handoff);
  };
  return <>
    <section className="booking-card" aria-busy={state.status === 'loading'}>
      <h2>{text('原预约材料交接', 'Original booking handoff')}</h2>
      <p role="status" aria-live="polite">{state.status === 'loading' ? text('读取中…', 'Reading…')
        : state.status === 'unavailable' ? text('材料不可用、已变化或无法映射，请返回原办理入口。', 'Unavailable, changed or unsupported. Return to the original booking entry.')
        : text('尚未提交预约；资源未预占。', 'Booking not submitted; resources not reserved.')}</p>
      {state.handoff && <dl>
        <dt>{text('原引用 / 修订', 'Original reference / revision')}</dt><dd style={{ overflowWrap: 'anywhere' }}>{state.handoff.handoffRef} / {state.handoff.revision}</dd>
        <dt>{text('原报价', 'Original quote')}</dt><dd style={{ overflowWrap: 'anywhere' }}>{state.handoff.fields.quoteId}</dd>
        <dt>{text('有效期', 'Expires')}</dt><dd>{state.handoff.expiresAt}</dd>
        <dt>{text('租户时区', 'Tenant time zone')}</dt><dd>{state.handoff.fields.timeZone}</dd>
        <dt>{text('原起止时间', 'Original start / end')}</dt><dd>{state.handoff.fields.startAt} / {state.handoff.fields.endAt}</dd>
      </dl>}
      {state.status !== 'continued' && <button type="button" className="button button-dark" disabled={state.status === 'loading'}
        onClick={() => { void consumer.controller.read(); }}>{text('读取原材料', 'Read original handoff')}</button>}
      {state.status === 'available' && <button type="button" className="button button-dark" onClick={() => { void proceed(); }}>
        {text('人工继续：复验并填入原表单', 'Continue: recheck and fill original form')}</button>}
    </section>
    {state.status === 'continued' && state.handoff && children(state.handoff)}
  </>;
}
