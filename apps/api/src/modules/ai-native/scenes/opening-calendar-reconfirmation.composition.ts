/** Human-requested current calendar difference -> separate new R1 request/Task.
 * Never rewrites or retries the predecessor, treats a missing operation as a
 * rollback, or starts/saves during review/creation-receipt reads. New proposal
 * preparation, explicit R1 start and the existing explicit Core draft save are
 * separate decisions. Current same-target version/row, Guard and actor binding
 * are rechecked; new Task policies remain the original runtime's responsibility. */
import { z } from 'zod';
import { AI_SCENE_REQUEST_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { getRequestIdentity } from '../../../common/request-identity';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskRunnerError } from '../runner/ai-task-runner.service';
import { originalRequestReferenceSchema, freezeOriginalInput } from '../task-request/original-request.validation';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { AiOpeningSectionDifferenceService, openingSectionChangeSchema, openingSectionFromMaterial, verifyOpeningSectionMaterial } from '../tools/opening-section-difference.service';
import { AiOpeningVersionFieldSource } from '../tools/opening-version-fields.source';
import { AiGuardedOpeningConfigurationSource } from '../tools/opening-configuration.source';
import { assertAiReadContextBinding } from '../tools/read-context-binding';
import { composeAiOriginalScenes } from './original-scenes.composition';
import { composeOpeningProposalWorkflow } from './opening-proposal-workflow.composition';
import { composeOpeningCalendarDraftSave } from './opening-calendar-draft.composition';
import type { AiTaskApplicationHost } from '../runner/prisma-task-application';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const schema = z.object({ original: originalRequestReferenceSchema, registrationRef: id,
  overrideReason: z.string().trim().min(1).max(1000), overrideConfirmed: z.boolean(),
  changes: z.array(z.unknown()).min(1).max(3) }).strict();
const confirmedSchema = schema.extend({ reviewHash: hash }).strict();
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
type Dependencies = Parameters<typeof composeOpeningCalendarDraftSave>[0];

export function composeOpeningCalendarReconfirmation(input: Dependencies, host: AiTaskApplicationHost) {
  const routes = new AiBusinessReadRouteAuthority(input.guard, input.credentials, input.clock);
  const originals = composeAiOriginalScenes(input), proposals = composeOpeningProposalWorkflow(input, host);
  const savedDraft = composeOpeningCalendarDraftSave(input, host);
  const differences = new AiOpeningSectionDifferenceService(new AiGuardedOpeningConfigurationSource(input.core, routes), routes,
    input.clock, new AiOpeningVersionFieldSource(input.db, routes));
  const principalHash = (context: AiExecutionContext) => {
    const { requestId: _request, authorizedAt: _time, ...principal } = context;
    return requestFingerprint(principal);
  };
  const history = async (command: z.infer<typeof schema>) => {
    const expected = await routes.withRead('opening', {}, async context => freezeOriginalInput(structuredClone(context)));
    const prior = await proposals.readReceipt({ original: command.original, registrationRef: command.registrationRef });
    if (prior.receipt.state !== 'ai_proposal_saved') throw unavailable();
    const material = verifyOpeningSectionMaterial(prior.receipt.material);
    if (material.key !== 'business_calendar' || material.date === undefined || material.baseRevision === undefined
      || requestFingerprint(material.scope) !== requestFingerprint(expected.scope)) throw unavailable();
    const verify = async () => {
      if (requestFingerprint(await proposals.readReceipt({ original: command.original, registrationRef: command.registrationRef })) !== requestFingerprint(prior)) throw conflict();
      await routes.withRead('opening', {}, async context => { assertAiReadContextBinding(context, expected); });
    };
    await verify();
    return { expected, prior, material, verify };
  };
  const inspect = async (command: z.infer<typeof schema>) => {
    const found = await history(command);
    const operation = await savedDraft.readDraftOperation({ original: command.original, registrationRef: command.registrationRef,
      overrideReason: command.overrideReason, overrideConfirmed: command.overrideConfirmed });
    await found.verify();
    if (operation.operation.state === 'committed') return { ...found, command, operation, update: null };
    const row = await routes.withRead('calendar_version', { year: Number(found.material.date!.slice(0, 4)), version: found.material.expectedVersion }, async context => {
      assertAiReadContextBinding(context, found.expected);
      const scope = found.material.scope, identity = getRequestIdentity();
      if (identity?.tenantId !== scope.tenantId || identity.workspaceId !== scope.workspaceId) throw unavailable();
      const row = await input.db.rentalBusinessCalendar.findFirst({ where: { id: found.material.targetId, tenantId: scope.tenantId,
        workspaceId: scope.workspaceId, version: found.material.expectedVersion, year: Number(found.material.date!.slice(0, 4)) },
        select: { id: true, tenantId: true, workspaceId: true, version: true, year: true, status: true, revision: true } });
      if (!row || row.id !== found.material.targetId || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
        || row.version !== found.material.expectedVersion || row.status !== 'draft' || !Number.isInteger(row.revision) || row.revision < 0) throw unavailable();
      return row;
    });
    // Keep the SAME target/version/date. A newer editable version needs the
    // formal version-selection workflow, not a silent reassignment here.
    const section = openingSectionChangeSchema.parse({ ...openingSectionFromMaterial(found.material), expectedRevision: row.revision, changes: command.changes });
    const current = verifyOpeningSectionMaterial(await differences.prepare(section, found.expected));
    await found.verify();
    if (current.targetId !== found.material.targetId || current.expectedVersion !== found.material.expectedVersion
      || current.baseRevision !== row.revision || current.date !== found.material.date) throw conflict();
    const reviewHash = requestFingerprint({ predecessor: command.original, registrationRef: command.registrationRef,
      originalMaterialHash: found.material.materialHash, changes: command.changes, currentMaterialHash: current.materialHash,
      principal: principalHash(found.expected), originalOperation: { overrideReason: command.overrideReason, overrideConfirmed: command.overrideConfirmed } });
    return { ...found, command, operation, update: { section, current, reviewHash } };
  };
  const newRequest = (command: z.infer<typeof confirmedSchema>) => ({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION,
    sceneCode: 'opening_diagnosis' as const, requestKey: `calendar-reconfirm:${requestFingerprint({ predecessor: command.original,
      registrationRef: command.registrationRef, reviewHash: command.reviewHash, changes: command.changes })}`,
    input: { sections: ['business_calendar' as const] } });
  const locate = async (command: z.infer<typeof confirmedSchema>) => {
    const expected = newRequest(command), record = freezeOriginalInput(structuredClone(await originals.reconcile(expected)));
    if (record.state === 'observed' && (record.receipt.requestKey !== expected.requestKey || record.receipt.sceneCode !== expected.sceneCode)) throw unavailable();
    return { record, original: record.state === 'observed' ? { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: record.receipt.inputRef } : null };
  };
  const confirmed = async (command: z.infer<typeof confirmedSchema>) => {
    const { reviewHash: _hash, ...body } = command, found = await inspect(body);
    if (!found.update || found.update.reviewHash !== command.reviewHash) throw conflict();
    return found;
  };
  return Object.freeze({
    async inspectCurrent(value: unknown) {
      const parsed = schema.safeParse(structuredClone(value)); if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const found = await inspect(parsed.data);
      return freezeOriginalInput({ predecessor: parsed.data.original, originalOperation: found.operation.operation,
        state: found.update ? found.update.current.status : 'original_committed' as const,
        ...(found.update ? { reviewHash: found.update.reviewHash, originalMaterial: found.material, currentMaterial: found.update.current } : {}),
        originalOperationAbsence: 'not_rollback_or_retry_evidence' as const, task: 'not_created' as const,
        businessDraft: 'not_saved_by_review' as const, approval: 'not_granted' as const, publication: 'not_attempted' as const });
    },
    async prepareUpdated(value: unknown) {
      const parsed = confirmedSchema.extend({ decision: z.literal('prepare_updated_calendar_proposal') }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const { decision: _decision, ...command } = parsed.data, found = await confirmed(command);
      if (found.update!.current.status === 'no_change') return freezeOriginalInput({ state: 'no_change' as const, predecessor: command.original, task: 'not_created' as const });
      const existing = await locate(command);
      if (existing.record.state === 'observed') return freezeOriginalInput({ state: 'existing_preparation' as const, ...existing, execution: 'not_started' as const });
      let created;
      try { created = await originals.create(newRequest(command)); }
      catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      try { await confirmed(command); } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      return freezeOriginalInput({ state: 'new_preparation' as const, predecessor: command.original, created,
        execution: 'not_started' as const, businessDraft: 'not_created' as const, approval: 'not_granted' as const, automaticRetry: false as const });
    },
    async readPrepared(value: unknown) {
      const parsed = confirmedSchema.safeParse(structuredClone(value)); if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const { reviewHash: _hash, ...body } = parsed.data, prior = await history(body), located = await locate(parsed.data);
      await prior.verify();
      return freezeOriginalInput({ predecessor: parsed.data.original, ...located, execution: 'read_only_no_create_start_or_save' as const, automaticRetry: false as const });
    },
    async startUpdated(value: unknown) {
      const parsed = confirmedSchema.extend({ decision: z.literal('start_updated_calendar_proposal') }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const { decision: _decision, ...command } = parsed.data, found = await confirmed(command), selected = await locate(command);
      if (!selected.original || selected.record.state !== 'observed' || selected.record.task.state !== 'observed'
        || selected.record.task.status !== 'queued' || selected.record.task.plan !== 'not_observed' || selected.record.task.resultAvailable
        || found.update!.current.status !== 'difference_ready') throw unavailable();
      let result;
      try { result = await proposals.startSections({ original: selected.original, sections: [found.update!.section] }); }
      catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      try { await confirmed(command); } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      return freezeOriginalInput({ predecessor: command.original, original: selected.original, result,
        businessDraft: 'not_created' as const, approval: 'not_granted' as const, publication: 'not_attempted' as const,
        nextAction: 'separate_explicit_save_of_new_proposal' as const, automaticRetry: false as const });
    }
  });
}
