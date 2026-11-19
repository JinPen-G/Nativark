/** Original human controls in the console's existing work area. Sending a chat
 * never adopts candidates, approves an order or substitutes model text for Core. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { TaskCancellation } from '../ai-native/TaskCancellation';
import { useAiManagementLocale } from '../ai-native/management-locale';
import { ConversationAdmissionSession } from '../ai-native/conversation-admission-session';
import { AgentRun } from './archive/agent-run/AgentRun';
import { nativeAgentRun, type NativeFrame } from './native-session';
import { useOperator } from './OperatorContext';

export function NativeOperatorWorkspace({ visible }: { visible: boolean }) {
  const operator = useOperator(), navigate = useNavigate(), frame = operator.active.native;
  const { locale, t } = useAiManagementLocale();
  const label = (chinese: string, english: string) => locale === 'en-US' ? english : t(chinese);
  const [answer, setAnswer] = useState<QuoteAnswerReference | null>(null), [quote, setQuote] = useState<ConfirmedQuoteSource | null>(null);
  const binding = JSON.stringify([operator.activeId, frame?.conversationId, frame?.turn?.turnId]);
  const lifetime = useMemo(() => ({ mounted: false }), [binding, visible]);
  useLayoutEffect(() => { lifetime.mounted = true; return () => { lifetime.mounted = false; }; }, [lifetime]);
  useEffect(() => { setAnswer(null); setQuote(null); }, [binding, visible]);
  const live = useRef({ binding, activeId: operator.activeId, visible });
  live.current = { binding, activeId: operator.activeId, visible };
  const current = () => lifetime.mounted && live.current.visible && live.current.binding === binding && live.current.activeId === operator.activeId && operator.current() && !!frame;
  const deny = () => { setAnswer(null); setQuote(null); operator.retract(); };
  return <>
    <ContentTransition value={`${binding}:${frame?.phase ?? 'input'}`} className="operator-work-body">
      {(frame?.contextTurns ?? 0) >= 7 && <div className="operator-artifact">
        <p role="status">{(frame!.contextTurns! > 8)
          ? label('已达到本对话的历史上限。可继续查看原结果，或新开对话处理下一个目标。', 'This conversation reached its history limit. Review the original result or start a new goal.')
          : label('单轮最多参考 8 个前序轮次。建议缩小本次目标，或新开对话。', 'Each request can use up to 8 previous turns. Narrow the goal or start a new conversation.')}</p>
        <Button onClick={() => operator.createConversation()}>{label('开始独立新目标', 'Start a new goal')}</Button>
      </div>}
      {operator.capability.nativeScene === 'order_explanation' && (!frame || frame.readyForNext) && <div className="operator-artifact">
        <label>{label('订单编号', 'Order ID')}<Input value={operator.orderId} maxLength={191} onChange={event => operator.setOrderId(event.currentTarget.value)} placeholder={label('填写原订单编号', 'Enter the original order ID')} /></label>
        <label>{label('本次订单问题', 'Order question')}<Select value={operator.orderQuestion || undefined} placeholder={label('明确选择本次问题', 'Choose a question')}
          options={[{ value: 'status', label: label('订单状态', 'Order status') }, { value: 'fees', label: label('费用', 'Charges') }, { value: 'payments', label: label('支付与退款', 'Payments and refunds') }, { value: 'next_steps', label: label('下一步', 'Next steps') }]}
          onChange={value => operator.setOrderQuestion(value)} /></label>
        <p className="operator-caption">{label('发送时按当前权限读取这笔订单的所选问题。', 'Sending reads the selected information for this order using your current permissions.')}</p>
      </div>}
      {operator.capability.nativeScene === 'opening_diagnosis' && (!frame || frame.readyForNext) && <div className="operator-artifact">
        <label>{label('本次检查分区', 'Sections to check')}<Select mode="multiple" value={operator.openingSections} onChange={operator.setOpeningSections}
          options={[
            ['workspace_profile', '空间资料'], ['accounts_roles', '账号与角色'], ['fulfillment_network', '履约网络'],
            ['business_rule', '营业规则'], ['business_calendar', '营业日历'], ['item_groups', '商品组'],
            ['pricing_groups_rates', '计价组与费率'], ['price_version', '价格版本'], ['membership_base', '会员基础'],
          ].map(([value, name]) => ({ value, label: label(name, value.replaceAll('_', ' ')) }))} /></label>
        <p className="operator-caption">{label('在原配置页面确认保存或发布。', 'Confirm changes on the original settings page.')}</p>
      </div>}
      {!operator.capability.nativeScene && <div className="operator-work-empty"><h2>{label('此能力请在业务页面办理', 'Use the business page for this capability')}</h2>
        <Button onClick={() => navigate(operator.capability.route)}>{label('打开原业务页面', 'Open business page')}</Button></div>}
      {!frame && operator.active.hasOriginal && <div className="operator-artifact"><Button onClick={() => operator.readOriginal()}>{label('核对原请求', 'Check original request')}</Button></div>}
      {frame && <div className="operator-artifact">
        {frame.phase === 'unknown' && <p role="status">{label('原结果待核对', 'Original result awaiting verification')}</p>}
        {frame.snapshot && <div className="operator-run-host"><AgentRun task={label('原任务步骤', 'Original task steps')}
          model={{ name: label('模型信息未提供', 'Model information unavailable'), mark: <></> }}
          statusText={label(...taskLabels[frame.snapshot.status])}
          run={nativeAgentRun(frame.snapshot, label)} autoPlay={false} activityOnly /></div>}
        {frame.historical && <p>{label('后续事项请通过原任务和业务页面办理。', 'Continue on the original task or business page.')}</p>}
        {visible && !frame.historical && frame.turn?.task && <TaskCancellation key={frame.turn.task.taskId} taskId={frame.turn.task.taskId} identity={operator.identity} current={current} onAccessDenied={deny} />}
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
        {visible && <NativeRoundClosure key={binding} frame={frame} current={current} />}
      </div>}
      {!frame && operator.capability.nativeScene && <div className="operator-work-empty"><h2>{label('发送后在此查看任务结果', 'Send a request to see the task result here')}</h2></div>}
    </ContentTransition>
    <footer className="operator-work-footer"><p className="operator-caption" role="status">{operator.notice}</p></footer>
  </>;
}

const taskLabels: Record<NonNullable<NativeFrame['snapshot']>['status'], [string, string]> = {
  queued: ['排队中', 'Queued'], running: ['执行中', 'Running'], waiting_input: ['等待补充', 'Awaiting input'],
  waiting_confirmation: ['等待确认', 'Awaiting confirmation'], waiting_external: ['等待外部结果', 'Awaiting external result'],
  cancel_requested: ['已请求取消', 'Cancellation requested'], succeeded: ['已完成', 'Completed'],
  partially_succeeded: ['部分成功', 'Partly completed'], failed: ['失败', 'Failed'], cancelled: ['已取消', 'Cancelled'],
};

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
