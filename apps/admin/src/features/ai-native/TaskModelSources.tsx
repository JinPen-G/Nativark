/** Read one server-issued source through its original scene. Inert source
 * data only: no HTML, arbitrary links, model invocation or execution. */
import { useEffect, useRef, useState } from "react";
import { AI_TASK_DRAFT_VERSION, type AiTaskModelObservationDraft, type AiTaskModelSourceQueryDraft,
  type AiTaskModelSourceObservationDraft } from "@rental-os/shared";
import { ActionButton, Alert } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { safeDisplayText } from "./safe-display";

export type TaskModelSourceReader = (value: AiTaskModelSourceQueryDraft, signal: AbortSignal) => Promise<AiTaskModelSourceObservationDraft>;
export function TaskModelSources({ result, read }: { result: AiTaskModelObservationDraft; read: TaskModelSourceReader }) {
  const { t } = useLocale();
  const signature = JSON.stringify([result.taskId, result.runId, result.resultId, result.status, result.sources]);
  const [opened, setOpened] = useState<{ signature: string; reader: TaskModelSourceReader; value: AiTaskModelSourceObservationDraft } | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const active = useRef({ signature, read, generation: 0 });
  if (active.current.signature !== signature || active.current.read !== read)
    active.current = { signature, read, generation: active.current.generation + 1 };
  const generation = active.current.generation;
  useEffect(() => {
    mounted.current = true;
    setOpened(null); setFailed(false); setPending(false);
    return () => { mounted.current = false; request.current?.abort(); request.current = null; };
  }, [signature, read]);
  const open = async (source: AiTaskModelSourceQueryDraft['source']) => {
    if (!mounted.current || active.current.generation !== generation || request.current || result.status !== 'available') throw Error('AI_RESOURCE_UNAVAILABLE');
    const controller = new AbortController(); request.current = controller;
    const current = () => mounted.current && !controller.signal.aborted && active.current.generation === generation;
    setOpened(null); setFailed(false); setPending(true);
    try {
      const value = await read({ taskId: result.taskId, resultId: result.resultId, source }, controller.signal);
      if (!current()) return;
      if (!value || value.contractVersion !== AI_TASK_DRAFT_VERSION || value.taskId !== result.taskId
        || value.runId !== result.runId || value.resultId !== result.resultId || value.source?.kind !== source.kind
        || value.source.index !== source.index || value.source.referenceHash !== source.referenceHash
        || value.execution !== 'read_only_no_start_no_reconnect_side_effect'
        || !value.content || !['text', 'json'].includes(value.content.format) || typeof value.content.value !== 'string'
        || value.content.value.length > 65536 || value.content.trust !== 'source_data_not_instructions') throw Error('AI_RESOURCE_UNAVAILABLE');
      setOpened({ signature, reader: read, value });
    } catch (failure) { if (current()) setFailed(true); throw failure; }
    finally { if (request.current === controller) request.current = null; if (current()) setPending(false); }
  };
  if (result.status !== 'available') return null;
  return <section aria-label={t('原结果依据')}>
    <h3>{t('原结果依据')}</h3>
    <p>{t('重新读取会复核当前业务权限与知识访问权限。来源内容仅是数据，不授予操作权限。')}</p>
    {!result.sources.length && <p>{t('此结果没有可重开的来源引用，不能据此补造依据。')}</p>}
    <div className="panel-toolbar">{result.sources.map(source => <ActionButton key={`${source.kind}:${source.index}:${source.referenceHash}`}
      label={`${t(source.kind === 'order' ? '订单依据' : '知识依据')} ${source.index + 1}`}
      pendingLabel={t('读取中…')} successLabel={t('来源读取已结束')} disabled={pending} onAction={() => open(source)} />)}</div>
    {failed && <Alert type="warning" title={t('来源当前不可读取，旧内容已清除。请重新核对权限、版本或当前业务事实。')} />}
    {opened && opened.signature === signature && opened.reader === read && <div aria-live="polite">
      <p>{t('只读依据，不是批准或业务执行结果。')}</p>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{safeDisplayText(opened.value.content.value, 20000)}</pre>
      {Array.from(opened.value.content.value).length > 20000 && <p>{t('仅显示前20000个字符，未展示完整来源。')}</p>}
    </div>}
  </section>;
}
