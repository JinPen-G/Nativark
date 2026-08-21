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

  /**
   * SPACE-03：快照按**经营空间**存档。
   *
   * 主键换成 workspaceId 之后，每个空间各有自己的恢复副本，调用方不必再
   * 「固定挑默认空间」来避免互相覆盖。
   */
  async saveCoreState(tenantId: string, workspaceId: string, state: unknown) {
    if (!this.enabled()) return;
    const json = JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue;
    await this.prisma.rentalCoreStateSnapshot.upsert({
      where: { workspaceId },
      update: { state: json },
      create: { workspaceId, tenantId, state: json }
    });
  }

  async saveBusinessState(tenantId: string, workspaceId: string, state: unknown) {
    if (!this.enabled()) return;
    const json = JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue;
    await this.prisma.rentalBusinessStateSnapshot.upsert({
      where: { workspaceId },
      update: { state: json },
      create: { workspaceId, tenantId, state: json }
    });
  }
}
