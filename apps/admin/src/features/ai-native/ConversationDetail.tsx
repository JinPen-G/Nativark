/** Explicit reauthorized turn locators and separately requested model text.
 * Reads never create/continue a Task. Closing, switching or hiding retracts the
 * detail, and erased input remains erased even when its original Task survives. */
import { useEffect, useRef, useState } from 'react';
import { AI_CONVERSATION_DRAFT_VERSION, type AiSceneCode } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { ActionButton, Alert } from '@/components/ui';
import { useAiManagementLocale } from './management-locale';
import { formatTimestamp } from './formatters';
import { safeDisplayText } from './safe-display';
import { ConversationResult } from './ConversationResult';
import { ConversationAdmission } from './ConversationAdmission';
import styles from './AiManagement.module.css';

type Detail = Awaited<ReturnType<typeof aiConversationsApi.detail>>;
export function ConversationDetail({ conversationId, capabilityCode, current, identity }: {
  conversationId: string; capabilityCode: AiSceneCode; current: () => boolean; identity: string;
}) {
  const { t } = useAiManagementLocale();
  const [detail, setDetail] = useState<Detail | null>(null), [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null), generation = useRef(0);
  const scope = useRef({ conversationId, capabilityCode, current }); scope.current = { conversationId, capabilityCode, current };
  useEffect(() => {
    const clear = () => { generation.current++; request.current?.abort(); request.current = null; setDetail(null); setBusy(false); setError(false); };
    clear(); document.addEventListener('visibilitychange', clear);
    return () => { generation.current++; request.current?.abort(); request.current = null; document.removeEventListener('visibilitychange', clear); };
  }, [conversationId, capabilityCode]);
  const read = async (beforeId?: string) => {
    if (request.current || document.hidden || !scope.current.current() || scope.current.conversationId !== conversationId
      || scope.current.capabilityCode !== capabilityCode) throw Error('AI_SCOPE_CHANGED');
    const owner = ++generation.current, controller = new AbortController(); request.current = controller;
    setDetail(null); setError(false); setBusy(true);
    const active = () => owner === generation.current && !controller.signal.aborted && !document.hidden
      && scope.current.conversationId === conversationId && scope.current.capabilityCode === capabilityCode && scope.current.current();
    try {
      const value = await aiConversationsApi.detail({ draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId, limit: 20,
        ...(beforeId ? { beforeId } : {}) }, capabilityCode, controller.signal);
      if (!active()) throw Error('AI_SCOPE_CHANGED');
      setDetail(value);
    } catch (failure) { if (active()) setError(true); throw failure; }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  return <section className={styles.section} aria-label={t('对话原轮次')} aria-busy={busy}>
    <h3>{t('对话原轮次')}</h3>
    <p className={styles.help}>{safeDisplayText(conversationId, 191)}</p>
    <div className={styles.toolbar}>
      <ActionButton label={t(detail ? '重读轮次首页' : '读取原轮次')} disabled={busy} onAction={() => read()} />
      {detail?.turns.nextBeforeId && <ActionButton label={t('更早轮次')} disabled={busy} onAction={() => read(detail.turns.nextBeforeId!)} />}
    </div>
    {['order_explanation', 'opening_diagnosis'].includes(capabilityCode) && <ConversationAdmission conversationId={conversationId} identity={identity} capabilityCode={capabilityCode}
      observation={detail?.conversation ?? null} current={() => !document.hidden && scope.current.conversationId === conversationId
        && scope.current.capabilityCode === capabilityCode && scope.current.current()} onChanged={() => {
          generation.current++; request.current?.abort(); request.current = null; setDetail(null); setBusy(false); setError(false);
        }} />}
    {error && <Alert type="warning" title={t('对话详情当前不可读取，旧内容已清除，请核对权限与版本。')} />}
    {detail && <>
      <p className={styles.help}>{t('本页为独立复验的原轮次定位，不是完整对话、执行结果或原子快照。')}</p>
      <dl className={styles.facts}>
        <div><dt>{t('对话修订')}</dt><dd>{detail.conversation.revision}</dd></div>
        <div><dt>{t('当前轮次')}</dt><dd>{detail.conversation.currentTurn?.turnId ?? t('无当前轮次，不代表无历史任务。')}</dd></div>
      </dl>
      {!detail.turns.items.length && <p>{t('本页没有轮次，不推断模型未调用或任务未执行。')}</p>}
      <ol className={styles.timeline}>{detail.turns.items.map(turn => <li key={turn.turnId}>
        <div><strong>{safeDisplayText(turn.turnId, 191)}</strong><p className={styles.help}>{t('原请求')}: {safeDisplayText(turn.original.inputRef, 191)}</p></div>
        <span>{'creation' in turn ? t('原请求创建入口已关闭，未创建任务。') : turn.task ? t('原任务已关联，执行结果另行读取。') : t('原请求已受理，未观察到任务关联。')}
          <p className={styles.help}>{turn.material === 'erased' ? t('原输入已清理，不恢复正文或执行权限。') : t('原输入保留，正文须独立受权读取。')}</p>
          {turn.task && <p className={styles.help}>{t('原任务')}: {safeDisplayText(turn.task.taskId, 191)}</p>}
        </span>
        <time dateTime={turn.createdAt}>{formatTimestamp(turn.createdAt).value}</time>
      </li>)}</ol>
      {detail.turns.items.map(turn => <ConversationResult key={turn.turnId} conversationId={conversationId} turn={turn}
        current={() => !document.hidden && scope.current.conversationId === conversationId && scope.current.capabilityCode === capabilityCode
          && scope.current.current()} />)}
    </>}
  </section>;
}
