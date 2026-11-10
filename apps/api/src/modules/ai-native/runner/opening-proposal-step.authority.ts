/** Exact R1 metadata evidence on the original transition repository. A measured
 * callback alone does not prove a proposal commit. Only this closed tool and its
 * matching immutable input/Step/Proposal/Version/Action can attest saved metadata;
 * no business configuration, approval, publication or retry grant is inferred. */
import type { Prisma, PrismaClient } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION, type AiProposalPayloadDraft } from '@rental-os/shared';
import { AiTaskRepositoryError, type AiTaskRepositoryAuthority } from '../ai-task.repository';
import type { AiStepTransitionCommand } from '../ai-step-transition.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { fingerprintAiProposalDraft } from '../proposal-binding-draft';
import { verifyOpeningSectionMaterial } from '../tools/opening-section-difference.service';
import { PrismaTaskStepEvidenceAuthority } from './prisma-task-step-evidence.authority';
import type { AiTaskPlanEvidenceAuthority } from './prisma-task-run-evidence.repository';

export class OpeningProposalStepAuthority extends PrismaTaskStepEvidenceAuthority {
  protected get possibleEffect() { return true; }
  protected accepts(step: Prisma.AiStepGetPayload<{}>, operation: string) {
    return step.toolCode === 'tenant.config.propose' && step.toolVersion === AI_TOOL_DRAFT_VERSION && operation === 'idempotent';
  }
  constructor(private readonly store: PrismaClient, authority: AiTaskRepositoryAuthority,
    plans: AiTaskPlanEvidenceAuthority, clock?: () => Date) { super(store, authority, plans, clock); }

  async resolve(command: Readonly<AiStepTransitionCommand>, tx?: Prisma.TransactionClient) {
    const grant = await super.resolve(command, tx);
    const outcome = grant.next.outcome;
    if (outcome.status === 'succeeded') {
      const db = tx ?? this.store;
      const step = await db.aiStep.findFirst({ where: { id: command.stepId, taskId: command.taskId, runId: command.lease.runId } });
      if (!step) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const key = { scopeId: step.scopeId, taskId: step.taskId, runId: step.runId };
      const input = await db.aiTaskActionInput.findFirst({ where: { ...key, id: step.inputRef! } });
      const artifact = await db.aiTaskResultArtifact.findFirst({ where: { ...key, stepId: step.id, id: command.evidenceId } });
      if (!input || !artifact || input.toolCode !== 'tenant.config.propose' || input.toolVersion !== AI_TOOL_DRAFT_VERSION
        || input.fingerprint !== step.requestFingerprint) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const material = verifyOpeningSectionMaterial(input.payload);
      const reference = `opening-section:${material.key}:${material.materialHash}`;
      const version = await db.aiProposalVersion.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId,
        proposalId: `oc-${material.materialHash.slice(0, 32)}`, revision: 1 } });
      const saved = artifact.payload as { state?: string; reference?: { payloadHash?: string; registrationRef?: string } };
      if (!version || input.registrationRef !== reference || material.materialHash !== input.fingerprint
        || saved.state !== 'ai_proposal_saved' || saved.reference?.payloadHash !== version.payloadHash
        || saved.reference?.registrationRef !== reference) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const proposal = version.payload as unknown as AiProposalPayloadDraft, action = proposal.actions[0];
      const storedAction = await db.aiProposalAction.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId,
        proposalId: version.proposalId, proposalRevision: 1, actionId: step.actionId } });
      if (!storedAction || storedAction.requestFingerprint !== material.materialHash || proposal.taskId !== key.taskId
        || proposal.proposalId !== version.proposalId || proposal.revision !== 1 || proposal.actions.length !== 1
        || proposal.audience !== grant.context.audience || requestFingerprint(proposal.scope) !== requestFingerprint(grant.context.scope)
        || action.actionId !== step.actionId || action.toolCode !== 'tenant.config.propose' || action.toolVersion !== AI_TOOL_DRAFT_VERSION
        || action.input.recordId !== input.id || action.input.revision !== 1 || action.input.contentHash !== material.materialHash
        || requestFingerprint(action.preview) !== requestFingerprint(action.input) || action.target.resourceId !== material.targetId
        || action.target.version !== material.expectedVersion || fingerprintAiProposalDraft(proposal) !== version.payloadHash)
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      grant.next = { ...grant.next, outcome: { status: 'succeeded', effect: 'committed', facts: [{ scope: grant.context.scope,
        resourceType: 'report', resourceId: version.proposalId, observedAt: version.createdAt.toISOString(), basis: { kind: 'current' } }] } };
    } else if (outcome.status === 'unknown') {
      grant.next = { ...grant.next, outcome: { ...outcome, error: { ...outcome.error,
        message: 'AI提案元数据结果待核对；不重派，也不表示活动配置已写入。' } } };
    } else if (outcome.status === 'failed') {
      grant.next = { ...grant.next, outcome: { ...outcome, error: { ...outcome.error,
        message: 'AI提案元数据保存未完成；活动配置未由本工具写入。' } } };
    }
    return { ...grant, authorizationKey: `opening-proposal-${requestFingerprint({ original: grant.authorizationKey, next: grant.next })}` };
  }
}
