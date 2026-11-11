/** Dedicated ordinary-name input/registration composition. Uses the original
 * persisted input, plan and Step repositories; no alternate runner, policy seed
 * or dispatch grant. Original recovery never inserts an input or Step. */
import { hasEffectivePermission } from '../../../common/permission-match';
import type { Prisma } from '@prisma/client';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ApprovedProfileRouteAuthority } from '../../platform/approved-profile-route.authority';
import type { ApprovedProfileOperationReceipt } from '../../platform/approved-profile-change.ports';
import type { AiStepRegistrationCommand, AiStepRegistrationAuthority } from '../ai-step-registration.repository';
import { AiStepRegistrationRepository } from '../ai-step-registration.repository';
import { composePersistedTaskAuthorization } from '../task-authorization.composition';
import { PrismaTaskPlanInputSource, profileChangeInputSchema, type ProfileInputDependencies } from '../runner/prisma-task-plan-input.source';
import { PrismaTaskPlanPolicyRepository } from '../runner/prisma-task-plan-policy.repository';
import { PrismaTaskRunEvidenceRepository, type AiTaskPlanEvidenceAuthority } from '../runner/prisma-task-run-evidence.repository';
import { PrismaTaskExecutionScopeAuthority } from '../runner/prisma-task-execution-scope.authority';
import type { AiTaskRunnerLease, AiTaskRunnerPlan } from '../runner/ai-task-runner.ports';
import { composeApprovedProfileApplication } from './approved-profile-application.composition';
import { ApprovedProfileTaskAuthority, PROFILE_NAME_TOOL_CODE, profileTransactionDb, profileConflict, profileDenied,
  type ApprovedProfileApplicationDependencies } from './approved-profile-task.authority';

/** A second boundary checks the complete immutable domain object on recovery,
 * rather than accepting a short input envelope as proof of a name change. */
export class ApprovedProfileRegistrationSource implements AiStepRegistrationAuthority, AiTaskPlanEvidenceAuthority {
  constructor(private readonly authority: ApprovedProfileTaskAuthority, readonly inputs: PrismaTaskPlanInputSource) {}
  private async check(command: Readonly<AiStepRegistrationCommand>, original: boolean, tx?: Prisma.TransactionClient) {
    const grant = await this.authority.resolve(command.taskId, original ? 'read' : 'prepare', tx);
    const db = tx ?? this.authority.d.db;
    const row = await db.aiTaskActionInput.findFirst({ where: { scopeId: grant.scopeId, taskId: command.taskId,
      runId: command.lease.runId, registrationRef: command.registrationRef, toolCode: PROFILE_NAME_TOOL_CODE } });
    if (!row) throw profileDenied();
    const reference = profileChangeInputSchema.parse(row.payload);
    if (row.id !== reference.changeId || row.fingerprint !== reference.changeHash) throw profileConflict();
    const app = composeApprovedProfileApplication({ ...this.authority.d,
      db: tx ? profileTransactionDb(this.authority.d.db, tx) : this.authority.d.db });
    const change = await (original ? app.readChangeReceipt(reference) : app.readAuthorizedChange(reference));
    if (change.changeId !== row.id || change.changeHash !== row.fingerprint || change.customerId !== reference.customerId) throw profileDenied();
    return grant;
  }
  async resolve(command: Readonly<AiStepRegistrationCommand>) {
    const before = await this.check(command, false), result = await this.inputs.resolve(command);
    const after = await this.check(command, false);
    if (before.policyHash !== after.policyHash || requestFingerprint(result.context.scope) !== requestFingerprint(after.context.scope)) throw profileDenied();
    return result;
  }
  async resolveOriginal(command: Readonly<AiStepRegistrationCommand>, tx?: Prisma.TransactionClient) {
    await this.check(command, true, tx);
    return this.inputs.resolveOriginal(command, tx);
  }
  authorize(plan: Readonly<AiTaskRunnerPlan>, lease: Readonly<AiTaskRunnerLease>) { return this.inputs.authorize(plan, lease); }
  authorizePreparation: NonNullable<AiTaskPlanEvidenceAuthority['authorizePreparation']> = (definition, lease, db) =>
    this.inputs.authorizePreparation(definition, lease, db);
}

export function composePersistedProfileTaskInput(d: ApprovedProfileApplicationDependencies & {
  readCommittedChange?: (value: { taskId: string; customerId: string; changeId: string; changeHash: string }) => Promise<ApprovedProfileOperationReceipt | null>;
}) {
  const authority = new ApprovedProfileTaskAuthority(d), authorization = composePersistedTaskAuthorization(d);
  const route = new ApprovedProfileRouteAuthority(d.guard, d.credentials);
  const evidence: ProfileInputDependencies = {
    async verify(context, reference, taskId, tx, purpose = 'input') {
      const app = composeApprovedProfileApplication({ ...d, db: tx ? profileTransactionDb(d.db, tx) : d.db });
      return route.withAuthorization(purpose === 'input' ? 'write' : 'read', reference.customerId, async (actor, revalidate) => {
        if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || context.audience !== 'operator'
          || context.actor.userId !== actor.actorId || context.scope.tenantId !== actor.tenantId
          || context.scope.workspaceId !== actor.workspaceId || !('access' in context)
          || !hasEffectivePermission(context.access.permissions, 'rental-os:member:manage')) throw profileDenied();
        const grant = await authority.resolve(taskId, purpose === 'input' ? 'prepare' : 'read', tx);
        if (requestFingerprint(grant.actor) !== requestFingerprint(actor)) throw profileDenied();
        const change = await app.readChangeReceipt(reference), current = await app.readCurrent({ customerId: reference.customerId });
        if (Date.parse(change.expiresAt) <= authority.clock().getTime()) throw profileConflict();
        const same = current.ordinaryRevision === change.baseRevision && current.name === change.fields[0].before;
        if (same) await app.readAuthorizedChange(reference);
        else {
          // Only an original committed operation permits finishing the same
          // saved plan after its one CAS. Today's profile is not a receipt.
          if (purpose !== 'plan' || !d.readCommittedChange) throw profileConflict();
          const committed = await d.readCommittedChange({ taskId, ...reference });
          if (!committed || committed.changeId !== change.changeId || committed.changeHash !== change.changeHash
            || committed.customerId !== reference.customerId || committed.baseRevision !== change.baseRevision
            || committed.resultRevision !== change.baseRevision + 1 || committed.resultName !== change.fields[0].after
            || committed.resultRevision !== current.ordinaryRevision || committed.resultName !== current.name) throw profileConflict();
        }
        await revalidate();
        return { expiresAt: change.expiresAt };
      });
    }
  };
  const inputs = new PrismaTaskPlanInputSource(d.db, authorization.authority, authorization.execution, authority.clock,
    PROFILE_NAME_TOOL_CODE, undefined, undefined, undefined, evidence);
  const source = new ApprovedProfileRegistrationSource(authority, inputs);
  const policy = new PrismaTaskPlanPolicyRepository(d.db, { ...d, tool: PROFILE_NAME_TOOL_CODE }, authority.clock);
  const plans = new PrismaTaskRunEvidenceRepository(d.db, new PrismaTaskExecutionScopeAuthority(authorization.tasks, d.db), source, authority.clock);
  const registrations = new AiStepRegistrationRepository(d.db, source, authority.clock, undefined,
    { resolve: command => authorization.authority.resolve(command.taskId, 'read_step_terminal') });
  return Object.freeze({ ...authorization, source, inputs, policy, plans, registrations });
}
