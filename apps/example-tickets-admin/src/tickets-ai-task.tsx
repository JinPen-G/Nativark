/** 原工单任务的显式页面动作；只保存核对引用，不缓存事实/批准或自动重放写入。
 * 页面与身份变化中止等待，未知结果仍沿同一服务端Task、输入和操作键回读。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { TICKETS_AI_TASK_HTTP as contract, type TicketsAiTaskAction, type TicketsAiTaskResponses } from "@rental-os/example-tickets-core/ai-http";
import { Alert, useCorePageHost, useCoreRequest, useLocale } from "@rental-os/platform-admin/core";
import { useAdminRuntime, useAdminSession } from "@rental-os/platform-admin/runtime";
import { ActionButton, ConfirmAction } from "@rental-os/platform-admin/ui";
import type { TicketAiRouteState } from "@rental-os/example-tickets-core";

const journalSchema = z.object({ version: z.literal(1), operationId: z.string().uuid(), inputRef: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(), runId: z.string().uuid().optional(),
  attempted: z.enum(["prepareInput", "createTask", "prepareApproval", "decide", "execute", "observeInterrupted"]).optional() }).strict();
type Journal = z.infer<typeof journalSchema>;
type Snapshot = { binding?: TicketsAiTaskResponses["prepareInput"]; task?: TicketsAiTaskResponses["originalTask"];
  approval?: TicketsAiTaskResponses["approval"]; result?: TicketsAiTaskResponses["result"] };
const permission = [{ resource: "ticket", action: "start" }];

export function TicketsAiTask({ ticketId, ticketRevision, state }: {
  ticketId: string; ticketRevision: number; state: TicketAiRouteState;
}) {
  const { request, queryKey } = useCoreRequest(), host = useCorePageHost(), client = useQueryClient(), { locale } = useLocale();
  const { tenant, user, sessionVerified } = useAdminSession(), runtime = useAdminRuntime(), epoch = runtime.currentSessionEpoch();
  const text = (zh: string, en: string) => locale === "en-US" ? en : zh;
  const journalKey = JSON.stringify(["tickets-ai-reference-1", tenant?.tenantId, user?.id, ticketId]);
  const generation = JSON.stringify([epoch, host.lifetimeKey, journalKey]);
  const [journal, setJournal] = useState<Journal>(), [snapshot, setSnapshot] = useState<Snapshot>({});
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(false), [storageFailure, setStorageFailure] = useState(false);
  const reference = useRef<Journal | undefined>(undefined), pending = useRef<Promise<void> | null>(null);
  const boundary = useRef<{ generation: string; controller: AbortController } | null>(null);
  const live = useRef({ generation, host, state, ticketRevision }); live.current = { generation, host, state, ticketRevision };
  useLayoutEffect(() => {
    const controller = new AbortController(); boundary.current = { generation, controller }; pending.current = null;
    setSnapshot({}); setBusy(false); setFailure(false); setStorageFailure(false);
    try {
      const raw = window.sessionStorage.getItem(journalKey);
      reference.current = raw ? journalSchema.parse(JSON.parse(raw)) : undefined;
      setJournal(reference.current);
    } catch { reference.current = undefined; setJournal(undefined); setStorageFailure(true); }
    return () => controller.abort();
  }, [generation]);
  const current = () => {
    const entry = boundary.current;
    if (!sessionVerified || !tenant || !user || runtime.currentSessionEpoch() !== epoch || live.current.generation !== generation
      || entry?.generation !== generation || entry.controller.signal.aborted
      || !live.current.host.canAccess("example-tickets", [{ resource: "ticket", action: "read" }]))
      throw new DOMException("原工单任务页面已失效", "AbortError");
    return entry.controller.signal;
  };
  const save = (next: Journal) => {
    current(); const checked = journalSchema.parse(next);
    // 存储失败不发送写请求，避免刷新后丢失必须沿用的操作引用。
    window.sessionStorage.setItem(journalKey, JSON.stringify(checked)); reference.current = checked; setJournal(checked);
  };
  const consume = async <Action extends TicketsAiTaskAction>(action: Action, value: unknown): Promise<TicketsAiTaskResponses[Action]> => {
    const route = contract[action], data = route.body.parse(value);
    const result = await request(route.path, { method: "post", data, signal: current(), timeout: 125000, retryAuthentication: false });
    current(); return route.response.parse(result) as TicketsAiTaskResponses[Action];
  };
  const original = (value: TicketsAiTaskResponses["prepareInput"]) => {
    const saved = reference.current;
    if (!saved || value.original.command.operationId !== saved.operationId || value.original.command.ticketId !== ticketId
      || value.original.principal.subjectId !== user?.id || value.original.principal.tenantId !== tenant?.tenantId)
      throw new Error("原工单输入与当前核对引用不一致");
    return value;
  };
  async function readOriginal() {
    let saved = reference.current;
    if (!saved) return;
    const next: Snapshot = {}, prepared = await consume("originalInput", { operationId: saved.operationId });
    if (prepared.binding) {
      next.binding = original(prepared.binding);
      if (saved.inputRef && saved.inputRef !== prepared.binding.source.recordId) throw new Error("原输入引用已变化");
      saved = { ...saved, inputRef: prepared.binding.source.recordId, attempted: saved.attempted === "prepareInput" ? undefined : saved.attempted }; save(saved);
    }
    if (saved.inputRef) {
      next.task = await consume("originalTask", { inputRef: saved.inputRef });
      if (next.task.state === "observed") {
        const task = next.task.task;
        if (saved.taskId && saved.taskId !== task.taskId || saved.runId && saved.runId !== task.runId) throw new Error("原任务引用已变化");
        saved = { ...saved, taskId: task.taskId, runId: task.runId, attempted: saved.attempted === "createTask" ? undefined : saved.attempted }; save(saved);
        next.result = await consume("result", { taskId: task.taskId });
        if (next.result.taskId !== task.taskId || next.result.runId !== task.runId || next.result.ticketId !== ticketId
          || next.result.operationId !== saved.operationId) throw new Error("原结果与工单任务不一致");
        if (next.result.step) {
          next.approval = await consume("approval", { taskId: task.taskId });
          if (next.approval.taskId !== task.taskId || next.approval.original.command.operationId !== saved.operationId
            || next.approval.original.command.ticketId !== ticketId) throw new Error("原提案与工单任务不一致");
          if (saved.attempted === "prepareApproval" && next.approval.status !== "NOT_OBSERVED"
            || saved.attempted === "decide" && next.approval.decision
            || (saved.attempted === "execute" || saved.attempted === "observeInterrupted") && !next.result.taskReconciliationRequired
              && next.result.step.status !== "pending" && next.result.step.status !== "running") {
            saved = { ...saved, attempted: undefined }; save(saved);
          }
        }
      }
    }
    current(); setSnapshot(next); return next;
  }
  function run(work: () => Promise<unknown>) {
    if (pending.current) return pending.current;
    const signal = current(); setBusy(true); setFailure(false); setSnapshot({});
    const promise = work().then(() => undefined).catch(error => {
      if (!signal.aborted && live.current.generation === generation) { setFailure(true); setSnapshot({}); }
      throw error;
    }).finally(() => {
      if (pending.current === promise) pending.current = null;
      if (!signal.aborted && live.current.generation === generation) setBusy(false);
    });
    pending.current = promise; return promise;
  }
  // 恢复只读取当前身份下的原引用；StrictMode重复读取也不会产生业务动作。
  useEffect(() => { if (reference.current) void run(readOriginal).catch(() => undefined); }, [generation]);
  const write = (action: NonNullable<Journal["attempted"]>, work: () => Promise<unknown>) => run(async () => {
    if (!live.current.host.canAccess("example-tickets", permission) || reference.current?.attempted || storageFailure)
      throw new Error("请先核对原结果和当前权限");
    const saved = reference.current;
    if (!saved) throw new Error("缺少原操作引用");
    save({ ...saved, attempted: action });
    await work(); current();
    save({ ...reference.current!, attempted: undefined });
    await readOriginal();
  });
  const prepare = () => run(async () => {
    if (reference.current || storageFailure || live.current.state.state !== "available"
      || !live.current.host.canAccess("example-tickets", permission)) throw new Error("当前工单任务不可准备");
    save({ version: 1, operationId: crypto.randomUUID(), attempted: "prepareInput" });
    const binding = original(await consume("prepareInput", { ticketId, expectedRevision: live.current.ticketRevision,
      operationId: reference.current!.operationId }));
    save({ ...reference.current!, inputRef: binding.source.recordId, attempted: undefined });
    setSnapshot({ binding });
  });
  const taskCommand = async () => {
    const saved = reference.current!;
    const result = await consume("result", { taskId: saved.taskId });
    if (result.taskId !== saved.taskId || result.runId !== saved.runId || result.operationId !== saved.operationId || result.ticketId !== ticketId)
      throw new Error("原结果与工单任务不一致");
    return { taskId: result.taskId, runId: result.runId, expectedRevision: result.taskRevision };
  };
  const decide = (decision: "approved" | "rejected") => {
    const proposal = snapshot.approval;
    if (!proposal || proposal.status !== "PENDING_CONFIRMATION") return Promise.reject(new Error("请重新读取原提案"));
    return write("decide", async () => {
      const observed = await consume("decide", { taskId: proposal.taskId, proposalId: proposal.proposalId,
        proposalRevision: proposal.proposalRevision, reviewedPayloadHash: proposal.payloadHash, decision });
      if (observed.decision?.decision !== decision) throw new Error("原决定尚未确认");
    });
  };
  const disabled = busy || storageFailure || Boolean(journal?.attempted) || !host.canAccess("example-tickets", permission);
  const result = snapshot.result, proposal = snapshot.approval, ready = !busy && !failure;
  const states = { queued: ["已创建，待准备", "Created; awaiting preparation"], running: ["进行中", "Running"],
    waiting_input: ["等待输入", "Awaiting input"], waiting_confirmation: ["等待确认", "Awaiting confirmation"],
    waiting_external: ["等待原结果", "Awaiting original result"], cancel_requested: ["已请求取消", "Cancellation requested"],
    succeeded: ["已完成", "Completed"], partially_succeeded: ["部分完成", "Partially completed"], failed: ["失败", "Failed"], cancelled: ["已取消", "Cancelled"] };
  return <div aria-busy={busy}>
    {storageFailure && <Alert type="error" title={text("无法读取原任务引用，请联系管理员核对；暂不发起新任务。", "Original references cannot be read. Contact an administrator; new tasks are blocked.")} />}
    {failure && <Alert type="warning" title={text("未取得完整原结果", "Original result unavailable")}
      description={text("保留原编号并重新核对。没有回执不表示可以重新执行。", "Keep the original reference and reconcile it. A missing receipt does not permit another execution.")} />}
    {journal?.attempted && <Alert type="warning" title={text("原请求待核对", "Original request needs reconciliation")}
      description={text("暂不发起下一步；核对不会再次执行工单。", "The next step is blocked. Reconciliation will not execute the ticket again.")} />}
    {!journal && state.state === "available" && <ActionButton intent="create" label={text("准备开始处理", "Prepare ticket start")} disabled={disabled} onAction={prepare} />}
    {journal && <>
      <p>{text("核对编号", "Operation reference")} <code>{journal.operationId}</code></p>
      <ActionButton intent="review" label={text("核对原任务", "Read original task")} disabled={busy} onAction={() => run(readOriginal)} />
      {ready && snapshot.binding && !journal.taskId && !journal.attempted && <>
        <p>{text("原工单已读取，创建任务后再准备批准。", "The original ticket was read. Create the task before preparing approval.")}</p>
        <ActionButton intent="create" label={text("创建工单任务", "Create ticket task")} disabled={disabled}
          onAction={() => write("createTask", async () => {
            const observed = await consume("createTask", { inputRef: reference.current?.inputRef });
            if (observed.state !== "observed") throw new Error("原任务创建结果尚未确认");
          })} />
      </>}
      {ready && result && <>
        <p>{text("原任务", "Original task")} · {states[result.taskStatus][locale === "en-US" ? 1 : 0]}</p>
        {result.business === "committed" && result.originalReceipt && <Alert type="success" title={text("工单已开始处理", "Ticket start recorded")}
          description={`${text("原收据版本", "Receipt revision")} ${result.originalReceipt.ticket.revision}`} />}
        {result.taskReconciliationRequired && <Alert type="warning" title={text("任务结果仍需核对", "Task result still needs reconciliation")}
          description={text("业务收据和任务资源分别核对；不要重新执行。", "The business receipt and task usage are checked separately. Do not execute again.")} />}
        {result.taskStatus === "queued" && !result.step && <ActionButton intent="review" label={text("准备批准提案", "Prepare approval")}
          disabled={disabled} onAction={() => write("prepareApproval", async () => {
            if ((await consume("prepareApproval", await taskCommand())).status === "NOT_OBSERVED") throw new Error("原提案尚未确认");
          })} />}
        {proposal && proposal.status !== "NOT_OBSERVED" && <>
          <p>{text("批准内容：开始处理", "Approval: start processing")}「{proposal.original.fact.subject}」</p>
          <p>{text("原说明", "Original description")}：{proposal.original.fact.description || text("未填写", "Not provided")}</p>
          <p>{text("工单版本", "Ticket revision")} {proposal.original.command.expectedRevision} · {text("受派成员", "Assignee")} {proposal.original.fact.assigneeId}</p>
          {proposal.status === "PENDING_CONFIRMATION" && <>
            <p>{text("批准仅确认上述原事实；执行需要下一次明确操作。", "Approval confirms the original facts above. Execution requires a separate action.")}</p>
            <ConfirmAction label={text("批准原提案", "Approve original proposal")} prompt={text("确认以上工单、版本与开始处理动作？", "Approve the ticket, revision and start action shown above?")}
              disabled={disabled} onConfirm={() => decide("approved")} />
            <ActionButton intent="review" label={text("拒绝提案", "Reject proposal")} disabled={disabled} onAction={() => decide("rejected")} />
          </>}
          {proposal.status === "CANCELLED" && <p>{text("提案已拒绝，未授予执行。", "Proposal rejected; execution was not granted.")}</p>}
          {proposal.status === "CONFIRMED" && result.step?.status === "pending" && !result.taskReconciliationRequired && <>
            <Alert type="info" title={text("已批准，尚未执行", "Approved; not executed")} />
            <ConfirmAction label={text("执行已批准动作", "Execute approved action")} prompt={text("按已批准的原工单版本开始处理？", "Start the ticket using the approved original revision?")}
              disabled={disabled} onConfirm={() => write("execute", async () => {
                const outcome = await consume("execute", await taskCommand());
                if (outcome.status !== "succeeded") throw new Error("请核对原任务结果");
                await client.invalidateQueries({ queryKey, refetchType: "none" });
              })} />
          </>}
        </>}
        {result.resources && <details><summary>{text("原任务用量", "Recorded task usage")}</summary>
          <ul>{result.resources.map(row => <li key={row.kind}>{({ steps: text("步骤", "Steps"), calls: text("模型调用", "Model calls"),
            active_ms: text("活动毫秒", "Active milliseconds"), output_bytes: text("输出字节", "Output bytes") })[row.kind]}：
            {row.consumed} / {row.maximum} · {text("保留", "Reserved")} {row.reserved}</li>)}</ul></details>}
      </>}
    </>}
  </div>;
}
