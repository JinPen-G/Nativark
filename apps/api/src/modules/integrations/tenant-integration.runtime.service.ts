/** 原短信运行入口复用公共唯一发送与回执实现，原业务outbox仍由Rental维护。 */
import { Injectable } from "@nestjs/common";
import { TenantIntegrationRuntimeService as PlatformTenantIntegrationRuntimeService } from "@rental-os/platform-server/integration-sms";
import { PrismaService } from "../database/prisma.service";
import { TenantIntegrationService } from "./tenant-integration.service";
export * from "@rental-os/platform-server/integration-sms";

@Injectable()
export class TenantIntegrationRuntimeService extends PlatformTenantIntegrationRuntimeService {
  constructor(prisma: PrismaService, integrations: TenantIntegrationService) { super(prisma, integrations); }
}
