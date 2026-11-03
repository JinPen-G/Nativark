/** Typed order/setup request admission only. Bodies stay in memory and the
 * journal retains only original keys/hashes. Task metadata and execution are
 * separate explicit operations; hiding or changing scope retracts the draft. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AiConversationObservationDraft, AiSceneCode } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { ActionButton, Alert, ConfirmAction, Input, Select } from '@/components/ui';
import { ConversationAdmissionSession } from './conversation-admission-session';
import { ConversationClosure } from './ConversationClosure';
import { ConversationTaskCreation } from './ConversationTaskCreation';
import { useAiManagementLocale } from './management-locale';
import { safeDisplayText } from './safe-display';

type Question = 'status' | 'fees' | 'payments' | 'next_steps';
// Existing tenantReadiness section keys, not checks, routes or write authority.
// The original service must still accept each selected key under current access.
const openingSections = [
  ['workspace_profile', '空间资料'], ['accounts_roles', '账号与角色'], ['fulfillment_network', '履约网络'],
  ['business_rule', '营业规则'], ['business_calendar', '营业日历'], ['item_groups', '商品组'],
  ['pricing_groups_rates', '计价组与费率'], ['price_version', '价格版本'], ['membership_base', '会员基础'],
] as const;
export function ConversationAdmission({ conversationId, identity, capabilityCode, observation, current, onChanged }: {
  conversationId: string; identity: string; capabilityCode?: AiSceneCode; observation: AiConversationObservationDraft | null;
  current: () => boolean; onChanged: () => void;
}) {
  const { t } = useAiManagementLocale();
  const [orderId, setOrderId] = useState(''), [question, setQuestion] = useState<Question>('status');
  const [sections, setSections] = useState<string[]>([]);
  const capability = capabilityCode ?? observation?.capabilityCode;
  const scope = useRef({ conversationId, identity, capability, observation, current, onChanged });
  scope.current = { conversationId, identity, capability, observation, current, onChanged };
  const session = useMemo(() => {
    let storage: Storage | undefined; try { storage = window.sessionStorage; } catch { /* no durable key means no send */ }
    return new ConversationAdmissionSession(conversationId, aiConversationsApi, () => scope.current.identity === identity
      && scope.current.conversationId === conversationId && scope.current.capability === capability
      && !document.hidden && scope.current.current(), storage,
    `ai-conversation-admission:${identity}:${conversationId}`);
  }, [conversationId, identity, capability]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useEffect(() => {
    setOrderId(''); setQuestion('status'); setSections([]);
    const clear = () => { setOrderId(''); setQuestion('status'); setSections([]); session.retract(); };
    document.addEventListener('visibilitychange', clear);
    return () => { clear(); document.removeEventListener('visibilitychange', clear); };
  }, [session]);
  const check = () => {
    if (scope.current.identity !== identity || scope.current.conversationId !== conversationId
      || scope.current.capability !== capability || !scope.current.current() || document.hidden) throw Error('AI_SCOPE_CHANGED');
  };
  const run = async (send: boolean | 'rotation') => {
    check(); scope.current.onChanged(); setOrderId(''); setSections([]);
    const value = await (send === 'rotation' ? session.resumeRotation(aiConversationsApi, () => {
      try { return window.sessionStorage.getItem(`ai-conversation-closure:${identity}:${conversationId}`) === null; } catch { return false; }
    }) : send ? session.send() : session.reconcile());
    check(); scope.current.onChanged(); return value;
  };
  const opening = capability === 'opening_diagnosis';
  const canPrepare = observation?.status === 'active' && observation.capabilityCode === capability && (capability === 'order_explanation' || opening) && !observation.currentTurn;
  return <section aria-label={t(opening ? '开业诊断原轮次受理' : '订单解读原轮次受理')} aria-busy={state.busy}>
    <p>{t(opening ? '仅保存选定分区的开业诊断原请求；受理不创建任务、不调用模型、不修改或发布配置。'
      : '仅保存订单解读原请求；受理不创建任务、不调用模型、不执行业务。')}</p>
    {!state.locked && <>
      {opening ? <Select<string[]> mode="multiple" showSearch={false} aria-label={t('诊断分区')} value={sections}
        disabled={state.busy || !canPrepare} options={openingSections.map(([value, label]) => ({ value, label: t(label) }))}
        onChange={value => setSections(value)} /> : <>
        <Input aria-label={t('订单标识')} value={orderId} maxLength={191} disabled={state.busy || !canPrepare}
          onChange={event => setOrderId(event.currentTarget.value)} />
        <Select aria-label={t('订单问题')} value={question} disabled={state.busy || !canPrepare}
          options={(['status', 'fees', 'payments', 'next_steps'] as const).map(value => ({ value, label: t(value === 'status' ? '订单状态'
            : value === 'fees' ? '费用依据' : value === 'payments' ? '收付款记录' : '下一步指引') }))} onChange={value => setQuestion(value as Question)} />
      </>}
      <ActionButton label={t('保留本轮发送定位')} disabled={state.busy || !canPrepare || opening && !sections.length} onAction={() => {
        check(); const latest = scope.current.observation;
        if (!observation || !latest || latest.revision !== observation.revision || latest.currentTurn !== null) throw Error('AI_SCOPE_CHANGED');
        if (opening && sections.some(section => !openingSections.some(([key]) => key === section))) throw Error('AI_INVALID_INPUT');
        return opening ? session.prepareOpening(latest, sections) : session.prepare(latest, orderId, question);
      }} />
    </>}
    {state.reviewedInput && <p>{t('订单标识')}: {safeDisplayText(state.reviewedInput.orderId, 191)} · {t('订单问题')}: {t(state.reviewedInput.question === 'status' ? '订单状态'
      : state.reviewedInput.question === 'fees' ? '费用依据' : state.reviewedInput.question === 'payments' ? '收付款记录' : '下一步指引')}</p>}
    {state.reviewedSections && <p>{t('诊断分区')}: {state.reviewedSections.map(section => t(openingSections.find(([key]) => key === section)?.[1]
      ?? safeDisplayText(section, 191))).join('、')}</p>}
    {state.prepared && <ConfirmAction label={t('明确受理本轮请求')} disabled={state.busy}
      prompt={t(opening ? '将这份已定位的开业诊断请求交服务端受理？不会开始任务、模型或配置写入。'
        : '将这份已定位的订单解读请求交服务端受理？不会开始任务或模型。')} onConfirm={() => run(true)} />}
    {state.rotationPending && <ActionButton label={t('核对并完成中断的轮换')} disabled={state.busy} onAction={() => run('rotation')} />}
    {state.locked && !state.prepared && <ActionButton label={t('核对原轮次受理')} disabled={state.busy} onAction={() => run(false)} />}
    {!canPrepare && !state.locked && <p>{t(opening ? '须显式读取活动开业对话且无当前轮次；诊断不证明配置已发布或外部连接成功。'
      : '须显式读取活动订单对话且无当前轮次；其他能力或已占用轮次不在此发送。')}</p>}
    {state.feedback === 'prepared' && <p>{t('原定位已保留，尚未发送或受理；关闭后只核对原键，不重建正文。')}</p>}
    {state.feedback === 'unknown' && <Alert type="warning" title={t('原轮次待核对，已禁止换键发送；没有受理观察不证明未提交。')} />}
    {state.feedback === 'unavailable' && <Alert type="warning" title={t('原请求定位不可用，未发送；请核对输入和存储。')} />}
    <ConversationClosure identity={identity} conversationId={conversationId} observation={observation} current={current}
      onChanged={onChanged} canClose={session.canClose(observation)} beforeClose={session.assertClosure}
      onRotate={(proof, acknowledge) => session.rotate(aiConversationsApi, proof.operationKey, proof, acknowledge)} />
    {state.observation?.result && <ConversationTaskCreation key={state.observation.result.admissionKey} identity={identity}
      conversationId={conversationId} turn={state.observation.result} current={current} onChanged={onChanged} />}
    {state.observation?.result && <p role="status">{t('已观察原请求受理，不代表模型调用或业务完成。')}
      {' '}{safeDisplayText(state.observation.result.original.inputRef, 191)}</p>}
  </section>;
}
