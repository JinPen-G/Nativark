/** 原客户API的Nest接线。18项原实例及每次检查的原事务出箱供给Rental包，权限和收据不改变。 */
import { Injectable, Optional } from "@nestjs/common";
import { ClientApiService as RentalClientApiService } from "@rental-os/rental-core/mysql-client-application";
import { PrismaBusinessFailureOutbox } from "../ai-native/business-events/prisma-business-failure-outbox";
import { PrismaService } from "../database/prisma.service";
import { MembershipService } from "../platform/membership.service";
import { RentalCoreService } from "../rental-core/rental-core.service";
import { RentalCoreFactRepository } from "../rental-core/rental-core-fact.repository";
import { RentalCategoryResolver } from "../rental-core/rental-category-resolver.service";
import { RentalBusinessService } from "../rental-core/rental-business.service";
import { RentalOrderConfirmationService } from "../rental-core/rental-order-confirmation.service";
import { RentalIdempotentActionService } from "../rental-core/rental-idempotent-action.service";
import { RentalFundingService } from "../rental-core/rental-funding.service";
import { RentalServiceCapacityService } from "../rental-core/rental-service-capacity.service";
import { TenantIntegrationService } from "../integrations/tenant-integration.service";
import { PaymentRuntimeService } from "../integrations/payment.runtime.service";
import { FileStorageRuntimeService } from "../integrations/file-storage.runtime.service";
import { ClientAuthService } from "./client-auth.service";
import { RentalDocumentService } from "../rental-core/rental-document.service";
import { CustomerCorporateSettlementService } from "../platform/customer-corporate-settlement.service";
import { ClientDeliveryAddressService } from "./client-delivery-address.service";
import { ClientWechatAuthService } from "./client-wechat-auth.service";

@Injectable()
export class ClientApiService extends RentalClientApiService {
  constructor(
    prisma: PrismaService,
    auth: ClientAuthService,
    memberships: MembershipService,
    core: RentalCoreService,
    business: RentalBusinessService,
    orders: RentalOrderConfirmationService,
    idempotent: RentalIdempotentActionService,
    fundingService: RentalFundingService,
    serviceCapacities: RentalServiceCapacityService,
    tenantIntegrations: TenantIntegrationService,
    payments: PaymentRuntimeService,
    files: FileStorageRuntimeService,
    documents: RentalDocumentService,
    @Optional() corporateSettlement?: CustomerCorporateSettlementService,
    @Optional() addresses?: ClientDeliveryAddressService,
    @Optional() wechat?: ClientWechatAuthService,
    categoryResolver?: RentalCategoryResolver,
    @Optional() handoffFacts?: RentalCoreFactRepository
  ) {
    super(prisma, auth, memberships, core, business, orders, idempotent, fundingService,
      serviceCapacities, tenantIntegrations, payments, files, documents,
      { inspection: (transaction, scope, inspectionId) => new PrismaBusinessFailureOutbox().inspection(transaction, scope, inspectionId) },
      corporateSettlement, addresses, wechat, categoryResolver, handoffFacts);
  }
}
