import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { Prisma, type RentalApprovedSettingsOperation } from '@prisma/client';
import { AI_APPROVED_SETTINGS_DRAFT_VERSION, type AiApprovedSettingsReferenceDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ApprovedSettingsResultUnknownError, type ApprovedSettingsParticipant, type ApprovedSettingsBinding, type ApprovedSettingsOperationReceipt } from '../../rental-core/approved-settings-change.ports';
import { settingsContract } from './approved-settings-contracts';
import { ApprovedSettingsTaskAuthority, settingsConflict, settingsDenied } from './approved-settings-task.authority';

export class PrismaApprovedSettingsParticipant implements ApprovedSettingsParticipant {
  constructor(readonly authority: ApprovedSettingsTaskAuthority) {}

  async load(reference: AiApprovedSettingsReferenceDraft, mode: 'read' | 'decide' | 'execute', tx?: Prisma.TransactionClient) {
    const d = this.authority.d, db = tx ?? d.db, grant = await this.authority.resolve(reference.taskId, mode, tx);
    const key = { scopeId: grant.scopeId, taskId: reference.taskId, proposalId: reference.proposalId };
    const head = await db.aiProposal.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.proposalId } });
    const version = await db.aiProposalVersion.findFirst({ where: { ...key, revision: reference.proposalRevision } });
    if (!head || !version || version.payloadHash !== reference.reviewedPayloadHash) throw settingsConflict();
    const payload = settingsContract('AiApprovedSettingsPayloadDraft', version.payload, true);
    if (requestFingerprint(payload) !== version.payloadHash || payload.taskId !== reference.taskId || payload.proposalId !== reference.proposalId ||
        payload.revision !== reference.proposalRevision || payload.audience !== grant.context.audience || requestFingerprint(payload.scope) !== requestFingerprint(grant.context.scope) ||
        version.expiresAt.getTime() !== Date.parse(payload.expiresAt)) throw settingsConflict();
    const action = payload.actions[0], change = await db.rentalApprovedSettingsChange.findUnique({ where: { id: action.input.recordId } });
    if (!change || change.tenantId !== grant.actor.tenantId || change.workspaceId !== grant.actor.workspaceId || change.actorId !== grant.actor.actorId) throw settingsDenied();
    const { createdAt, changeHash, ...material } = change;
    if (requestFingerprint({ ...material, expiresAt: material.expiresAt.toISOString() }) !== changeHash ||
        action.input.contentHash !== changeHash || requestFingerprint(action.input) !== requestFingerprint(action.preview) ||
        action.target.resourceId !== grant.actor.workspaceId || action.target.version !== String(change.baseRevision) ||
        Date.parse(payload.expiresAt) > change.expiresAt.getTime()) throw settingsConflict();
    const actions = await db.aiProposalAction.findMany({ where: { ...key, proposalRevision: reference.proposalRevision } });
    if (actions.length !== 1 || actions[0].sequence !== 1 || actions[0].actionId !== action.actionId || actions[0].requestFingerprint !== changeHash) throw settingsConflict();
    const step = await db.aiStep.findFirst({ where: { scopeId: grant.scopeId, taskId: reference.taskId, actionId: action.actionId } });
    if (!step || step.toolCode !== action.toolCode || step.toolVersion !== AI_TOOL_DRAFT_VERSION || step.inputRef !== change.id || step.requestFingerprint !== changeHash) throw settingsConflict();
    if (mode !== 'read') {
      if (Date.parse(payload.expiresAt) <= this.authority.clock().getTime() || change.expiresAt <= this.authority.clock() ||
          await db.aiProposalVersion.findFirst({ where: { ...key, revision: { gt: reference.proposalRevision } } })) throw settingsConflict();
      if (mode === 'execute' ? head.status !== 'CONFIRMED' || head.currentRevision !== reference.proposalRevision
        : !((head.status === 'PENDING_CONFIRMATION' && head.currentRevision === null) ||
          (['CONFIRMED', 'CANCELLED'].includes(head.status) && head.currentRevision === reference.proposalRevision))) throw settingsConflict();
    }
    const before = change.beforeNotifications, after = change.afterNotifications;
    if (!before || typeof before !== 'object' || Array.isArray(before) || !after || typeof after !== 'object' || Array.isArray(after)) throw settingsConflict();
    const review = settingsContract('AiApprovedSettingsReviewDraft', { draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION,
      proposal: { payload, payloadHash: version.payloadHash, status: head.status.toLowerCase() }, generatedText: null,
      change: { changeId: change.id, changeHash, baseRevision: change.baseRevision, expiresAt: change.expiresAt.toISOString(), diff: {
        'notifications.enabledEvents': { before: before.enabledEvents, after: after.enabledEvents },
        'notifications.editableChannels': { before: before.editableChannels, after: after.editableChannels }
      } } }, true);
    return { grant, head, version, payload, action, step, change, review };
  }

  private async verify(binding: Readonly<ApprovedSettingsBinding>, mode: 'read' | 'execute', tx?: Prisma.TransactionClient) {
    const db = tx ?? this.authority.d.db;
    const proposal = await db.aiProposal.findFirst({ where: { id: binding.approval.proposalId } });
    if (!proposal) throw settingsDenied();
    const reference = { draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION, taskId: proposal.taskId, ...binding.approval };
    const loaded = await this.load(reference, mode, tx), { grant, change, payload, action } = loaded;
    if (Object.entries(grant.actor).some(([key, value]) => binding[key as keyof ApprovedSettingsBinding] !== value) ||
        change.id !== binding.changeId || change.changeHash !== binding.changeHash || change.baseRevision !== binding.baseRevision) throw settingsDenied();
    if (mode === 'execute') {
      if (!tx) throw settingsDenied();
      await this.authority.heldStep(grant, loaded.step.id, { changeId: change.id, changeHash: change.changeHash }, tx);
      if ((await tx.aiProposal.updateMany({ where: { scopeId: grant.scopeId, taskId: proposal.taskId, id: proposal.id,
        stateRevision: loaded.head.stateRevision, status: 'CONFIRMED', currentRevision: binding.approval.proposalRevision },
      data: { stateRevision: loaded.head.stateRevision } })).count !== 1) throw settingsConflict();
    }
    const approval = await db.aiApproval.findFirst({ where: { scopeId: grant.scopeId, taskId: proposal.taskId, id: binding.approval.approvalId,
      proposalId: proposal.id, proposalRevision: binding.approval.proposalRevision, actorKind: 'USER', actorId: binding.actorId, audience: grant.access.audience } });
    if (!approval || approval.decision !== 'APPROVED' || approval.payloadHash !== binding.approval.reviewedPayloadHash ||
        approval.expiresAt.getTime() !== Date.parse(payload.expiresAt) || approval.issuedAt >= approval.expiresAt || approval.issuedAt > this.authority.clock() ||
        (mode === 'execute' && approval.expiresAt <= this.authority.clock())) throw settingsDenied();
    return { ...loaded, consumption: { scopeId: grant.scopeId, taskId: proposal.taskId, actionId: action.actionId, approvalId: approval.id,
      proposalId: proposal.id, proposalRevision: binding.approval.proposalRevision, actionFingerprint: change.changeHash, businessIdempotencyKey: binding.operationKey } };
  }

  async authorize(binding: Readonly<ApprovedSettingsBinding>, tx: Prisma.TransactionClient) {
    const current = await this.verify(binding, 'execute', tx), { scopeId, taskId, actionId } = current.consumption;
    if (await tx.aiApprovalConsumption.findUnique({ where: { scopeId_taskId_actionId: { scopeId, taskId, actionId } } })) throw new ApprovedSettingsResultUnknownError();
  }

  private async operation(binding: Readonly<ApprovedSettingsBinding>, expected: Readonly<ApprovedSettingsOperationReceipt>, tx?: Prisma.TransactionClient) {
    const row = await (tx ?? this.authority.d.db).rentalApprovedSettingsOperation.findUnique({ where: { workspaceId_operationKey: { workspaceId: binding.workspaceId, operationKey: binding.operationKey } } });
    if (!row || row.tenantId !== binding.tenantId || row.actorId !== binding.actorId || row.changeId !== binding.changeId || row.changeHash !== binding.changeHash ||
        row.baseRevision !== binding.baseRevision || row.resultRevision !== binding.baseRevision + 1 || requestFingerprint(row.approvalRef) !== requestFingerprint(binding.approval) ||
        row.commandHash !== requestFingerprint({ tenantId: binding.tenantId, workspaceId: binding.workspaceId, actorId: binding.actorId,
          operationKey: binding.operationKey, changeId: binding.changeId, changeHash: binding.changeHash, approval: binding.approval }) ||
        requestFingerprint(this.receipt(row)) !== requestFingerprint(expected)) throw settingsConflict();
    return row;
  }

  async consume(binding: Readonly<ApprovedSettingsBinding>, receipt: Readonly<ApprovedSettingsOperationReceipt>, tx: Prisma.TransactionClient) {
    await this.authorize(binding, tx);
    const current = await this.verify(binding, 'execute', tx);
    await this.operation(binding, receipt, tx);
    const settings = await this.authority.d.core.readVersionedBusinessSettings(binding.tenantId, tx);
    if (settings.settingsRevision !== receipt.resultRevision || requestFingerprint(settings.settings) !== receipt.resultHash) throw settingsConflict();
    await tx.aiApprovalConsumption.create({ data: { ...current.consumption, status: 'COMMITTED', resultRef: this.resultRef(receipt) } });
    if ((await this.verify(binding, 'execute', tx)).grant.bindingHash !== current.grant.bindingHash) throw settingsDenied();
  }

  async replay(binding: Readonly<ApprovedSettingsBinding>, receipt: Readonly<ApprovedSettingsOperationReceipt>) {
    const current = await this.verify(binding, 'read');
    await this.operation(binding, receipt);
    const { scopeId, taskId, actionId } = current.consumption;
    const consumed = await this.authority.d.db.aiApprovalConsumption.findUnique({ where: { scopeId_taskId_actionId: { scopeId, taskId, actionId } } });
    if (!consumed || consumed.status !== 'COMMITTED' || consumed.resultRef !== this.resultRef(receipt) ||
        Object.entries(current.consumption).some(([key, value]) => consumed[key as keyof typeof consumed] !== value)) throw new ApprovedSettingsResultUnknownError();
    if ((await this.verify(binding, 'read')).grant.bindingHash !== current.grant.bindingHash) throw settingsDenied();
  }

  private resultRef(receipt: Readonly<ApprovedSettingsOperationReceipt>) { return `settings:${receipt.receiptId}:${requestFingerprint(receipt)}`; }
  private receipt(row: RentalApprovedSettingsOperation): ApprovedSettingsOperationReceipt {
    return { receiptId: row.id, operationKey: row.operationKey, changeId: row.changeId, changeHash: row.changeHash, baseRevision: row.baseRevision,
      resultRevision: row.resultRevision, resultHash: row.resultHash, committedAt: row.createdAt.toISOString() };
  }
}
