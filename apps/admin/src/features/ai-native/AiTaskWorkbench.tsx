import { useEffect, useRef, useState } from "react";
import { ActionButton, Alert } from "@/components/ui";
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
}>;

export type AiTaskDetailReader = (
  taskId: string,
  context: AiWorkbenchContext,
  signal: AbortSignal,
) => Promise<AiTaskDetailProjection>;

export interface AiTaskWorkbenchProps {
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
}

type DetailState = "idle" | "unavailable" | "loading" | "ready" | "failed" | "hidden";

/**
 * Feature-local, opt-in management composition. It owns display selection only;
 * the host owns authorization, transport, task state and mutation idempotency.
 */
export function AiTaskWorkbench({
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

  return (
    <section aria-label="AI 任务工作台" data-ai-workbench="feature-local">
      <TaskList
        tasks={tasks}
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
      <section aria-label="AI 任务详情" aria-busy={detailState === "loading"}>
        <h2>{title}</h2>
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
            <TaskTimeline taskId={taskId} steps={currentDetail.steps} />
            {currentDetail.fields && <MissingFieldsPanel fields={currentDetail.fields} draft={currentDetail.draft ?? {}} readOnly />}
            {currentDetail.proposal && <ProposalPreview proposal={currentDetail.proposal} />}
            {currentDetail.proposalRef && (
              <HumanConfirmShell
                proposalId={currentDetail.proposalRef.proposalId}
                revision={currentDetail.proposalRef.revision}
                available={Boolean(onConfirm)}
                onConfirm={onConfirm}
              />
            )}
            {currentDetail.actionStatus && (
              <CancelRecoveryStatus
                status={currentDetail.actionStatus}
                canCancel={Boolean(onCancel)}
                canRecover={Boolean(onRecover)}
                onCancel={onCancel}
                onRecover={onRecover}
              />
            )}
            {currentDetail.sources && <KnowledgeSources sources={currentDetail.sources} />}
            {currentDetail.memories && <MemoryPreferences items={currentDetail.memories} />}
            {currentDetail.serviceSummary && <AiServiceSummary summary={currentDetail.serviceSummary} />}
            {currentDetail.assessments && <CapabilityStatus assessments={currentDetail.assessments} />}
          </>
        )}
        {detailState === "unavailable" && <Alert type="warning" message="宿主未提供任务详情读取能力；不会自动请求或补造结果。" />}
      </section>
    </section>
  );
}
