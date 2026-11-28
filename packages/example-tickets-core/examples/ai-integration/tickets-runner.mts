/** 工单单动作的显式准备与执行装配，复用原Runner及持久资源账。
 * 人工等待不持有租约；unknown只观察原任务，不重放准备/执行或生成新Run。
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { TicketsAiRunCommandSchema } from "@rental-os/example-tickets-core/ai-http";
import { createPersistentAiTaskRunner, snapshotAiTaskRunnerClaimLease,
  type AiTaskRunnerLease, type AiTaskPreparationTicket, type AiTaskRunnerOverheadTicket } from "@rental-os/platform-server/ai-runtime";
import { createPublicAiTaskMeasuredRunnerPorts } from "@rental-os/ai-native-server/task-measured-effects";
import { createPublicAiTaskTransitions, createPublicAiTaskRunnerOutcomePort } from "@rental-os/ai-native-server/task-transitions";
import { createPublicAiTaskSteps, createPublicAiTaskRunnerStepPorts, type AiStepTransitionAuthority,
  type AiTaskRunnerRepositoryCommandFactory } from "@rental-os/ai-native-server/task-steps";
import type { createPublicAiTaskPersistence } from "@rental-os/ai-native-server/task-persistence";
import type { AiTaskTransactionBoundary } from "@rental-os/ai-native-server/task-transactions";
import { createTicketsStartExecutor, createTicketsStartSource } from "./tickets-start.mjs";
import { TicketsAiAuthority, TicketsAiSceneError, TicketsAiUnknownError, type TicketsBoundAuthority } from "./tickets-authority.mjs";
import type { createTicketsAiApprovals } from "./tickets-approval.mjs";
import { createTicketsAiPlans, ticketsAiStep, ticketsAiAdmitsTool } from "./tickets-plan.mjs";

type Tx = Prisma.TransactionClient;
export { TicketsAiRunCommandSchema } from "@rental-os/example-tickets-core/ai-http";
const unavailable = () => new TicketsAiSceneError("original_evidence_unavailable");
const conflict = () => new TicketsAiSceneError("basis_changed", "TICKETS_AI_BASIS_CHANGED");
const leaseInput = ({ runId, holderId, revision, fencingToken }: AiTaskRunnerLease) => ({ runId, holderId, revision, fencingToken });

export function createTicketsAiRunner(input: { database: PrismaClient; scene: TicketsAiAuthority;
  bound: TicketsBoundAuthority; tasks: ReturnType<typeof createPublicAiTaskPersistence>;
  transactions: AiTaskTransactionBoundary<Tx>; approvals: ReturnType<typeof createTicketsAiApprovals>;
  /** 本Core的真实Step/原收据证据；不能用客户端outcome或恒真回调替代。 */
  transition: AiStepTransitionAuthority }) {
  const { database: db, scene, bound, tasks, transactions, approvals } = input;
  const once = <T,>(work: () => Promise<T>) => transactions.withAiTaskTransactionAuthority(bound.transaction, work);
  const plans = createTicketsAiPlans({ database: db, scene, bound, transactions });
  const executor = createTicketsStartExecutor({ database: db, transactions, authority: bound.transaction,
    source: createTicketsStartSource({ database: db, bound, clock: scene.clock }), approvals: approvals.approvals, tickets: scene.tickets });
  const measured = createPublicAiTaskMeasuredRunnerPorts({ db, scopes: bound.resourceScopes, transactions,
    planAuthority: plans.authority, actions: bound.actions, execution: { authorize: taskId => bound.actions.resolve(taskId, "transition_task") },
    tools: executor, toolCatalog: { async resolve(code, version) { return ticketsAiAdmitsTool(code, version) ? { modelCall: false } : null; } }, wall: scene.clock });
  const steps = createPublicAiTaskSteps({ db, transactions, registration: plans.registration, transition: input.transition,
    replay: { resolve: (command, tx) => tx ? bound.readActionOn(tx, command.taskId, "read_step_terminal")
      : bound.actions.resolve(command.taskId, "read_step_terminal") }, delivery: bound.actions, admitsTool: ticketsAiAdmitsTool, clock: scene.clock });
  const commands: AiTaskRunnerRepositoryCommandFactory = {
    async register(plan, lease) {
      if (!ticketsAiAdmitsTool(plan.toolCode, plan.toolVersion) || plan.operation !== "idempotent") throw unavailable();
      return { taskId: lease.taskId, registrationRef: plan.registrationRef,
        expectedTaskRevision: (await tasks.readMetadata(lease.taskId)).revision, lease: leaseInput(lease) };
    },
    transition(kind, step, lease, resultRef) {
      if (kind === "pause" || !ticketsAiAdmitsTool(step.plan.toolCode, step.plan.toolVersion) || kind !== "start" && !resultRef) throw unavailable();
      return { taskId: lease.taskId, stepId: step.registered.stepId, expectedTaskRevision: step.registered.taskRevision,
        expectedStepRevision: step.registered.stepRevision, evidenceId: kind === "start" ? `start-${step.registered.stepId}` : resultRef!,
        reason: kind === "start" ? "start" : kind === "unknown" ? "result_unknown"
          : step.registered.existingStatus === "unknown" ? "reconciled_committed" : "result_observed", lease: leaseInput(lease) };
    }
  };
  const ports = createPublicAiTaskRunnerStepPorts(steps, { tasks: measured.tasks, commands });
  const outcome = createPublicAiTaskRunnerOutcomePort(createPublicAiTaskTransitions({ db, transactions, authority: bound, clock: scene.clock }), tasks);
  const runner = createPersistentAiTaskRunner({ ...ports, plan: measured.plans, effects: measured.effects, resources: measured.resources, taskOutcome: outcome });

  async function original(value: unknown) {
    const command = TicketsAiRunCommandSchema.parse(value), context = await bound.actions.resolve(command.taskId, "read_step_terminal");
    const task = await scene.task(db, context, command.taskId), source = await scene.source(db, task.who, task.row.inputRef!);
    const run = await db.aiRun.findFirst({ where: { id: command.runId, taskId: command.taskId, scopeId: task.who.scopeId,
      sequence: 1, actorKind: "USER", actorId: task.who.actorId } });
    if (!run || run.id !== command.runId || run.taskId !== task.row.id || run.scopeId !== task.who.scopeId
      || run.actorKind !== "USER" || run.actorId !== task.who.actorId || run.sequence !== 1 || run.inputReceiptId || run.resourceOriginRunId
      || source.row.contentHash !== task.row.inputHash || task.row.revision !== command.expectedRevision) throw conflict();
    scene.active();
    return { command, task: task.row, source, run };
  }
  const claim = (value: Awaited<ReturnType<typeof original>>) => ({ taskId: value.command.taskId, runId: value.command.runId,
    holderId: `tickets:${randomUUID()}`, expectedTaskRevision: value.task.revision, expectedRunRevision: value.run.revision,
    expectedFencingToken: value.run.fencingToken.toFixed(0), leaseMs: 120000 });

  return Object.freeze({
    /** 只接纳从未取得租约的原Run。中途不明须先读原准备/Task/提案，不能重复这一写入入口。 */
    async prepare(value: unknown) {
      const before = await original(value);
      if (before.task.status !== "QUEUED" || before.run.status !== "QUEUED" || before.run.fencingToken.toFixed(0) !== "0"
        || before.run.leaseOwnerId !== null || before.run.leaseExpiresAt !== null) throw new TicketsAiUnknownError();
      const definition = await plans.definition(before.task.id, before.run.id), request = claim(before);
      return once(async () => {
        let lease: AiTaskRunnerLease;
        try { lease = snapshotAiTaskRunnerClaimLease(request, await measured.tasks.claimRun(request)); }
        catch { throw new TicketsAiUnknownError(); }
        let preparation: AiTaskPreparationTicket | undefined, overhead: AiTaskRunnerOverheadTicket | undefined;
        const resources = measured.resources.preparation!, time = measured.resources.overhead!;
        let preparationMeasured = false, overheadMeasured = false;
        try {
          const started = await outcome.start!({ taskId: before.task.id, taskRevision: before.task.revision, lease });
          lease = started.lease;
          preparation = await resources.begin(lease, definition, 15000, scene.signal);
          if (preparation.prepared || !preparation.remainingMs || preparation.remainingMs < 1) throw new TicketsAiUnknownError();
          const { bindingHash: _hash, ...plan } = definition;
          await measured.plans.savePlan({ ...plan, taskRevision: started.taskRevision }, lease,
            (tx, scopeId) => plans.publishInput(tx, scopeId, before.task.id, before.run.id));
          scene.active();
          // 原计量工厂原子交接准备与登记区间，不能把数据库等待留成免费的间隙。
          overhead = await resources.handoff!(preparation, lease, false, false);
          preparationMeasured = true;
          const within = () => { scene.active(); if (time.remaining!(overhead!, lease) < 1) throw new TicketsAiUnknownError(); };
          within();
          const registered = await ports.steps.register(ticketsAiStep(before.source.row.id), lease);
          if (registered.replayed || registered.runRevision !== lease.revision + 1 || registered.existingStatus !== "pending") throw new TicketsAiUnknownError();
          lease = { ...lease, revision: registered.runRevision };
          within();
          const result = await approvals.prepare(before.task.id);
          within();
          const revision = (await tasks.readMetadata(before.task.id)).revision;
          const released = await measured.tasks.releaseRun({ taskId: lease.taskId, runId: lease.runId, holderId: lease.holderId,
            expectedTaskRevision: revision, expectedRunRevision: lease.revision, expectedFencingToken: lease.fencingToken });
          await time.completeAfterRelease!(overhead, lease, released);
          overheadMeasured = true;
          bound.assertCurrent(); scene.active(); return result;
        } catch {
          // 只处理本进程已取得的原计量ticket；不猜提交是否成功、不换lease、不自动释放未知工作。
          if (preparation && !preparationMeasured) await resources.abandon(preparation, lease).catch(() => undefined);
          if (overhead && !overheadMeasured) await time.abandon(overhead, lease).catch(() => undefined);
          throw new TicketsAiUnknownError();
        }
      });
    },
    async execute(value: unknown) {
      const before = await original(value), decision = await approvals.read(before.task.id);
      if (before.task.status !== "RUNNING" || before.run.status !== "RUNNING" || decision.status !== "CONFIRMED"
        || decision.decision?.decision !== "approved") throw conflict();
      // 正式continuePending核原PENDING/NONE及原计量。已RUNNING/UNKNOWN步骤不会再次执行。
      return once(() => runner.continuePending(claim(before), scene.signal));
    },
    async observeInterrupted(value: unknown) {
      const before = await original(value);
      if (!["RUNNING", "WAITING_EXTERNAL"].includes(before.task.status)) throw conflict();
      return once(() => runner.run({ ...claim(before), recovery: true }, scene.signal));
    }
  });
}
