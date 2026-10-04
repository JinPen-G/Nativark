import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import type { RentalCoreService } from '../rental-core/rental-core.service';
import { ModelGatewayError } from './model-gateway.ports';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const item = z.object({ id, tenantId: id, categoryCode: z.string().min(1).max(64), code: id, name: z.string().min(1).max(191), status: z.enum(['enabled', 'disabled']), unit: z.string().min(1).max(32) }).strict();
const input = z.object({ limit: z.number().int().min(1).max(100) }).strict();

export interface AiCatalogReadAuthority { resolve(): Promise<AiExecutionContext>; }
export interface AiCatalogReadProjection { contractVersion: typeof AI_CONTRACT_DRAFT_VERSION; requestId: string; audience: AiExecutionContext['audience']; scope: AiExecutionContext['scope']; observedAt: string; items: Array<{ id: string; code: string; name: string; categoryCode: string; status: 'enabled' | 'disabled'; unit: string }>; }

/** Bounded read-only projection; it does not reserve stock, calculate price or select a customer. */
export class AiCatalogReadFactsService {
  constructor(private readonly core: Pick<RentalCoreService, 'listItemGroups'>, private readonly authority: AiCatalogReadAuthority, private readonly clock: () => Date = () => new Date()) {
    if (!core || typeof core.listItemGroups !== 'function' || !authority || typeof authority.resolve !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  async read(value: unknown): Promise<AiCatalogReadProjection> {
    const request = input.safeParse(value); if (!request.success) throw new ModelGatewayError('INVALID_REQUEST');
    let context: AiExecutionContext;
    try { context = structuredClone(await this.authority.resolve()); } catch { throw new ModelGatewayError('FORBIDDEN'); }
    if (context.scope.kind !== 'workspace' || (context.audience !== 'operator' && context.audience !== 'staff') || context.actor.kind !== 'user') throw new ModelGatewayError('FORBIDDEN');
    const workspace = context.scope;
    const rows = await this.core.listItemGroups(workspace.tenantId);
    if (!Array.isArray(rows) || rows.length > request.data.limit) throw new ModelGatewayError('INVALID_RESPONSE');
    const parsed = rows.map(row => item.safeParse({ id: row?.id, tenantId: row?.tenantId, categoryCode: row?.categoryCode, code: row?.code, name: row?.name, status: row?.status, unit: row?.unit }));
    if (parsed.some(result => !result.success || result.data.tenantId !== workspace.tenantId)) throw new ModelGatewayError('INVALID_RESPONSE');
    const observed = this.clock(); if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) throw new ModelGatewayError('CONFIG_INVALID');
    return { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: context.requestId, audience: context.audience, scope: context.scope, observedAt: observed.toISOString(), items: parsed.map(result => ({ id: result.data!.id, code: result.data!.code, name: result.data!.name, categoryCode: result.data!.categoryCode, status: result.data!.status, unit: result.data!.unit })) };
  }
}
