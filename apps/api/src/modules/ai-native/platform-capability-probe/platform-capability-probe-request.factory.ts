import { z } from 'zod';
import { composeAuthorizedPlatformCapabilityProbe, type AuthorizedPlatformCapabilityProbeDependencies } from './platform-capability-probe.composition';
import { AiTaskRepositoryError } from '../ai-task.repository';

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
    const authorization = parsed.data;
    const credentials = { current: async () => ({ authorization, requestId: `platform-probe-${Date.now()}-${Math.random().toString(16).slice(2)}`, audience: 'operator' as const }) };
    const composed = composeAuthorizedPlatformCapabilityProbe({ ...this.dependencies, credentials });
    return Object.freeze({
      prepareOriginal: (value: unknown) => composed.workflow.publishOriginal(value),
      readOriginal: (value: unknown) => composed.workflow.readOriginal(typeof value === 'string' ? value : String((value as { requestKey?: string })?.requestKey ?? '')),
      createTask: (value: unknown) => composed.workflow.createTask(value),
      readCreation: (value: unknown) => composed.workflow.readCreation(value),
      start: (value: unknown, signal?: AbortSignal) => composed.workflow.startOriginal(value, signal),
      inspect: (value: unknown) => composed.workflow.inspectOriginal(value),
      requestCancellation: (value: unknown) => composed.workflow.requestCancellationOriginal(value),
      reconcile: (value: unknown, signal?: AbortSignal) => composed.workflow.reconcileOriginal(value, signal),
      readCapabilityReceipt: (value: unknown) => composed.workflow.readCapabilityReceipt(value),
      readHistory: (value: unknown) => composed.workflow.readHistoricalOriginal(typeof value === 'string' ? value : String((value as { requestKey?: string })?.requestKey ?? '')),
      readTaskPolicyMutation: (value: unknown) => composed.workflow.readTaskPolicyMutation(
        String((value as { requestKey?: string }).requestKey ?? ''),
        ((value as { operation?: import('../prisma-task-action-policy.repository').AiTaskActionPolicyMutation['operation'] }).operation ?? 'configure_action_policy') as import('../prisma-task-action-policy.repository').AiTaskActionPolicyMutation['operation'],
        (value as { expectedRevision?: number | null }).expectedRevision ?? null),
      readAccounting: (value: unknown) => composed.workflow.readOriginalAccounting(typeof value === 'string' ? value : String((value as { requestKey?: string })?.requestKey ?? '')),
      releaseUnsent: (value: unknown) => composed.workflow.releaseOriginalUnsent(typeof value === 'string' ? value : String((value as { requestKey?: string })?.requestKey ?? '')),
      reconcileAccounting: (value: unknown) => composed.workflow.reconcileOriginalAccounting(typeof value === 'string' ? value : String((value as { requestKey?: string })?.requestKey ?? '')),
    });
  }
}
