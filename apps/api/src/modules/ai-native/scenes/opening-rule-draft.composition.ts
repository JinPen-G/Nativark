/** Original business-rule R1 preview and separate explicit bound draft save.
 * Current complete row config is separate from the saved R1's bounded field
 * evidence. Preview grants no save; the save consumer binds a human review to
 * Core's exact version operation. Neither path grants publication. */
import { z } from 'zod';
import type { RentalBusinessService } from '../../rental-core/rental-business.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { originalRequestReferenceSchema, freezeOriginalInput } from '../task-request/original-request.validation';
import { AiOpeningVersionFieldSource } from '../tools/opening-version-fields.source';
import { verifyOpeningSectionMaterial, openingSectionFromMaterial } from '../tools/opening-section-difference.service';
import { assertAiReadContextBinding } from '../tools/read-context-binding';
import { AiGuardedQuoteCoreContextSource } from '../tools/quote-route.composition';
import { AiGuardedOpeningConfigurationSource } from '../tools/opening-configuration.source';
import type { AiOriginalSceneDependencies } from './original-scenes.composition';
import { composeOpeningProposalWorkflow } from './opening-proposal-workflow.composition';
import type { AiTaskApplicationHost } from '../runner/prisma-task-application';
import { BoundRuleDraftService, BoundRuleDraftUnknownError, boundRuleDraftCommandSchema } from '../../rental-core/bound-rule-draft.service';

const schema = z.object({ original: originalRequestReferenceSchema,
  registrationRef: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict();
const hash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');

export function composeOpeningRuleDraftPreview(input: AiOriginalSceneDependencies & {
  business: AiOriginalSceneDependencies['business'] & Pick<RentalBusinessService, 'previewBoundRuleDraft'>;
}, host: AiTaskApplicationHost) {
  if (typeof input.business?.previewBoundRuleDraft !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const originals = composeOpeningProposalWorkflow(input, host), routes = new AiBusinessReadRouteAuthority(input.guard, input.credentials, input.clock);
  const fields = new AiOpeningVersionFieldSource(input.db, routes), contexts = new AiGuardedQuoteCoreContextSource(input.core, routes);
  const opening = new AiGuardedOpeningConfigurationSource(input.core, routes);
  return Object.freeze({
    async previewDraft(value: unknown) {
      const parsed = schema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const command = parsed.data, expected = await routes.withRead('opening', {}, async context => freezeOriginalInput(structuredClone(context)));
      const saved = await originals.readReceipt(command);
      if (saved.receipt.state !== 'ai_proposal_saved') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const material = verifyOpeningSectionMaterial(saved.receipt.material), section = openingSectionFromMaterial(material);
      if (material.key !== 'business_rule' || material.status !== 'difference_ready' || section.key !== 'business_rule'
        || hash(material.scope) !== hash(expected.scope)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const category = await opening.current(material.scope, expected);
      if (category.categoryCode !== material.categoryCode || category.categoryVersion !== material.categoryVersion) throw conflict();
      const firstFields = await fields.read(section, expected);
      if (hash(firstFields.basis) !== material.sourceFingerprint) throw conflict();
      const read = () => routes.withRead('rule_version', { version: material.expectedVersion }, async context => {
        assertAiReadContextBinding(context, expected);
        const where = { id: material.targetId, tenantId: material.scope.tenantId, workspaceId: material.scope.workspaceId, version: material.expectedVersion };
        const row = await input.db.rentalRuleVersion.findFirst({ where, select: { id: true, tenantId: true, workspaceId: true, version: true,
          categoryCode: true, status: true, config: true, createdAt: true, effectiveFrom: true, publishedAt: true } });
        if (!row || Object.entries(where).some(([key, v]) => row[key as keyof typeof row] !== v)) throw conflict();
        return freezeOriginalInput(structuredClone(row));
      });
      // R1 intentionally captured only approved boolean fields, not a full
      // historical rule. This is an explicit CURRENT complete-config observation.
      const source = await read();
      const coreContext = await contexts.current(material.scope, expected);
      const preview = await routes.withRuleDraftPreview(material.targetId, async context => {
        assertAiReadContextBinding(context, expected);
        const business = await contexts.current(material.scope, expected);
        if (hash(business) !== hash(coreContext)) throw conflict();
        return input.business.previewBoundRuleDraft(material.scope.tenantId, business, source,
          material.changes.map(row => ({ field: row.field, before: z.boolean().parse(row.before), after: z.boolean().parse(row.after) })));
      });
      if (preview.targetId !== material.targetId || preview.version !== material.expectedVersion
        || preview.sourceConfigFingerprint !== hash(source.config) || hash(preview.changes) !== hash(material.changes)) throw conflict();
      if (hash(await read()) !== hash(source) || hash(await contexts.current(material.scope, expected)) !== hash(coreContext)
        || hash((await fields.read(section, expected)).basis) !== hash(firstFields.basis)
        || hash(await originals.readReceipt(command)) !== hash(saved)) throw conflict();
      const latestCategory = await opening.current(material.scope, expected);
      if (latestCategory.categoryCode !== category.categoryCode || latestCategory.categoryVersion !== category.categoryVersion) throw conflict();
      await routes.withRuleDraftPreview(material.targetId, async context => { assertAiReadContextBinding(context, expected); });
      return freezeOriginalInput({ original: command.original, registrationRef: command.registrationRef,
        proposal: { payloadHash: saved.receipt.payloadHash, materialHash: material.materialHash }, preview,
        configSource: 'current_original_version_row_not_saved_R1_full_config' as const,
        fieldRevision: material.fieldRevision, businessDraft: 'not_created' as const, approval: 'not_granted' as const,
        publication: 'not_attempted' as const, execution: 'read_only_no_lease_or_dispatch' as const,
        draftSave: { status: 'unavailable' as const, reason: 'separate_explicit_bound_draft_save_not_invoked' as const }, automaticRetry: false as const });
    }
  });
}

/** An original AI proposal is not a business write grant. A human must review
 * the CURRENT full Core candidate and explicitly save it under rules:manage.
 * Original result reads do not require fresh config, a new lease or execution. */
export function composeOpeningRuleDraftSave(input: AiOriginalSceneDependencies & {
  business: AiOriginalSceneDependencies['business'] & Pick<RentalBusinessService, 'prepareBoundRuleDraft' | 'refreshBoundRuleDraftVersion'>;
}, host: AiTaskApplicationHost) {
  const originals = composeOpeningProposalWorkflow(input, host), routes = new AiBusinessReadRouteAuthority(input.guard, input.credentials, input.clock);
  const fields = new AiOpeningVersionFieldSource(input.db, routes), contexts = new AiGuardedQuoteCoreContextSource(input.core, routes);
  const core = new BoundRuleDraftService(input.db, input.business, input.clock);
  const bodySchema = schema.extend({ changeReason: z.string().trim().min(1).max(500) }).strict();
  const operationSchema = bodySchema.extend({ reviewHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
  const resolve = async (value: unknown) => {
    const parsed = bodySchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data), expected = await routes.withRead('opening', {}, async context => freezeOriginalInput(structuredClone(context)));
    const saved = await originals.readReceipt({ original: command.original, registrationRef: command.registrationRef });
    if (saved.receipt.state !== 'ai_proposal_saved') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const material = verifyOpeningSectionMaterial(saved.receipt.material), section = openingSectionFromMaterial(material);
    if (material.key !== 'business_rule' || section.key !== 'business_rule' || material.status !== 'difference_ready'
      || hash(material.scope) !== hash(expected.scope)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const bindingHash = requestFingerprint({ original: command.original, registrationRef: command.registrationRef,
      materialHash: material.materialHash, payloadHash: saved.receipt.payloadHash });
    const operation = boundRuleDraftCommandSchema.parse({ targetId: material.targetId, version: material.expectedVersion,
      changes: material.changes, categoryCode: material.categoryCode, categoryVersion: material.categoryVersion,
      changeReason: command.changeReason, operationKey: `rule-draft-${bindingHash}`, bindingHash });
    return { command, expected, saved, material, section, operation };
  };
  const verify = async (found: Awaited<ReturnType<typeof resolve>>) => {
    if (hash(await originals.readReceipt({ original: found.command.original, registrationRef: found.command.registrationRef })) !== hash(found.saved)) throw conflict();
    await routes.withRead('opening', {}, async context => { assertAiReadContextBinding(context, found.expected); });
  };
  const currentFields = async (found: Awaited<ReturnType<typeof resolve>>) => {
    if (hash((await fields.read(found.section, found.expected)).basis) !== found.material.sourceFingerprint) throw conflict();
  };
  const read = (found: Awaited<ReturnType<typeof resolve>>, reviewHash: string) => routes.withRead('rule_version',
    { version: found.material.expectedVersion }, async context => {
      assertAiReadContextBinding(context, found.expected);
      return core.read(found.material.scope.tenantId, { ...found.operation, reviewHash }, () => verify(found));
    });
  return Object.freeze({
    async reviewDraft(value: unknown) {
      const found = await resolve(value); await currentFields(found);
      const review = await routes.withRuleDraftPreview(found.material.targetId, async context => {
        assertAiReadContextBinding(context, found.expected);
        const business = await contexts.current(found.material.scope, found.expected);
        return core.review(found.material.scope.tenantId, business, found.operation, async () => {
          await routes.withRuleDraftPreview(found.material.targetId, async current => { assertAiReadContextBinding(current, found.expected); });
          if (hash(await contexts.current(found.material.scope, found.expected)) !== hash(business)) throw conflict();
          await verify(found);
        });
      });
      await currentFields(found);
      await verify(found);
      return freezeOriginalInput({ original: found.command.original, registrationRef: found.command.registrationRef, review,
        configSource: 'current_original_version_row_not_saved_R1_full_config' as const,
        humanAction: 'explicit_save_original_business_draft_required' as const,
        task: 'original_unchanged' as const, approval: 'not_granted' as const, publication: 'not_attempted' as const });
    },
    async saveDraft(value: unknown) {
      const parsed = operationSchema.extend({ decision: z.literal('save_original_business_draft') }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const { decision: _decision, reviewHash, ...body } = parsed.data, found = await resolve(body);
      const observed = await read(found, reviewHash);
      if (observed.state === 'committed') return freezeOriginalInput({ original: found.command.original, operation: observed, replayed: true,
        task: 'original_unchanged' as const, approval: 'not_granted' as const, publication: 'not_attempted' as const });
      await currentFields(found);
      const result = await routes.withRuleDraftSave(found.material.targetId, async context => {
        assertAiReadContextBinding(context, found.expected);
        const business = await contexts.current(found.material.scope, found.expected);
        return core.save(found.material.scope.tenantId, business, { ...found.operation, reviewHash }, async () => {
          await routes.withRuleDraftPreview(found.material.targetId, async current => { assertAiReadContextBinding(current, found.expected); });
          await verify(found);
        });
      });
      try { await verify(found); } catch { throw new BoundRuleDraftUnknownError(); }
      return freezeOriginalInput({ original: found.command.original, operation: result.receipt, replayed: result.replayed,
        task: 'original_unchanged' as const, approval: 'not_granted' as const, publication: 'not_attempted' as const, automaticRetry: false as const });
    },
    async readDraftOperation(value: unknown) {
      const parsed = operationSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const { reviewHash, ...body } = parsed.data, found = await resolve(body), operation = await read(found, reviewHash);
      await verify(found);
      return freezeOriginalInput({ original: found.command.original, operation, execution: 'read_only_no_save_or_publish' as const, retryable: false as const });
    }
  });
}
