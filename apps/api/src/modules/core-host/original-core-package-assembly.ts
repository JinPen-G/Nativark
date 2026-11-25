/**
 * 旧组合的四组 Core 包管理共用原数据库、账号和提交意图审计。
 * 存储由宿主配置，注册目录及当前部署材料由受控 provider 提供，缺源明确不可用。
 */
import type { FactoryProvider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { CoreAccessError, type CoreDeployedCatalogue } from "@rental-os/core-host";
import {
  composePlatformCorePackageAssembly, createPlatformCorePackageAudit, type CorePackageAssembly
} from "@rental-os/platform-core-host";
import { PrismaService } from "../database/prisma.service";
import { PlatformRepository } from "../platform/platform.repository";

export const ORIGINAL_CORE_PACKAGE_ASSEMBLY = Symbol("original.core-packages.assembly");
export const ORIGINAL_CORE_PACKAGE_DEPLOYMENT = Symbol("original.core-packages.deployment");

type AssemblyInput = Parameters<typeof composePlatformCorePackageAssembly<Prisma.TransactionClient>>[0];
export type OriginalCorePackageDeployment = Pick<AssemblyInput,
  "catalogue" | "deployment" | "materials" | "legacyApiRoutes">;

function unavailableCatalogue(): never {
  throw new CoreAccessError("core_unavailable", "旧组合宿主尚未提供受控 Core 部署目录");
}

const missingCatalogue: CoreDeployedCatalogue = {
  get registrations() { return unavailableCatalogue(); },
  get http() { return unavailableCatalogue(); },
  availability: {
    async requireRegistered() { unavailableCatalogue(); },
    async requireAvailable() { unavailableCatalogue(); }
  },
  async requireDataCapabilityAvailable() { unavailableCatalogue(); }
};

/** 组合只创建应用，真实目录与原文件材料在当前权限下按各自入口读取。 */
export function composeOriginalCorePackageAssembly(input: Omit<AssemblyInput, "audit" | "catalogue"> & {
  catalogue?: CoreDeployedCatalogue;
}): CorePackageAssembly {
  return composePlatformCorePackageAssembly<Prisma.TransactionClient>({
    ...input,
    catalogue: input.catalogue ?? missingCatalogue,
    audit: createPlatformCorePackageAudit<Prisma.TransactionClient>()
  });
}

export const ORIGINAL_CORE_PACKAGE_ASSEMBLY_PROVIDER: FactoryProvider<CorePackageAssembly> = {
  provide: ORIGINAL_CORE_PACKAGE_ASSEMBLY,
  inject: [PrismaService, PlatformRepository, ConfigService,
    { token: ORIGINAL_CORE_PACKAGE_DEPLOYMENT, optional: true }],
  useFactory: (database: PrismaService, users: PlatformRepository, config: Pick<ConfigService, "get">,
    deployment?: OriginalCorePackageDeployment) => composeOriginalCorePackageAssembly({
      database, users, storageDirectory: config.get<string>("CORE_PACKAGE_STORAGE_ROOT"), ...deployment
    })
};
