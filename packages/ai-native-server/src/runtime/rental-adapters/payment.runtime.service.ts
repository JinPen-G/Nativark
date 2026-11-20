/** 原Nest支付接线，供给Rental单源应用相同数据库、资金、Auth/ALS与失败出箱。 */
import { Injectable, Inject, Optional } from "@nestjs/common";
import { PaymentRuntimeService as RentalPaymentRuntimeService } from "@rental-os/rental-core/mysql-payment-runtime";
import { PrismaService } from "./prisma.service";
import { TenantIntegrationService } from "@rental-os/platform-server/tenant-integration";
import { RentalFundingService } from "./rental-funding.service";
import { getRequestIdentity, getRequestWorkspaceId } from "@rental-os/platform-server/request-identity";
import { requestRentalOrderVisibilityWhere } from "./rental-core-fact.repository";
import { BUSINESS_FAILURE_OUTBOX, type BusinessFailureOutboxParticipant } from "../business-events/prisma-business-failure-outbox";

@Injectable()
export class PaymentRuntimeService extends RentalPaymentRuntimeService {
  constructor(prisma: PrismaService, integrations: TenantIntegrationService, funding: RentalFundingService,
    @Optional() @Inject(BUSINESS_FAILURE_OUTBOX) failureEvents?: BusinessFailureOutboxParticipant) {
    super(prisma, integrations, funding, { getRequestIdentity, getRequestWorkspaceId, requestRentalOrderVisibilityWhere }, failureEvents);
  }
}

export { alipayExpireTime, wechatExpireTime, PaymentProviderUnknownError, PaymentProviderDefinitiveError,
  alipayFailure, refundFailureDisposition } from "@rental-os/platform-server/integration-payment";
