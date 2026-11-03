/** Explicit original-turn result consumption through the existing task-center
 * reader. Rendering is inert plain text; visibility, selection and unmount
 * retract it. No model calls, business commands or raw artifact fallback. */
import { useEffect, useRef, useState } from 'react';
import { AI_CONVERSATION_DRAFT_VERSION, type AiConversationTurnObservationDraft } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { ActionButton, Alert } from '@/components/ui';
import { ModelText } from './ModelText';
import { safeDisplayText } from './safe-display';
import { useAiManagementLocale } from './management-locale';
import styles from './AiManagement.module.css';

type Result = Awaited<ReturnType<typeof aiConversationsApi.result>>;
export function ConversationResult({ conversationId, turn, current }: {
  conversationId: string; turn: AiConversationTurnObservationDraft; current: () => boolean;
}) {
  const { t } = useAiManagementLocale();
  const [result, setResult] = useState<Result | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null), generation = useRef(0), mounted = useRef(false);
  const binding = JSON.stringify([conversationId, turn]);
  const scope = useRef({ binding, current }); scope.current = { binding, current };
  useEffect(() => {
    const clear = () => { generation.current++; request.current?.abort(); request.current = null; setResult(null); setBusy(false); setError(false); };
    clear(); mounted.current = true; document.addEventListener('visibilitychange', clear);
    return () => { mounted.current = false; generation.current++; request.current?.abort(); request.current = null; document.removeEventListener('visibilitychange', clear); };
  }, [binding]);
  const read = async () => {
    if (!mounted.current || request.current || document.hidden || scope.current.binding !== binding || !scope.current.current()) throw Error('AI_SCOPE_CHANGED');
    const owner = ++generation.current, controller = new AbortController(); request.current = controller;
    setResult(null); setBusy(true); setError(false);
    const active = () => owner === generation.current && !controller.signal.aborted && !document.hidden
      && scope.current.binding === binding && scope.current.current();
    try {
      const value = await aiConversationsApi.result({ draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId,
        admissionKey: turn.admissionKey }, turn, controller.signal);
      if (!active()) throw Error('AI_SCOPE_CHANGED');
      setResult(value);
    } catch (failure) { if (active()) setError(true); throw failure; }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  return <section aria-label={t('原轮次模型结果')} aria-busy={busy}>
    <p>{safeDisplayText(turn.turnId, 191)}</p>
    <ActionButton label={t(result ? '重读原模型结果' : '读取原模型结果')} disabled={busy} onAction={read} />
    {error && <Alert type="warning" title={t('原结果当前不可读取，旧正文已清除；不自动重试或重新生成。')} />}
    {result && <>
      <p className={styles.help}>{t('模型文本不证明业务已完成；本次只读，不启动模型或业务。')}</p>
      {result.status === 'material_erased' ? <p>{t('原输入已清理，不恢复正文或执行权限。')}</p>
        : result.status === 'no_task_observed' ? <p>{t('未观察到任务关联，不推断模型未调用。')}</p>
          : result.status === 'no_unique_result' ? <p>{t('该原轮次没有唯一可定位结果，不猜测其他轮次或补造答案。')}</p>
            : result.result.status === 'available' ? <ModelText text={result.result.text!.value} />
              : <p>{t(result.result.status === 'stale' ? '事实已变化，旧正文不显示，请回原业务页核对。'
                : result.result.status === 'unknown' ? '结果待核对，不自动重试。' : '原步骤失败，未产生可展示答案。')}</p>}
    </>}
  </section>;
}
