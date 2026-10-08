import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { z } from 'zod';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRentalInspectionDto } from '../../rental-core/rental-order-request.dto';
import type { SystemUserRow } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../../common/request-identity';
import type { RentalCoreController } from '../../rental-core/rental-core.controller';
import type { RentalIdempotencyRepository } from '../../rental-core/rental-idempotency.repository';
import type { AiOrderRouteCredentialSource } from '../order-route-context.authority';
import type { AiInspectionActorScope, AiInspectionTarget, AiInspectionSubmissionMaterial } from '@rental-os/shared';
import { InspectionAssistError, inspectionId } from './inspection-assist.validation';

const recorded = z.object({ inspection: z.object({ id: inspectionId, tenantId: inspectionId, orderId: inspectionId,
  templateId: inspectionId, templateVersion: inspectionId, stage: z.enum(['pickup', 'return']) }) });
export type InspectionSubmissionReceipt = { status: 'submitted'; inspectionId: string } | { status: 'absent' | 'unavailable' };

export class OriginalInspectionApplication {
  constructor(private readonly guard: Pick<ApiAuthGuard, 'canActivate'>, private readonly credentials: AiOrderRouteCredentialSource,
    private readonly controller: Pick<RentalCoreController, 'createInspection'>, private readonly receipts: Pick<RentalIdempotencyRepository, 'find'>) {}

  async submit(scope: AiInspectionActorScope, target: AiInspectionTarget, templateVersion: string, material: AiInspectionSubmissionMaterial) {
    scope = structuredClone(scope); target = structuredClone(target); material = structuredClone(material);
    const dto = plainToInstance(CreateRentalInspectionDto, material.body);
    if ((await validate(dto, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true })).length) throw new InspectionAssistError('INVALID_INPUT');
    return this.withGuard(scope, target, async () => {
      const prior = await this.lookup(scope, target, templateVersion, material);
      if (prior.status !== 'absent') return prior;
      return this.withGuard(scope, target, async request => {
        try { await this.controller.createInspection({ user: request.user, headers: { 'idempotency-key': material.actionId } }, target.orderId, dto); }
        catch { /* The exact persistent receipt, not the transport reply, determines commitment. */ }
        return this.lookup(scope, target, templateVersion, material);
      });
    });
  }

  async reconcile(scope: AiInspectionActorScope, target: AiInspectionTarget, templateVersion: string, material: AiInspectionSubmissionMaterial) {
    return this.withGuard(scope, target, () => this.lookup(scope, target, templateVersion, material));
  }

  private async lookup(scope: AiInspectionActorScope, target: AiInspectionTarget, templateVersion: string,
    material: AiInspectionSubmissionMaterial): Promise<InspectionSubmissionReceipt> {
    try {
      const receipt = await this.receipts.find(scope.tenantId, 'order.inspection', material.actionId);
      if (!receipt) return { status: 'absent' };
      if (receipt.requestHash !== material.requestHash || receipt.orderId !== target.orderId) throw new InspectionAssistError('REVISION_CONFLICT');
      const parsed = recorded.safeParse(receipt.response);
      if (!parsed.success) return { status: 'unavailable' };
      const inspection = parsed.data.inspection;
      if (inspection.tenantId !== scope.tenantId || inspection.orderId !== target.orderId || inspection.stage !== target.stage
        || inspection.templateId !== target.templateId || inspection.templateVersion !== templateVersion) throw new InspectionAssistError('BINDING_CHANGED');
      return { status: 'submitted', inspectionId: inspection.id };
    } catch (error) {
      if (error instanceof InspectionAssistError) throw error;
      return { status: 'unavailable' };
    }
  }

  private async withGuard<T>(scope: AiInspectionActorScope, target: AiInspectionTarget,
    execute: (request: { user: SystemUserRow }) => Promise<T>, recheck = true): Promise<T> {
    const credential = await this.credentials.current();
    if (credential.audience !== scope.audience) throw new InspectionAssistError('ACCESS_DENIED');
    return runWithRequestIdentity({}, async () => {
      const staff = credential.audience === 'staff';
      const request: { url: string; originalUrl: string; method: string; headers: { authorization: string }; query: object;
        staffApiRequest: boolean; user?: SystemUserRow } = {
        url: `/api/rental/v1/orders/${target.orderId}/inspections`,
        originalUrl: `/api/${staff ? 'staff' : 'rental'}/v1/orders/${target.orderId}/inspections`,
        method: 'POST', headers: { authorization: credential.authorization }, query: {}, staffApiRequest: staff
      };
      if (await this.guard.canActivate(new ExecutionContextHost([request])) !== true) throw new InspectionAssistError('ACCESS_DENIED');
      const identity = getRequestIdentity();
      if (!request.user || request.user.isSaasAdmin || request.user.id !== scope.ownerId || request.user.tenantId !== scope.tenantId
        || identity?.workspaceId !== scope.workspaceId || identity.tenantId !== scope.tenantId || identity.userId !== scope.ownerId
        || identity.staffApi !== staff) throw new InspectionAssistError('ACCESS_DENIED');
      if (!request.user.permissions.some(permission => ['*', 'rental-os:order:operate', `rental-os:order:${target.stage}`].includes(permission))) {
        throw new InspectionAssistError('ACCESS_DENIED');
      }
      const result = await execute({ user: request.user });
      if (recheck) await this.withGuard(scope, target, async () => undefined, false);
      return result;
    });
  }
}
