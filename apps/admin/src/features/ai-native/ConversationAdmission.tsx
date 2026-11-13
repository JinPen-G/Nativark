/** Typed order/setup request admission and a separate unsent local draft.
 * Editing never prepares or sends; the original journal keeps only keys/hashes.
 * Task metadata/execution stay explicit. Scope/hide/unmount discards local text;
 * Copilot's current order is a locator for original Guard checks, not facts. */
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AiConversationObservationDraft, AiSceneCode, AiSceneQuoteCandidate } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { ActionButton, Alert, ConfirmAction, Input, Select } from '@/components/ui';
import { ConversationAdmissionSession } from './conversation-admission-session';
import { ConversationClosure } from './ConversationClosure';
import { ConversationTaskCreation } from './ConversationTaskCreation';
import { QuoteCandidateFields } from './QuoteCandidateFields';
import { useAiManagementLocale } from './management-locale';
import { safeDisplayText } from './safe-display';

type Question = 'status' | 'fees' | 'payments' | 'next_steps';
type InputDraft = { orderId: string; question: Question; sections: string[]; quoteCandidate: AiSceneQuoteCandidate };
type LocalDraft = { owner: string; revision: number; value: InputDraft };
const emptyDraft = (owner: string, revision = 0): LocalDraft => ({ owner, revision, value: {
  orderId: '', question: 'status', sections: [], quoteCandidate: { customerType: 'personal', items: [{ quantity: 1 }] }
} });
const localEnglish: Record<string, string> = {
  '未发送草稿': 'Unsent draft',
  '当前输入仅保留在本页；核对并完成原轮次后，再明确发送。': 'This input stays on this page. Check and complete the current turn before explicitly sending it.',
  '已核对的原发送内容': 'Reviewed original request'
};
export const ConversationOrderContext = createContext<{ orderId: string; current(): boolean } | null>(null);
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
  const locale = useAiManagementLocale();
  const t = (text: string) => locale.locale === 'en-US' && localEnglish[text] ? localEnglish[text] : locale.t(text);
  const source = useContext(ConversationOrderContext);
  const sourceOrderId = source?.orderId;
  const capability = capabilityCode ?? observation?.capabilityCode;
  const epoch = currentSessionEpoch(), signal = currentSessionSignal();
  const owner = JSON.stringify([identity, conversationId, capability, sourceOrderId, epoch]);
  const [draft, setDraft] = useState(() => emptyDraft(owner));
  const localDraft = useRef(draft), mounted = useRef(false), lifecycle = useRef(0), previousOwner = useRef(owner);
  const wasEditable = useRef(false);
  if (previousOwner.current !== owner) { previousOwner.current = owner; lifecycle.current++; }
  const generation = lifecycle.current;
  const scope = useRef({ conversationId, identity, capability, observation, current, onChanged, source });
  scope.current = { conversationId, identity, capability, observation, current, onChanged, source };
  const active = () => mounted.current && currentSessionEpoch() === epoch && !signal.aborted
    && scope.current.identity === identity && scope.current.conversationId === conversationId
    && scope.current.capability === capability && scope.current.source?.orderId === sourceOrderId
    && (!scope.current.source || scope.current.source.current()) && !document.hidden && scope.current.current();
  const clearDraft = (notify = true) => {
    if (localDraft.current.owner !== owner) return;
    const next = emptyDraft(owner, localDraft.current.revision + 1); localDraft.current = next;
    if (notify) setDraft(next);
  };
  const session = useMemo(() => {
    let storage: Storage | undefined; try { storage = window.sessionStorage; } catch { /* no durable key means no send */ }
    return new ConversationAdmissionSession(conversationId, aiConversationsApi, active, storage,
    `ai-conversation-admission:${identity}:${conversationId}`);
  }, [conversationId, identity, capability, sourceOrderId, epoch]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => {
    mounted.current = true; wasEditable.current = false; session.activate(); session.retract();
    const next = emptyDraft(owner, localDraft.current.revision + 1); localDraft.current = next; setDraft(next);
    const clear = () => { lifecycle.current++; clearDraft(); session.retract(); };
    document.addEventListener('visibilitychange', clear);
    signal.addEventListener('abort', clear, { once: true });
    return () => { mounted.current = false; lifecycle.current++; clearDraft(false); session.dispose();
      document.removeEventListener('visibilitychange', clear); signal.removeEventListener('abort', clear); };
  }, [session]);
  const check = () => {
    if (!active() || lifecycle.current !== generation) throw Error('AI_SCOPE_CHANGED');
  };
  const run = async (send: boolean | 'rotation') => {
    check(); if (send === true && !editable()) throw Error('AI_SCOPE_CHANGED');
    scope.current.onChanged();
    const value = await (send === 'rotation' ? session.resumeRotation(aiConversationsApi, () => {
      try { return window.sessionStorage.getItem(`ai-conversation-closure:${identity}:${conversationId}`) === null; } catch { return false; }
    }) : send ? session.send() : session.reconcile());
    check(); scope.current.onChanged(); return value;
  };
  const opening = capability === 'opening_diagnosis';
  const quote = capability === 'quote_clarification';
  const editable = () => active() && !!capability && ['order_explanation', 'opening_diagnosis', 'quote_clarification'].includes(capability)
    && (!scope.current.source || capability === 'order_explanation') && (!scope.current.observation
      || scope.current.observation.status === 'active' && scope.current.observation.conversationId === conversationId
        && scope.current.observation.capabilityCode === capability);
  const canEdit = editable();
  useEffect(() => {
    // Initial render precedes mount, so its false value is not a revocation.
    // Only an observed editable scope becoming unavailable withdraws a draft.
    const next = editable();
    if (wasEditable.current && !next) { lifecycle.current++; clearDraft(); session.retract(); }
    wasEditable.current = next;
  }, [canEdit, session]);
  const canPrepare = canEdit && !state.busy && !state.locked && observation?.status === 'active'
    && observation.capabilityCode === capability && observation.currentTurn === null;
  const edit = (patch: Partial<InputDraft>) => {
    check(); if (!editable() || localDraft.current.owner !== owner) throw Error('AI_SCOPE_CHANGED');
    const next = { ...localDraft.current, revision: localDraft.current.revision + 1,
      value: { ...localDraft.current.value, ...structuredClone(patch) } };
    localDraft.current = next; setDraft(next);
  };
  const prepare = async () => {
    check(); const latest = scope.current.observation;
    if (!canPrepare || !editable() || session.snapshot().busy || session.snapshot().locked || !observation || !latest
      || latest.status !== 'active' || latest.capabilityCode !== capability || latest.revision !== observation.revision
      || latest.currentTurn !== null || localDraft.current.owner !== owner) throw Error('AI_SCOPE_CHANGED');
    const captured = structuredClone(localDraft.current);
    if (opening && captured.value.sections.some(section => !openingSections.some(([key]) => key === section))) throw Error('AI_INVALID_INPUT');
    await (quote ? session.prepareQuote(latest, captured.value.quoteCandidate) : opening ? session.prepareOpening(latest, captured.value.sections)
      : session.prepare(latest, sourceOrderId ?? captured.value.orderId, captured.value.question));
    check();
    // The reviewed command is now held separately. Hashing/storage can await;
    // clear only its exact draft revision, preserving edits made in that gap.
    if (session.snapshot().prepared && localDraft.current.owner === captured.owner && localDraft.current.revision === captured.revision) clearDraft();
  };
  const { orderId, question, sections, quoteCandidate } = draft.owner === owner && canEdit ? draft.value : emptyDraft(owner).value;
  if (!active()) return null;
  return <section aria-label={t(quote ? '报价条件受理' : opening ? '开业诊断原轮次受理' : '订单解读原轮次受理')} aria-busy={state.busy}>
    <p>{t(quote ? '先核对租赁条件并受理原请求；报价、建单和支付仍需各自正式确认。' : opening ? '仅保存选定分区的开业诊断原请求；受理不创建任务、不调用模型、不修改或发布配置。'
      : '仅保存订单解读原请求；受理不创建任务、不调用模型、不执行业务。')}</p>
    <div role="group" aria-label={t('未发送草稿')}>
      <p>{t('未发送草稿')}</p>
      {(state.locked || observation?.currentTurn) && <p>{t('当前输入仅保留在本页；核对并完成原轮次后，再明确发送。')}</p>}
      {quote ? <QuoteCandidateFields value={quoteCandidate} onChange={value => edit({ quoteCandidate: value })} disabled={!canEdit} /> : opening ? <Select<string[]> mode="multiple" showSearch={false} aria-label={t('诊断分区')} value={sections}
        disabled={!canEdit} options={openingSections.map(([value, label]) => ({ value, label: t(label) }))}
        onChange={value => edit({ sections: value })} /> : <>
        <Input aria-label={t('订单标识')} value={sourceOrderId ?? orderId} readOnly={!!source} maxLength={191} disabled={!canEdit}
          onChange={event => edit({ orderId: event.currentTarget.value })} />
        <Select aria-label={t('订单问题')} value={question} disabled={!canEdit}
          options={(['status', 'fees', 'payments', 'next_steps'] as const).map(value => ({ value, label: t(value === 'status' ? '订单状态'
            : value === 'fees' ? '费用依据' : value === 'payments' ? '收付款记录' : '下一步指引') }))} onChange={value => edit({ question: value as Question })} />
      </>}
      <ActionButton label={t(quote ? '核对租赁条件' : '保留本轮发送定位')} disabled={!canPrepare || opening && !sections.length} onAction={prepare} />
    </div>
    {canEdit && state.prepared && <p>{t('已核对的原发送内容')}</p>}
    {canEdit && state.reviewedInput && <p>{t('订单标识')}: {safeDisplayText(state.reviewedInput.orderId, 191)} · {t('订单问题')}: {t(state.reviewedInput.question === 'status' ? '订单状态'
      : state.reviewedInput.question === 'fees' ? '费用依据' : state.reviewedInput.question === 'payments' ? '收付款记录' : '下一步指引')}</p>}
    {canEdit && state.reviewedSections && <p>{t('诊断分区')}: {state.reviewedSections.map(section => t(openingSections.find(([key]) => key === section)?.[1]
      ?? safeDisplayText(section, 191))).join('、')}</p>}
    {canEdit && state.reviewedQuote && <QuoteCandidateFields value={state.reviewedQuote} />}
    {canEdit && state.prepared && <ConfirmAction label={t('明确受理本轮请求')} disabled={state.busy}
      prompt={t(quote ? '发送这些租赁条件交原场景受理？不会创建报价、订单或支付。' : opening ? '将这份已定位的开业诊断请求交服务端受理？不会开始任务、模型或配置写入。'
        : '将这份已定位的订单解读请求交服务端受理？不会开始任务或模型。')} onConfirm={() => run(true)} />}
    {state.rotationPending && <ActionButton label={t('核对并完成中断的轮换')} disabled={state.busy} onAction={() => run('rotation')} />}
    {state.locked && !state.prepared && <ActionButton label={t('核对原轮次受理')} disabled={state.busy} onAction={() => run(false)} />}
    {!canPrepare && !state.locked && <p>{t(quote ? '须读取活动报价对话并先完成原轮次；不隐式排队或覆盖旧条件。' : opening ? '须显式读取活动开业对话且无当前轮次；诊断不证明配置已发布或外部连接成功。'
      : '须显式读取活动订单对话且无当前轮次；其他能力或已占用轮次不在此发送。')}</p>}
    {state.feedback === 'prepared' && <p>{t('原定位已保留，尚未发送或受理；关闭后只核对原键，不重建正文。')}</p>}
    {state.feedback === 'unknown' && <Alert type="warning" title={t('原轮次待核对，已禁止换键发送；没有受理观察不证明未提交。')} />}
    {state.feedback === 'unavailable' && <Alert type="warning" title={t('原请求定位不可用，未发送；请核对输入和存储。')} />}
    <ConversationClosure identity={identity} conversationId={conversationId} observation={observation}
      current={() => active() && lifecycle.current === generation} onChanged={onChanged}
      canClose={session.canClose(observation)} beforeClose={target => { check(); session.assertClosure(target); }}
      onRotate={async (proof, acknowledge) => { check(); await session.rotate(aiConversationsApi, proof.operationKey, proof, acknowledge); check(); }} />
    {canEdit && state.observation?.result && <ConversationTaskCreation key={state.observation.result.admissionKey} identity={identity}
      conversationId={conversationId} turn={state.observation.result} current={() => active() && lifecycle.current === generation} onChanged={onChanged} />}
    {canEdit && state.observation?.result && <p role="status">{t('已观察原请求受理，不代表模型调用或业务完成。')}
      {' '}{safeDisplayText(state.observation.result.original.inputRef, 191)}</p>}
  </section>;
}
