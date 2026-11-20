/** Inspection's original Guard and frozen draft supply the generic task
 * participant. New work owns Auth/Tenant -> Core -> Order -> Task locks in one
 * transaction. Original settlement does not call this new-work participant. */
import { z } from 'zod';
import { getRequestIdentity, runWithRequestIdentity } from '@rental-os/platform-server/request-identity';
import { hasRentalBusinessTenantFence, assertRentalBusinessTenantAccessAfterLock } from '@rental-os/rental-core/mysql-business-fence';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { AiTaskRepositoryError } from '../../task-errors';
import { holdAiTaskDeploymentAdmission, withAiTaskTransactionAuthority, type AiTaskTransactionReference } from '../task-transaction-authority';
import { InspectionActionAuthority } from './inspection-action.authority';
import { InspectionTemplateService } from './inspection-template.service';
import { inspectionRecognitionInputSchema } from './inspection-draft.service';
import { inspectionId, inspectionTargetSchema } from './inspection-assist.validation';
import type { InspectionEvidenceTransactionPorts } from './prisma-inspection-evidence.authority';

const referenceSchema = inspectionTargetSchema.extend({ templateId: inspectionId, draftId: inspectionId,
  inputId: inspectionId, expectedRevision: z.number().int().min(1).max(999) }).strict();
type Dependencies = ConstructorParameters<typeof InspectionTemplateService>[0] & Partial<InspectionEvidenceTransactionPorts> & {
  /** Exact server-selected recognition scene codes; never copied from an HTTP field. */
  creationScenes?: readonly string[];
};
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

export async function withInspectionTaskTransactions<T>(dependencies: Dependencies, value: unknown,
  consume: () => Promise<T>): Promise<T> {
  // The legacy host keeps its original isolated Guard flow. Only a selected
  // server request can choose this mode; no DTO or optional boolean selects it.
  if (!hasRentalBusinessTenantFence()) return runWithRequestIdentity({}, consume);
  if (!dependencies.auth || !dependencies.orders) throw denied();
  const auth = dependencies.auth, orders = dependencies.orders;
  const reference = referenceSchema.parse(structuredClone(value));
  const target = { orderId: reference.orderId, allocationId: reference.allocationId,
    templateId: reference.templateId, stage: reference.stage };
  const authority = new InspectionActionAuthority(dependencies.guard, dependencies.credentials);
  const templates = new InspectionTemplateService(dependencies);
  return authority.withAction(target, 'read', async scope => {
    const identity = getRequestIdentity();
    if (!identity) throw denied();
    const binding = requestFingerprint({ scope, reference, session: identity.accessSession });
    return withAiTaskTransactionAuthority({ binding, begin: async (tx, original) => {
      if (getRequestIdentity() !== identity || '$transaction' in tx) throw denied();
      const lease = await auth.lockRequestWorkspaceAccess(tx);
      let needsBindPermission = original.kind !== 'task_control';
      const current = async (user: typeof lease.user) => {
        if (getRequestIdentity() !== identity) throw denied();
        await assertRentalBusinessTenantAccessAfterLock(tx, scope.tenantId);
        await authority.assertTransactionScope(target, scope, user, tx, needsBindPermission ? 'bind' : 'read');
      };
      await current(lease.user);
      const deploymentAdmission = await holdAiTaskDeploymentAdmission(tx, original.kind === 'task_control' ? 'task_control' : 'new_work');
      await orders.lockOrder(scope.tenantId, target.orderId, tx);
      const order = await orders.findOrder(scope.tenantId, target.orderId, tx), locations = identity.locationScope;
      const location = target.stage === 'pickup' ? order?.fulfillmentLocationId : order?.returnLocationId ?? order?.fulfillmentLocationId;
      if (!order || order.id !== target.orderId || order.tenantId !== scope.tenantId || !location || !locations
        || locations.mode === 'selected' && !locations.locationIds.includes(location)) throw denied();
      const checkReference = async (key: AiTaskTransactionReference) => {
        if (key.kind !== 'task_control') deploymentAdmission.requireNewWork();
        if (key.kind !== 'task_control' && !needsBindPermission) {
          needsBindPermission = true;
          await current(lease.user);
        }
        if (key.kind === 'creation') {
          if (key.inputRef !== reference.inputId || !dependencies.creationScenes?.includes(key.sceneCode)) throw denied();
          const template = await templates.readInTransaction(target, tx);
          const draft = await tx.aiInspectionDraft.findFirst({ where: { id: reference.draftId, ...scope, ...target,
            revision: reference.expectedRevision, status: { in: ['draft_saved', 'prepared'] } } });
          if (!draft || draft.expiresAt <= new Date() || draft.bindingFingerprint !== template.bindingFingerprint) throw denied();
          const state = z.object({ recognitionInputs: z.array(inspectionRecognitionInputSchema) }).passthrough().safeParse(draft.state);
          const inputs = state.success ? state.data.recognitionInputs.filter(input => input.inputId === reference.inputId) : [];
          if (inputs.length !== 1) throw denied();
          const { inputFingerprint, ...payload } = inputs[0];
          if (requestFingerprint(payload) !== inputFingerprint || payload.bindingFingerprint !== draft.bindingFingerprint) throw denied();
          return;
        }
        const ownerScope = await tx.aiScope.findFirst({ where: { kind: 'WORKSPACE',
          tenantId: scope.tenantId, workspaceId: scope.workspaceId }, select: { id: true } });
        if (!ownerScope) throw denied();
        const taskId = key.kind === 'task' || key.kind === 'task_control' ? key.taskId : key.kind === 'step'
          ? (await tx.aiStep.findFirst({ where: { id: key.stepId, scopeId: ownerScope.id } }))?.taskId
          : (await tx.aiGatewayInvocation.findFirst({ where: { callId: key.callId, actorId: scope.ownerId,
            scopeId: ownerScope.id } }))?.taskId;
        if (!taskId) throw denied();
        const task = await tx.aiTask.findFirst({ where: { id: taskId, inputRef: reference.inputId,
          inputRevision: reference.expectedRevision, ownerKind: 'USER', ownerId: scope.ownerId, audience: 'STAFF',
          scopeKind: 'WORKSPACE', scopeId: ownerScope.id } });
        if (!task) throw denied();
      };
      await checkReference(original);
      return { verifyReference: checkReference, revalidate: async () => {
        await current(await lease.revalidate());
        await checkReference(original);
      } };
    } }, consume);
  });
}
