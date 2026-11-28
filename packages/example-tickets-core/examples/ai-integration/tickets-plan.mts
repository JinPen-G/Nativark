/** 固定工单场景的计划/步骤来源参加者；原仓储拥有持久化、CAS和累计资源。
 * 这里只解析同一原输入，不接受客户端或模型提供的工具、权限、计划或租约。
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AiTaskPreparationDefinition, AiTaskRunnerLease, AiTaskRunnerPlan } from "@rental-os/platform-server/ai-runtime";
import { requestFingerprint as hash } from "@rental-os/platform-contracts/request-fingerprint";
import { aiTaskAccessFromContext } from "@rental-os/ai-native-server/task-observation";
import { aiTaskRunPlanSchema, type TaskRunPlanAuthority } from "@rental-os/ai-native-server/task-runner-resources";
import type { AiStepRegistrationCommand, AiStepRegistrationAuthority } from "@rental-os/ai-native-server/task-steps";
import type { AiTaskTransactionBoundary } from "@rental-os/ai-native-server/task-transactions";
import { TICKETS_START_TOOL, ticketsStartFingerprint, ticketsStartActionInput } from "./tickets-start.mjs";
import { TicketsAiAuthority, TicketsAiSceneError, TICKETS_AI_TRANSACTION, ticketsAiRegistrationRef,
  type TicketsBoundAuthority } from "./tickets-authority.mjs";

type Tx = Prisma.TransactionClient;
const denied = () => new TicketsAiSceneError("permission_denied", "AI_ACCESS_DENIED");
const unavailable = () => new TicketsAiSceneError("original_evidence_unavailable");
export const ticketsAiStep = (inputRef: string) => ({ registrationRef: ticketsAiRegistrationRef(inputRef),
  operation: "idempotent" as const, toolCode: TICKETS_START_TOOL.code, toolVersion: TICKETS_START_TOOL.version });
export const ticketsAiAdmitsTool = (code: string, version: string) => code === TICKETS_START_TOOL.code && version === TICKETS_START_TOOL.version;

export function createTicketsAiPlans(input: { database: PrismaClient; scene: TicketsAiAuthority;
  bound: TicketsBoundAuthority; transactions: AiTaskTransactionBoundary<Tx> }) {
  const { database: db, scene, bound, transactions } = input;
  // 所有写权依据在原Native复核，避免持有Task/Run锁时另开会争锁的权限事务。
  const work = <T,>(taskId: string, readOnly: boolean, tx: Tx | undefined, consume: (tx: Tx) => Promise<T>) => tx ? consume(tx)
    : readOnly ? db.$transaction(consume, TICKETS_AI_TRANSACTION)
      : transactions.withAiTaskTransactionAuthority(bound.transaction, () => db.$transaction(native =>
        transactions.withAiTaskTransaction(native, { kind: "task", taskId }, () => consume(native)), TICKETS_AI_TRANSACTION));

  async function original(taskId: string, readOnly: boolean, tx: Tx) {
    const context = await (readOnly ? bound.readActionOn(tx, taskId, "read_step_terminal") : bound.actionOn(tx, taskId, "transition_task"));
    const task = await scene.task(tx, context, taskId), source = await scene.source(tx, task.who, task.row.inputRef!);
    if (task.row.inputHash !== source.row.contentHash) throw denied();
    return { context, task: task.row, who: task.who, ...source };
  }

  async function definition(taskId: string, runId: string, native?: Tx): Promise<AiTaskPreparationDefinition> {
    return work(taskId, false, native, async tx => {
      const before = await original(taskId, false, tx), current = await scene.live(tx, before.context, before.row.id);
      const run = await tx.aiRun.findFirst({ where: { id: runId, scopeId: before.who.scopeId, taskId, sequence: 1,
        actorKind: "USER", actorId: before.who.actorId } });
      if (!run || run.id !== runId || run.scopeId !== before.who.scopeId || run.taskId !== taskId
        || run.sequence !== 1 || run.actorKind !== "USER" || run.actorId !== before.who.actorId
        || run.inputReceiptId || run.resourceOriginRunId || before.task.cancelRequestedAt) throw denied();
      scene.active();
      return { taskId, runId, steps: [ticketsAiStep(before.row.id)], limits: current.policy.limits,
        bindingHash: hash({ version: "example-tickets-plan-1", input: before.row.contentHash, policy: current.policy.hash,
          scope: before.who.scopeId, subject: before.who.binding, entitlement: current.entitlementRevision }) };
    });
  }

  const proof = async (plan: AiTaskPreparationDefinition | AiTaskRunnerPlan, lease: AiTaskRunnerLease, native?: Tx) =>
    work(lease.taskId, false, native, async tx => {
      const expected = await definition(lease.taskId, lease.runId, tx), { bindingHash, ...base } = expected;
      const actual = "bindingHash" in plan ? plan : { taskId: plan.taskId, runId: plan.runId, steps: plan.steps, limits: plan.limits };
      if (hash(actual) !== hash("bindingHash" in plan ? expected : base)) throw denied();
      const source = await original(lease.taskId, false, tx);
      return { authorityHash: bindingHash, policyVersion: `tickets-plan:${source.row.policyRevision}`, expiresAt: source.row.expiresAt.toISOString() };
    });
  const authority: Required<TaskRunPlanAuthority> = { authorize: proof, authorizePreparation: proof };

  async function registered(command: AiStepRegistrationCommand, readOnly: boolean, native?: Tx) {
    return work(command.taskId, readOnly, native, async tx => {
      const source = await original(command.taskId, readOnly, tx), key = { scopeId: source.who.scopeId, taskId: command.taskId, runId: command.lease.runId };
      const saved = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
      if (!saved || Object.entries(key).some(([key, value]) => saved[key as keyof typeof saved] !== value)) throw unavailable();
      const plan = aiTaskRunPlanSchema.parse(saved.payload), step = ticketsAiStep(source.row.id);
      if (plan.taskId !== key.taskId || plan.runId !== key.runId || hash(plan) !== saved.planHash
        || hash(plan.steps) !== hash([step]) || command.registrationRef !== step.registrationRef
        || !/^[a-f0-9]{64}$/u.test(saved.authorityHash) || saved.policyVersion !== `tickets-plan:${source.row.policyRevision}`) throw denied();
      const action = await tx.aiTaskActionInput.findUnique({ where: { scopeId_taskId_runId_registrationRef: { ...key, registrationRef: step.registrationRef } } });
      if (!action || action.id !== source.row.id || Object.entries(key).some(([name, value]) => action[name as keyof typeof action] !== value)
        || action.registrationRef !== step.registrationRef || action.toolCode !== step.toolCode || action.toolVersion !== step.toolVersion
        || action.policyRevision !== source.row.policyRevision || action.expiresAt.getTime() !== source.row.expiresAt.getTime()
        || action.fingerprint !== ticketsStartFingerprint(source.binding) || hash(action.payload) !== action.fingerprint
        || hash(action.payload) !== hash(ticketsStartActionInput(source.binding))) throw unavailable();
      if (!readOnly) {
        const current = await definition(command.taskId, key.runId, tx);
        if (saved.authorityHash !== current.bindingHash || hash(plan.limits) !== hash(current.limits)) throw denied();
      }
      const after = await original(command.taskId, readOnly, tx);
      if (aiTaskAccessFromContext(after.context, key.taskId, scene.clock()).bindingKey !== source.who.binding
        || hash(after.binding) !== hash(source.binding)) throw denied();
      return { context: after.context, taskId: key.taskId, registrationRef: step.registrationRef,
        toolCode: step.toolCode, toolVersion: step.toolVersion, inputRef: source.row.id,
        requestFingerprint: ticketsStartFingerprint(source.binding), expiresAt: source.row.expiresAt.toISOString(),
        authorizationKey: hash({ planHash: saved.planHash, source: source.binding.source }) };
    });
  }
  const registration: Required<AiStepRegistrationAuthority> = {
    async resolve(command, tx) { return { ...await registered(command, false, tx), registrationAllowed: true }; },
    async resolveOriginal(command, tx) { const { expiresAt: _expires, ...value } = await registered(command, true, tx);
      return { ...value, registrationAllowed: false }; }
  };
  async function publishInput(tx: Tx, scopeId: string, taskId: string, runId: string) {
    const source = await original(taskId, false, tx), step = ticketsAiStep(source.row.id);
    if (source.who.scopeId !== scopeId) throw denied();
    // 同一原记录ID在独立action表中作引用；正文是版本化来源指针，摘要与Step唯一指纹一致。
    await tx.aiTaskActionInput.create({ data: { scopeId, taskId, runId, id: source.row.id,
      registrationRef: step.registrationRef, toolCode: step.toolCode, toolVersion: step.toolVersion,
      payload: ticketsStartActionInput(source.binding), fingerprint: ticketsStartFingerprint(source.binding),
      policyRevision: source.row.policyRevision, expiresAt: source.row.expiresAt } });
  }
  return Object.freeze({ definition, authority, registration, publishInput });
}
