/** 原客户Auth的Nest接线。保留原五项构造位置，缺省客户/注册参加者仍使用同一数据源。 */
import { Injectable, Optional } from "@nestjs/common";
import { ClientAuthService as RentalClientAuthService } from "@rental-os/rental-core/mysql-client-auth";
import { PrismaService } from "../database/prisma.service";
import { TenantIntegrationRuntimeService } from "../integrations/tenant-integration.runtime.service";
import { SharedCustomerRepository } from "../platform/shared-customer.repository";
import { CustomerRegistrationService } from "../platform/customer-registration.service";
import { ClientApiRateLimitService } from "./client-api-rate-limit.service";
export type { ClientRequestContext } from "@rental-os/rental-core/client-context";

@Injectable()
export class ClientAuthService extends RentalClientAuthService {
  constructor(
    prisma: PrismaService,
    integrations: TenantIntegrationRuntimeService,
    @Optional() customers?: SharedCustomerRepository,
    @Optional() registration?: CustomerRegistrationService,
    @Optional() rateLimit?: ClientApiRateLimitService
  ) {
    const actualCustomers = customers ?? new SharedCustomerRepository(prisma);
    super(prisma, integrations, actualCustomers,
      registration ?? new CustomerRegistrationService(prisma, actualCustomers), rateLimit);
  }
}
