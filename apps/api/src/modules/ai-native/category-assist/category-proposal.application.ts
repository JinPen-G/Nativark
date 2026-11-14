/** Read-only category proposal preparation over original platform reads and a
 * server-supplied Task/Gateway host. No Core write, publication or adoption is
 * available here. Missing runtime/identity evidence stays unavailable; original
 * unknown model work is read by its existing operation/reference only. */
import { z } from 'zod';
import { isRentalCategoryCode, RENTAL_CATEGORY_TEMPLATE_IDS, CATEGORY_DRAFT_SECTIONS,
  type RentalCategoryDefinition, type PreviewRentalCategoryCreationRequest,
  type RentalCategoryCreationPreview, type CategoryDraftSection } from '@rental-os/shared';
import { CategoryAssistError, type CategoryDraftApplication } from './category-draft.application';
import { patchCategorySection } from '../../rental-core/category-governance.service';
import { parsePublishedRentalCategory } from '../../rental-core/rental-category-resolver.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const source = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('version'), code: z.string().refine(isRentalCategoryCode), versionId: id,
    expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('template'), templateId: z.enum(RENTAL_CATEGORY_TEMPLATE_IDS), templateRevision: id }).strict()
]);
// Preparation binds the original request and registration, before a leased
// execution creates a Step. The model host verifies actual Step/Gateway proof.
const reference = z.object({ operationKey: id, taskId: id, runId: id, inputId: id, registrationRef: id, materialHash: hash }).strict();
export type CategoryProposalSource = z.infer<typeof source>;
export type CategoryProposalReference = z.infer<typeof reference>;
type Principal = { tenantId: string; actorId: string; audience: 'operator'; isSaasAdmin: true };
export interface CategoryProposalMaterial {
  version: 'category-proposal-material-1'; principal: Principal; source: CategoryProposalSource;
  definition: RentalCategoryDefinition; definitionStatus: string; sourceHash: string; catalogHash: string; materialHash: string;
  catalog: Awaited<ReturnType<CategoryDraftApplication['catalog']>>;
}
export type CategoryProposalCandidate = {
  kind: 'patch'; section: CategoryDraftSection; values: Record<string, unknown>; explanation: string;
  source: CategoryProposalSource; materialHash: string; validation: 'requires_original_draft_validation';
  definitionValidation: { valid: boolean; errors: string[] };
} | {
  kind: 'create'; input: PreviewRentalCategoryCreationRequest; explanation: string;
  source: CategoryProposalSource; materialHash: string; preview: RentalCategoryCreationPreview;
};

/** The implementation is supplied by the standard platform Task host. These
 * ports must keep current Task ownership, publication, policy, resource limits,
 * Gateway invocation and ledger evidence; this application does not mint them. */
export interface CategoryProposalModelPort {
  prepare(input: { operationKey: string; goal: string; material: CategoryProposalMaterial }, signal: AbortSignal): Promise<CategoryProposalReference>;
  readInput(ref: CategoryProposalReference, signal: AbortSignal): Promise<{ reference: CategoryProposalReference; goal: string; material: CategoryProposalMaterial }>;
  execute(ref: CategoryProposalReference, signal: AbortSignal): Promise<void>;
  readOriginal(ref: CategoryProposalReference, signal: AbortSignal): Promise<{ reference: CategoryProposalReference; state: 'unknown' }
    | { reference: CategoryProposalReference; state: 'succeeded'; resultId: string; gatewayInvocationId: string;
      inputFingerprint: string; output: unknown }>;
}
export class CategoryProposalApplication {
  constructor(private readonly dependencies: {
    sources: Pick<CategoryDraftApplication, 'catalog' | 'detail' | 'previewCreation'>;
    currentPlatform(signal: AbortSignal): Promise<Principal>;
    model?: CategoryProposalModelPort;
  }) {}

  private async principal(signal: AbortSignal): Promise<Principal> {
    if (signal.aborted || !this.dependencies.currentPlatform) throw new CategoryAssistError('ACCESS_DENIED');
    const result = z.object({ tenantId: id, actorId: id, audience: z.literal('operator'), isSaasAdmin: z.literal(true) })
      .strict().safeParse(structuredClone(await this.dependencies.currentPlatform(signal)));
    if (!result.success || signal.aborted) throw new CategoryAssistError('ACCESS_DENIED');
    return result.data;
  }
  async readMaterial(value: unknown, signal: AbortSignal): Promise<CategoryProposalMaterial> {
    const selection = source.parse(structuredClone(value)), before = await this.principal(signal);
    // Match database/HTTP JSON: catalog templates can have optional undefined
    // properties, which never become empty evidence or a different definition.
    const snapshot = <T>(input: T): T => JSON.parse(JSON.stringify(input));
    const catalog = snapshot(await this.dependencies.sources.catalog());
    let definition: RentalCategoryDefinition, definitionStatus: string;
    if (selection.kind === 'template') {
      const template = catalog.templates.find(row => row.id === selection.templateId && row.revision === selection.templateRevision);
      if (!catalog.dynamicCreationEnabled || !template) throw new CategoryAssistError('UNAVAILABLE');
      definition = snapshot(template.definition); definitionStatus = 'template';
    } else {
      const detail = await this.dependencies.sources.detail({ code: selection.code });
      const version = detail.versions.find(row => row.id === selection.versionId && row.revision === selection.expectedRevision);
      if (!version || !['draft', 'published', 'legacy_baseline'].includes(version.status)) throw new CategoryAssistError('UNAVAILABLE');
      const original = snapshot(version.definition);
      const materialDefinition = z.custom<RentalCategoryDefinition>(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const row = value as Record<string, unknown>, business = row.businessModel;
        return row.code === selection.code && Array.isArray(row.supportedInventoryModes)
          && Array.isArray(row.defaultCapabilities) && Array.isArray(row.requiredCapabilities)
          && !!business && typeof business === 'object' && !Array.isArray(business)
          && Array.isArray((business as Record<string, unknown>).pricingUnits);
      }).safeParse(original);
      // A saved draft may still fail Core business validation. Check the source
      // shape needed by this proposal reader without certifying executability.
      if (!materialDefinition.success) throw new CategoryAssistError('UNAVAILABLE');
      definition = materialDefinition.data; definitionStatus = version.status;
    }
    if (signal.aborted || requestFingerprint(await this.principal(signal)) !== requestFingerprint(before)) throw new CategoryAssistError('ACCESS_DENIED');
    const payload = { version: 'category-proposal-material-1' as const, principal: before, source: selection, definition, definitionStatus,
      sourceHash: requestFingerprint({ selection, definition, definitionStatus }), catalogHash: requestFingerprint(catalog), catalog };
    // No silent truncation of a definition or capability contract for the model.
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 262144) throw new CategoryAssistError('UNAVAILABLE');
    return { ...payload, materialHash: requestFingerprint(payload) };
  }
  async prepare(value: unknown, signal: AbortSignal) {
    const input = z.object({ operationKey: id, goal: z.string().trim().min(1).max(2000), source }).strict().parse(structuredClone(value));
    const model = this.dependencies.model;
    if (!model) throw new CategoryAssistError('UNAVAILABLE');
    const material = await this.readMaterial(input.source, signal);
    const result = reference.parse(await model.prepare({ operationKey: input.operationKey, goal: input.goal, material }, signal));
    if (signal.aborted || result.operationKey !== input.operationKey || result.materialHash !== material.materialHash) throw new CategoryAssistError('UNAVAILABLE');
    const current = await this.readMaterial(input.source, signal);
    if (current.materialHash !== material.materialHash) throw new CategoryAssistError('UNAVAILABLE');
    return { state: 'prepared' as const, reference: result, material };
  }
  private async original(ref: CategoryProposalReference, signal: AbortSignal) {
    const model = this.dependencies.model;
    if (!model) throw new CategoryAssistError('UNAVAILABLE');
    await this.principal(signal);
    const stored = await model.readInput(ref, signal);
    if (signal.aborted || requestFingerprint(reference.parse(stored.reference)) !== requestFingerprint(ref)
      || stored.material.materialHash !== ref.materialHash || !stored.goal || stored.goal.length > 2000) throw new CategoryAssistError('ACCESS_DENIED');
    const { materialHash, ...payload } = stored.material;
    if (requestFingerprint(payload) !== materialHash) throw new CategoryAssistError('ACCESS_DENIED');
    if (requestFingerprint(stored.material.principal) !== requestFingerprint(await this.principal(signal))) throw new CategoryAssistError('ACCESS_DENIED');
    return stored;
  }
  async execute(value: unknown, signal: AbortSignal) {
    const ref = reference.parse(structuredClone(value)), stored = await this.original(ref, signal);
    const current = await this.readMaterial(stored.material.source, signal);
    if (current.materialHash !== ref.materialHash) throw new CategoryAssistError('UNAVAILABLE');
    await this.dependencies.model!.execute(ref, signal);
    return this.readOriginal(ref, signal);
  }
  async readOriginal(value: unknown, signal: AbortSignal) {
    const ref = reference.parse(structuredClone(value)), stored = await this.original(ref, signal);
    const result = await this.dependencies.model!.readOriginal(ref, signal);
    if (signal.aborted || requestFingerprint(reference.parse(result.reference)) !== requestFingerprint(ref)) throw new CategoryAssistError('ACCESS_DENIED');
    if (requestFingerprint(await this.principal(signal)) !== requestFingerprint(stored.material.principal)) throw new CategoryAssistError('ACCESS_DENIED');
    if (result.state === 'unknown') return { state: 'unknown' as const, reference: ref };
    if (!id.safeParse(result.resultId).success || !id.safeParse(result.gatewayInvocationId).success
      || !hash.safeParse(result.inputFingerprint).success) throw new CategoryAssistError('UNAVAILABLE');
    let current: CategoryProposalMaterial;
    try { current = await this.readMaterial(stored.material.source, signal); }
    catch (error) { if (error instanceof CategoryAssistError && error.code === 'UNAVAILABLE') return { state: 'stale' as const, reference: ref }; throw error; }
    if (current.materialHash !== ref.materialHash) return { state: 'stale' as const, reference: ref };
    const parsed = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('patch'), section: z.enum(CATEGORY_DRAFT_SECTIONS), values: z.record(z.unknown()), explanation: z.string().max(1000) }).strict(),
      z.object({ kind: z.literal('create'), input: z.record(z.unknown()), explanation: z.string().max(1000) }).strict()
    ]).parse(structuredClone(result.output));
    if (Buffer.byteLength(JSON.stringify(parsed), 'utf8') > 262144) throw new CategoryAssistError('INVALID_INPUT');
    let candidate: CategoryProposalCandidate;
    if (parsed.kind === 'patch') {
      if (current.source.kind !== 'version') throw new CategoryAssistError('INVALID_INPUT');
      const definition = patchCategorySection(current.definition, parsed.section, parsed.values) as RentalCategoryDefinition;
      this.supported(definition, current);
      // Original Core structural/conditional validation, without saving a
      // provisional definition. Registered runtime composition is checked by
      // the original draft validator after explicit human save and on publish.
      let definitionValidation: { valid: boolean; errors: string[] };
      try { parsePublishedRentalCategory(definition, current.definition.code); definitionValidation = { valid: true, errors: [] }; }
      catch (error) { definitionValidation = { valid: false, errors: [error instanceof Error ? error.message : '品类草稿需原校验'] }; }
      candidate = { ...parsed, source: current.source, materialHash: current.materialHash,
        validation: 'requires_original_draft_validation', definitionValidation };
    } else {
      const input = parsed.input as unknown as PreviewRentalCategoryCreationRequest;
      if (!current.catalog.dynamicCreationEnabled) throw new CategoryAssistError('UNAVAILABLE');
      if (current.source.kind === 'template') {
        if (input.templateId !== current.source.templateId || input.sourceVersionId !== undefined) throw new CategoryAssistError('INVALID_INPUT');
      } else if (!['published', 'legacy_baseline'].includes(current.definitionStatus)
        || input.sourceVersionId !== current.source.versionId || input.templateId !== undefined) throw new CategoryAssistError('INVALID_INPUT');
      const preview = await this.dependencies.sources.previewCreation(input);
      if (signal.aborted) throw new CategoryAssistError('ACCESS_DENIED');
      this.supported(preview.definition, current);
      candidate = { kind: 'create', input, explanation: parsed.explanation, source: current.source, materialHash: current.materialHash, preview };
    }
    const after = await this.readMaterial(current.source, signal);
    if (after.materialHash !== ref.materialHash) return { state: 'stale' as const, reference: ref };
    return { state: 'candidate' as const, reference: ref, resultId: result.resultId, gatewayInvocationId: result.gatewayInvocationId,
      inputFingerprint: result.inputFingerprint, candidate };
  }
  private supported(definition: RentalCategoryDefinition, material: CategoryProposalMaterial) {
    if (!Array.isArray(definition.defaultCapabilities) || !Array.isArray(definition.requiredCapabilities)
      || definition.conditionalCapabilities !== undefined && !Array.isArray(definition.conditionalCapabilities)
      || !Array.isArray(definition.businessModel?.pricingUnits)) throw new CategoryAssistError('INVALID_INPUT');
    const required = [...definition.requiredCapabilities, ...(definition.conditionalCapabilities ?? []).map(row => row?.code)];
    const declared = [...new Set([...definition.defaultCapabilities, ...required])];
    if (required.some(code => !definition.defaultCapabilities.includes(code))
      || declared.some(code => !material.catalog.capabilities.some(entry => entry.code === code && entry.implemented
        && (entry.applicableCategories === 'all' || entry.applicableCategories.includes(definition.code))))
      || definition.businessModel.pricingUnits.some(unit => !material.catalog.pricingStrategies.some(entry => entry.unit === unit))) {
      throw new CategoryAssistError('UNAVAILABLE');
    }
  }
}
