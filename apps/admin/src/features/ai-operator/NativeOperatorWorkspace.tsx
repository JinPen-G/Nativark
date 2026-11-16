/** Original human controls in the console's existing work area. Sending a chat
 * never adopts candidates, approves an order or substitutes model text for Core. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { aiConversationsApi } from '@/api/aiConversations';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Select } from '@/components/ui';
import { ContentTransition } from '@/components/workspace/ContentTransition';
import { ConversationResult } from '../ai-native/ConversationResult';
import { ConversationQuoteConfirmation } from '../ai-native/ConversationQuoteConfirmation';
import { ConversationQuoteSelection } from '../ai-native/ConversationQuoteSelection';
import type { QuoteAnswerReference, ConfirmedQuoteSource } from '../ai-native/conversation-quote-confirmation-session';
import { ConversationOrderHandoff } from '../ai-native/ConversationOrderHandoff';
import { ConversationClosure } from '../ai-native/ConversationClosure';
import { ConversationAdmissionSession } from '../ai-native/conversation-admission-session';
import { AgentRun } from './archive/agent-run/AgentRun';
import type { NativeFrame } from './native-session';
import { useOperator } from './OperatorContext';

export function NativeOperatorWorkspace({ visible }: { visible: boolean }) {
  const operator = useOperator(), navigate = useNavigate(), frame = operator.active.native;
  const [answer, setAnswer] = useState<QuoteAnswerReference | null>(null), [quote, setQuote] = useState<ConfirmedQuoteSource | null>(null);
  const binding = JSON.stringify([operator.activeId, frame?.conversationId, frame?.turn?.turnId]);
  useEffect(() => { setAnswer(null); setQuote(null); }, [binding, visible]);
  const live = useRef({ binding, activeId: operator.activeId, visible });
  live.current = { binding, activeId: operator.activeId, visible };
  const current = () => live.current.visible && live.current.binding === binding && live.current.activeId === operator.activeId && operator.current() && !!frame;
  const deny = () => { setAnswer(null); setQuote(null); operator.retract(); };
  return <>
    <ContentTransition value={`${binding}:${frame?.phase ?? 'input'}`} className="operator-work-body">
      {operator.capability.nativeScene === 'order_explanation' && (!frame || frame.readyForNext) && <div className="operator-artifact">
        <label>订单编号<Input value={operator.orderId} maxLength={191} onChange={event => operator.setOrderId(event.currentTarget.value)} placeholder="填写原订单编号" /></label>
        <label>本次订单问题<Select value={operator.orderQuestion || undefined} placeholder="明确选择本次问题"
          options={[{ value: 'status', label: '订单状态' }, { value: 'fees', label: '费用' }, { value: 'payments', label: '支付与退款' }, { value: 'next_steps', label: '下一步' }]}
          onChange={value => operator.setOrderQuestion(value)} /></label>
        <p className="operator-caption">发送会读取此订单的已选问题。自由文本不会扩大查询范围。当前权限与原订单范围由服务端核验。</p>
      </div>}
      {operator.capability.nativeScene === 'opening_diagnosis' && (!frame || frame.readyForNext) && <div className="operator-artifact">
        <label>本次检查分区<Select mode="multiple" value={operator.openingSections} onChange={operator.setOpeningSections}
          options={[
            ['workspace_profile', '空间资料'], ['accounts_roles', '账号与角色'], ['fulfillment_network', '履约网络'],
            ['business_rule', '营业规则'], ['business_calendar', '营业日历'], ['item_groups', '商品组'],
            ['pricing_groups_rates', '计价组与费率'], ['price_version', '价格版本'], ['membership_base', '会员基础'],
          ].map(([value, label]) => ({ value, label }))} /></label>
        <p className="operator-caption">发送后检查已选分区。保存和发布仍由各原配置页面确认。</p>
      </div>}
      {!operator.capability.nativeScene && <div className="operator-work-empty"><h2>此能力尚未接入 Agent</h2><p>可继续使用原业务页面。</p>
        <Button onClick={() => navigate(operator.capability.route)}>打开原业务页面</Button></div>}
      {!frame && operator.active.hasOriginal && <div className="operator-artifact"><Button onClick={() => operator.readOriginal()}>核对原请求</Button></div>}
      {frame && <div className="operator-artifact">
        {frame.phase === 'unknown' && <p role="status">原结果待核对，不会重复派发。</p>}
        {operator.active.run && <div className="operator-run-host"><AgentRun task={`${operator.capability.name} · 原任务步骤`}
          run={operator.active.run} autoPlay={false} activityOnly /></div>}
        {frame.historical && <p>原历史仅供核对，请通过原任务和业务页面办理后续事项。</p>}
        {frame.turn && visible && <>
          <ConversationResult key={binding} identity={operator.identity} conversationId={frame.conversationId} turn={frame.turn}
            current={current} embedded autoRead readOnly={frame.historical} onAccessDenied={deny}
            onResultChange={operator.resultChanged} onAnswerReceipt={frame.scene === 'quote_clarification' && !frame.historical ? setAnswer : undefined} />
          {frame.scene === 'quote_clarification' && !frame.historical && <>
            <ConversationQuoteConfirmation identity={operator.identity} conversationId={frame.conversationId} turn={frame.turn}
              answer={answer} current={current} onAccessDenied={deny} onQuoteSource={setQuote} />
            <ConversationQuoteSelection identity={operator.identity} conversationId={frame.conversationId} turn={frame.turn} source={quote} answer={answer} current={current} onAccessDenied={deny} />
          </>}
          {frame.scene === 'order_explanation' && !frame.historical && <ConversationOrderHandoff identity={operator.identity} conversationId={frame.conversationId}
            turn={frame.turn} current={current} />}
        </>}
        <NativeRoundClosure frame={frame} current={current} />
      </div>}
      {!frame && operator.capability.nativeScene && <div className="operator-work-empty"><h2>结果会出现在这里</h2><p>发送后读取原任务结果。业务确认在这里另行办理。</p></div>}
    </ContentTransition>
    <footer className="operator-work-footer"><p className="operator-caption" role="status">{operator.notice}</p></footer>
  </>;
}

function NativeRoundClosure({ frame, current }: { frame: NativeFrame; current(): boolean }) {
  const operator = useOperator();
  const chatId = operator.activeId;
  const admission = useMemo(() => {
    let storage: Storage | undefined; try { storage = sessionStorage; } catch { /* cannot rotate without original journals */ }
    return new ConversationAdmissionSession(frame.conversationId, aiConversationsApi, current, storage,
      `ai-conversation-admission:${operator.identity}:${frame.conversationId}`);
  }, [operator.identity, frame.conversationId, frame.turn?.admissionKey]);
  useEffect(() => { admission.activate(); return () => admission.dispose(); }, [admission]);
  let closurePending = false;
  try { closurePending = sessionStorage.getItem(`ai-conversation-closure:${operator.identity}:${frame.conversationId}`) !== null; }
  catch { /* unreadable storage does not expose a closing action */ }
  if (frame.historical && !closurePending) return null;
  return <ConversationClosure identity={operator.identity} conversationId={frame.conversationId} observation={frame.observation ?? null}
    current={current} canClose={admission.canClose(frame.observation ?? null)} beforeClose={observation => admission.assertClosure(observation)}
    onChanged={() => operator.readOriginal()} onRotate={async (proof, acknowledge) => {
      await admission.rotate(aiConversationsApi, proof.operationKey, proof, acknowledge);
      if (!current()) throw Error('AI_SCOPE_CHANGED');
      await operator.native.nextRound(chatId, proof, new AbortController().signal);
    }} />;
}
