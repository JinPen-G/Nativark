import { z } from 'zod';
import type { AiInspectionActorScope, AiInspectionDraftState, AiInspectionTarget } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { InspectionActionAuthority } from './inspection-action.authority';
import { InspectionTemplateService } from './inspection-template.service';
import { InspectionManualPreparationService } from './inspection-manual-preparation.service';
import { InspectionCandidateService, snapshotInspectionCandidates } from './inspection-candidate.service';
import { PrismaInspectionDraftRepository } from './prisma-inspection-draft.repository';
import { InspectionAssistError, inspectionId, inspectionTargetSchema, parseInspectionInput } from './inspection-assist.validation';
import { recognitionSaveAssociationSchema, recognitionSaveReferenceSchema, type RecognitionSaveAssociation } from './inspection-recognition-save.association';

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const targetSchema = inspectionTargetSchema.extend({ templateId: inspectionId }).strict();
const scalar = z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]);
const evidenceRef = z.object({ attachmentId: inspectionId, attachmentRevision: z.number().int().positive() }).strict();
const resultsSchema = z.record(inspectionId, scalar).refine(value => Object.keys(value).length <= 100);
const createSchema = targetSchema.extend({ operationId: inspectionId, bindingFingerprint: hash,
  results: resultsSchema, evidence: z.array(evidenceRef).max(100) }).strict();
const changeSchema = targetSchema.extend({ draftId: inspectionId, operationId: inspectionId,
  expectedRevision: z.number().int().min(1).max(999), bindingFingerprint: hash }).strict();
const evidenceChangeSchema = changeSchema.extend({ evidence: z.array(evidenceRef).max(100) }).strict();
const editSchema = changeSchema.extend({ edits: z.array(z.object({ fieldCode: inspectionId,
  decision: z.enum(['manual', 'accepted', 'modified', 'rejected']), value: scalar.optional(), candidateId: inspectionId.optional() }).strict()).min(1).max(100) }).strict();
export const inspectionSubmissionMaterialSchema = z.object({ mode: z.enum(['original_single', 'manual_review_only']).optional(), actionId: inspectionId, requestHash: hash,
  body: z.object({ templateId: inspectionId, results: z.record(inspectionId, z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.array(inspectionId).max(100)])),
    attachments: z.array(inspectionId).max(101), handoverSignatureFileAssetId: inspectionId.optional() }).strict() }).strict();
export const inspectionRecognitionInputSchema = z.object({ inputId: inspectionId, inputFingerprint: hash, bindingFingerprint: hash, question: z.string().min(1).max(4000),
  template: z.object({ id: inspectionId, version: inspectionId, fields: z.array(z.object({ code: inspectionId, type: z.string(), label: z.string(), required: z.boolean(), options: z.array(z.string()).optional() }).strict()).max(100) }).strict(),
  media: z.array(evidenceRef.extend({ contentHash: hash, mediaType: z.string(), sizeBytes: z.number().int().positive(), width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(), durationMs: z.number().int().nonnegative().nullable() }).strict()).max(8) }).strict();
const stateSchema = z.object({ version: z.literal(1), fields: z.record(inspectionId, z.object({ value: scalar,
  decision: z.enum(['manual', 'accepted', 'modified', 'rejected']), candidateId: inspectionId.optional(), actorId: inspectionId }).strict()),
  candidates: z.array(z.unknown()).max(100), evidence: z.array(evidenceRef).max(100), missingFields: z.array(inspectionId).max(100), reviewRequired: z.boolean(), submission: inspectionSubmissionMaterialSchema.optional(), recognitionInputs: z.array(inspectionRecognitionInputSchema).max(8).optional() }).strict();
export interface InspectionDraftEvidence {
  fingerprint(target: AiInspectionTarget, refs: Array<z.infer<typeof evidenceRef>>): Promise<string>;
}
const targetOf = (input: AiInspectionTarget): AiInspectionTarget => ({ orderId: input.orderId, allocationId: input.allocationId, stage: input.stage, templateId: input.templateId });

export class InspectionDraftService {
  constructor(private readonly repository: PrismaInspectionDraftRepository, private readonly authority: InspectionActionAuthority,
    private readonly templates: InspectionTemplateService, private readonly manual: InspectionManualPreparationService,
    private readonly candidates: InspectionCandidateService, private readonly evidence?: InspectionDraftEvidence) {}

  async create(value: unknown) {
    const input = parseInspectionInput(createSchema, value), target = targetOf(input);
    return this.authority.withAction(target, 'write', async scope => {
      const fingerprint = requestFingerprint({ kind: 'inspection.draft.create', scope, input });
      const replay = await this.replay(scope, input.operationId, fingerprint);
      if (replay) return replay;
      const binding = await this.binding(target, scope, input.bindingFingerprint);
      const prepared = await this.manual.prepare({ ...target, bindingFingerprint: input.bindingFingerprint, results: input.results });
      if (prepared.unavailableEvidenceFields.length) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
      this.photoReferences(binding, prepared.results, input.evidence);
      const evidenceFingerprint = await this.evidenceHash(target, input.evidence);
      const state: AiInspectionDraftState = { version: 1, fields: Object.fromEntries(Object.entries(prepared.results)
        .map(([code, value]) => [code, { value, decision: 'manual', actorId: scope.ownerId }])),
      candidates: [], evidence: input.evidence, missingFields: prepared.missingFields, reviewRequired: false };
      await this.binding(target, scope, input.bindingFingerprint);
      return this.authority.withAction(target, 'write', current => {
        this.sameScope(scope, current);
        return this.repository.create(scope, { operationId: input.operationId, fingerprint, expectedRevision: 0 }, {
          ...scope, ...target, assetId: binding.assetId, templateVersion: binding.template.version,
          bindingFingerprint: binding.bindingFingerprint, evidenceFingerprint, status: 'draft_saved',
          state: JSON.parse(JSON.stringify(state)), expiresAt: new Date(Date.now() + 30 * 86400000) });
      });
    });
  }

  async edit(value: unknown) {
    const input = parseInspectionInput(editSchema, value), target = targetOf(input);
    if (new Set(input.edits.map(row => row.fieldCode)).size !== input.edits.length) throw new InspectionAssistError('INVALID_INPUT');
    return this.authority.withAction(target, 'write', async scope => {
      const fingerprint = requestFingerprint({ kind: 'inspection.draft.edit', scope, input });
      const replay = await this.replay(scope, input.operationId, fingerprint);
      if (replay) return replay;
      const row = await this.load(scope, input.draftId, target);
      this.editable(row, input.expectedRevision);
      const binding = await this.binding(target, scope, input.bindingFingerprint);
      if (row.bindingFingerprint !== input.bindingFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
      const state = this.state(row.state);
      delete state.submission;
      for (const edit of input.edits) {
        const candidate = edit.candidateId ? state.candidates.find(item => item.candidateId === edit.candidateId && item.fieldCode === edit.fieldCode) : undefined;
        if (edit.decision !== 'manual' && !candidate || edit.decision === 'manual' && edit.candidateId) throw new InspectionAssistError('INVALID_INPUT');
        if (candidate && edit.decision !== 'rejected' && !this.sourcesIncluded(candidate, state.evidence)) throw new InspectionAssistError('BINDING_CHANGED');
        let value = edit.value;
        if (edit.decision === 'accepted') {
          if (!candidate || candidate.status !== 'candidate' || edit.value !== undefined) throw new InspectionAssistError('INVALID_INPUT');
          value = candidate.value.kind === 'photo' ? candidate.value.attachmentId : candidate.value.value;
          await this.candidates.consume({ ...target, bindingFingerprint: input.bindingFingerprint, candidates: [candidate] });
        }
        if (edit.decision === 'rejected') {
          if (edit.value !== undefined) throw new InspectionAssistError('INVALID_INPUT');
          value = null;
        }
        if (value === undefined) throw new InspectionAssistError('INVALID_INPUT');
        state.fields[edit.fieldCode] = { value, decision: edit.decision, ...(edit.candidateId ? { candidateId: edit.candidateId } : {}), actorId: scope.ownerId };
      }
      const values = Object.fromEntries(Object.entries(state.fields).map(([code, field]) => [code, field.value]));
      const prepared = await this.manual.prepare({ ...target, bindingFingerprint: input.bindingFingerprint, results: values });
      if (prepared.unavailableEvidenceFields.length) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
      this.photoReferences(binding, prepared.results, state.evidence);
      const evidenceFingerprint = await this.evidenceHash(target, state.evidence);
      if (evidenceFingerprint !== row.evidenceFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
      state.missingFields = prepared.missingFields;
      return this.authority.withAction(target, 'write', async current => {
        this.sameScope(scope, current);
        await this.binding(target, scope, input.bindingFingerprint);
        return this.repository.change(scope, row.id, { operationId: input.operationId, fingerprint, expectedRevision: input.expectedRevision },
          input.bindingFingerprint, { state: JSON.parse(JSON.stringify(state)), status: 'draft_saved' });
      });
    });
  }

  async saveCandidates(value: unknown, recognitionSave?: RecognitionSaveAssociation) {
    const input = parseInspectionInput(changeSchema.extend({ candidates: z.array(z.unknown()).max(100) }).strict(), value);
    const association = recognitionSave ? parseInspectionInput(recognitionSaveAssociationSchema, recognitionSave) : undefined;
    const snapshot = snapshotInspectionCandidates(input.candidates), target = targetOf(input);
    input.candidates = snapshot;
    return this.authority.withAction(target, 'write', async scope => {
      const fingerprint = requestFingerprint({ kind: 'inspection.draft.candidates', scope, input });
      if (association && (requestFingerprint(association.scope) !== requestFingerprint(scope)
        || requestFingerprint(targetOf(association.reference)) !== requestFingerprint(target)
        || association.reference.draftId !== input.draftId || association.reference.expectedRevision !== input.expectedRevision
        || association.reference.operationId !== input.operationId || association.bindingFingerprint !== input.bindingFingerprint
        || association.candidateHash !== requestFingerprint(snapshot) || association.commandHash !== fingerprint)) {
        throw new InspectionAssistError('BINDING_CHANGED');
      }
      const receipt = await this.repository.receipt(scope, input.operationId, fingerprint, association);
      if (receipt.status === 'unavailable') throw new InspectionAssistError('RECONCILIATION_REQUIRED');
      if (receipt.status === 'found') {
        await this.load(scope, receipt.result.draftId, target);
        return receipt.result;
      }
      const row = await this.load(scope, input.draftId, target);
      this.editable(row, input.expectedRevision);
      if (row.bindingFingerprint !== input.bindingFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
      const consumed = await this.candidates.consume({ ...target, bindingFingerprint: input.bindingFingerprint, candidates: snapshot });
      const state = this.state(row.state);
      if (snapshot.some(candidate => candidate.sources.some(source => !state.evidence.some(ref => ref.attachmentId === source.attachmentId
        && ref.attachmentRevision === source.attachmentRevision)))) throw new InspectionAssistError('BINDING_CHANGED');
      if (snapshot.some(candidate => state.candidates.some(old => old.candidateId === candidate.candidateId))) throw new InspectionAssistError('REVISION_CONFLICT');
      if (state.candidates.length + snapshot.length > 100) throw new InspectionAssistError('INVALID_INPUT');
      state.candidates.push(...consumed.candidates);
      delete state.submission;
      state.reviewRequired = true;
      await this.binding(target, scope, input.bindingFingerprint);
      return this.authority.withAction(target, 'write', current => {
        this.sameScope(scope, current);
        return this.repository.change(scope, row.id, { operationId: input.operationId, fingerprint, expectedRevision: input.expectedRevision,
          ...(association ? { recognitionSave: association } : {}) },
          input.bindingFingerprint, { state: JSON.parse(JSON.stringify(state)), status: 'draft_saved' });
      });
    });
  }

  /** Explicit human draft change, not attachment deletion or business submission.
   * Preserve candidate history, but invalidate prepared execution materials.
   * A value dependent on removed evidence must first be explicitly corrected
   * or cleared by the human through edit(); never silently rewrite their value. */
  async replaceEvidence(value: unknown) {
    const input = parseInspectionInput(evidenceChangeSchema, value), target = targetOf(input);
    if (new Set(input.evidence.map(ref => ref.attachmentId)).size !== input.evidence.length) throw new InspectionAssistError('INVALID_INPUT');
    return this.authority.withAction(target, 'write', async scope => {
      const fingerprint = requestFingerprint({ kind: 'inspection.draft.evidence', scope, input });
      const replay = await this.replay(scope, input.operationId, fingerprint);
      if (replay) return replay;
      const row = await this.load(scope, input.draftId, target);
      this.editable(row, input.expectedRevision);
      const binding = await this.binding(target, scope, input.bindingFingerprint);
      if (row.bindingFingerprint !== input.bindingFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
      const state = this.state(row.state);
      for (const field of Object.values(state.fields)) {
        if (field.value === null || !field.candidateId) continue;
        const candidate = state.candidates.find(item => item.candidateId === field.candidateId);
        if (!candidate || !this.sourcesIncluded(candidate, input.evidence)) throw new InspectionAssistError('BINDING_CHANGED');
      }
      const values = Object.fromEntries(Object.entries(state.fields).map(([code, field]) => [code, field.value]));
      // Check retained photo references before reading them: removal must not
      // silently discard a manually selected photograph either.
      this.photoReferences(binding, Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string | number | boolean] => entry[1] !== null)), input.evidence);
      const evidenceFingerprint = await this.evidenceHash(target, input.evidence);
      const prepared = await this.manual.prepare({ ...target, bindingFingerprint: input.bindingFingerprint, results: values });
      if (prepared.unavailableEvidenceFields.length) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
      state.evidence = input.evidence;
      state.missingFields = prepared.missingFields;
      state.reviewRequired = true;
      delete state.submission;
      delete state.recognitionInputs;
      return this.authority.withAction(target, 'write', async current => {
        this.sameScope(scope, current);
        await this.binding(target, scope, input.bindingFingerprint);
        if (await this.evidenceHash(target, input.evidence) !== evidenceFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
        return this.repository.change(scope, row.id, { operationId: input.operationId, fingerprint, expectedRevision: input.expectedRevision },
          input.bindingFingerprint, { state: JSON.parse(JSON.stringify(state)), evidenceFingerprint,
            inputFingerprint: null, submissionActionId: null, status: 'draft_saved' });
      });
    });
  }

  async read(value: unknown) {
    const input = parseInspectionInput(targetSchema.extend({ draftId: inspectionId }).strict(), value), target = targetOf(input);
    return this.authority.withAction(target, 'read', async scope => {
      const row = await this.load(scope, input.draftId, target), state = this.state(row.state);
      let reviewRequired = state.reviewRequired || row.expiresAt.getTime() <= Date.now();
      try {
        await this.binding(target, scope, row.bindingFingerprint);
        if (await this.evidenceHash(target, state.evidence) !== row.evidenceFingerprint) reviewRequired = true;
      } catch (error) {
        if (error instanceof InspectionAssistError && ['BINDING_CHANGED', 'TEMPLATE_UNAVAILABLE', 'STORAGE_UNAVAILABLE'].includes(error.code)) reviewRequired = true;
        else throw error;
      }
      return { draftId: row.id, revision: row.revision, status: row.status, target, assetId: row.assetId,
        templateVersion: row.templateVersion, bindingFingerprint: row.bindingFingerprint, state: { ...state, reviewRequired },
        recognitionEvidence: 'caller_supplied_not_model_execution_proof' as const, inspectionId: row.inspectionId };
    });
  }

  async list(value: unknown) {
    const input = parseInspectionInput(targetSchema.extend({ after: inspectionId.optional(), limit: z.number().int().min(1).max(50) }).strict(), value);
    const target = targetOf(input);
    return this.authority.withAction(target, 'read', async scope => {
      await this.templates.read(target);
      return this.repository.list(scope, target.orderId, input.after, input.limit, target);
    });
  }

  /** Human review material from the persisted draft and original frozen
   * template. No candidate is automatically adopted and no Core field is
   * written. Read and revalidate again after the template wait so a concurrent
   * human edit cannot be returned with an old revision or source association. */
  async readReview(value: unknown) {
    const input = parseInspectionInput(targetSchema.extend({ draftId: inspectionId }).strict(), value);
    const target = targetOf(input);
    return this.authority.withAction(target, 'read', async () => {
      const before = await this.read(input);
      let template: Awaited<ReturnType<InspectionTemplateService['read']>> | undefined;
      try {
        template = await this.templates.read(target);
      } catch (error) {
        if (!(error instanceof InspectionAssistError) || !['BINDING_CHANGED', 'TEMPLATE_UNAVAILABLE'].includes(error.code)) throw error;
      }
      const current = await this.read(input);
      if (requestFingerprint(before) !== requestFingerprint(current)) throw new InspectionAssistError('REVISION_CONFLICT');
      const bindingCurrent = template?.bindingFingerprint === current.bindingFingerprint;
      const definitions = bindingCurrent ? template!.template.fields : [];
      const codes = [...new Set([...definitions.map(field => field.code), ...Object.keys(current.state.fields),
        ...current.state.candidates.map(candidate => candidate.fieldCode)])];
      if (codes.length > 100) throw new InspectionAssistError('INVALID_INPUT');
      const fields = codes.map(code => {
        const definition = definitions.find(field => field.code === code);
        const human = current.state.fields[code];
        const candidates = current.state.candidates.filter(candidate => candidate.fieldCode === code);
        const chosen = human?.candidateId ? candidates.find(candidate => candidate.candidateId === human.candidateId) : undefined;
        if (human?.candidateId && !chosen) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
        return { fieldCode: code, ...(definition ? { label: definition.label, type: definition.type,
          required: definition.required, ...(definition.unit ? { unit: definition.unit } : {}) } : {}),
          human: human ? structuredClone(human) : null,
          candidates: structuredClone(candidates),
          candidateEvidence: candidates.map(candidate => ({ candidateId: candidate.candidateId,
            sourcesMatchDraftEvidence: bindingCurrent && this.sourcesIncluded(candidate, current.state.evidence),
            requiresCurrentEvidenceValidation: true as const })),
          selectedSource: chosen ? structuredClone(chosen.sources) : [],
          missing: current.state.missingFields.includes(code),
          reviewRequired: current.state.reviewRequired || !bindingCurrent || candidates.some(candidate => candidate.candidateId !== human?.candidateId),
        };
      });
      return { draftId: current.draftId, revision: current.revision, target: current.target,
        assetId: current.assetId, templateVersion: current.templateVersion, bindingFingerprint: current.bindingFingerprint,
        status: current.status, inspectionId: current.inspectionId,
        binding: bindingCurrent ? 'current' as const : 'changed' as const,
        fields, evidence: structuredClone(current.state.evidence),
        reviewRequired: current.state.reviewRequired || !bindingCurrent,
        next: current.status === 'submitted' ? 'read_original_inspection' as const
          : current.status === 'submission_unknown' ? 'reconcile_original_submission' as const
          : !bindingCurrent ? 'review_changed_resource' as const : 'human_review' as const,
        semantics: 'persisted_human_draft_and_untrusted_candidates_not_core_facts' as const };
    });
  }

  async reconcileOperation(value: unknown) {
    const input = parseInspectionInput(z.object({ kind: z.enum(['create', 'edit', 'candidates', 'evidence']), request: z.unknown() }).strict(), value);
    const request = input.kind === 'create' ? parseInspectionInput(createSchema, input.request)
      : input.kind === 'edit' ? parseInspectionInput(editSchema, input.request)
      : input.kind === 'evidence' ? parseInspectionInput(evidenceChangeSchema, input.request)
      : parseInspectionInput(changeSchema.extend({ candidates: z.array(z.unknown()).max(100) }).strict(), input.request);
    if ('candidates' in request) request.candidates = snapshotInspectionCandidates(request.candidates);
    const target = targetOf(request);
    return this.authority.withAction(target, 'read', async scope => {
      const fingerprint = requestFingerprint({ kind: `inspection.draft.${input.kind}`, scope, input: request });
      const result = await this.repository.receipt(scope, request.operationId, fingerprint);
      if (result.status === 'found') await this.load(scope, result.result.draftId, target);
      return result;
    });
  }

  /** Receipt metadata is independent of current template/evidence validity.
   * Current order read authority and the exact draft owner/target still apply.
   * No candidate, file body or model result is read or returned here. */
  async reconcileRecognitionSave(value: unknown) {
    const reference = parseInspectionInput(recognitionSaveReferenceSchema, value), target = targetOf(reference);
    return this.authority.withAction(target, 'read', async scope => {
      await this.load(scope, reference.draftId, target);
      const before = await this.repository.recognitionReceipt(scope, reference);
      await this.load(scope, reference.draftId, target);
      const after = await this.repository.recognitionReceipt(scope, reference);
      if (requestFingerprint(before) !== requestFingerprint(after)) throw new InspectionAssistError('REVISION_CONFLICT');
      return after;
    });
  }

  async receipt(value: unknown) {
    const input = parseInspectionInput(targetSchema.extend({ operationId: inspectionId, fingerprint: hash }).strict(), value);
    return this.authority.withAction(targetOf(input), 'read', async scope => {
      const result = await this.repository.receipt(scope, input.operationId, input.fingerprint);
      if (result.status === 'found') await this.load(scope, result.result.draftId, targetOf(input));
      return result;
    });
  }

  private async binding(target: AiInspectionTarget, scope: AiInspectionActorScope, fingerprint: string) {
    const binding = await this.templates.read(target);
    if (binding.scope.tenantId !== scope.tenantId || binding.scope.workspaceId !== scope.workspaceId || binding.owner.actorId !== scope.ownerId
      || binding.audience !== scope.audience) throw new InspectionAssistError('ACCESS_DENIED');
    if (binding.bindingFingerprint !== fingerprint) throw new InspectionAssistError('BINDING_CHANGED');
    return binding;
  }

  private async load(scope: AiInspectionActorScope, id: string, target: AiInspectionTarget) {
    const row = await this.repository.read(scope, id);
    if (!row || Object.entries(target).some(([key, value]) => row[key as keyof typeof row] !== value)) throw new InspectionAssistError('ACCESS_DENIED');
    return row;
  }

  private editable(row: { revision: number; status: string; expiresAt: Date }, revision: number) {
    if (row.revision !== revision) throw new InspectionAssistError('REVISION_CONFLICT');
    if (!['draft_saved', 'prepared'].includes(row.status) || row.expiresAt.getTime() <= Date.now()) throw new InspectionAssistError('RECONCILIATION_REQUIRED');
  }

  private state(value: unknown): AiInspectionDraftState {
    const state = parseInspectionInput(stateSchema, value);
    return { ...state, candidates: snapshotInspectionCandidates(state.candidates) };
  }

  private async evidenceHash(target: AiInspectionTarget, refs: AiInspectionDraftState['evidence']) {
    if (!refs.length) return requestFingerprint([]);
    if (!this.evidence) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    return this.evidence.fingerprint(target, structuredClone(refs));
  }

  private photoReferences(binding: Awaited<ReturnType<InspectionTemplateService['read']>>, results: Record<string, string | number | boolean>, refs: AiInspectionDraftState['evidence']) {
    for (const field of binding.template.fields) if (field.type === 'photo' && results[field.code] !== undefined
      && !refs.some(ref => ref.attachmentId === results[field.code])) throw new InspectionAssistError('INVALID_INPUT');
  }

  private sameScope(a: AiInspectionActorScope, b: AiInspectionActorScope) {
    if (requestFingerprint(a) !== requestFingerprint(b)) throw new InspectionAssistError('ACCESS_DENIED');
  }

  private sourcesIncluded(candidate: AiInspectionDraftState['candidates'][number], refs: AiInspectionDraftState['evidence']) {
    return candidate.sources.every(source => refs.some(ref => ref.attachmentId === source.attachmentId
      && ref.attachmentRevision === source.attachmentRevision));
  }

  private async replay(scope: AiInspectionActorScope, operationId: string, fingerprint: string) {
    const result = await this.repository.receipt(scope, operationId, fingerprint);
    if (result.status === 'unavailable') throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    return result.status === 'found' ? result.result : undefined;
  }
}
