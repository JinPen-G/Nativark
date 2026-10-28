import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionButton, Alert, Accordion } from "@/components/ui";
import styles from './AiManagement.module.css';
import { TaskList } from "./TaskList";
import { TaskTimeline } from "./TaskTimeline";
import { MissingFieldsPanel, type MissingField } from "./MissingFieldsPanel";
import { ProposalPreview, type ProposalPreviewData } from "./ProposalPreview";
import { HumanConfirmShell } from "./HumanConfirmShell";
import { CancelRecoveryStatus, type ActionLifecycle } from "./CancelRecoveryStatus";
import { KnowledgeSources, type KnowledgeSource } from "./KnowledgeSources";
import { MemoryPreferences, type MemoryPreference } from "./MemoryPreferences";
import { AiServiceSummary, type AiServiceSummaryProps } from "./AiServiceSummary";
import { CapabilityStatus, type CapabilityStatusProps } from "./CapabilityStatus";
import { consumePolledEvents } from "./polling-consumer";
import { safeDisplayText } from "./safe-display";
import { ModelText } from "./ModelText";
import { TaskModelSources, type TaskModelSourceReader } from "./TaskModelSources";
import type { AiTaskConfirmationHistoryDraft, AiTaskModelObservationDraft } from "@rental-os/shared";
import type { DisplayEventInput, EventTimelineState } from "./event-reducer";

export type AiWorkbenchContext = Readonly<{
  audience: string;
  tenantId?: string;
  workspaceId?: string;
}>;

/** Host-owned detail projection. This is a feature-local display input, not a transport DTO. */
export type AiTaskDetailProjection = Readonly<{
  task?: unknown;
  steps?: readonly unknown[];
  modelText?: string;
  modelObservation?: AiTaskModelObservationDraft;
  fields?: readonly MissingField[];
  draft?: Record<string, string>;
  proposal?: ProposalPreviewData | null;
  proposalRef?: { proposalId: string; revision: string };
  sources?: readonly KnowledgeSource[];
  memories?: readonly MemoryPreference[];
  serviceSummary?: AiServiceSummaryProps["summary"];
  assessments?: CapabilityStatusProps["assessments"];
  actionStatus?: ActionLifecycle;
  eventTimeline?: EventTimelineState;
  events?: readonly DisplayEventInput[];
  /** Feature-local rows projected from authorized business facts, not model text. */
  factRows?: readonly { label: string; value: string }[];
  confirmationSteps?: readonly { runId: string; stepId: string }[];
}>;

export type AiTaskDetailReader = (
  taskId: string,
  context: AiWorkbenchContext,
  signal: AbortSignal,
) => Promise<AiTaskDetailProjection>;

export interface AiTaskWorkbenchProps {
  detailActions?: ReactNode;
  translate?: (text: string) => string;
  statusLabels?: Readonly<Record<string, string>>;
  tasks?: readonly unknown[];
  loading?: boolean;
  paging?: boolean;
  error?: string | null;
  forbidden?: boolean;
  page?: number;
  hasNext?: boolean;
  selectedTaskId?: string | null;
  context: AiWorkbenchContext;
  visible?: boolean;
  /** Explicit opt-in. Importing or mounting alone never reads. */
  enabled?: boolean;
  readTask?: AiTaskDetailReader;
  onPageChange?: (page: number) => void;
  onRetry?: () => void;
  onSelectTask?: (taskId: string) => void;
  onResync?: (taskId: string, context: AiWorkbenchContext) => void | Promise<void>;
  onConfirm?: (input: { proposalId: string; revision: string }) => Promise<unknown>;
  onCancel?: () => Promise<unknown>;
  onRecover?: () => Promise<unknown>;
  readConfirmation?: (reference: { taskId: string; runId: string; stepId: string }, signal: AbortSignal) => Promise<AiTaskConfirmationHistoryDraft>;
  readSource?: TaskModelSourceReader;
}

type DetailState = "idle" | "unavailable" | "loading" | "ready" | "failed" | "hidden";

/**
 * Feature-local, opt-in management composition. It owns display selection only;
 * the host owns authorization, transport, task state and mutation idempotency.
 */
export function AiTaskWorkbench({
  detailActions,
  translate: t = text => text,
  statusLabels,
  tasks,
  loading = false,
  paging = false,
  error = null,
  forbidden = false,
  page = 1,
  hasNext = false,
  selectedTaskId: controlledTaskId,
  context,
  visible = true,
  enabled = false,
  readTask,
  onPageChange,
  onRetry,
  onSelectTask,
  onResync,
  onConfirm,
  onCancel,
  onRecover,
  readConfirmation,
  readSource,
}: AiTaskWorkbenchProps) {
  const contextKey = JSON.stringify([context.audience, context.tenantId ?? null, context.workspaceId ?? null]);
  const [selection, setSelection] = useState({ contextKey, taskId: controlledTaskId ?? null });
  const [detail, setDetail] = useState<AiTaskDetailProjection | null>(null);
  const [detailState, setDetailState] = useState<DetailState>("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [readNonce, setReadNonce] = useState(0);
  const epoch = useRef(0);
  const resyncPending = useRef(false);
  const taskId = controlledTaskId !== undefined ? controlledTaskId : selection.contextKey === contextKey ? selection.taskId : null;
  const identity = JSON.stringify([contextKey, taskId, readNonce]);
  const [loadedIdentity, setLoadedIdentity] = useState<string | null>(null);
  const loadedReader = useRef<AiTaskDetailReader | undefined>(undefined);
  const active = useRef({ identity, readTask, onResync, allowed: visible && enabled && !forbidden });
  active.current = { identity, readTask, onResync, allowed: visible && enabled && !forbidden };
  const currentDetail = active.current.allowed && loadedIdentity === identity && loadedReader.current === readTask ? detail : null;

  useEffect(() => {
    epoch.current += 1;
    resyncPending.current = false;
    const currentEpoch = epoch.current;
    setDetail(null);
    setDetailError(null);
    resyncPending.current = false;
    if (!visible || forbidden) {
      setDetailState("hidden");
      return;
    }
    if (!taskId) {
      setDetailState("idle");
      return;
    }
    if (!enabled || typeof readTask !== "function") {
      setDetailState("unavailable");
      return;
    }
    const abort = new AbortController();
    setDetailState("loading");
    void Promise.resolve().then(() => {
      if (abort.signal.aborted) return null;
      return readTask(taskId, context, abort.signal);
    }).then(
      (next) => {
        if (currentEpoch !== epoch.current || abort.signal.aborted || !active.current.allowed || active.current.identity !== identity || active.current.readTask !== readTask) return;
        if (!next || typeof next !== "object" || Array.isArray(next)) {
          setDetailState("unavailable");
          return;
        }
        setDetail(next);
        loadedReader.current = readTask;
        setLoadedIdentity(identity);
        setDetailState("ready");
      },
      () => {
        if (currentEpoch !== epoch.current || abort.signal.aborted || !active.current.allowed || active.current.identity !== identity || active.current.readTask !== readTask) return;
        setDetailError("任务详情读取失败，请重新读取");
        setDetailState("failed");
      },
    );
    return () => {
      epoch.current += 1;
      abort.abort();
    };
  }, [contextKey, readTask, taskId, visible, enabled, forbidden, readNonce]);

  const selectTask = (nextTaskId: string) => {
    epoch.current += 1;
    if (!visible || forbidden) return;
    setSelection({ contextKey, taskId: nextTaskId });
    setDetail(null);
    setDetailError(null);
    setDetailState(visible && readTask ? "loading" : "unavailable");
    onSelectTask?.(nextTaskId);
  };

  const requestResync = async () => {
    if (!taskId || !onResync || !active.current.allowed || resyncPending.current) return;
    resyncPending.current = true;
    epoch.current += 1;
    const resyncEpoch = epoch.current;
    setDetail(null);
    setDetailError(null);
    setDetailState(readTask ? "loading" : "unavailable");
    try {
      await onResync(taskId, context);
      if (epoch.current !== resyncEpoch || active.current.identity !== identity || active.current.onResync !== onResync || !active.current.allowed) return;
      setReadNonce((value) => value + 1);
    } catch (error) {
      if (epoch.current === resyncEpoch && active.current.identity === identity && active.current.allowed) {
        setDetailError("任务重新同步失败，请重新读取");
        setDetailState("failed");
      }
      throw error;
    } finally {
      if (epoch.current === resyncEpoch) resyncPending.current = false;
    }
  };

  const title = forbidden ? "任务不可见：无权限" : !visible ? "当前工作台不可见" : !enabled ? "工作台读取尚未启用" : !taskId
    ? "请选择一个 AI 任务"
    : detailState === "loading"
      ? "正在读取任务详情…"
      : detailState === "failed"
        ? detailError ?? "任务详情读取失败"
        : detailState === "unavailable"
          ? "任务详情读取能力不可用"
          : detailState === "hidden"
            ? "当前工作台不可见"
            : "任务详情";
  const eventBatch = currentDetail?.eventTimeline && currentDetail.events
    ? consumePolledEvents(currentDetail.eventTimeline, currentDetail.events)
    : null;
  // A reset/cursor gap invalidates the old projection until the host supplies a fresh snapshot.
  const detailSynchronized = Boolean(currentDetail) && !eventBatch?.resyncRequired;

  return (
    <section aria-label="AI 任务工作台" data-ai-workbench="feature-local">
      <TaskList
        tasks={tasks}
        translate={t}
        statusLabels={statusLabels}
        loading={loading}
        paging={paging}
        error={error}
        forbidden={forbidden}
        page={page}
        hasNext={hasNext}
        selectedTaskId={taskId}
        onSelectTask={selectTask}
        onPageChange={onPageChange}
        onRetry={onRetry}
      />
      {taskId && <section className={styles.taskDetail} aria-label={t("AI 任务详情")} aria-busy={detailState === "loading"}>
        <h2>{t(title)}</h2>
        {detailState === "failed" && taskId && onResync && (
          <ActionButton
            label="重新读取"
            pendingLabel="读取中…"
            onAction={requestResync}
          />
        )}
        {detailState === "ready" && currentDetail && taskId && (
          <>
            {eventBatch?.resyncRequired && (
              <Alert
                type="warning"
                message="事件未同步，请由宿主重新读取快照后再继续。"
                action={onResync ? <ActionButton label="重新读取事件" pendingLabel="读取中…" onAction={requestResync} /> : undefined}
              />
            )}
            {detailSynchronized && typeof currentDetail.modelText === "string" && <ModelText text={currentDetail.modelText} />}
            {detailSynchronized && <Accordion items={[
              { key: 'steps', title: t('执行步骤'), content: <TaskTimeline taskId={taskId} steps={currentDetail.steps} /> },
              ...(readConfirmation && currentDetail.confirmationSteps?.length ? [{ key: 'confirmation', title: t('确认记录'), content: <>{currentDetail.confirmationSteps.slice(0, 20).map(step =>
              <ConfirmationHistory key={`${identity}:${step.runId}:${step.stepId}`} taskId={taskId} {...step} read={readConfirmation} />)}
              {(currentDetail.confirmationSteps.length > 20) && <p role="status">仅展示前20个确认步骤，其他记录未加载。</p>}</> }] : []),
              ...(currentDetail.factRows ? [{ key: 'facts', title: t('任务信息'), content: <dl className={styles.facts}>{currentDetail.factRows.slice(0, 24).map((row, index) => <div key={index}>
                <dt>{safeDisplayText(row.label, 100)}</dt><dd style={{ overflowWrap: "anywhere" }}>{safeDisplayText(row.value, 1000)}</dd>
              </div>)}</dl> }] : [])
            ]} />}
            {detailSynchronized && currentDetail.fields && <MissingFieldsPanel fields={currentDetail.fields} draft={currentDetail.draft ?? {}} readOnly />}
            {detailSynchronized && currentDetail.proposal && <ProposalPreview proposal={currentDetail.proposal} />}
            {detailSynchronized && currentDetail.proposalRef && (
              <HumanConfirmShell
                proposalId={currentDetail.proposalRef.proposalId}
                revision={currentDetail.proposalRef.revision}
                available={Boolean(onConfirm)}
                onConfirm={onConfirm}
              />
            )}
            {detailSynchronized && currentDetail.actionStatus && (
              <CancelRecoveryStatus
                status={currentDetail.actionStatus}
                canCancel={Boolean(onCancel)}
                canRecover={Boolean(onRecover)}
                onCancel={onCancel}
                onRecover={onRecover}
              />
            )}
            {detailSynchronized && currentDetail.modelObservation && readSource
              && <TaskModelSources key={identity} result={currentDetail.modelObservation} read={readSource} />}
            {detailSynchronized && currentDetail.sources && <KnowledgeSources sources={currentDetail.sources} />}
            {detailSynchronized && currentDetail.memories && <MemoryPreferences items={currentDetail.memories} />}
            {detailSynchronized && currentDetail.serviceSummary && <AiServiceSummary summary={currentDetail.serviceSummary} />}
            {detailSynchronized && currentDetail.assessments && <CapabilityStatus assessments={currentDetail.assessments} />}
          </>
        )}
        {detailState === "unavailable" && <Alert type="warning" message="宿主未提供任务详情读取能力；不会自动请求或补造结果。" />}
        {detailActions}
      </section>}
    </section>
  );
}

function ConfirmationHistory({ taskId, runId, stepId, read }: { taskId: string; runId: string; stepId: string;
  read: NonNullable<AiTaskWorkbenchProps['readConfirmation']> }) {
  const [history, setHistory] = useState<AiTaskConfirmationHistoryDraft | null>(null);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const reader = useRef(read); reader.current = read;
  useEffect(() => () => { request.current?.abort(); }, []);
  return <section aria-label="原人工确认记录">
    <h3>原人工确认记录</h3>
    <p>步骤 {safeDisplayText(stepId, 191)}。只核对原记录，不批准、不继续执行；没有记录不代表未执行。</p>
    <ActionButton label="读取原确认历史" pendingLabel="读取中…" onAction={async () => {
      if (request.current) throw Error('AI_RESOURCE_UNAVAILABLE');
      const controller = new AbortController(), selectedReader = read; request.current = controller;
      setHistory(null); setError(false);
      try {
        const result = await selectedReader({ taskId, runId, stepId }, controller.signal);
        if (controller.signal.aborted || reader.current !== selectedReader) return;
        if (!result || result.version !== 'task-confirmation-history-1' || result.taskId !== taskId || result.runId !== runId || result.stepId !== stepId
          || result.execution !== 'read_only_no_claim_or_dispatch' || result.businessOutcome !== 'not_attested'
          || !Array.isArray(result.phases) || result.phases.length > 2 || !Array.isArray(result.transitions) || result.transitions.length > 2
          || result.phases.some(phase => !phase || typeof phase.phaseId !== 'string' || ![1, 2].includes(phase.sequence)
            || phase.kind !== null && !['confirmation', 'succeeded', 'failed', 'unknown'].includes(phase.kind))
          || result.transitions.some(item => !item || !['paused', 'continued'].includes(item.kind)))
          throw Error('AI_RESOURCE_UNAVAILABLE');
        setHistory(result);
      } catch (failure) { if (!controller.signal.aborted && reader.current === selectedReader) setError(true); throw failure; }
      finally { if (request.current === controller) request.current = null; }
    }} />
    {error && <Alert type="warning" title="原确认记录不可读取，旧内容已清除。"/>}
    {history && <div aria-live="polite">
      {!history.phases.length && <p>尚未观察到原确认阶段，不推断审批或业务结果。</p>}
      <ul>{history.phases.map(phase => <li key={phase.phaseId}>
        阶段 {phase.sequence}：{phase.kind === 'confirmation' ? '已保存等待记录' : phase.kind === 'succeeded' ? '原阶段完成，业务结果需另查原收据'
          : phase.kind === 'failed' ? '原阶段未完成' : phase.kind === 'unknown' ? '结果待核对' : '尚无阶段收据'}
      </li>)}</ul>
      <p>已观察的转换：{history.transitions.map(item => item.kind === 'paused' ? '暂停等待' : '按原决定继续').join(' → ') || '未观察到'}。</p>
      <p>读取记录不是新的批准、执行许可或业务成功证明。</p>
    </div>}
  </section>;
}
