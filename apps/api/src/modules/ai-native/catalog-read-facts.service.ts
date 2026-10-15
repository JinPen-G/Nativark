import { z } from 'zod';
import { assertAiReadContextBinding } from './tools/read-context-binding';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import type { RentalCoreService } from '../rental-core/rental-core.service';
import { ModelGatewayError } from './model-gateway.ports';
import type { AiBusinessReadAuthority } from './business-read-route.authority';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const item = z.object({ id, tenantId: id, categoryCode: z.string().min(1).max(64), code: id, name: z.string().min(1).max(191), status: z.enum(['enabled', 'disabled']), unit: z.string().min(1).max(32) }).strict();
export const aiCatalogReadInputSchema = z.object({ limit: z.number().int().min(1).max(100),
  cursor: id.optional(), itemGroupId: id.optional(), name: z.string().trim().min(1).max(191).optional() }).strict();
const input = aiCatalogReadInputSchema;

export type AiCatalogReadAuthority = AiBusinessReadAuthority;
/** Bounded-only hosts need not expose the legacy unbounded method. The legacy
 * shape is retained for older compositions, but read() never calls it. */
export type AiCatalogReadPort = Pick<RentalCoreService, 'listItemGroupsPage'>
  | (Pick<RentalCoreService, 'listItemGroups'> & Partial<Pick<RentalCoreService, 'listItemGroupsPage'>>);
export interface AiCatalogReadProjection { contractVersion: typeof AI_CONTRACT_DRAFT_VERSION; requestId: string; audience: AiExecutionContext['audience']; scope: AiExecutionContext['scope']; observedAt: string; items: Array<{ id: string; code: string; name: string; categoryCode: string; status: 'enabled' | 'disabled'; unit: string }>;
  truncated: boolean; nextCursor: string | null; configurationVersion: string; source: 'persisted_workspace_configuration'; }

/** Bounded read-only projection; it does not reserve stock, calculate price or select a customer. */
export class AiCatalogReadFactsService {
  constructor(private readonly core: AiCatalogReadPort, private readonly authority: AiCatalogReadAuthority, private readonly clock: () => Date = () => new Date()) {
    if (!core || (typeof core.listItemGroupsPage !== 'function'
      && (!('listItemGroups' in core) || typeof core.listItemGroups !== 'function'))
      || typeof authority?.withRead !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  async read(value: unknown, expectedContext?: AiExecutionContext): Promise<AiCatalogReadProjection> {
    const request = input.safeParse(structuredClone(value)); if (!request.success) throw new ModelGatewayError('INVALID_REQUEST');
    return this.authority.withRead('catalog', request.data, async context => {
    assertAiReadContextBinding(context, expectedContext);
    if (context.scope.kind !== 'workspace' || (context.audience !== 'operator' && context.audience !== 'staff') || context.actor.kind !== 'user') throw new ModelGatewayError('FORBIDDEN');
    const workspace = context.scope;
    if (typeof this.core.listItemGroupsPage !== 'function') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    const page = await this.core.listItemGroupsPage(workspace.tenantId, request.data);
    const rows = page?.rows;
    if (!Array.isArray(rows) || rows.length > request.data.limit) throw new ModelGatewayError('INVALID_RESPONSE');
    if (page.source !== 'persisted_workspace_configuration' || !/^[a-f0-9]{64}$/u.test(page.configurationVersion)
      || typeof page.truncated !== 'boolean'
      || (page.truncated ? rows.length !== request.data.limit || page.nextCursor !== rows.at(-1)?.id : page.nextCursor !== null)
      || rows.some((row, index) => (request.data.itemGroupId && row.id !== request.data.itemGroupId)
        || (request.data.name && row.name !== request.data.name)
        || (request.data.cursor && row.id <= request.data.cursor) || (index > 0 && row.id <= rows[index - 1].id)))
      throw new ModelGatewayError('INVALID_RESPONSE');
    const parsed = rows.map(row => item.safeParse({ id: row?.id, tenantId: row?.tenantId, categoryCode: row?.categoryCode, code: row?.code, name: row?.name, status: row?.status, unit: row?.unit }));
    if (parsed.some(result => !result.success || result.data.tenantId !== workspace.tenantId)) throw new ModelGatewayError('INVALID_RESPONSE');
    const ids = parsed.map(result => result.data!.id);
    const codes = parsed.map(result => result.data!.code);
    if (new Set(ids).size !== ids.length || new Set(codes).size !== codes.length) throw new ModelGatewayError('INVALID_RESPONSE');
    const observed = this.clock(); if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) throw new ModelGatewayError('CONFIG_INVALID');
    return { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: context.requestId, audience: context.audience, scope: context.scope, observedAt: observed.toISOString(), items: parsed.map(result => ({ id: result.data!.id, code: result.data!.code, name: result.data!.name, categoryCode: result.data!.categoryCode, status: result.data!.status, unit: result.data!.unit })),
      truncated: page.truncated, nextCursor: page.nextCursor, configurationVersion: page.configurationVersion, source: page.source };
    });
  }
}
