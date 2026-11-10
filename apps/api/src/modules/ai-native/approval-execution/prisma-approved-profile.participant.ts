/** Original proposal/approval participant for ordinary personal-name CAS.
 * It binds the immutable change to one original Task/Step/action and records
 * consumption in the domain's transaction. Recovery reads the original receipt,
 * never today's profile name, a current configuration or a new approval. */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, type CustomerApprovedProfileOperation } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION, type AiProposalPayloadDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { fingerprintAiProposalDraft } from '../proposal-binding-draft';
import { ApprovedProfileResultUnknownError, type ApprovedProfileBinding, type ApprovedProfileOperationReceipt,
  type ApprovedProfileParticipant } from '../../platform/approved-profile-change.ports';
import { ApprovedProfileTaskAuthority, PROFILE_NAME_TOOL_CODE, profileConflict, profileDenied,
  type ProfileExecutionLease } from './approved-profile-task.authority';

export interface ProfileProposalReference { taskId: string; proposalId: string; proposalRevision: number; payloadHash: string; }
export class PrismaApprovedProfileParticipant implements ApprovedProfileParticipant {
  private readonly executionLease?: ProfileExecutionLease;
  constructor(readonly authority: ApprovedProfileTaskAuthority, executionLease?: ProfileExecutionLease) {
    this.executionLease = executionLease && Object.freeze(structuredClone(executionLease));
  }
  async load(reference: ProfileProposalReference, mode: 'read' | 'decide' | 'execute', tx?: Prisma.TransactionClient) {
    const db = tx ?? this.authority.d.db, grant = await this.authority.resolve(reference.taskId, mode, tx);
    const key = { scopeId: grant.scopeId, taskId: reference.taskId, proposalId: reference.proposalId };
    const head = await db.aiProposal.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.proposalId } });
    const version = await db.aiProposalVersion.findFirst({ where: { ...key, revision: reference.proposalRevision } });
    if (!head || !version || version.payloadHash !== reference.payloadHash) throw profileConflict();
    const payload = structuredClone(version.payload) as unknown as AiProposalPayloadDraft;
    if (fingerprintAiProposalDraft(payload) !== version.payloadHash || payload.taskId !== reference.taskId
      || payload.proposalId !== reference.proposalId || payload.revision !== reference.proposalRevision || payload.actions.length !== 1
      || payload.atomicity !== 'single_action' || payload.audience !== grant.context.audience
      || requestFingerprint(payload.scope) !== requestFingerprint(grant.context.scope)
      || version.expiresAt.getTime() !== Date.parse(payload.expiresAt)) throw profileConflict();
    const action = payload.actions[0];
    if (action.toolCode !== PROFILE_NAME_TOOL_CODE || action.toolVersion !== AI_TOOL_DRAFT_VERSION
      || action.input.revision !== 1 || requestFingerprint(action.input) !== requestFingerprint(action.preview)
      || action.target.resourceType !== 'customer') throw profileConflict();
    const change = await db.customerApprovedProfileChange.findUnique({ where: { id: action.input.recordId } });
    if (!change || change.tenantId !== grant.actor.tenantId || change.workspaceId !== grant.actor.workspaceId
      || change.actorId !== grant.actor.actorId || action.target.resourceId !== change.customerId) throw profileDenied();
    const { createdAt: _created, changeHash, ...original } = change;
    if (requestFingerprint({ ...original, expiresAt: change.expiresAt.toISOString() }) !== changeHash
      || action.input.contentHash !== changeHash || action.target.version !== String(change.baseRevision)
      || Date.parse(payload.expiresAt) > change.expiresAt.getTime()) throw profileConflict();
    const actions = await db.aiProposalAction.findMany({ where: { ...key, proposalRevision: reference.proposalRevision } });
    if (actions.length !== 1 || actions[0].sequence !== 1 || actions[0].actionId !== action.actionId
      || actions[0].requestFingerprint !== changeHash) throw profileConflict();
    const step = await db.aiStep.findFirst({ where: { scopeId: grant.scopeId, taskId: reference.taskId, actionId: action.actionId } });
    if (!step || step.toolCode !== PROFILE_NAME_TOOL_CODE || step.toolVersion !== AI_TOOL_DRAFT_VERSION
      || step.inputRef !== change.id || step.requestFingerprint !== changeHash) throw profileConflict();
    if (mode !== 'read') {
      if (Date.parse(payload.expiresAt) <= this.authority.clock().getTime() || change.expiresAt <= this.authority.clock()
        || await db.aiProposalVersion.findFirst({ where: { ...key, revision: { gt: reference.proposalRevision } } })) throw profileConflict();
      if (mode === 'execute' ? head.status !== 'CONFIRMED' || head.currentRevision !== reference.proposalRevision
        : !((head.status === 'PENDING_CONFIRMATION' && head.currentRevision === null)
          || (['CONFIRMED', 'CANCELLED'].includes(head.status) && head.currentRevision === reference.proposalRevision))) throw profileConflict();
    }
    return { grant, head, version, payload, action, change, step };
  }
  private async verify(binding: Readonly<ApprovedProfileBinding>, mode: 'read' | 'execute', tx?: Prisma.TransactionClient) {
    const db = tx ?? this.authority.d.db;
    const proposal = await db.aiProposal.findFirst({ where: { id: binding.approval.proposalId } });
    if (!proposal) throw profileDenied();
    const loaded = await this.load({ taskId: proposal.taskId, ...binding.approval }, mode, tx), { grant, change, action, payload } = loaded;
    if (Object.entries(grant.actor).some(([key, value]) => binding[key as keyof ApprovedProfileBinding] !== value)
      || binding.customerId !== change.customerId || binding.changeId !== change.id || binding.changeHash !== change.changeHash
      || binding.baseRevision !== change.baseRevision) throw profileDenied();
    if (mode === 'execute') {
      if (!tx || !this.executionLease) throw profileDenied();
      await this.authority.heldStep(grant, action.actionId, change, this.executionLease, tx);
      if ((await tx.aiProposal.updateMany({ where: { scopeId: grant.scopeId, taskId: grant.task.id, id: proposal.id,
        stateRevision: loaded.head.stateRevision, status: 'CONFIRMED', currentRevision: binding.approval.proposalRevision },
        data: { stateRevision: loaded.head.stateRevision } })).count !== 1) throw profileConflict();
    }
    const approval = await db.aiApproval.findFirst({ where: { scopeId: grant.scopeId, taskId: grant.task.id,
      id: binding.approval.approvalId, proposalId: proposal.id, proposalRevision: binding.approval.proposalRevision,
      actorKind: 'USER', actorId: binding.actorId, audience: grant.access.audience } });
    if (!approval || approval.decision !== 'APPROVED' || approval.payloadHash !== binding.approval.payloadHash
      || approval.payloadHash !== loaded.version.payloadHash || approval.expiresAt.getTime() !== Date.parse(payload.expiresAt)
      || approval.issuedAt >= approval.expiresAt || approval.issuedAt > this.authority.clock()
      || (mode === 'execute' && approval.expiresAt <= this.authority.clock())) throw profileDenied();
    return { ...loaded, consumption: { scopeId: grant.scopeId, taskId: grant.task.id, actionId: action.actionId,
      approvalId: approval.id, proposalId: proposal.id, proposalRevision: binding.approval.proposalRevision,
      actionFingerprint: change.changeHash, businessIdempotencyKey: binding.operationKey } };
  }
  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 'AI_ACCESS_DENIED') throw new ForbiddenException();
        if (error.code === 'AI_REVISION_CONFLICT' || error.code === 'AI_RESOURCE_UNAVAILABLE') throw new ConflictException('原普通姓名批准或任务依据已变化/未就绪');
      }
      throw error;
    }
  }
  async authorize(binding: Readonly<ApprovedProfileBinding>, tx: Prisma.TransactionClient) {
    await this.guarded(async () => {
      const current = await this.verify(binding, 'execute', tx), { scopeId, taskId, actionId } = current.consumption;
      if (await tx.aiApprovalConsumption.findUnique({ where: { scopeId_taskId_actionId: { scopeId, taskId, actionId } } })) throw new ApprovedProfileResultUnknownError();
    });
  }
  private receipt(row: CustomerApprovedProfileOperation): ApprovedProfileOperationReceipt {
    return { receiptId: row.id, operationKey: row.operationKey, changeId: row.changeId, changeHash: row.changeHash,
      customerId: row.customerId, baseRevision: row.baseRevision, resultRevision: row.resultRevision,
      resultName: row.resultName, resultHash: row.resultHash, committedAt: row.createdAt.toISOString() };
  }
  private async operation(binding: Readonly<ApprovedProfileBinding>, expected: Readonly<ApprovedProfileOperationReceipt>, tx?: Prisma.TransactionClient) {
    const row = await (tx ?? this.authority.d.db).customerApprovedProfileOperation.findUnique({ where: { tenantId_customerId_operationKey: {
      tenantId: binding.tenantId, customerId: binding.customerId, operationKey: binding.operationKey } } });
    if (!row || row.workspaceId !== binding.workspaceId || row.actorId !== binding.actorId || row.changeId !== binding.changeId
      || row.changeHash !== binding.changeHash || row.baseRevision !== binding.baseRevision || row.resultRevision !== row.baseRevision + 1
      || requestFingerprint(row.approvalRef) !== requestFingerprint(binding.approval)
      || row.commandHash !== requestFingerprint({ tenantId: binding.tenantId, workspaceId: binding.workspaceId, actorId: binding.actorId,
        customerId: binding.customerId, operationKey: binding.operationKey, changeId: binding.changeId, changeHash: binding.changeHash, approval: binding.approval })
      || row.resultHash !== requestFingerprint({ customerId: row.customerId, name: row.resultName, ordinaryRevision: row.resultRevision })
      || requestFingerprint(this.receipt(row)) !== requestFingerprint(expected)) throw profileConflict();
    return row;
  }
  private resultRef(receipt: Readonly<ApprovedProfileOperationReceipt>) { return `profile:${receipt.receiptId}:${requestFingerprint(receipt)}`; }
  async consume(binding: Readonly<ApprovedProfileBinding>, receipt: Readonly<ApprovedProfileOperationReceipt>, tx: Prisma.TransactionClient) {
    await this.guarded(async () => {
      await this.authorize(binding, tx);
      const current = await this.verify(binding, 'execute', tx);
      await this.operation(binding, receipt, tx);
      const profile = await tx.customerProfile.findFirst({ where: { tenantId: binding.tenantId, id: binding.customerId },
        select: { id: true, name: true, ordinaryRevision: true } });
      if (!profile || profile.name !== current.change.afterName || profile.ordinaryRevision !== receipt.resultRevision
        || receipt.resultName !== profile.name || requestFingerprint({ customerId: profile.id, name: profile.name,
          ordinaryRevision: profile.ordinaryRevision }) !== receipt.resultHash) throw profileConflict();
      await tx.aiApprovalConsumption.create({ data: { ...current.consumption, status: 'COMMITTED', resultRef: this.resultRef(receipt) } });
      if ((await this.verify(binding, 'execute', tx)).grant.bindingHash !== current.grant.bindingHash) throw profileDenied();
    });
  }
  async replay(binding: Readonly<ApprovedProfileBinding>, receipt: Readonly<ApprovedProfileOperationReceipt>) {
    await this.guarded(async () => {
      const current = await this.verify(binding, 'read');
      await this.operation(binding, receipt);
      const { scopeId, taskId, actionId } = current.consumption;
      const consumed = await this.authority.d.db.aiApprovalConsumption.findUnique({ where: { scopeId_taskId_actionId: { scopeId, taskId, actionId } } });
      if (!consumed || consumed.status !== 'COMMITTED' || consumed.resultRef !== this.resultRef(receipt)
        || Object.entries(current.consumption).some(([key, value]) => consumed[key as keyof typeof consumed] !== value)) throw new ApprovedProfileResultUnknownError();
      if ((await this.verify(binding, 'read')).grant.bindingHash !== current.grant.bindingHash) throw profileDenied();
    });
  }
}
