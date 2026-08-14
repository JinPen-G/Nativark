import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class RentalStateRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  enabled() {
    return (this.config.get<string>("PLATFORM_DATA_SOURCE") ?? "mysql").toLowerCase() === "mysql";
  }

  async loadCoreStates() {
    if (!this.enabled()) return [];
    return this.prisma.rentalCoreStateSnapshot.findMany();
  }

  async loadBusinessStates() {
    if (!this.enabled()) return [];
    return this.prisma.rentalBusinessStateSnapshot.findMany();
  }

  async loadTenantProfiles() {
    if (!this.enabled()) return [];
    return this.prisma.tenantRentalProfile.findMany({
      select: { tenantId: true, categoryCode: true }
    });
  }

  async saveCoreState(tenantId: string, state: unknown) {
    if (!this.enabled()) return;
    const json = JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue;
    await this.prisma.rentalCoreStateSnapshot.upsert({
      where: { tenantId },
      update: { state: json },
      create: { tenantId, state: json }
    });
  }

  async saveBusinessState(tenantId: string, state: unknown) {
    if (!this.enabled()) return;
    const json = JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue;
    await this.prisma.rentalBusinessStateSnapshot.upsert({
      where: { tenantId },
      update: { state: json },
      create: { tenantId, state: json }
    });
  }
}
