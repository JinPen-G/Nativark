/** Original calendar proposal consumers, with distinct preview and draft-save
 * boundaries. The legacy preview never saves, approves or publishes. Explicit
 * save uses the bound Core producer's exact target/version/CAS/append-only
 * operation receipt, not the annual apply's latest-version or batch-id shortcut.
 * Neither consumer grants publication, new capability or arbitrary fields. */
import { z } from 'zod';
import type { PreviewRentalCalendarRangeOverrideRequest, ApplyRentalCalendarRangeOverrideRequest } from '@rental-os/shared';
import { BoundCalendarDraftService, BoundCalendarDraftUnknownError, boundCalendarDraftCommandSchema } from '../../rental-core/bound-calendar-draft.service';
import type { RentalBusinessService } from '../../rental-core/rental-business.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { originalRequestReferenceSchema, freezeOriginalInput } from '../task-request/original-request.validation';
import { AiOpeningVersionFieldSource } from '../tools/opening-version-fields.source';
import { verifyOpeningSectionMaterial, openingSectionFromMaterial } from '../tools/opening-section-difference.service';
import { assertAiReadContextBinding } from '../tools/read-context-binding';
import { AiGuardedQuoteCoreContextSource } from '../tools/quote-route.composition';
import type { AiOriginalSceneDependencies } from './original-scenes.composition';
import { composeOpeningProposalWorkflow } from './opening-proposal-workflow.composition';
import type { AiTaskApplicationHost } from '../runner/prisma-task-application';

const commandSchema = z.object({ original: originalRequestReferenceSchema,
  registrationRef: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict();
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');

export function composeOpeningCalendarDraftPreview(input: AiOriginalSceneDependencies & {
  business: AiOriginalSceneDependencies['business'] & Pick<RentalBusinessService, 'previewCalendarRangeOverride'>;
}, host: AiTaskApplicationHost) {
  const originals = composeOpeningProposalWorkflow(input, host);
  const routes = new AiBusinessReadRouteAuthority(input.guard, input.credentials, input.clock);
  const fields = new AiOpeningVersionFieldSource(input.db, routes);
  const businessContext = new AiGuardedQuoteCoreContextSource(input.core, routes);
  if (typeof input.business?.previewCalendarRangeOverride !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  return Object.freeze({
    async previewDraft(value: unknown) {
      const parsed = commandSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const command = parsed.data;
      const expected = await routes.withRead('opening', {}, async context => freezeOriginalInput(structuredClone(context)));
        const saved = await originals.readReceipt(command);
        if (saved.receipt.state !== 'ai_proposal_saved') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const material = verifyOpeningSectionMaterial(saved.receipt.material);
        if (material.key !== 'business_calendar' || material.date === undefined || material.baseRevision === undefined
          || requestFingerprint(material.scope) !== requestFingerprint(expected.scope)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const section = openingSectionFromMaterial(material);
        if (section.key !== 'business_calendar') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
        // Metadata history stays immutable. A current Core preview is a new
        // observation and must not silently rebase that old proposal.
        const first = await fields.read(section, expected);
        if (requestFingerprint(first.basis) !== material.sourceFingerprint
          || material.changes.some(change => requestFingerprint(first.fields[change.field]) !== requestFingerprint(change.before))) throw conflict();
        const after = { ...first.fields, ...Object.fromEntries(material.changes.map(change => [change.field, change.after])) };
        const rangeFields: PreviewRentalCalendarRangeOverrideRequest['fields'] = {};
        for (const change of section.changes) {
          if (change.field === 'name') rangeFields.name = change.value;
          if (change.field === 'businessStatus') rangeFields.businessStatus = change.value;
        }
        // Core exposes businessStatus, not an independent closed write. Never
        // invent a second status algorithm or coerce contradictory AI material.
        if (section.changes.some(change => change.field === 'closed') && rangeFields.businessStatus === undefined)
          throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const range: PreviewRentalCalendarRangeOverrideRequest = { startDate: section.date, endDate: section.date, fields: rangeFields };
        const year = Number(section.date.slice(0, 4));
        const preview = await routes.withCalendarRangePreview(year, range, async context => {
          assertAiReadContextBinding(context, expected);
          const current = await businessContext.current(material.scope, expected);
          return freezeOriginalInput(structuredClone(await input.business.previewCalendarRangeOverride(material.scope.tenantId, current, year, range)));
        });
        if (preview.year !== year || preview.version !== material.expectedVersion || preview.startDate !== section.date
          || preview.endDate !== section.date || preview.totalDays !== 1 || preview.days.length !== 1
          || preview.days[0].date !== section.date || typeof preview.days[0].conflict !== 'boolean'
          || preview.conflictCount !== Number(preview.days[0].conflict)) throw conflict();
        for (const field of ['name', 'businessStatus', 'closed'] as const) {
          if (first.fields[field] === undefined || requestFingerprint(preview.days[0].current[field]) !== requestFingerprint(first.fields[field])
            || requestFingerprint(preview.days[0].after[field]) !== requestFingerprint(after[field])) throw conflict();
        }
        const latest = await fields.read(section, expected);
        if (requestFingerprint(latest.basis) !== requestFingerprint(first.basis)
          || requestFingerprint(await originals.readReceipt(command)) !== requestFingerprint(saved)) throw conflict();
        await routes.withRead('opening', {}, async context => { assertAiReadContextBinding(context, expected); });
        return freezeOriginalInput({ original: command.original, registrationRef: command.registrationRef,
          proposal: { payloadHash: saved.receipt.payloadHash, materialHash: material.materialHash },
          calendar: { targetId: material.targetId, year, version: material.expectedVersion, baseRevision: material.baseRevision },
          preview, overrideConfirmation: preview.conflictCount ? 'explicit_user_required' as const : 'not_required_by_preview' as const,
          validation: 'original_core_preview_only_apply_validation_not_attempted' as const,
          businessDraft: 'not_created' as const, activeConfiguration: 'not_changed_by_preview' as const,
          approval: 'not_granted' as const, publication: 'not_attempted' as const,
          draftSave: { status: 'unavailable' as const, reason: 'original_version_bound_operation_receipt_not_available' as const },
          execution: 'read_only_no_lease_or_dispatch' as const, automaticRetry: false as const });
    }
  });
}

/** Explicit server-host draft persistence. R1 metadata is not a write grant;
 * this separately requires the original human calendar-edit Guard and a user
 * save decision/reason/override confirmation. It creates no new Task, approval
 * or model call and never publishes the saved Core draft. */
export function composeOpeningCalendarDraftSave(input: AiOriginalSceneDependencies & {
  business: AiOriginalSceneDependencies['business'] & Pick<RentalBusinessService, 'prepareBoundCalendarDraftDay' | 'refreshBoundCalendarDraftYear'>;
}, host: AiTaskApplicationHost) {
  const originals = composeOpeningProposalWorkflow(input, host), routes = new AiBusinessReadRouteAuthority(input.guard, input.credentials, input.clock);
  const fields = new AiOpeningVersionFieldSource(input.db, routes), contexts = new AiGuardedQuoteCoreContextSource(input.core, routes);
  const core = new BoundCalendarDraftService(input.db, input.business, input.clock);
  const schema = commandSchema.extend({ overrideReason: z.string().trim().min(1).max(1000), overrideConfirmed: z.boolean() }).strict();
  const operationSchema = schema.extend({ reviewHash: z.string().regex(/^[a-f0-9]{64}$/u).optional() }).strict();
  const resolve = async (value: unknown) => {
    const parsed = operationSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data), expected = await routes.withRead('opening', {}, async context => freezeOriginalInput(structuredClone(context)));
    const saved = await originals.readReceipt({ original: command.original, registrationRef: command.registrationRef });
    if (saved.receipt.state !== 'ai_proposal_saved') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const material = verifyOpeningSectionMaterial(saved.receipt.material);
    if (material.key !== 'business_calendar' || material.date === undefined || material.baseRevision === undefined
      || material.status !== 'difference_ready' || requestFingerprint(material.scope) !== requestFingerprint(expected.scope))
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const section = openingSectionFromMaterial(material);
    if (section.key !== 'business_calendar') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const rangeFields: PreviewRentalCalendarRangeOverrideRequest['fields'] = {};
    for (const change of section.changes) {
      if (change.field === 'name') rangeFields.name = change.value;
      if (change.field === 'businessStatus') rangeFields.businessStatus = change.value;
    }
    if (section.changes.some(change => change.field === 'closed') && rangeFields.businessStatus === undefined)
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const bindingHash = requestFingerprint({ original: command.original, registrationRef: command.registrationRef,
      materialHash: material.materialHash, payloadHash: saved.receipt.payloadHash });
    const operation = boundCalendarDraftCommandSchema.parse({ targetId: material.targetId, year: Number(material.date.slice(0, 4)),
      version: material.expectedVersion, expectedRevision: material.baseRevision, date: material.date, fields: rangeFields,
      before: Object.fromEntries(material.changes.map(change => [change.field, change.before])),
      overrideReason: command.overrideReason, overrideConfirmed: command.overrideConfirmed,
      operationKey: `calendar-draft-${bindingHash}`, bindingHash, categoryCode: material.categoryCode, categoryVersion: material.categoryVersion,
      ...(command.reviewHash !== undefined ? { reviewHash: command.reviewHash } : {}) });
    const range: ApplyRentalCalendarRangeOverrideRequest = { startDate: material.date, endDate: material.date, fields: rangeFields,
      expectedRevision: material.baseRevision, overrideReason: command.overrideReason, overrideConfirmed: command.overrideConfirmed,
      batchId: operation.operationKey };
    return { command, expected, saved, material, section, operation, range };
  };
  const verifyOriginal = async (found: Awaited<ReturnType<typeof resolve>>) => {
    const current = await originals.readReceipt({ original: found.command.original, registrationRef: found.command.registrationRef });
    if (requestFingerprint(current) !== requestFingerprint(found.saved)) throw conflict();
    await routes.withRead('opening', {}, async context => { assertAiReadContextBinding(context, found.expected); });
  };
  return Object.freeze({
    async reviewDraft(value: unknown) {
      const parsed = schema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const found = await resolve(parsed.data), first = await fields.read(found.section, found.expected);
      if (requestFingerprint(first.basis) !== found.material.sourceFingerprint) throw conflict();
      const result = await routes.withCalendarDraftWrite(found.operation.year, found.range, async context => {
        assertAiReadContextBinding(context, found.expected);
        const business = await contexts.current(found.material.scope, found.expected);
        return core.review(found.material.scope.tenantId, business, found.operation, async () => {
          await routes.withCalendarDraftWrite(found.operation.year, found.range, async current => { assertAiReadContextBinding(current, context); });
          if (requestFingerprint(await contexts.current(found.material.scope, found.expected)) !== requestFingerprint(business)) throw conflict();
          await verifyOriginal(found);
        });
      });
      if (requestFingerprint((await fields.read(found.section, found.expected)).basis) !== requestFingerprint(first.basis)) throw conflict();
      await verifyOriginal(found);
      return freezeOriginalInput({ original: found.command.original, registrationRef: found.command.registrationRef,
        review: result, task: 'original_unchanged' as const, approval: 'not_granted' as const, publication: 'not_attempted' as const });
    },
    async saveDraft(value: unknown) {
      const parsed = operationSchema.extend({ decision: z.literal('save_original_business_draft') }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const { decision: _decision, ...body } = parsed.data, found = await resolve(body);
      // Replaying the original committed operation is a read, not a new CAS.
      const observed = await routes.withRead('calendar_version', { year: found.operation.year, version: found.operation.version }, async context => {
        assertAiReadContextBinding(context, found.expected);
        return core.read(found.material.scope.tenantId, found.operation, () => verifyOriginal(found));
      });
      if (observed.state === 'committed') return freezeOriginalInput({ original: found.command.original, operation: observed,
        replayed: true, businessDraft: 'saved_not_published' as const, approval: 'not_granted' as const, publication: 'not_attempted' as const });
      const first = await fields.read(found.section, found.expected);
      if (requestFingerprint(first.basis) !== found.material.sourceFingerprint) throw conflict();
      const result = await routes.withCalendarDraftWrite(found.operation.year, found.range, async context => {
        assertAiReadContextBinding(context, found.expected);
        const business = await contexts.current(found.material.scope, found.expected);
        const revalidate = async () => {
          await routes.withCalendarDraftWrite(found.operation.year, found.range, async current => { assertAiReadContextBinding(current, context); });
          if (requestFingerprint(await contexts.current(found.material.scope, found.expected)) !== requestFingerprint(business)) throw conflict();
          await verifyOriginal(found);
        };
        return core.save(found.material.scope.tenantId, business, found.operation, revalidate);
      });
      try { await verifyOriginal(found); } catch { throw new BoundCalendarDraftUnknownError(); }
      return freezeOriginalInput({ original: found.command.original, operation: result.receipt, replayed: result.replayed,
        businessDraft: 'saved_not_published' as const, approval: 'not_granted' as const, publication: 'not_attempted' as const,
        task: 'original_unchanged' as const, automaticRetry: false as const });
    },
    async readDraftOperation(value: unknown) {
      const found = await resolve(value);
      const operation = await routes.withRead('calendar_version', { year: found.operation.year, version: found.operation.version }, async context => {
        assertAiReadContextBinding(context, found.expected);
        const result = await core.read(found.material.scope.tenantId, found.operation, () => verifyOriginal(found));
        if (result.state === 'committed') {
          const business = await contexts.current(found.material.scope, found.expected);
          await input.business.refreshBoundCalendarDraftYear(found.material.scope.tenantId, business, found.operation.year);
        }
        return result;
      });
      await verifyOriginal(found);
      return freezeOriginalInput({ original: found.command.original, operation, execution: 'read_only_no_save_or_publish' as const });
    }
  });
}
