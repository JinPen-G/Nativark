import { z } from 'zod';
import { AI_BOOKING_DRAFT_CONTRACT_VERSION, type AiBookingDraft, type AiBookingHandoff, type AiBookingMaterial } from '@rental-os/shared';
import type { AiCustomerEntrySurface, AiEntryActionDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import type { AiClientMaterialScope, AiClientSceneMaterial } from './prisma-client-scene-material.repository';
import { PrismaClientBookingRepository, type ClientBookingRow } from './prisma-client-booking.repository';
import { AiClientEntryError, assertEntryAction, entryActionSchema, entryHash, entryId, materialEntryAction, parseEntry } from './client-entry-action';

type Material = { row: AiClientSceneMaterial; material: AiBookingMaterial; policyFingerprint: string; policyExpiresAt: Date };
const revision = z.number().int().min(1).max(4294967294);
const choiceSchema = z.object({ bookingDraftId: z.string().uuid(), expectedRevision: revision, inputFingerprint: entryHash,
  operationKey: entryId, decision: z.enum(['continue_booking', 'abandon']) }).strict();
const actionCommandSchema = z.object({ action: entryActionSchema, operationKey: entryId }).strict();
const active = ['draft_created', 'user_selected', 'handed_to_booking_page'];
const unknown = () => new AiClientEntryError('AI_RESULT_UNKNOWN', 'booking_commit_unacknowledged', 'read_booking_operation');
const hashJson = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));

export function composeClientBooking(input: {
  repository: PrismaClientBookingRepository; scope: AiClientMaterialScope; bindingHash: string; surface: AiCustomerEntrySurface;
  loadMaterial(ref: string): Promise<Material>; assertCurrent(): Promise<void>; clock(): Date;
}) {
  const repo = input.repository;
  const load = async (id: string) => {
    const row = await repo.find(input.scope, id);
    if (!row || row.bindingHash !== input.bindingHash) throw new AiClientEntryError('AI_ACCESS_DENIED', 'draft_unavailable');
    return row;
  };
  const verify = async (row: ClientBookingRow) => {
    if (!active.includes(row.state)) throw new AiClientEntryError('AI_PROPOSAL_STALE', `draft_${row.state}`, 'reprepare');
    if (row.expiresAt <= input.clock()) {
      await repo.invalidate(row, 'expired', 'lifetime_elapsed');
      throw new AiClientEntryError('AI_PROPOSAL_STALE', 'draft_expired', 'reprepare');
    }
    try {
      const material = await input.loadMaterial(row.materialRef);
      if (material.row.inputHash !== row.inputHash || material.row.bindingHash !== row.bindingHash
        || material.policyFingerprint !== row.policyHash) throw new AiClientEntryError('AI_PROPOSAL_STALE', 'draft_basis_changed', 'reprepare');
      const latest = await load(row.id);
      if (hashJson(latest) !== hashJson(row)) throw new AiClientEntryError('AI_REVISION_CONFLICT', 'draft_changed');
      await input.assertCurrent();
      return { row, rowMaterial: material.row, material: material.material,
        policyFingerprint: material.policyFingerprint, policyExpiresAt: material.policyExpiresAt };
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : null;
      const status = error instanceof Error && 'getStatus' in error && typeof error.getStatus === 'function' ? error.getStatus() : null;
      if (code === 'AI_PROPOSAL_STALE' || code === 'AI_ACCESS_DENIED' || code === 'AI_RESOURCE_UNAVAILABLE' || [401, 403, 404].includes(status)
        || (error instanceof Error && ['AI_CLIENT_MATERIAL_STALE', 'AI_CLIENT_CONTEXT_UNAVAILABLE'].includes(error.message))) {
        await repo.invalidate(row, 'stale', 'current_basis_invalid');
      }
      throw error;
    }
  };
  const openAction = (value: Awaited<ReturnType<typeof verify>>): AiEntryActionDraft | null => {
    const { row } = value;
    if (!['user_selected', 'handed_to_booking_page'].includes(row.state) || !row.selectedAt || row.selectionRevision !== 1) return null;
    const base = materialEntryAction(value.rowMaterial, input.surface, value.policyFingerprint, value.policyExpiresAt,
      value.material.selection.quoteId, 'CREATE_BOOKING_DRAFT');
    return entryActionSchema.parse({ ...base, actionId: `${row.id}:${row.selectionRevision}`, actionCode: 'OPEN_BOOKING',
      resource: { kind: 'booking_draft', id: row.id, resourceVersion: requestFingerprint({ id: row.id, inputHash: row.inputHash,
        selectionRevision: row.selectionRevision, materialHash: value.rowMaterial.materialHash }) },
      requiresConfirmation: false, riskLevel: 'R0', issuedAt: row.selectedAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
      associations: { ...base.associations, bookingDraftId: row.id } });
  };
  const verified = verify;
  const view = (value: Awaited<ReturnType<typeof verified>>): AiBookingDraft => ({
    contractVersion: AI_BOOKING_DRAFT_CONTRACT_VERSION, bookingDraftId: value.row.id, audience: 'customer', surface: input.surface,
    scope: { kind: 'workspace', tenantId: input.scope.tenantId, workspaceId: input.scope.workspaceId },
    state: value.row.state, revision: value.row.revision, selectionRevision: value.row.selectionRevision,
    inputFingerprint: value.row.inputHash, materialRef: value.row.materialRef, material: value.material,
    createdAt: value.row.createdAt.toISOString(), expiresAt: value.row.expiresAt.toISOString(), execution: 'not_submitted', action: openAction(value)
  });
  const readHandoffMaterial = async (ref: string) => {
    const handoff = await repo.handoff(input.scope, ref);
    if (!handoff) throw new AiClientEntryError('AI_ACCESS_DENIED', 'handoff_unavailable');
    if (handoff.expiresAt <= input.clock()) throw new AiClientEntryError('AI_PROPOSAL_STALE', 'handoff_expired', 'reprepare');
    const value = await verified(await load(handoff.draftId));
    if (value.row.state !== 'handed_to_booking_page' || value.row.inputHash !== handoff.inputHash
      || value.row.selectionRevision !== handoff.selectionRevision) throw new AiClientEntryError('AI_PROPOSAL_STALE', 'handoff_changed', 'reprepare');
    const latest = await repo.handoff(input.scope, ref);
    if (hashJson(handoff) !== hashJson(latest) || handoff.expiresAt <= input.clock()) throw new AiClientEntryError('AI_PROPOSAL_STALE', 'handoff_expired', 'reprepare');
    await input.assertCurrent();
    const result: AiBookingHandoff = { contractVersion: AI_BOOKING_DRAFT_CONTRACT_VERSION, handoffRef: handoff.id, bookingDraftId: value.row.id,
      revision: value.row.revision, audience: 'customer', surface: input.surface,
      scope: { kind: 'workspace', tenantId: input.scope.tenantId, workspaceId: input.scope.workspaceId },
      expiresAt: handoff.expiresAt.toISOString(), fields: value.material.selection,
      actionCode: 'OPEN_BOOKING', submission: 'original_booking_page_required', inventory: 'not_reserved' };
    return { handoff: result, value };
  };
  const readHandoff = async (ref: string): Promise<AiBookingHandoff> =>
    freezeOriginalInput((await readHandoffMaterial(ref)).handoff);
  return Object.freeze({
    async create(value: unknown) {
      const { action, operationKey } = parseEntry(actionCommandSchema, value);
      if (action.actionCode !== 'CREATE_BOOKING_DRAFT') throw new AiClientEntryError('AI_INVALID_INPUT', 'create_action_required');
      const material = await input.loadMaterial(action.associations.materialRef);
      const expected = materialEntryAction(material.row, input.surface, material.policyFingerprint, material.policyExpiresAt,
        material.material.selection.quoteId, 'CREATE_BOOKING_DRAFT');
      assertEntryAction(action, expected, input.clock());
      const result = await repo.create(material.row, material.policyFingerprint, new Date(expected.expiresAt), operationKey,
        requestFingerprint({ kind: 'create', action }));
      try { return { draft: view(await verified(result.row)), operation: result.operation.operationKey, replayed: result.replayed }; }
      catch { throw unknown(); }
    },
    async read(value: unknown) {
      const ref = parseEntry(z.object({ bookingDraftId: z.string().uuid() }).strict(), value);
      return freezeOriginalInput(view(await verified(await load(ref.bookingDraftId))));
    },
    async choose(value: unknown) {
      const command = parseEntry(choiceSchema, value), row = await load(command.bookingDraftId);
      if (row.inputHash !== command.inputFingerprint) throw new AiClientEntryError('AI_REVISION_CONFLICT', 'selection_input_changed');
      const prior = await repo.operation(input.scope, command.operationKey), operationHash = requestFingerprint(command);
      if (prior) {
        if (prior.inputHash !== operationHash || prior.draftId !== row.id) throw new AiClientEntryError('AI_REVISION_CONFLICT', 'booking_operation_conflict');
        if (row.state === 'abandoned') return { bookingDraftId: row.id, state: row.state, revision: row.revision, replayed: true };
        return { draft: view(await verified(row)), replayed: true };
      }
      await verified(row);
      if (row.revision !== command.expectedRevision) throw new AiClientEntryError('AI_REVISION_CONFLICT', 'selection_revision_changed');
      const result = await repo.transition(row, command.decision === 'continue_booking' ? 'select' : 'abandon', command.operationKey, operationHash);
      try {
        await input.assertCurrent();
        if (result.row.state === 'abandoned') return { bookingDraftId: row.id, state: result.row.state, revision: result.row.revision, replayed: result.replayed };
        return { draft: view(await verified(result.row)), replayed: result.replayed };
      } catch { throw unknown(); }
    },
    async readAction(action: AiEntryActionDraft) {
      if (action.actionCode !== 'OPEN_BOOKING' || !action.associations.bookingDraftId) throw new AiClientEntryError('AI_INVALID_INPUT', 'open_booking_action_required');
      const expected = openAction(await verified(await load(action.associations.bookingDraftId)));
      if (!expected) throw new AiClientEntryError('AI_PROPOSAL_STALE', 'selection_required');
      assertEntryAction(action, expected, input.clock());
      return freezeOriginalInput(expected);
    },
    async handoff(value: unknown) {
      const { action, operationKey } = parseEntry(actionCommandSchema, value);
      if (action.actionCode !== 'OPEN_BOOKING' || !action.associations.bookingDraftId) throw new AiClientEntryError('AI_INVALID_INPUT', 'open_booking_action_required');
      const valueAtRead = await verified(await load(action.associations.bookingDraftId)), expected = openAction(valueAtRead);
      if (!expected) throw new AiClientEntryError('AI_PROPOSAL_STALE', 'selection_required');
      assertEntryAction(action, expected, input.clock());
      const result = await repo.transition(valueAtRead.row, 'handoff', operationKey, requestFingerprint({ kind: 'handoff', action }));
      try {
        if (!result.operation.handoffRef) throw unknown();
        return { handoff: await readHandoff(result.operation.handoffRef), replayed: result.replayed };
      } catch { throw unknown(); }
    },
    async readHandoff(value: unknown) {
      const ref = parseEntry(z.object({ handoffRef: z.string().uuid() }).strict(), value);
      return readHandoff(ref.handoffRef);
    },
    /** Internal consumer result, not a new HTTP/shared DTO. Both views come
     * from the same authorized verification; callers must not join two reads
     * or treat a draft operation receipt as acceptance by the booking system. */
    async readPreparation(value: unknown) {
      const ref = parseEntry(z.object({ handoffRef: z.string().uuid() }).strict(), value);
      const current = await readHandoffMaterial(ref.handoffRef);
      return freezeOriginalInput({
        handoff: current.handoff,
        draft: view(current.value),
        observedAt: input.clock().toISOString(),
        submission: 'unavailable_original_page_acceptance_receipt_missing' as const,
        inventory: 'not_reserved' as const,
        approval: 'not_granted' as const,
      });
    },
    async readOperation(value: unknown) {
      const { operationKey } = parseEntry(z.object({ operationKey: entryId }).strict(), value);
      const operation = await repo.operation(input.scope, operationKey);
      if (!operation) return { state: 'unknown' as const, operationKey, retryable: false as const, nextAction: 'read_booking_operation' as const };
      const row = await load(operation.draftId);
      await input.assertCurrent();
      return { state: 'observed' as const, operationKey, bookingDraftId: row.id, kind: operation.kind,
        resultRevision: operation.resultRevision, handoffRef: operation.handoffRef,
        businessSubmission: 'not_attested' as const, retryable: false as const };
    }
  });
}
