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
          const result = execution ? await run() : await waitForTaskApplicationDependency(run, writes, signal);
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
      prepareOriginal: (value: unknown) => { const command = structuredClone(value); return guard(() => composed.workflow.publishOriginal(command), true); },
      readOriginal: (value: unknown) => guard(() => composed.workflow.readOriginal(typeof value === 'string' ? value : String((value as { requestKey?: string })?.requestKey ?? ''))),
      createTask: (value: unknown) => { const command = structuredClone(value); return guard(() => composed.workflow.createTask(command), true); },
      readCreation: (value: unknown) => guard(() => composed.workflow.readCreation(value)),
      start: (value: unknown, signal?: AbortSignal) => { const command = structuredClone(value); return guard(() => composed.workflow.startOriginal(command, signal), true, true, signal); },
      inspect: (value: unknown) => guard(() => composed.workflow.inspectOriginal(value)),
      requestCancellation: (value: unknown) => { const command = structuredClone(value); return guard(() => composed.workflow.requestCancellationOriginal(command), true); },
      reconcile: (value: unknown, signal?: AbortSignal) => { const command = structuredClone(value); return guard(() => composed.workflow.reconcileOriginal(command, signal), true, true, signal); },
      readCapabilityReceipt: (value: unknown) => guard(() => composed.workflow.readCapabilityReceipt(value)),
      readHistory: (value: unknown) => guard(() => composed.workflow.readHistoricalOriginal(typeof value === 'string' ? value : String((value as { requestKey?: string })?.requestKey ?? ''))),
      readTaskPolicyMutation: (value: unknown) => guard(() => composed.workflow.readTaskPolicyMutation(
        String((value as { requestKey?: string }).requestKey ?? ''),
        ((value as { operation?: import('../prisma-task-action-policy.repository').AiTaskActionPolicyMutation['operation'] }).operation ?? 'configure_action_policy') as import('../prisma-task-action-policy.repository').AiTaskActionPolicyMutation['operation'],
        (value as { expectedRevision?: number | null }).expectedRevision ?? null)),
      readAccounting: (value: unknown) => guard(() => composed.workflow.readOriginalAccounting(typeof value === 'string' ? value : String((value as { requestKey?: string })?.requestKey ?? ''))),
      releaseUnsent: (value: unknown) => { const key = typeof value === 'string' ? value : String((value as { requestKey?: string })?.requestKey ?? ''); return guard(() => composed.workflow.releaseOriginalUnsent(key), true); },
      reconcileAccounting: (value: unknown) => { const key = typeof value === 'string' ? value : String((value as { requestKey?: string })?.requestKey ?? ''); return guard(() => composed.workflow.reconcileOriginalAccounting(key), true); },
    });
  }
}
