/** Composes the original private customer source with Core's sealed order port.
 * Current merchant authority comes from the source owner. Core owns execution,
 * the original D/K and receipts. HTTP receives the minimal original order link. */
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { EnterpriseMerchantOrderDelegationResult, ExecuteEnterpriseMerchantOrderDelegation } from "./enterprise-order-delegation";
import type { RentalEnterpriseApprovalBusiness as RentalBusinessService } from "./enterprise-approval-ports";
import type { RentalEnterpriseApprovalCore as RentalCoreService } from "./enterprise-approval-ports";
import { RentalMerchantDelegatedOrderPort } from "./merchant-delegation";
import type { RentalEnterpriseApprovalOrders as RentalOrderConfirmationService } from "./enterprise-approval-ports";
import { EnterpriseMerchantDelegationService, type EnterpriseMerchantDelegationActorAuth } from "./mysql-enterprise-merchant-delegation";
import type { Prisma } from "@prisma/client";

export class EnterpriseMerchantOrderSubmissionService {
  private readonly port: RentalMerchantDelegatedOrderPort<Prisma.TransactionClient>;

  constructor(private readonly sources: EnterpriseMerchantDelegationService, orders: RentalOrderConfirmationService,
    private readonly core: RentalCoreService, private readonly business: RentalBusinessService) {
    this.port = new RentalMerchantDelegatedOrderPort<Prisma.TransactionClient>(orders, sources);
  }

  async execute(actor: EnterpriseMerchantDelegationActorAuth, input: ExecuteEnterpriseMerchantOrderDelegation): Promise<EnterpriseMerchantOrderDelegationResult> {
    if (!input || Object.keys(input).some(key => !["delegationKey", "expectedRevision", "approvalId", "confirm"].includes(key))
      || input.confirm !== true) throw new BadRequestException("须明确确认本条原委托");
    const reference = { delegationKey: input.delegationKey, expectedRevision: input.expectedRevision, approvalId: input.approvalId };
    const source = await this.sources.readMerchantDelegatedSubmission(actor, reference);
    if (source.state !== "issued" || Date.parse(source.expiresAt) <= Date.now()) return this.readOriginal(actor, reference.delegationKey);
    const context = await this.business.refreshWorkspaceContext(source.tenantId, await this.core.readBusinessContext(source.tenantId));
    const name = actor.user.displayName || actor.user.account || actor.user.id;
    const result = await this.port.execute(actor, reference, name, context);
    return { delegationKey: reference.delegationKey, state: "observed", orderId: result.order.id, retryable: false };
  }

  async readOriginal(actor: EnterpriseMerchantDelegationActorAuth, delegationKey: string): Promise<EnterpriseMerchantOrderDelegationResult> {
    const result = await this.port.readOriginal(actor, { delegationKey, expectedRevision: 1 });
    if (result.state === "observed") return { delegationKey, state: "observed", orderId: result.orderId, retryable: false };
    if (result.state === "unknown") return { delegationKey, state: "unknown", orderId: null, retryable: false };
    throw new ConflictException("原委托Core结果仍待核对");
  }
}
