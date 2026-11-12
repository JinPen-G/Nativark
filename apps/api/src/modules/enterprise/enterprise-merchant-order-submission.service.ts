/** Composes the original private customer source with Core's sealed order port.
 * Current merchant authority comes from the source owner. Core owns execution,
 * the original D/K and receipts. HTTP receives the minimal original order link. */
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import type { EnterpriseMerchantOrderDelegationResult, ExecuteEnterpriseMerchantOrderDelegation } from "@rental-os/shared";
import { RentalBusinessService } from "../rental-core/rental-business.service";
import { RentalCoreService } from "../rental-core/rental-core.service";
import { RentalMerchantDelegatedOrderPort } from "../rental-core/rental-merchant-delegated-order.authority";
import { RentalOrderConfirmationService } from "../rental-core/rental-order-confirmation.service";
import { EnterpriseMerchantDelegationService, type EnterpriseMerchantDelegationActorAuth } from "./enterprise-merchant-delegation.service";

@Injectable()
export class EnterpriseMerchantOrderSubmissionService {
  private readonly port: RentalMerchantDelegatedOrderPort;

  constructor(private readonly sources: EnterpriseMerchantDelegationService, orders: RentalOrderConfirmationService,
    private readonly core: RentalCoreService, private readonly business: RentalBusinessService) {
    this.port = new RentalMerchantDelegatedOrderPort(orders, sources);
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
