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
  selectedTaskId: controlledTaskId = null,
  context,
  visible = true,
  readTask,
  onPageChange,
  onRetry,
  onSelectTask,
  onResync,
  onConfirm,
  onCancel,
  onRecover,
}: AiTaskWorkbenchProps) {
  const [localTaskId, setLocalTaskId] = useState<string | null>(controlledTaskId);
  const [detail, setDetail] = useState<AiTaskDetailProjection | null>(null);
  const [detailState, setDetailState] = useState<DetailState>("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const epoch = useRef(0);
  const taskId = controlledTaskId ?? localTaskId;

  useEffect(() => {
    setLocalTaskId(controlledTaskId);
  }, [controlledTaskId]);

  useEffect(() => {
    epoch.current += 1;
    const currentEpoch = epoch.current;
    setDetail(null);
    setDetailError(null);
    if (!visible) {
      setDetailState("hidden");
      return;
    }
    if (!taskId) {
      setDetailState("idle");
      return;
    }
    if (typeof readTask !== "function") {
      setDetailState("unavailable");
      return;
    }
    const abort = new AbortController();
    setDetailState("loading");
    void readTask(taskId, context, abort.signal).then(
      (next) => {
        if (currentEpoch !== epoch.current || abort.signal.aborted) return;
        setDetail(next);
        setDetailState("ready");
      },
      () => {
        if (currentEpoch !== epoch.current || abort.signal.aborted) return;
        setDetailError("任务详情读取失败，请重新读取");
        setDetailState("failed");
      },
    );
    return () => {
      abort.abort();
    };
  }, [context, readTask, taskId, visible]);

  const selectTask = (nextTaskId: string) => {
    epoch.current += 1;
    setLocalTaskId(nextTaskId);
    setDetail(null);
    setDetailError(null);
    setDetailState(visible && readTask ? "loading" : "unavailable");
    onSelectTask?.(nextTaskId);
  };

  const title = !taskId
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
            onAction={async () => { await onResync(taskId, context); }}
          />
        )}
        {detailState === "ready" && detail && taskId && (
          <>
            <TaskTimeline taskId={taskId} steps={detail.steps} />
            {detail.fields && <MissingFieldsPanel fields={detail.fields} draft={detail.draft ?? {}} readOnly />}
            {detail.proposal && <ProposalPreview proposal={detail.proposal} />}
            {detail.proposalRef && (
              <HumanConfirmShell
                proposalId={detail.proposalRef.proposalId}
                revision={detail.proposalRef.revision}
                available={Boolean(onConfirm)}
                onConfirm={onConfirm}
              />
            )}
            {detail.actionStatus && (
              <CancelRecoveryStatus
                status={detail.actionStatus}
                canCancel={Boolean(onCancel)}
                canRecover={Boolean(onRecover)}
                onCancel={onCancel}
                onRecover={onRecover}
              />
            )}
            {detail.sources && <KnowledgeSources sources={detail.sources} />}
            {detail.memories && <MemoryPreferences items={detail.memories} />}
            {detail.serviceSummary && <AiServiceSummary summary={detail.serviceSummary} />}
            {detail.assessments && <CapabilityStatus assessments={detail.assessments} />}
          </>
        )}
        {detailState === "unavailable" && <Alert type="warning" message="宿主未提供任务详情读取能力；不会自动请求或补造结果。" />}
      </section>
    </section>
  );
}
