/** Current server diagnostic thresholds, independent of model execution and
 * Task grants. Only explicitly published scope/actor policies are considered;
 * absent, disabled or out-of-window policies cannot imply a healthy service. */
import type { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { readRuntimePublication } from '../runtime-publication.configuration';
import { taskFaultAlertPolicySchema, type TaskFaultAlertPolicySource, type TaskFaultTaskReference } from './task-fault-observation.reader';

const configuration = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), policies: z.array(taskFaultAlertPolicySchema).min(1).max(100) }).strict(),
]);

export function readTaskFaultConfiguration(value: unknown) {
  const parsed = configuration.safeParse(structuredClone(value ?? { enabled: false }));
  if (!parsed.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  if (parsed.data.enabled) {
    const keys = parsed.data.policies.map(policy => JSON.stringify([policy.scopeId, policy.tenantId,
      policy.workspaceId, policy.actorId, policy.audience]));
    if (new Set(keys).size !== keys.length) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
  return parsed.data;
}

/** Re-read on every capture and closing comparison. A deployment replacement
 * does not extend an in-flight policy, grant Task access or send notifications. */
export class RuntimeTaskFaultAlertPolicySource implements TaskFaultAlertPolicySource {
  constructor(private readonly source: Pick<ConfigService, 'get'>, private readonly clock: () => Date = () => new Date()) {}

  async read(task: Readonly<TaskFaultTaskReference>, context: AiExecutionContext) {
    return this.readCurrent(task, context);
  }

  async readForScope(scopeId: string, context: AiExecutionContext) {
    return this.readCurrentForScope(scopeId, context);
  }

  /** Close after the caller's final await without introducing another policy
   * wait. ConfigService's current publication is synchronous server state. */
  readCurrent(task: Readonly<TaskFaultTaskReference>, context: AiExecutionContext) {
    return this.readCurrentForScope(task.scopeId, context);
  }

  readCurrentForScope(scopeId: string, context: AiExecutionContext) {
    if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || !['operator', 'staff'].includes(context.audience))
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const scope = context.scope, actor = context.actor;
    const publication = readTaskFaultConfiguration(readRuntimePublication(this.source).configurations.taskFaultDiagnostics);
    if (!publication.enabled) return null;
    const current = this.clock();
    if (!(current instanceof Date) || !Number.isFinite(current.getTime())) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const policy = publication.policies.find(row => row.scopeId === scopeId && row.tenantId === scope.tenantId
      && row.workspaceId === scope.workspaceId && row.actorId === actor.userId && row.audience === context.audience);
    return policy && Date.parse(policy.validFrom) <= current.getTime() && Date.parse(policy.expiresAt) > current.getTime()
      ? structuredClone(policy) : null;
  }
}
