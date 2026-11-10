import { z } from 'zod';
import type { AiExecutionContext, RentalOrderInspectionBasisFacts } from '@rental-os/shared';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ModelGatewayError } from '../model-gateway.ports';
import { assertAiReadContextBinding } from './read-context-binding';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const time = z.string().max(40).datetime({ offset: true });
const order = z.object({ id, tenantId: id, updatedAt: time });
const records = z.array(z.object({ id, tenantId: id, orderId: id,
  stage: z.enum(['pickup', 'return']), templateId: id, templateCode: z.string().min(1).max(191),
  templateVersion: z.string().min(1).max(191), exchangeId: id.optional(), baselineInspectionId: id.optional(),
  createdAt: time, exceptions: z.array(z.object({ code: z.string().min(1).max(191),
    description: z.string().max(2000), allocationId: id.optional(),
    reviewStatus: z.enum(['pending', 'approved', 'rejected']),
    customerResponseStatus: z.enum(['not_required', 'pending', 'confirmed', 'disputed']).optional()
  })).max(50)
})).max(50);
const templateRef = z.object({ id, tenantId: id, code: z.string().min(1).max(191),
  stage: z.enum(['pickup', 'return']), version: z.string().min(1).max(191), enabled: z.boolean() }).strict();
const applicableRef = templateRef.extend({
  // Core's display ID may contain both allocation and template IDs. It is not
  // the original template FK; claims and provenance use sourceTemplateId below.
  id: z.string().min(1).max(512).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u), sourceTemplateId: id,
  allocationIds: z.array(id).max(200).refine(values => new Set(values).size === values.length).optional(), exchangeId: id.optional()
}).strict();

/** Validate the formal Core projection, not another applicability algorithm.
 * Cross-reference checks reject corrupt transport; omitted allocationIds retain
 * Core semantics and never become an inferred whole-order resource population. */
export const aiOrderInspectionBasisFactsSchema = z.object({
  contractVersion: z.literal('rental-order-inspection-basis-1'), orderId: id, tenantId: id, workspaceId: id,
  sourceOrderUpdatedAt: time, originalTemplateRefs: z.array(templateRef).max(50),
  allocations: z.array(z.object({ id, orderLineId: id, itemGroupId: id.optional(),
    status: z.enum(['pre_assigned', 'locked', 'allocated', 'picked_up', 'consumed', 'returned', 'released']),
    quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), exchangeId: id.optional() }).strict()).max(200),
  exchanges: z.array(z.object({ id, type: z.literal('post_pickup_exchange'), status: z.literal('applied'),
    templateRefs: z.array(templateRef).max(50).optional() }).strict()).max(50),
  applicableTemplateRefs: z.array(applicableRef).max(200), recordResourceCoverage: z.literal('not_projected'),
  semantics: z.literal('frozen_template_applicability_not_inspection_or_execution_authority')
}).strict().superRefine((value, context) => {
  const bad = () => context.addIssue({ code: 'custom', message: 'frozen inspection reference binding mismatch' });
  const unique = (values: Array<{ id: string }>) => new Set(values.map(row => row.id)).size === values.length;
  if (![value.originalTemplateRefs, value.allocations, value.exchanges, value.applicableTemplateRefs].every(unique)) bad();
  for (const exchange of value.exchanges) if (exchange.templateRefs && !unique(exchange.templateRefs)) bad();
  const all = [...value.originalTemplateRefs, ...value.exchanges.flatMap(row => row.templateRefs ?? []), ...value.applicableTemplateRefs];
  if (all.some(row => row.tenantId !== value.tenantId)) bad();
  for (const row of value.applicableTemplateRefs) {
    const source = row.exchangeId ? value.exchanges.find(change => change.id === row.exchangeId)?.templateRefs : value.originalTemplateRefs;
    const saved = source?.find(template => template.id === row.sourceTemplateId);
    if (!saved || ['tenantId', 'code', 'stage', 'version', 'enabled'].some(key =>
      saved[key as keyof typeof saved] !== row[key as keyof typeof row])) bad();
    if (!row.exchangeId && row.id !== row.sourceTemplateId) bad();
    if (row.allocationIds?.some(allocationId => {
      const allocation = value.allocations.find(item => item.id === allocationId);
      return !allocation || allocation.exchangeId !== row.exchangeId;
    })) bad();
  }
}) satisfies z.ZodType<RentalOrderInspectionBasisFacts>;
export const aiOrderFrozenInspectionBasisSchema = z.union([
  z.object({ status: z.literal('unavailable') }).strict(),
  z.object({ status: z.literal('available'), value: aiOrderInspectionBasisFactsSchema }).strict()
]);

/** Original inspection records plus Core-owned frozen applicability only. The
 * same bounded page is reopened after basis waits, not a cross-domain snapshot.
 * No results/attachments/operators, resource inference or liability/charge
 * calculation. Missing optional basis leaves an explicit unavailable. */
export class AiOrderInspectionFactsService {
  constructor(private readonly core: Pick<RentalCoreService, 'readOrderFacts' | 'readInspectionFactsPage'>
      & Partial<Pick<RentalCoreService, 'readOrderInspectionBasis'>>,
    private readonly authority: Pick<AiOrderRouteContextAuthority, 'withOrderRead'>,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof core?.readOrderFacts !== 'function' || typeof core?.readInspectionFactsPage !== 'function'
      || typeof authority?.withOrderRead !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }

  async read(expectedContext?: AiExecutionContext) {
    // Retain the original server parent before the Guard waits; current read
    // rights and Core source/basis checks remain independently authoritative.
    const parent = expectedContext && structuredClone(expectedContext);
    return this.authority.withOrderRead(async (context, orderId) => {
      assertAiReadContextBinding(context, parent);
      if (context.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
      const scope = structuredClone(context.scope);
      const before = order.parse(await this.core.readOrderFacts(scope.tenantId, orderId));
      if (before.id !== orderId || before.tenantId !== scope.tenantId) throw new ModelGatewayError('FORBIDDEN');
      const readPage = async () => {
        const page = await this.core.readInspectionFactsPage(scope.tenantId, orderId, { limit: 50 });
        const items = records.parse(page?.items);
        if (page.coverage !== 'page_not_total' || !(page.nextCursor === null || id.safeParse(page.nextCursor).success)
          || (page.nextCursor !== null && (items.length !== 50 || page.nextCursor !== items.at(-1)?.id))) {
          throw new ModelGatewayError('INVALID_RESPONSE');
        }
        if (new Set(items.map(row => row.id)).size !== items.length
          || items.some(row => row.orderId !== orderId || row.tenantId !== scope.tenantId)) throw new ModelGatewayError('FORBIDDEN');
        if (Buffer.byteLength(JSON.stringify(items), 'utf8') > 32768) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
        return { items, coverage: page.coverage, nextCursor: page.nextCursor };
      };
      const page = await readPage(), current = page.items;
      let frozenBasis: z.infer<typeof aiOrderFrozenInspectionBasisSchema> = { status: 'unavailable' };
      if (typeof this.core.readOrderInspectionBasis === 'function') {
        let raw: unknown;
        try { raw = await this.core.readOrderInspectionBasis(scope.tenantId, orderId); }
        catch { /* No source counts/reasons on failure; final order and outer live authority still recheck. */ }
        if (raw !== undefined && Buffer.byteLength(JSON.stringify(raw), 'utf8') <= 32768) {
          const basis = aiOrderInspectionBasisFactsSchema.parse(raw);
          if (basis.orderId !== orderId || basis.tenantId !== scope.tenantId || basis.workspaceId !== scope.workspaceId)
            throw new ModelGatewayError('FORBIDDEN');
          if (basis.sourceOrderUpdatedAt !== before.updatedAt) throw new ModelGatewayError('CONFIG_INVALID');
          frozenBasis = { status: 'available', value: basis };
        }
      }
      // Review/customer-response records may change without updating the order.
      // Reopen only the same first page after awaited frozen-basis observation,
      // including empty pages and cursor coverage. A changed page is not retried
      // or replaced by new data; the caller may explicitly request a new read.
      if (requestFingerprint(page) !== requestFingerprint(await readPage())) throw new ModelGatewayError('CONFIG_INVALID');
      const latest = order.parse(await this.core.readOrderFacts(scope.tenantId, orderId));
      if (requestFingerprint(before) !== requestFingerprint(latest)) throw new ModelGatewayError('CONFIG_INVALID');
      const observed = this.clock();
      if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) throw new ModelGatewayError('CONFIG_INVALID');
      return { scope, audience: context.audience, orderId,
        sourceOrderUpdatedAt: before.updatedAt, observedAt: observed.toISOString(),
        records: current.map(({ tenantId: _tenant, orderId: _order, ...row }) => row), frozenBasis,
        coverage: 'partial' as const, pageCoverage: page.coverage,
        truncated: page.nextCursor !== null, nextCursor: page.nextCursor,
        queryBound: 'persisted_core_page_limit_plus_one' as const, queryLimit: 50, queryPages: 1,
        semantics: 'recorded_inspection_and_review_only_not_liability_or_settlement' as const,
        attachments: 'not_loaded' as const, execution: 'not_attempted' as const };
    });
  }
}
