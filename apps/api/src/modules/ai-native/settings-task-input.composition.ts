import type { PrismaClient } from '@prisma/client';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { RentalCoreService } from '../rental-core/rental-core.service';
import { ApprovedSettingsRouteAuthority } from '../rental-core/approved-settings-route.authority';
import { settingsNotificationsSchema } from '../rental-core/approved-settings-change.validation';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from './ai-task.repository';
import { AiStepRegistrationRepository } from './ai-step-registration.repository';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from './task-authorization.composition';
import { PrismaTaskPlanInputSource, type SettingsInputDependencies } from './runner/prisma-task-plan-input.source';
import { PrismaTaskPlanPolicyRepository } from './runner/prisma-task-plan-policy.repository';
import { PrismaTaskExecutionScopeAuthority } from './runner/prisma-task-execution-scope.authority';
import { PrismaTaskRunEvidenceRepository } from './runner/prisma-task-run-evidence.repository';
import { registeredSettingsTool } from './approval-execution/approved-settings-contracts';
import type { AiApprovedSettingsOperationReceiptDraft } from '../../../../../packages/shared/src/ai-approved-settings-draft';

/** Publishes references to Core-prepared immutable notification changes. No
 * active settings write, approval decision, worker, timer or production seed.
 * Plan authorization is replaceable runtime evidence, never dispatch authority. */
export function composePersistedSettingsTaskInput(d: PersistedTaskAuthorizationDependencies & {
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  core: Pick<RentalCoreService, 'readVersionedBusinessSettings'>;
  scene: { code: string; version: string };
  /** Only the controlled application may attest the exact already committed
   * change. This permits receipt completion, not new input publication. */
  readCommittedChange?: (value: { taskId: string; changeId: string; changeHash: string }) => Promise<AiApprovedSettingsOperationReceiptDraft | null>;
}) {
  const clock = d.clock ?? (() => new Date());
  const scene = structuredClone(d.scene);
  const authorization = composePersistedTaskAuthorization(d);
  const route = new ApprovedSettingsRouteAuthority(d.guard, d.credentials);
  const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
  const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
  const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  registeredSettingsTool();
  if (typeof d.core?.readVersionedBusinessSettings !== 'function'
    || typeof d.db.rentalApprovedSettingsChange?.findFirst !== 'function'
    || typeof d.db.businessWorkspace?.findFirst !== 'function') throw unavailable();

  const evidence: SettingsInputDependencies = {
    async verify(context, reference, taskId, tx, purpose = 'input') {
      const db: Pick<PrismaClient, 'aiTask' | 'rentalApprovedSettingsChange' | 'businessWorkspace'> = tx ?? d.db;
      return route.withAuthorization('write', async (actor, revalidate) => {
        if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user'
          || context.scope.tenantId !== actor.tenantId || context.scope.workspaceId !== actor.workspaceId
          || context.actor.userId !== actor.actorId) throw denied();
        const read = async () => {
          const task = await db.aiTask.findFirst({ where: { id: taskId, ownerKind: 'USER', ownerId: actor.actorId,
            scope: { tenantId: actor.tenantId, workspaceId: actor.workspaceId }, archivedAt: null } });
          // Original-charge recovery reads this proof too; it does not permit new input or execution.
          const readablePlan = purpose === 'plan' && ['RUNNING', 'WAITING_CONFIRMATION', 'WAITING_EXTERNAL', 'CANCEL_REQUESTED'].includes(task?.status ?? '');
          if (!task || task.id !== taskId || task.sceneCode !== scene.code || task.sceneVersion !== scene.version
            || !(readablePlan || purpose === 'input' && task.status === 'RUNNING')
            || (task.cancelRequestedAt !== null && !(readablePlan && task.status === 'CANCEL_REQUESTED'))
            || task.audience !== context.audience.toUpperCase()) throw denied();
          const change = await db.rentalApprovedSettingsChange.findFirst({ where: { id: reference.changeId, ...actor } });
          if (!change || change.id !== reference.changeId || change.changeHash !== reference.changeHash
            || change.tenantId !== actor.tenantId || change.workspaceId !== actor.workspaceId || change.actorId !== actor.actorId) throw denied();
          const { createdAt: _created, changeHash, ...material } = change;
          if (!(change.expiresAt instanceof Date) || !Number.isFinite(change.expiresAt.getTime()) || change.expiresAt <= clock()
            || requestFingerprint({ ...material, expiresAt: change.expiresAt.toISOString() }) !== changeHash) throw conflict();
          settingsNotificationsSchema.parse(change.beforeNotifications);
          settingsNotificationsSchema.parse(change.afterNotifications);
          // Read-only comparisons here deliberately do not lock the category
          // after a task/run lock. The approved Core transaction later performs
          // category-first locking and the authoritative configuration CAS.
          const workspace = await db.businessWorkspace.findFirst({ where: { id: actor.workspaceId, tenantId: actor.tenantId } });
          const current = await d.core.readVersionedBusinessSettings(actor.tenantId, tx);
          if (!workspace || workspace.id !== actor.workspaceId || workspace.tenantId !== actor.tenantId
            || workspace.status !== 'ACTIVE' || workspace.categoryVersionId !== change.categoryVersionId
            || workspace.categoryAdoptionRevision !== change.categoryAdoptionRevision
            || current.settings.tenantId !== actor.tenantId) throw conflict();
          const unchanged = current.settingsRevision === change.baseRevision && requestFingerprint(current.settings) === change.baseSettingsHash
            && requestFingerprint(current.settings.notifications) === requestFingerprint(change.beforeNotifications);
          if (!unchanged) {
            if (purpose !== 'plan' || !d.readCommittedChange) throw conflict();
            const committed = await d.readCommittedChange({ taskId, ...reference });
            if (!committed || committed.changeId !== change.id || committed.changeHash !== change.changeHash
              || committed.baseRevision !== change.baseRevision || committed.resultRevision !== change.baseRevision + 1
              || current.settingsRevision !== committed.resultRevision || requestFingerprint(current.settings) !== committed.resultHash
              || requestFingerprint(current.settings.notifications) !== requestFingerprint(change.afterNotifications)) throw conflict();
          }
          return { expiresAt: change.expiresAt.toISOString(), hash: requestFingerprint({ task: { scopeId: task.scopeId,
            sceneCode: task.sceneCode, sceneVersion: task.sceneVersion }, material, current, workspace }) };
        };
        const before = await read();
        await revalidate();
        const after = await read();
        if (after.hash !== before.hash) throw conflict();
        await revalidate();
        return { expiresAt: after.expiresAt };
      });
    }
  };
  const source = new PrismaTaskPlanInputSource(d.db, authorization.authority, authorization.execution, clock,
    'tenant.notifications.commit', undefined, undefined, evidence);
  const policy = new PrismaTaskPlanPolicyRepository(d.db, { ...d, scene, tool: 'tenant.notifications.commit' }, clock);
  const scopes = new PrismaTaskExecutionScopeAuthority(authorization.tasks, d.db);
  const plans = new PrismaTaskRunEvidenceRepository(d.db, scopes, source, clock);
  const registrations = new AiStepRegistrationRepository(d.db, source, clock);
  return Object.freeze({ tasks: authorization.tasks, source, policy, plans, registrations });
}
