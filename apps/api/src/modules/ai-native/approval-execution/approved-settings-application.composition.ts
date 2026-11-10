import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AI_PROPOSAL_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, type AiProposalPayloadDraft, type AiApprovalRecordDraft } from '@rental-os/shared';
import { AI_APPROVED_SETTINGS_DRAFT_VERSION, type AiApprovedSettingsReferenceDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { lockActiveCategoryBinding } from '../../rental-core/category-active-write';
import { ApprovedSettingsRouteAuthority } from '../../rental-core/approved-settings-route.authority';
import { ApprovedSettingsChangeService } from '../../rental-core/approved-settings-change.service';
import { prepareSettingsChangeSchema } from '../../rental-core/approved-settings-change.validation';
import { AiProposalRepository, AiProposalRepositoryError } from '../ai-proposal-repository';
import { AiApprovalService, AiApprovalRepositoryError, PrismaAiApprovalRepository, type AiApprovalRecord } from '../ai-approval-repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { settingsContract, registeredSettingsTool, ApprovedSettingsApplicationUnknownError } from './approved-settings-contracts';
import { ApprovedSettingsTaskAuthority, settingsTransactionDb, settingsConflict, settingsDenied, settingsUnavailable,
  settingsExecutionLeaseSchema, type ApprovedSettingsExecutionLease, type ApprovedSettingsApplicationDependencies } from './approved-settings-task.authority';
import { PrismaApprovedSettingsParticipant } from './prisma-approved-settings.participant';
import { composePersistedSettingsTaskInput } from '../settings-task-input.composition';

export function composeApprovedSettingsApplication(d: ApprovedSettingsApplicationDependencies) {
  const authority = new ApprovedSettingsTaskAuthority(d), participant = new PrismaApprovedSettingsParticipant(authority);
  const route = new ApprovedSettingsRouteAuthority(d.guard, d.credentials);
  const domain = (tx?: Prisma.TransactionClient, executionLease?: ApprovedSettingsExecutionLease) =>
    new ApprovedSettingsChangeService(tx ? settingsTransactionDb(d.db, tx) : d.db, d.core, route,
      executionLease ? new PrismaApprovedSettingsParticipant(authority, executionLease) : participant, authority.clock);
  const sameActor = (a: object, b: object) => { if (requestFingerprint(a) !== requestFingerprint(b)) throw settingsDenied(); };
  const write = async <T>(next: 'read_preparation_receipt' | 'read_decision_receipt', work: () => Promise<T>) => {
    try { return await work(); }
    catch (error) {
      if (error instanceof AiTaskRepositoryError || error instanceof HttpException && error.getStatus() < 500) throw error;
      if (error instanceof AiProposalRepositoryError && error.code !== 'UNAVAILABLE') throw settingsConflict();
      if (error instanceof AiApprovalRepositoryError && error.code !== 'UNAVAILABLE') throw error.code === 'FORBIDDEN' ? settingsDenied() : settingsConflict();
      throw new ApprovedSettingsApplicationUnknownError(next);
    }
  };
  const approvalRecord = (row: AiApprovalRecord, loaded: Awaited<ReturnType<typeof participant.load>>): AiApprovalRecordDraft => ({
    contractVersion: AI_PROPOSAL_DRAFT_VERSION, approvalId: row.approvalId, proposalId: row.proposalId, proposalRevision: row.proposalRevision,
    payloadHash: row.payloadHash, audience: row.audience, scope: loaded.grant.context.scope,
    actor: { kind: 'user', userId: row.actorId }, decision: row.decision, issuedAt: row.issuedAt.toISOString(), expiresAt: row.expiresAt.toISOString()
  });

  const prepare = (value: unknown) => {
    const command = settingsContract('AiApprovedSettingsPrepareDraft', value), toolCode = registeredSettingsTool();
    return route.withAuthorization('write', (actor, revalidate) => write('read_preparation_receipt', () => d.db.$transaction(async tx => {
      await lockActiveCategoryBinding(tx, actor.tenantId, actor.workspaceId);
      const grant = await authority.resolve(command.taskId, 'prepare', tx);
      sameActor(actor, grant.actor);
      const change = await domain(tx).readAuthorizedChange({ changeId: command.changeId, changeHash: command.changeHash });
      const step = await authority.heldStep(grant, command.stepId, command, tx, command.runId);
      if (await tx.aiApprovalConsumption.findUnique({ where: { scopeId_taskId_actionId: { scopeId: grant.scopeId, taskId: command.taskId, actionId: step.actionId } } })) throw settingsConflict();
      const snapshot = { recordId: change.changeId, revision: 1, contentHash: change.changeHash };
      const payload: AiProposalPayloadDraft = { contractVersion: AI_PROPOSAL_DRAFT_VERSION, taskId: command.taskId, proposalId: command.proposalId,
        revision: command.proposalRevision, audience: grant.context.audience, scope: grant.context.scope, actions: [{ actionId: step.actionId,
          toolCode, toolVersion: AI_TOOL_DRAFT_VERSION, input: snapshot, preview: snapshot,
          target: { resourceType: 'configuration', resourceId: actor.workspaceId, version: String(change.baseRevision) } }],
        atomicity: 'single_action', failurePolicy: 'stop_and_reconcile', expiresAt: change.expiresAt };
      await new AiProposalRepository(d.db).createPending({ scopeId: grant.scopeId, taskId: command.taskId, payload,
        actions: [{ actionId: step.actionId, requestFingerprint: change.changeHash }] }, tx);
      const reference = { draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION, taskId: command.taskId, proposalId: command.proposalId,
        proposalRevision: command.proposalRevision, reviewedPayloadHash: requestFingerprint(payload) };
      await participant.load(reference, 'read', tx);
      if ((await authority.resolve(command.taskId, 'prepare', tx)).bindingHash !== grant.bindingHash) throw settingsDenied();
      await revalidate();
      return settingsContract('AiApprovedSettingsReferenceDraft', reference, true);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })));
  };

  const readPreparationReceipt = (value: unknown) => {
    const command = settingsContract('AiApprovedSettingsPrepareDraft', value);
    return route.withAuthorization('read', async actor => {
      const grant = await authority.resolve(command.taskId, 'read');
      sameActor(actor, grant.actor);
      const version = await d.db.aiProposalVersion.findFirst({ where: { scopeId: grant.scopeId, taskId: command.taskId,
        proposalId: command.proposalId, revision: command.proposalRevision } });
      if (!version) return settingsContract('AiApprovedSettingsPreparationReceiptDraft', { draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION,
        state: 'not_observed', nextAction: 'read_preparation_receipt' }, true);
      const reference = { draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION, taskId: command.taskId, proposalId: command.proposalId,
        proposalRevision: command.proposalRevision, reviewedPayloadHash: version.payloadHash };
      const loaded = await participant.load(reference, 'read');
      if (loaded.change.id !== command.changeId || loaded.change.changeHash !== command.changeHash || loaded.step.id !== command.stepId ||
          loaded.step.runId !== command.runId || loaded.grant.bindingHash !== grant.bindingHash) throw settingsConflict();
      return settingsContract('AiApprovedSettingsPreparationReceiptDraft', { draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION,
        state: 'prepared', reference }, true);
    });
  };

  const readProposal = (value: unknown) => {
    const reference = settingsContract('AiApprovedSettingsReferenceDraft', value);
    return route.withAuthorization('read', async actor => {
      const first = await participant.load(reference, 'read');
      sameActor(actor, first.grant.actor);
      const latest = await participant.load(reference, 'read');
      if (first.grant.bindingHash !== latest.grant.bindingHash || requestFingerprint(first.review) !== requestFingerprint(latest.review)) throw settingsConflict();
      return latest.review;
    });
  };

  const decide = (value: unknown) => {
    const { decision, ...reference } = settingsContract('AiApprovedSettingsDecisionDraft', value), toolCode = registeredSettingsTool();
    return route.withAuthorization('write', (actor, revalidate) => write('read_decision_receipt', () => d.db.$transaction(async tx => {
      await lockActiveCategoryBinding(tx, actor.tenantId, actor.workspaceId);
      const initial = await participant.load(reference, 'decide', tx);
      sameActor(actor, initial.grant.actor);
      const taskWhere = { ...initial.grant.access.where, scopeId: initial.grant.scopeId, revision: initial.grant.task.revision, cancelRequestedAt: null };
      if ((await tx.aiTask.updateMany({ where: taskWhere, data: { revision: initial.grant.task.revision } })).count !== 1) throw settingsConflict();
      await domain(tx).readAuthorizedChange({ changeId: initial.change.id, changeHash: initial.change.changeHash });
      const payload: AiProposalPayloadDraft = { ...initial.payload, actions: [{ ...initial.action, toolCode }] };
      const principal = { scopeId: initial.grant.scopeId, actorKind: 'user' as const, actorId: actor.actorId, audience: initial.grant.context.audience };
      const service = new AiApprovalService(new PrismaAiApprovalRepository(settingsTransactionDb(d.db, tx), authority.clock), {
        authorize: async (_context, input) => {
          if (input.taskId !== reference.taskId || input.proposalId !== reference.proposalId || input.proposalRevision !== reference.proposalRevision ||
              input.reviewedPayloadHash !== reference.reviewedPayloadHash || requestFingerprint(input.payload) !== requestFingerprint(payload)) throw settingsDenied();
          const current = await participant.load(reference, 'decide', tx);
          if (current.grant.bindingHash !== initial.grant.bindingHash) throw settingsDenied();
          await revalidate();
          return principal;
        }
      });
      const row = await service.decide({ context: initial.grant.context, scopeId: initial.grant.scopeId, taskId: reference.taskId,
        proposalId: reference.proposalId, proposalRevision: reference.proposalRevision, payload, reviewedPayloadHash: reference.reviewedPayloadHash,
        decision: decision === 'approve' ? 'approved' : 'rejected' });
      if ((await authority.resolve(reference.taskId, 'decide', tx)).bindingHash !== initial.grant.bindingHash) throw settingsDenied();
      await domain(tx).readAuthorizedChange({ changeId: initial.change.id, changeHash: initial.change.changeHash });
      await revalidate();
      return settingsContract('AiApprovedSettingsDecisionReceiptDraft', { draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION,
        state: 'recorded', approval: approvalRecord(row, initial) }, true);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })));
  };

  const readDecisionReceipt = (value: unknown) => {
    const reference = settingsContract('AiApprovedSettingsReferenceDraft', value);
    return route.withAuthorization('read', async actor => {
      const loaded = await participant.load(reference, 'read');
      sameActor(actor, loaded.grant.actor);
      const key = { scopeId: loaded.grant.scopeId, taskId: reference.taskId, proposalId: reference.proposalId, proposalRevision: reference.proposalRevision,
        actorKind: 'USER' as const, actorId: actor.actorId, audience: loaded.grant.access.audience };
      const row = await d.db.aiApproval.findFirst({ where: key });
      if (!row) return settingsContract('AiApprovedSettingsDecisionReceiptDraft', { draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION,
        state: 'not_observed', nextAction: 'read_decision_receipt' }, true);
      if (row.payloadHash !== reference.reviewedPayloadHash || row.expiresAt.getTime() !== Date.parse(loaded.payload.expiresAt) ||
          row.issuedAt >= row.expiresAt || row.issuedAt > authority.clock()) throw settingsConflict();
      const record: AiApprovalRecord = { ...key, actorKind: 'user', audience: loaded.grant.context.audience, approvalId: row.id,
        payloadHash: row.payloadHash, decision: row.decision === 'APPROVED' ? 'approved' : 'rejected', issuedAt: row.issuedAt, expiresAt: row.expiresAt };
      if ((await participant.load(reference, 'read')).grant.bindingHash !== loaded.grant.bindingHash) throw settingsDenied();
      return settingsContract('AiApprovedSettingsDecisionReceiptDraft', { draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION,
        state: 'recorded', approval: approvalRecord(record, loaded) }, true);
    });
  };

  const commitApprovedChange = async (value: unknown, executionLease?: ApprovedSettingsExecutionLease) => {
    const command = settingsContract('AiApprovedSettingsCommitDraft', value);
    registeredSettingsTool();
    // Only the original runner supplies its acknowledged tuple as a separate
    // server argument. Public commit fields/current database state cannot grant
    // it; callers without that binding must use the original host continuation.
    const held = settingsExecutionLeaseSchema.safeParse(structuredClone(executionLease));
    if (!held.success || held.data.holderId !== d.holderId) throw settingsUnavailable();
    const loaded = await participant.load(command, 'read');
    const result = await domain(undefined, held.data).commitApprovedChange({ operationKey: command.operationKey, changeId: loaded.change.id, changeHash: loaded.change.changeHash,
      approval: { proposalId: command.proposalId, proposalRevision: command.proposalRevision, approvalId: command.approvalId, reviewedPayloadHash: command.reviewedPayloadHash } });
    return settingsContract('AiApprovedSettingsOperationResultDraft', { draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION, ...result }, true);
  };
  const readOperation = async (value: unknown) => {
    const command = settingsContract('AiApprovedSettingsReadOperationDraft', value);
    const result = await domain().readOperation({ operationKey: command.operationKey });
    return settingsContract('AiApprovedSettingsOperationResultDraft', { draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION, ...result }, true);
  };
  // Preparing a frozen business change is distinct from creating an AI
  // proposal, deciding approval and committing active settings.
  const readCurrent = async () => settingsContract('AiApprovedSettingsCurrentDraft', await domain().readCurrent(), true);
  const prepareChange = async (value: unknown) => {
    try { return settingsContract('AiApprovedSettingsChangeReviewDraft', await domain().prepareChange(structuredClone(value)), true); }
    catch (error) {
      if (error instanceof AiTaskRepositoryError && error.code !== 'AI_RESOURCE_UNAVAILABLE'
        || error instanceof HttpException && error.getStatus() < 500) throw error;
      // The domain transaction may have committed its immutable change. Never
      // turn a lost acknowledgement into permission to generate another key.
      throw new ApprovedSettingsApplicationUnknownError('read_change_receipt');
    }
  };
  const readChangeReceipt = async (value: unknown) => {
    const parsed = prepareSettingsChangeSchema.pick({ changeKey: true }).safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const changeKey = parsed.data.changeKey;
    return route.withAuthorization('read', async (actor, revalidate) => {
      const change = structuredClone(await d.db.rentalApprovedSettingsChange.findUnique({
        where: { workspaceId_actorId_changeKey: { workspaceId: actor.workspaceId, actorId: actor.actorId, changeKey } }
      }));
      if (!change) return settingsContract('AiApprovedSettingsChangeReceiptDraft',
        { state: 'not_observed', nextAction: 'read_change_receipt' }, true);
      if (change.workspaceId !== actor.workspaceId || change.tenantId !== actor.tenantId
        || change.actorId !== actor.actorId || change.changeKey !== changeKey) throw settingsDenied();
      const review = await domain().readHistoricalChange({ changeId: change.id, changeHash: change.changeHash });
      await revalidate();
      return settingsContract('AiApprovedSettingsChangeReceiptDraft', { state: 'prepared_not_approved', change: review }, true);
    });
  };
  const publishTaskInput = (value: unknown) => composePersistedSettingsTaskInput(d).source.publishSettingsInput(value);
  const readTaskInputReceipt = (value: unknown) => composePersistedSettingsTaskInput(d).source.readSettingsInputReceipt(value);
  return Object.freeze({ readCurrent, prepareChange, readChangeReceipt, publishTaskInput, readTaskInputReceipt,
    prepare, readPreparationReceipt, readProposal, decide, readDecisionReceipt, commitApprovedChange, readOperation });
}
