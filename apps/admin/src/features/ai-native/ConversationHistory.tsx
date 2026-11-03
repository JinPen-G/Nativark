/** Explicit owner-history metadata, independent of task execution and demo chat.
 * Opening this panel never starts a model/Task; hidden or changed scopes retract
 * the page and abort its read. A page is not a complete conversation transcript. */
import { useEffect, useRef, useState } from 'react';
import { AI_CONVERSATION_DRAFT_VERSION, AI_SCENE_CODES, type AiConversationListResponseDraft, type AiSceneCode } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { ActionButton, Alert, Select, Button } from '@/components/ui';
import { useAiManagementLocale } from './management-locale';
import { formatTimestamp } from './formatters';
import { safeDisplayText } from './safe-display';
import styles from './AiManagement.module.css';
import { ConversationDetail } from './ConversationDetail';
import { ConversationLifecycle } from './ConversationLifecycle';

const scenes: Record<AiSceneCode, string> = {
  order_explanation: '订单解读', opening_diagnosis: '开业诊断', quote_clarification: '报价说明',
};
export function ConversationHistory({ current, enabled, identity }: { current: () => boolean; enabled: boolean; identity: string }) {
  const { t } = useAiManagementLocale();
  const [capability, setCapability] = useState<AiSceneCode | 'all'>('all');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [page, setPage] = useState<AiConversationListResponseDraft | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [index, setIndex] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const request = useRef<AbortController | null>(null), generation = useRef(0);
  const scope = useRef({ current, enabled }); scope.current = { current, enabled };
  const reset = () => {
    generation.current++; request.current?.abort(); request.current = null;
    setPage(null); setSelected(null); setCursors([undefined]); setIndex(0); setBusy(false); setError(false);
  };
  useEffect(() => {
    const change = () => { reset(); setVisible(!document.hidden); };
    document.addEventListener('visibilitychange', change);
    return () => { generation.current++; request.current?.abort(); request.current = null; document.removeEventListener('visibilitychange', change); };
  }, []);
  useEffect(() => { if (!enabled) reset(); }, [enabled]);
  const read = async (nextIndex = 0) => {
    if (request.current || document.hidden || !scope.current.enabled || !scope.current.current()) throw Error('AI_SCOPE_CHANGED');
    const beforeId = nextIndex > index ? page?.nextBeforeId ?? undefined : cursors[nextIndex];
    if (nextIndex < 0 || nextIndex > index + 1 || nextIndex > index && !beforeId) throw Error('AI_INVALID_INPUT');
    const controller = new AbortController(), owner = ++generation.current;
    request.current = controller; setPage(null); setSelected(null); setBusy(true); setError(false);
    const active = () => owner === generation.current && !controller.signal.aborted && !document.hidden
      && scope.current.enabled && scope.current.current();
    try {
      const result = await aiConversationsApi.list({ draftVersion: AI_CONVERSATION_DRAFT_VERSION, status, limit: 20,
        ...(capability === 'all' ? {} : { capabilityCode: capability }), ...(beforeId ? { beforeId } : {}) }, controller.signal);
      if (!active()) throw Error('AI_SCOPE_CHANGED');
      setPage(result); setIndex(nextIndex);
      setCursors(previous => [...previous.slice(0, nextIndex), beforeId]);
    } catch (failure) {
      if (active()) setError(true);
      throw failure;
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  };
  if (!enabled) return null;
  return <section className={styles.section} aria-label={t('本人对话历史')} aria-busy={busy}>
    <h2>{t('本人对话历史')}</h2>
    <p className={styles.help}>{t('只读取对话记录，不启动任务；完整对话与结果仍需独立受权读取。')}</p>
    <div className={styles.toolbar}>
      <Select aria-label={t('对话能力')} value={capability} disabled={busy || !visible}
        options={[{ value: 'all', label: t('全部能力') }, ...AI_SCENE_CODES.map(value => ({ value, label: t(scenes[value]) }))]}
        onChange={value => { reset(); setCapability(value as AiSceneCode | 'all'); }} />
      <Select aria-label={t('对话状态')} value={status} disabled={busy || !visible}
        options={[{ value: 'active', label: t('活动对话') }, { value: 'archived', label: t('已归档对话') }]}
        onChange={value => { reset(); setStatus(value as 'active' | 'archived'); }} />
      <ActionButton className={styles.toolbarEnd} label={t(page ? '重读对话首页' : '读取本人对话')} pendingLabel={t('读取中…')}
        disabled={busy || !visible} onAction={() => read()} />
    </div>
    <ConversationLifecycle identity={identity} enabled={enabled && visible} capability={capability}
      target={page?.items.find(row => row.conversationId === selected) ?? null} current={current} onCommitted={reset} />
    {busy && <p role="status">{t('读取中…')}</p>}
    {error && <Alert type="warning" title={t('对话历史当前不可读取，旧内容已清除，请核对当前权限。')} />}
    {page && <>
      {!page.items.length && <p>{t('本页未观察到对话，不代表任务未执行。')}</p>}
      <ul className={styles.taskList}>{page.items.map(row => <li key={row.conversationId}>
        <div className={styles.taskIdentity}><Button type="text" aria-pressed={selected === row.conversationId} onClick={() => {
          if (document.hidden || !scope.current.enabled || !scope.current.current()) return;
          setSelected(previous => previous === row.conversationId ? null : row.conversationId);
        }}>{t(scenes[row.capabilityCode])}</Button><span className={styles.help}>{safeDisplayText(row.conversationId, 191)}</span></div>
        <span className={styles.status}>{t(row.status === 'active' ? '活动对话' : '已归档对话')}</span>
        <time dateTime={row.updatedAt}>{formatTimestamp(row.updatedAt).value}</time>
      </li>)}</ul>
      <nav className={styles.taskPager} aria-label={t('对话分页')}>
        <ActionButton label={t('上一页')} disabled={busy || index === 0 || !visible} onAction={() => read(index - 1)} />
        <span>{t('第')} {index + 1} {t('页')}</span>
        <ActionButton label={t('下一页')} disabled={busy || !page.nextBeforeId || !visible} onAction={() => read(index + 1)} />
      </nav>
      {selected && page.items.some(row => row.conversationId === selected) && <ConversationDetail key={selected}
        conversationId={selected} identity={identity} capabilityCode={page.items.find(row => row.conversationId === selected)!.capabilityCode}
        current={() => scope.current.enabled && scope.current.current() && !document.hidden} />}
    </>}
  </section>;
}
