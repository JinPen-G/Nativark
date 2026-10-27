import { z } from 'zod';
import { composeAuthorizedPlatformCapabilityProbe, type AuthorizedPlatformCapabilityProbeDependencies } from './platform-capability-probe.composition';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { randomUUID } from 'node:crypto';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { waitForTaskApplicationDependency } from '../runner/prisma-task-application';
import { TextProbeOriginalRequestUnknownError } from '../prisma-text-probe-original-request.repository';

const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
export type PlatformCapabilityProbeHttpRequest = { headers: { authorization?: unknown } };

export type PlatformCapabilityProbeRequestDependencies = Omit<AuthorizedPlatformCapabilityProbeDependencies, 'credentials'>;

/** Request-scoped entry for the platform capability probe. Each open() builds a
 * composition bound to THAT request's Bearer credential; every internal
 * operation re-resolves the current SaaS principal through the real platform
 * Guard, so credentials never leak across requests or administrators. The
 * workflow methods carry the actual semantics (immutable original, task
 * metadata only, fail-closed execution, original-key recovery). */
export class PlatformCapabilityProbeRequestFactory {
  constructor(private readonly dependencies: PlatformCapabilityProbeRequestDependencies) {
    if (!dependencies || typeof dependencies.db?.$transaction !== 'function'
      || typeof dependencies.secrets?.decrypt !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }

  open(request: PlatformCapabilityProbeHttpRequest) {
    const parsed = bearer.safeParse(request?.headers?.authorization);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    let authorization: string | undefined = parsed.data;
    const requestId = randomUUID();
    const credentials = { current: async () => {
      if (authorization === undefined) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return { authorization, requestId, audience: 'operator' as const };
    } };
    const composed = composeAuthorizedPlatformCapabilityProbe({ ...this.dependencies, credentials });
    let identity: string | undefined;
    const current = async () => {
      const context = structuredClone((await composed.scopes.resolveCurrent()).context);
      if (authorization === undefined) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const { requestId: _request, authorizedAt: _at, ...stable } = context;
      const fingerprint = requestFingerprint(stable);
      if (identity !== undefined && identity !== fingerprint) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      identity = fingerprint;
    };
    const guard = <T>(run: () => Promise<T>, writes = false, execution = false, signal?: AbortSignal): Promise<T> => {
      if (authorization === undefined) return Promise.reject(new AiTaskRepositoryError('AI_ACCESS_DENIED'));
      const abort = () => { authorization = undefined; };
      if (signal?.aborted) abort();
      signal?.addEventListener('abort', abort, { once: true });
      return runWithRequestIdentity({}, async () => {
        let entered = false;
        try {
          await waitForTaskApplicationDependency(current, false, signal);
          entered = true;
          // Preserve an original-result unknown raised by the workflow. The
          // read wait barrier may classify its OWN timeout as unavailable, but
          // must not relabel an observed financial unknown as an absent fact.
          const result = execution ? await run() : await (async () => {
            const outcome = await waitForTaskApplicationDependency(async () => {
              try { return { ok: true as const, value: await run() }; }
              catch (error) { return { ok: false as const, error }; }
            }, writes, signal);
            if (!outcome.ok) throw outcome.error;
            return outcome.value;
          })();
          await waitForTaskApplicationDependency(current, writes, signal);
          return structuredClone(result);
        } catch (error) {
          if (writes && entered) throw new TextProbeOriginalRequestUnknownError();
          throw error;
        } finally { signal?.removeEventListener('abort', abort); }
      });
    };
    return Object.freeze({
      close() { authorization = undefined; },
      readOriginalLocator: (value: unknown, signal?: AbortSignal) => guard(async () => {
        const key = typeof value === 'string' ? value : String((value as { requestKey?: string })?.requestKey ?? '');
        const original = await composed.workflow.readOriginalLocator(key);
        return original ? { state: 'stored' as const, inputRef: original.inputRef, inputHash: original.inputHash }
          : { state: 'not_found' as const };
      }, false, false, signal),
      prepareOriginal: (value: unknown, signal?: AbortSignal) => { const command = structuredClone(value); return guard(() => composed.workflow.publishOriginal(command), true, false, signal); },
      readExecutableOriginal: (value: unknown, signal?: AbortSignal) => guard(() => composed.workflow.readOriginal(typeof value === 'string' ? value : String((value as { requestKey?: string })?.requestKey ?? '')), false, false, signal),
      readOriginal: (value: unknown, signal?: AbortSignal) => guard(async () => {
        const original = await composed.workflow.readOriginalLocator(typeof value === 'string' ? value : String((value as { requestKey?: string })?.requestKey ?? ''));
        return original ? { state: 'stored' as const, inputRef: original.inputRef, inputHash: original.inputHash }
          : { state: 'not_found' as const };
      }, false, false, signal),
      createTask: (value: unknown, signal?: AbortSignal) => { const command = structuredClone(value); return guard(() => composed.workflow.createTask(command), true, false, signal); },
      readCreation: (value: unknown, signal?: AbortSignal) => guard(() => composed.workflow.readCreation(value), false, false, signal),
      start: (value: unknown, signal?: AbortSignal) => { const command = structuredClone(value); return guard(() => composed.workflow.startOriginal(command, signal), true, true, signal); },
      inspect: (value: unknown, signal?: AbortSignal) => guard(() => composed.workflow.inspectOriginal(value), false, false, signal),
      requestCancellation: (value: unknown, signal?: AbortSignal) => { const command = structuredClone(value); return guard(() => composed.workflow.requestCancellationOriginal(command), true, false, signal); },
      reconcile: (value: unknown, signal?: AbortSignal) => { const command = structuredClone(value); return guard(() => composed.workflow.reconcileOriginal(command, signal), true, true, signal); },
      readCapabilityReceipt: (value: unknown, signal?: AbortSignal) => guard(() => composed.workflow.readCapabilityReceipt(value), true, false, signal),
      readHistory: (value: unknown, signal?: AbortSignal) => guard(() => composed.workflow.readHistoricalOriginal(typeof value === 'string' ? value : String((value as { requestKey?: string })?.requestKey ?? '')), false, false, signal),
      readTaskPolicyMutation: (value: unknown, signal?: AbortSignal) => guard(() => composed.workflow.readTaskPolicyMutation(
        String((value as { requestKey?: string }).requestKey ?? ''),
        ((value as { operation?: import('../prisma-task-action-policy.repository').AiTaskActionPolicyMutation['operation'] }).operation ?? 'configure_action_policy') as import('../prisma-task-action-policy.repository').AiTaskActionPolicyMutation['operation'],
        (value as { expectedRevision?: number | null }).expectedRevision ?? null), false, false, signal),
      readAccounting: (value: unknown, signal?: AbortSignal) => guard(() => composed.workflow.readOriginalAccounting(typeof value === 'string' ? value : String((value as { requestKey?: string })?.requestKey ?? '')), false, false, signal),
      readAccountingOperation: (value: unknown, signal?: AbortSignal) => guard(() => {
        const command = z.object({ requestKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
          operation: z.enum(['releaseUnsent', 'reconcileAccounting']) }).strict().safeParse(structuredClone(value));
        if (!command.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
        return composed.workflow.readOriginalAccountingOperation(command.data.requestKey, command.data.operation);
      }, false, false, signal),
      releaseUnsent: (value: unknown, signal?: AbortSignal) => { const key = typeof value === 'string' ? value : String((value as { requestKey?: string })?.requestKey ?? ''); return guard(() => composed.workflow.releaseOriginalUnsent(key), true, false, signal); },
      reconcileAccounting: (value: unknown, signal?: AbortSignal) => { const key = typeof value === 'string' ? value : String((value as { requestKey?: string })?.requestKey ?? ''); return guard(() => composed.workflow.reconcileOriginalAccounting(key), true, false, signal); },
    });
  }
}
