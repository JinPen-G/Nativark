import { z } from 'zod';
import type { AiExecutionContext, RentalCategoryCode, RentalCurrency } from '@rental-os/shared';
import type { RentalBusinessService, BusinessContext } from '../../rental-core/rental-business.service';
import { RentalReportReadLimitError, type RentalWorkspaceReportRepository } from '../../rental-core/rental-workspace-report.repository';
import { ModelGatewayError } from '../model-gateway.ports';
import { assertAiReadContextBinding } from './read-context-binding';

/** Mainline must implement this closed bridge through the ORIGINAL route Guard
 * and ALS, including current-identity revalidation after the awaited read.
 * No implementation or default authorization is installed by this slice. */
export interface AiDiagnosticReadAuthority {
  withRead<T>(kind: 'opening' | 'risk', input: unknown, consume: (context: AiExecutionContext) => Promise<T>): Promise<T>;
}
export const aiOpeningReadInputSchema = z.object({ limit: z.number().int().min(1).max(50),
  sections: z.array(z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)).min(1).max(9)
    .refine(rows => new Set(rows).size === rows.length).optional()
}).strict();
const instant = z.string().max(40).datetime({ offset: true });
export const aiRiskReadInputSchema = z.object({
  from: instant, to: instant, locationId: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).optional()
}).strict().refine(v => Date.parse(v.to) > Date.parse(v.from) && Date.parse(v.to) - Date.parse(v.from) <= 31 * 86400000);
const id = z.string().min(1).max(191);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const amount = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const readiness = z.object({ tenantId: id, workspaceId: id, ready: z.boolean(), items: z.array(z.object({
  key: id, title: z.string().min(1).max(200), done: z.boolean(), missing: z.string().max(1000),
  unavailable: z.boolean().optional(), optional: z.boolean().optional()
})).max(50) });
const report = z.object({ tenantId: id, workspaceId: id, currency: z.string().regex(/^[A-Z]{3}$/u), generatedAt: instant,
  orderCount: count, rentalRevenue: amount, receivableTotal: amount, exceptionOrderCount: count,
  utilization: z.object({ orderOccupancy: z.object({ orderCount: count, totalHours: amount, averageHours: amount }) })
});
function workspace(context: AiExecutionContext) {
  if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user'
    || !['operator', 'staff'].includes(context.audience)) throw new ModelGatewayError('FORBIDDEN');
  return context.scope;
}
function requireMethod(value: unknown, method: string) {
  if (!value || typeof (value as Record<string, unknown>)[method] !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
}
function observed(clock: () => Date) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new ModelGatewayError('CONFIG_INVALID');
  return value.toISOString();
}

/** Internal bounded projection; neither an enabled handler nor an HTTP DTO. */
export class AiOpeningReadFactsService {
  constructor(private readonly business: Pick<RentalBusinessService, 'tenantReadiness'>,
    private readonly context: { current(scope: Extract<AiExecutionContext['scope'], { kind: 'workspace' }>): Promise<BusinessContext> },
    private readonly authority: AiDiagnosticReadAuthority, private readonly clock: () => Date = () => new Date()) {
    requireMethod(business, 'tenantReadiness'); requireMethod(context, 'current'); requireMethod(authority, 'withRead');
  }
  async read(value: unknown, expectedContext?: AiExecutionContext) {
    const input = aiOpeningReadInputSchema.safeParse(value);
    if (!input.success) throw new ModelGatewayError('INVALID_REQUEST');
    return this.authority.withRead('opening', input.data, async context => {
      assertAiReadContextBinding(context, expectedContext);
      const scope = workspace(context), businessContext = await this.context.current(scope);
      const parsed = readiness.safeParse(await this.business.tenantReadiness(scope.tenantId, businessContext));
      if (!parsed.success || parsed.data.tenantId !== scope.tenantId || parsed.data.workspaceId !== scope.workspaceId
        || parsed.data.items.length > input.data.limit || new Set(parsed.data.items.map(x => x.key)).size !== parsed.data.items.length)
        throw new ModelGatewayError('INVALID_RESPONSE');
      if (input.data.sections?.some(key => !parsed.data.items.some(row => row.key === key))) throw new ModelGatewayError('INVALID_REQUEST');
      const selected = input.data.sections && new Set(input.data.sections);
      return { requestId: context.requestId, scope: { ...scope }, observedAt: observed(this.clock), ready: parsed.data.ready,
        // The Core aggregate is not recalculated from a selected subset. This
        // is output minimization only, not a per-section database query.
        readinessBasis: 'core_workspace_aggregate' as const,
        coverage: selected ? 'requested_sections' as const : 'all_readiness_sections' as const,
        items: parsed.data.items.filter(row => !selected || selected.has(row.key)).map(row => ({ key: row.key, title: row.title, missing: row.missing,
          optional: row.optional === true, status: row.unavailable ? 'unavailable' as const : row.done ? 'ready' as const : 'missing' as const })) };
    });
  }
}

export class AiRiskReadFactsService {
  constructor(private readonly reports: Pick<RentalWorkspaceReportRepository, 'getBoundedOperationReport'>,
    private readonly settings: {
      category(scope: Extract<AiExecutionContext['scope'], { kind: 'workspace' }>): Promise<RentalCategoryCode>;
      currency(scope: Extract<AiExecutionContext['scope'], { kind: 'workspace' }>): Promise<RentalCurrency>;
    }, private readonly authority: AiDiagnosticReadAuthority, private readonly clock: () => Date = () => new Date()) {
    requireMethod(reports, 'getBoundedOperationReport'); requireMethod(settings, 'category'); requireMethod(settings, 'currency'); requireMethod(authority, 'withRead');
  }
  async read(value: unknown, expectedContext?: AiExecutionContext) {
    const input = aiRiskReadInputSchema.safeParse(value);
    if (!input.success) throw new ModelGatewayError('INVALID_REQUEST');
    return this.authority.withRead('risk', input.data, async context => {
      assertAiReadContextBinding(context, expectedContext);
      const scope = workspace(context), category = await this.settings.category(scope), currency = await this.settings.currency(scope);
      const facts = await this.reports.getBoundedOperationReport(scope.tenantId, scope.workspaceId, category, input.data, currency)
        .catch(error => {
          if (error instanceof RentalReportReadLimitError) throw new ModelGatewayError('RATE_LIMITED');
          throw error;
        });
      const parsed = report.safeParse(facts);
      if (!parsed.success || parsed.data.tenantId !== scope.tenantId || parsed.data.workspaceId !== scope.workspaceId || parsed.data.currency !== currency)
        throw new ModelGatewayError('INVALID_RESPONSE');
      const r = parsed.data;
      return { requestId: context.requestId, scope: { ...scope }, observedAt: observed(this.clock), sourceGeneratedAt: r.generatedAt,
        range: { from: input.data.from, to: input.data.to }, currency: r.currency, orderCount: r.orderCount,
        rentalRevenue: r.rentalRevenue, receivableTotal: r.receivableTotal, exceptionOrderCount: r.exceptionOrderCount,
        orderOccupancy: r.utilization.orderOccupancy, inventoryBasis: 'current_snapshot' as const,
        profit: { status: 'unavailable' as const, reason: 'cost_evidence_missing' as const },
        historicalUtilization: { status: 'unavailable' as const, reason: 'historical_available_capacity_missing' as const } };
    });
  }
}
