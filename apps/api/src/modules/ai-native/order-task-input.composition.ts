import type { ApiAuthGuard } from '../../common/api-auth.guard';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { RentalOrderConfirmationService } from '../rental-core/rental-order-confirmation.service';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from './ai-task.repository';
import { AiStepRegistrationRepository } from './ai-step-registration.repository';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from './task-authorization.composition';
import { AiApprovedOrderRouteAuthority } from './approval-execution/approved-order-route.authority';
import { PersistedApprovedOrderPolicyAuthority } from './approval-execution/persisted-approved-order-policy.authority';
import { PrismaApprovedOrderOriginalInputSource } from './approval-execution/prisma-approved-order-original-input.source';
import type { ApprovedOrderOriginalInputSource } from './approval-execution/approved-order-composition.ports';
import { orderContextHash } from './approval-execution/prisma-approved-order.source';
import { PrismaTaskPlanInputSource, type PersistedTaskInputTool } from './runner/prisma-task-plan-input.source';
import { PrismaTaskPlanPolicyRepository } from './runner/prisma-task-plan-policy.repository';
import { PrismaTaskExecutionScopeAuthority } from './runner/prisma-task-execution-scope.authority';
import { PrismaTaskRunEvidenceRepository } from './runner/prisma-task-run-evidence.repository';

export function composePersistedOrderTaskInput(input: PersistedTaskAuthorizationDependencies & {
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  confirmation: Pick<RentalOrderConfirmationService, 'normalizeOrderInput'>;
  scene: { code: string; version: string };
  planTools?: readonly PersistedTaskInputTool[];
}) {
  const clock = input.clock ?? (() => new Date());
  const authorization = composePersistedTaskAuthorization(input);
  const route = new AiApprovedOrderRouteAuthority(input.guard, input.credentials, clock);
  const source = new PrismaTaskPlanInputSource(input.db, authorization.authority, authorization.execution, clock,
    'rental.order.commit', { route, confirmation: input.confirmation });
  const policy = new PrismaTaskPlanPolicyRepository(input.db, { ...input, tool: 'rental.order.commit', tools: input.planTools }, clock);
  const scopes = new PrismaTaskExecutionScopeAuthority(authorization.tasks, input.db);
  const plans = new PrismaTaskRunEvidenceRepository(input.db, scopes, source, clock);
  const registrations = new AiStepRegistrationRepository(input.db, source, clock);
  const preparation = new PersistedApprovedOrderPolicyAuthority({ ...input, toolVersion: AI_TOOL_DRAFT_VERSION });
  const reader = new PrismaApprovedOrderOriginalInputSource(preparation, AI_TOOL_DRAFT_VERSION, clock);
  const inputSource: ApprovedOrderOriginalInputSource = {
    async read(presented, tx) {
      const reference = structuredClone(presented);
      const key = { scopeId: reference.scopeId, taskId: reference.taskId, runId: reference.runId, actionId: reference.actionId };
      const step = await tx.aiStep.findFirst({ where: key });
      const row = step?.inputRef ? await tx.aiTaskActionInput.findFirst({ where: {
        scopeId: reference.scopeId, taskId: reference.taskId, runId: reference.runId, id: step.inputRef
      } }) : null;
      if (!step?.inputRef || !row) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const binding = { ...key, stepId: step.id, inputRef: step.inputRef, registrationRef: row.registrationRef, fingerprint: row.fingerprint };
      const first = await source.authorizeOrderInput(binding, tx);
      if (orderContextHash(first.context) !== orderContextHash(reference.context)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const body = await reader.read(reference, tx);
      const latest = await source.authorizeOrderInput(binding, tx);
      if (!body || first.bindingHash !== latest.bindingHash || orderContextHash(first.context) !== orderContextHash(latest.context)
        || requestFingerprint(body) !== binding.fingerprint) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return body;
    }
  };
  return Object.freeze({ tasks: authorization.tasks, source, policy, plans, registrations, inputAuthority: source, inputSource });
}
