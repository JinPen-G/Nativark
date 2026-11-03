/** Explicit original answer and Core fact reads. Render text inertly, keep money
 * copied from the original facts, and retract both on scope/source failure. */
import { useEffect, useRef, useState } from 'react';
import type { AiConversationTurnObservationDraft } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { ActionButton, Alert } from '@/components/ui';
import { readConversationOrderResults } from './conversation-order-results-reader';
import { ModelText } from './ModelText';
import { useAiManagementLocale } from './management-locale';
import { safeDisplayText } from './safe-display';

type Results = Awaited<ReturnType<typeof readConversationOrderResults>>;
const amounts = ['rental', 'service', 'discount', 'coupon', 'deposit', 'preAuthorization', 'finalPayable'] as const;
const labels = { rental: '租金', service: '服务', discount: '折扣', coupon: '优惠券', deposit: '押金', preAuthorization: '预授权', finalPayable: '最终应付' };
export function ConversationOrderResults({ conversationId, turn, current }: {
  conversationId: string; turn: AiConversationTurnObservationDraft; current: () => boolean;
}) {
  const { t } = useAiManagementLocale();
  const [result, setResult] = useState<Results | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null), generation = useRef(0), mounted = useRef(false);
  const binding = JSON.stringify([conversationId, turn]), scope = useRef({ binding, current }); scope.current = { binding, current };
  useEffect(() => {
    const clear = () => { generation.current++; request.current?.abort(); request.current = null; setResult(null); setBusy(false); setError(false); };
    clear(); mounted.current = true; document.addEventListener('visibilitychange', clear);
    return () => { mounted.current = false; generation.current++; request.current?.abort(); request.current = null; document.removeEventListener('visibilitychange', clear); };
  }, [binding]);
  const read = async () => {
    if (!mounted.current || request.current || document.hidden || scope.current.binding !== binding || !scope.current.current()) throw Error('AI_SCOPE_CHANGED');
    const owner = ++generation.current, controller = new AbortController(); request.current = controller;
    setResult(null); setBusy(true); setError(false);
    const active = () => mounted.current && owner === generation.current && !controller.signal.aborted && !document.hidden
      && scope.current.binding === binding && scope.current.current();
    try {
      const value = await readConversationOrderResults(aiConversationsApi, conversationId, turn, controller.signal, active);
      if (!active()) throw Error('AI_SCOPE_CHANGED'); setResult(value);
    } catch (failure) { if (active()) setError(true); throw failure; }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  const facts = result?.facts.result.status === 'available' ? result.facts.result.facts : null;
  return <section aria-label={t('原订单事实与回答')} aria-busy={busy}>
    <ActionButton label={t('读取原订单事实与回答')} disabled={busy} onAction={read} />
    {error && <Alert type="warning" title={t('原订单结果不可读取或已变化，旧事实和回答已撤回；不自动重试。')} />}
    {result && <>
      <p>{t('事实与回答经过独立复验，不是原子快照；模型文字不证明付款、退款或业务完成。')}</p>
      {facts ? <section aria-label={t('权威订单事实')}>
        <p>{safeDisplayText(facts.order.orderNo, 191)} · {safeDisplayText(facts.order.status, 80)}</p>
        <p>{t('查询时点')}: {safeDisplayText(facts.observedAt, 40)}</p>
        <p>{t('订单来源')}: {safeDisplayText(facts.sources[0].resourceId, 191)} · {t('来源空间')}: {safeDisplayText(facts.scope.workspaceId, 191)}</p>
        <dl>{amounts.map(key => <div key={key}><dt>{t(labels[key])}</dt><dd>{facts.order.amounts[key] === null
          ? t('未加载') : `${String(facts.order.amounts[key])} ${facts.order.currency}`}</dd></div>)}</dl>
        <p>{t('支付凭证与历史费用依据未加载，不代表支付已完成。')}</p>
      </section> : <p>{t(result.facts.result.status === 'stale' ? '事实已变化，旧正文不显示，请回原业务页核对。'
        : result.facts.result.status === 'unknown' ? '结果待核对，不自动重试。' : '原事实步骤未提供可展示结果。')}</p>}
      {result.answer.result.status === 'available' ? <ModelText text={result.answer.result.text} />
        : <p>{t(result.answer.result.status === 'stale' ? '事实已变化，旧正文不显示，请回原业务页核对。'
          : result.answer.result.status === 'unknown' ? '结果待核对，不自动重试。' : '原回答未提供可展示结果。')}</p>}
    </>}
  </section>;
}
