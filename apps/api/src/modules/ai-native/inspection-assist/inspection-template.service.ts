import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import { AiOrderRouteContextAuthority, type AiOrderRouteCredentialSource } from '../order-route-context.authority';
import { InspectionAssistError, inspectionId, inspectionTargetSchema, parseInspectionInput } from './inspection-assist.validation';

const field = z.object({ code: inspectionId, label: z.string().min(1).max(256),
  type: z.enum(['boolean', 'number', 'text', 'select', 'photo']), required: z.boolean(),
  unit: z.string().max(64).optional(), options: z.array(z.string().min(1).max(256)).max(100).optional(), usageMetric: z.boolean().optional() });
const templateSchema = z.object({ id: inspectionId, tenantId: inspectionId, categoryCode: z.string().min(1).max(128),
  code: inspectionId, name: z.string().min(1).max(256), stage: z.enum(['pickup', 'return']),
  version: inspectionId, enabled: z.literal(true), fields: z.array(field).min(1).max(100),
  allocationIds: z.array(inspectionId).max(200).optional(), sourceTemplateId: inspectionId.optional(), exchangeId: inspectionId.optional() });
const requestSchema = inspectionTargetSchema.extend({ templateId: inspectionId }).strict();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Order metadata permission only. This does not authorize extraction, file reads,
 * draft writes or final inspection submission. Uses the original Guard/ALS chain. */
export class InspectionTemplateService {
  constructor(private readonly dependencies: {
    guard: Pick<ApiAuthGuard, 'canActivate'>; credentials: AiOrderRouteCredentialSource;
    core: Pick<RentalCoreService, 'getOrder' | 'listInspectionTemplates'>;
  }) {
    if (typeof dependencies?.guard?.canActivate !== 'function'
      || typeof dependencies.credentials?.current !== 'function'
      || typeof dependencies.core?.getOrder !== 'function'
      || typeof dependencies.core?.listInspectionTemplates !== 'function') throw new InspectionAssistError('TEMPLATE_UNAVAILABLE');
  }

  async read(value: unknown) {
    const input = parseInspectionInput(requestSchema, value);
    const authority = new AiOrderRouteContextAuthority(this.dependencies.guard, this.dependencies.credentials, input.orderId);
    try {
      return await authority.withOrderRead(async (context, orderId) => {
        if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user') throw new InspectionAssistError('ACCESS_DENIED');
        const scope = context.scope;
        const observe = async () => {
          const order = await this.dependencies.core.getOrder(scope.tenantId, orderId);
          // RentalOrder's public contract has no workspaceId; workspace is verified
          // by the real route Guard and Core's ALS-scoped repository, not invented here.
          if (order.id !== orderId || order.tenantId !== scope.tenantId
            || !Array.isArray(order.inspectionTemplateSnapshots) || order.inspectionTemplateSnapshots.length > 32
            || !Array.isArray(order.allocations) || order.allocations.length > 200) throw new InspectionAssistError('TEMPLATE_UNAVAILABLE');
          const allocations = order.allocations.filter(row => row.id === input.allocationId && row.orderId === orderId);
          if (allocations.length !== 1 || !allocations[0].assetId
            || !inspectionId.safeParse(allocations[0].assetId).success
            || ['released', 'returned'].includes(allocations[0].status)) throw new InspectionAssistError('BINDING_CHANGED');
          // Core resolves replacement-goods snapshots; never substitute current configuration.
          const templates = await this.dependencies.core.listInspectionTemplates(scope.tenantId, input.stage, order);
          if (!Array.isArray(templates) || templates.length > 32) throw new InspectionAssistError('TEMPLATE_UNAVAILABLE');
          const matches = templates.filter(row => row.id === input.templateId && row.stage === input.stage
            && (!row.allocationIds || row.allocationIds.includes(input.allocationId)));
          if (matches.length !== 1) throw new InspectionAssistError('TEMPLATE_UNAVAILABLE');
          const template = parseInspectionInput(templateSchema, matches[0]);
          if (template.tenantId !== scope.tenantId || new Set(template.fields.map(row => row.code)).size !== template.fields.length
            || template.fields.some(row => row.type === 'select' && !row.options?.length)) throw new InspectionAssistError('TEMPLATE_UNAVAILABLE');
          return { scope: structuredClone(scope), owner: { actorKind: 'user' as const, actorId: context.actor.kind === 'user' ? context.actor.userId : '' },
            audience: context.audience, orderId, allocationId: input.allocationId, assetId: allocations[0].assetId,
            stage: input.stage, template, allocationStatus: allocations[0].status };
        };
        const before = await observe(), after = await observe();
        if (digest(before) !== digest(after)) throw new InspectionAssistError('BINDING_CHANGED');
        return { ...after, bindingFingerprint: digest(after), status: 'template_ready' as const,
          semantics: 'read_projection_not_inspection_or_action_authorization' as const };
      });
    } catch (error) {
      if (error instanceof InspectionAssistError) throw error;
      throw new InspectionAssistError('ACCESS_DENIED');
    }
  }
}
