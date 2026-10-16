import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AiTextCapabilityHttpResponsesDraft } from '@rental-os/shared';
import { runWithRequestIdentity } from '../../common/request-identity';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from './ai-task.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { TenantModelConfigurationAuthority } from './tenant-model-config.authority';
import { composeAuthorizedPersistedTextProbeWorkflow, type AuthorizedTextProbeWorkflowDependencies } from './text-capability-probe.composition';
import { textProbeCommandSchema, type TextProbeCapability } from './text-capability-probe';
import { TextProbeOriginalRequestUnknownError } from './prisma-text-probe-original-request.repository';
import { textProbeTaskCreationKey } from './text-capability-probe-task.composition';
import { waitForTaskApplicationDependency, type AiTaskApplicationStartResult } from './runner/prisma-task-application';
import type { AiTaskRepositoryOperation } from './ai-task.repository';
import { taskActionPolicyOperations } from './prisma-task-action-policy.repository';

export type TextCapabilityHttpRequest = { headers: { authorization?: unknown } };
export type TextCapabilityRequestDependencies = Omit<AuthorizedTextProbeWorkflowDependencies, 'credentials' | 'pricing'> & {
  pricing: { mode: 'persisted_calls'; priceVersion: string };
  /** Server-selected default; request selection is limited to the server whitelist. */
  probeCapability?: TextProbeCapability;
  /** Optional server-owned selection whitelist. Default remains one kind. */
  probeCapabilities?: readonly TextProbeCapability[];
  /** Explicit server policy templates, never a default task-creation grant. */
  taskActionPolicies?: readonly { operation: AiTaskRepositoryOperation; requiredPermissions: readonly string[] }[];
  taskActionPolicyTtlMs?: number;
};
export type TextCapabilityRequest = {
  [K in keyof AiTextCapabilityHttpResponsesDraft]: (value: unknown, signal?: AbortSignal) => Promise<AiTextCapabilityHttpResponsesDraft[K]>;
} & { close(): void };
const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const requestSchema = z.object({ requestKey: textProbeCommandSchema.shape.operationId }).strict();
const prepareSchema = requestSchema.extend({ capability: textProbeCommandSchema.shape.capability }).strict();
const cancelSchema = requestSchema.extend({ expectedRevision: z.number().int().min(1).max(4294967294) }).strict();
const actionReadSchema = requestSchema.extend({ operation: z.string().min(1).max(64) }).strict();
const actionConfigureSchema = actionReadSchema.extend({ expectedRevision: z.number().int().min(1).max(4294967293).nullable() }).strict();
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
function taskSummary(task: { taskId: string; runId: string; status: string; revision: number; replayed: boolean }) {
  return { taskId: task.taskId, runId: task.runId, status: task.status, revision: task.revision, replayed: task.replayed };
}
function runSummary(requestKey: string, result: AiTaskApplicationStartResult): AiTextCapabilityHttpResponsesDraft['start'] {
  const common = { requestKey, retryable: false as const, semantics: 'task_outcome_not_capability_evidence' as const };
  return result.kind === 'not_started' ? { ...common, kind: result.kind, reason: result.reason }
    : { ...common, kind: result.kind, outcome: { status: result.outcome.status,
      completedSteps: result.outcome.completedSteps, cleanupFailed: result.outcome.cleanupFailed } };
}

/** One request, one real persisted root. No injectable caller identity, command,
 * connection, task producer, lease or dispatch permit. Constructing is inert. */
export class TextCapabilityProbeRequestFactory {
  private readonly dependencies: TextCapabilityRequestDependencies;
  constructor(dependencies: TextCapabilityRequestDependencies) {
    if (!dependencies || 'credentials' in dependencies || dependencies.pricing?.mode !== 'persisted_calls'
      || dependencies.pricing.priceVersion !== dependencies.priceVersion
      || [dependencies.auth?.resolveAccessContext, dependencies.guard?.canActivate, dependencies.db?.$transaction]
        .some(method => typeof method !== 'function')) throw unavailable();
    const capabilities = [...(dependencies.probeCapabilities ?? [dependencies.probeCapability ?? 'text'])];
    if (!capabilities.length || capabilities.length > 6 || new Set(capabilities).size !== capabilities.length
      || capabilities.some(value => !textProbeCommandSchema.shape.capability.unwrap().safeParse(value).success)
      || !capabilities.includes(dependencies.probeCapability ?? 'text')) throw unavailable();
    const policies = structuredClone(dependencies.taskActionPolicies ?? []);
    const ttl = dependencies.taskActionPolicyTtlMs ?? 60000;
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 120000 || policies.length > taskActionPolicyOperations.length
      || new Set(policies.map(policy => policy.operation)).size !== policies.length
      || policies.some(policy => !taskActionPolicyOperations.includes(policy.operation)
        || !Array.isArray(policy.requiredPermissions) || !policy.requiredPermissions.length || policy.requiredPermissions.length > 64
        || new Set(policy.requiredPermissions).size !== policy.requiredPermissions.length
        || policy.requiredPermissions.some(permission => typeof permission !== 'string'
          || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(permission)))) throw unavailable();
    this.dependencies = { ...dependencies, probeCapabilities: Object.freeze(capabilities),
      taskActionPolicies: Object.freeze(policies.map(policy => Object.freeze({ ...policy,
        requiredPermissions: Object.freeze([...policy.requiredPermissions]) }))), taskActionPolicyTtlMs: ttl,
      host: structuredClone(dependencies.host), pricing: { ...dependencies.pricing } };
  }
  open(request: TextCapabilityHttpRequest): TextCapabilityRequest {
    const header = bearer.safeParse(request?.headers?.authorization);
    if (!header.success) throw denied();
    let authorization: string | undefined = header.data;
    const requestId = randomUUID(), dependencies = this.dependencies;
    const credentials = { current: async () => {
      if (authorization === undefined) throw denied();
      return { authorization, requestId, audience: 'operator' as const };
    } };
    const identity = new AiTaskCurrentIdentityAuthority(dependencies.auth, credentials, dependencies.clock);
    const management = new TenantModelConfigurationAuthority(dependencies.guard, credentials, identity);
    const binding = async () => {
      const { requestId: _requestId, authorizedAt: _at, ...context } = await identity.resolve();
      if (context.audience !== 'operator' || context.actor.kind !== 'user' || context.scope.kind !== 'workspace') throw denied();
      await management.authorize({ actorId: context.actor.userId, tenantId: context.scope.tenantId,
        workspaceId: context.scope.workspaceId }, 'manage');
      const { requestId: _again, authorizedAt: _now, ...current } = await identity.resolve();
      const hash = requestFingerprint(context);
      if (hash !== requestFingerprint(current)) throw denied();
      return hash;
    };
    let root: ReturnType<typeof composeAuthorizedPersistedTextProbeWorkflow>;
    try { root = composeAuthorizedPersistedTextProbeWorkflow({ ...dependencies, credentials }); }
    catch (error) { authorization = undefined; throw error; }
    const wait = <T>(operation: () => Promise<T>, writes = false, signal?: AbortSignal) =>
      waitForTaskApplicationDependency(operation, writes, signal, dependencies.runnerClock);
    const run = <S extends z.AnyZodObject, T>(schema: S, value: unknown,
      work: (input: z.infer<S>) => Promise<T>, writes = false, execution = false, signal?: AbortSignal): Promise<T> => {
      // Snapshot before any await: neither headers nor body may retarget a call.
      const parsed = schema.safeParse(value);
      if (!parsed.success) return Promise.reject(new AiTaskRepositoryError('AI_INVALID_INPUT'));
      const input = structuredClone(parsed.data);
      return runWithRequestIdentity({}, async () => {
        const before = await wait(binding, false, signal?.aborted ? undefined : signal);
        try {
          // Execution has its own trusted step/total deadlines. Do not cut a
          // legitimate probe to the metadata deadline; only observation and
          // explicit non-dispatch mutations use this outer finite wait.
          const result = execution ? await work(input) : await wait(() => work(input), writes);
          if (before !== await wait(binding, writes)) throw denied();
          return structuredClone(result);
        } catch (error) {
          if (before !== await wait(binding, writes)) throw denied();
          // A lost write reply is not a failed write or permission to replace
          // the operation. The controller names the original-key read endpoint.
          if (writes && (!(error instanceof Error) || !('code' in error) || error.code === 'AI_STORAGE_UNAVAILABLE')) {
            throw new TextProbeOriginalRequestUnknownError();
          }
          throw error;
        }
      });
    };
    const originalKey = async (requestKey: string) => {
      const original = await wait(() => root.workflow.readOriginal(requestKey));
      if (original.state !== 'stored') throw unavailable();
      // Creation is one per original request, not a client-supplied replacement
      // key or task ID. The producer also binds the immutable input fingerprint.
      return { creationKey: textProbeTaskCreationKey(requestKey), inputRef: original.inputRef };
    };
    const selected = (capability?: TextProbeCapability) => {
      const value = capability ?? dependencies.probeCapability ?? 'text';
      if (!dependencies.probeCapabilities!.includes(value)) throw unavailable();
      return value;
    };
    const actionTask = async (requestKey: string, operation: string) => {
      const template = dependencies.taskActionPolicies!.find(policy => policy.operation === operation);
      if (!template) throw unavailable();
      const found = await root.workflow.readCreation(await originalKey(requestKey));
      if (!found.task) throw unavailable();
      return { taskId: found.task.taskId, template };
    };
    return Object.freeze({
      configureTaskAction: value => run(actionConfigureSchema, value, async ({ requestKey, operation, expectedRevision }) => {
        const target = await actionTask(requestKey, operation);
        const originalExpiry = Date.parse(await root.workflow.readOriginalPolicyExpiry(requestKey));
        const now = (dependencies.clock ?? (() => new Date()))().getTime();
        if (!Number.isFinite(now) || !Number.isFinite(originalExpiry) || originalExpiry <= now) throw unavailable();
        const policy = await root.workflow.taskPolicies.put({ taskId: target.taskId, operation: target.template.operation,
          requiredPermissions: target.template.requiredPermissions,
          expiresAt: new Date(Math.min(originalExpiry, now + dependencies.taskActionPolicyTtlMs!)) }, expectedRevision);
        return { requestKey, state: 'configured' as const, policy, retryable: false as const,
          semantics: 'action_policy_not_dispatch_or_business_approval' as const };
      }, true),
      readTaskAction: value => run(actionReadSchema, value, async ({ requestKey, operation }) => {
        const target = await actionTask(requestKey, operation);
        const result = await root.workflow.taskPolicies.read(target.taskId, target.template.operation);
        return { requestKey, state: result.state, policy: result.state === 'observed' ? result.policy : null,
          retryable: false as const, semantics: 'action_policy_not_dispatch_or_business_approval' as const };
      }),
      prepare: value => run(prepareSchema, value, async ({ requestKey, capability }) => {
        const kind = selected(capability);
        if ((await root.workflow.readOriginal(requestKey)).state === 'stored'
          && await root.workflow.readOriginalCapability(requestKey) !== kind) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        const prepared = await root.application.prepareRequestCurrent(requestKey, dependencies.platformProfileId, kind);
        return { requestKey, state: 'prepared' as const, capability: prepared.capability, methodVersion: prepared.methodVersion,
          configurationRevision: prepared.configurationRevision, execution: 'not_started' as const };
      }),
      publish: value => run(prepareSchema, value, async ({ requestKey, capability }) => {
        const kind = selected(capability);
        const previous = await root.workflow.readOriginal(requestKey);
        if (previous.state === 'stored') {
          if (await root.workflow.readOriginalCapability(requestKey) !== kind) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
          return { requestKey, ...previous, replayed: true, retryable: false as const };
        }
        const { command } = await root.application.prepareRequestCurrent(requestKey, dependencies.platformProfileId, kind);
        return { requestKey, ...await root.workflow.publishOriginal({ requestKey, command }), retryable: false as const };
      }, true),
      readOriginal: value => run(requestSchema, value, async ({ requestKey }) => {
        const original = await root.workflow.readOriginal(requestKey);
        return original.state === 'stored' ? { requestKey, ...original, retryable: false as const }
          : { requestKey, state: 'not_observed' as const, retryable: false as const };
      }),
      createTask: value => run(requestSchema, value, async ({ requestKey }) => {
        const key = await originalKey(requestKey), task = await root.workflow.createTask(key);
        const metadata = task.replayed ? await root.workflow.readTaskMetadataOriginal(key) : task;
        return { requestKey, ...taskSummary({ ...task, status: metadata.status, revision: metadata.revision }), retryable: false as const };
      }, true),
      readTask: value => run(requestSchema, value, async ({ requestKey }) => {
        const key = await originalKey(requestKey), found = await root.workflow.readCreation(key);
        if (!found.task) return { requestKey, state: found.state, task: null, retryable: false as const };
        const metadata = await root.workflow.readTaskMetadataOriginal(key);
        return { requestKey, state: 'observed' as const, task: taskSummary({ ...found.task,
          status: metadata.status, revision: metadata.revision }), retryable: false as const };
      }),
      start: (value, signal) => run(requestSchema, value, async ({ requestKey }) => {
        if (signal?.aborted) return runSummary(requestKey, { kind: 'not_started', reason: 'host_aborted' });
        const key = await originalKey(requestKey);
        selected(await wait(() => root.workflow.readOriginalCapability(requestKey)));
        return runSummary(requestKey, await root.workflow.startOriginal(key, signal));
      }, true, true, signal),
      inspect: value => run(requestSchema, value, async ({ requestKey }) => {
        const snapshot = await root.workflow.inspectOriginal(await originalKey(requestKey));
        return { requestKey, task: { taskId: snapshot.task.taskId, revision: snapshot.task.revision,
          status: snapshot.task.status, cancelRequestedAt: snapshot.task.cancelRequestedAt },
          run: { runId: snapshot.run.runId, status: snapshot.run.status }, semantics: 'task_outcome_not_capability_evidence' as const };
      }),
      cancel: value => run(cancelSchema, value, async ({ requestKey, expectedRevision }) => {
        const result = await root.workflow.requestCancellationOriginal({ ...await originalKey(requestKey), expectedRevision });
        return { requestKey, status: 'cancel_requested' as const, revision: result.event.taskRevision, retryable: false as const };
      }, true),
      reconcile: (value, signal) => run(requestSchema, value, async ({ requestKey }) => {
        if (signal?.aborted) return runSummary(requestKey, { kind: 'not_started', reason: 'host_aborted' });
        return runSummary(requestKey, await root.workflow.reconcileOriginal(await originalKey(requestKey), signal));
      }, true, true, signal),
      readCapabilityReceipt: value => run(requestSchema, value, async ({ requestKey }) => {
        // Existing reconciliation may record verified capability evidence; it
        // cannot register, reserve or dispatch. This is deliberately a POST.
        const result = await root.workflow.readCapabilityReceipt(await originalKey(requestKey));
        return { requestKey, capability: result.capability, status: result.status,
          ...('receiptId' in result ? { receiptId: result.receiptId } : {}),
          ...('evidenceHash' in result ? { evidenceHash: result.evidenceHash } : {}),
          ...('reason' in result ? { reason: result.reason } : {}),
          observation: 'observation' in result && result.observation ? { methodVersion: result.observation.methodVersion,
            mode: result.observation.mode, configurationRevision: result.observation.configurationRevision,
            checkedAt: result.observation.checkedAt, expiresAt: result.observation.expiresAt } : null,
          retryable: false as const, semantics: 'original_receipt_not_task_outcome' as const };
      }, true),
      readHistory: value => run(requestSchema, value, async ({ requestKey }) => {
        // Do not call originalKey(), collect(), or a recovery runner: those
        // either check today's config/plan or write/claim execution state.
        const history = await root.workflow.readHistoricalOriginal(requestKey);
        return { requestKey, state: history.state, applicability: history.applicability,
          currentCapability: history.currentCapability, retryable: false as const,
          original: history.original ? { expiresAt: history.original.expiresAt, validity: history.original.validity } : null,
          task: history.task ? { taskId: history.task.taskId, status: history.task.status, revision: history.task.revision,
            cancelRequestedAt: history.task.cancelRequestedAt } : null,
          run: history.run ? { runId: history.run.runId, status: history.run.status } : null,
          resultObserved: history.resultObserved, configurationRevision: history.configurationRevision,
          observation: history.observation ? { receiptId: history.observation.receiptId, methodVersion: history.observation.methodVersion,
            mode: history.observation.mode, checkedAt: history.observation.checkedAt, expiresAt: history.observation.expiresAt,
            validity: history.observation.validity, matched: history.observation.matched,
            reportedUsage: history.observation.reportedUsage ? { ...history.observation.reportedUsage } : null } : null };
      }),
      preflight: value => run(requestSchema, value, async ({ requestKey }) => {
        const result = await root.workflow.preflightOriginal(await originalKey(requestKey));
        return { requestKey, capability: result.required.includes('tools') ? 'tools' as const
          : result.required.includes('structured_output') ? 'structured_output' as const
          : result.required.includes('vision') ? 'vision' as const
          : result.required.includes('audio') ? 'audio' as const
          : result.required.includes('streaming') ? 'streaming' as const : 'text' as const, allowed: result.allowed,
          missing: result.missing.length > 0, stale: result.stale.length > 0,
          semantics: 'current_preflight_not_dispatch_permission' as const };
      }),
      close() { authorization = undefined; },
    } satisfies TextCapabilityRequest);
  }
}
