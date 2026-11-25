/**
 * Core 包管理的只读宿主接点与浏览器投影，底层清单、发行和数据事实复用正式 Core 合同。
 * 安装、部署和租户使用权由各自原入口核验，可用状态要求实际包和原数据观察。
 */
import type {
  CoreCompatibilityIssue, CoreDataObservation, CoreDeploymentLock, CorePackagePinSchema,
  CorePlatformDataCapabilityRelease, CorePlatformReleaseSchema, CoreRegisteredSummary, CoreUpdateIssue
} from "@rental-os/core-contracts";
import type { GitHubCoreDiscoveryQuerySchema, GitHubCoreDiscoveryResult } from "@rental-os/core-contracts/github";
import type { GitHubCoreRepositoryInspection } from "@rental-os/core-contracts/github-repository";
import type { z } from "zod";

export const CORE_PACKAGE_HTTP_BASE = "platform/core-packages";
export const CORE_PACKAGE_HTTP = {
  catalogue: { method: "GET", path: "catalogue" },
  discover: { method: "POST", path: "discover" },
  repository: { method: "POST", path: "repository" }
} as const;

type PackagePin = z.infer<typeof CorePackagePinSchema>;
type PlatformRelease = z.infer<typeof CorePlatformReleaseSchema>;
export type CorePackageReadFailure = { code: string; message: string; retryAfterSeconds?: number };
export type CorePackageAvailability =
  | { status: "available" }
  | { status: "unavailable"; issues: CoreUpdateIssue[] };

export type CorePackageVersions =
  | { status: "unavailable"; error: CorePackageReadFailure }
  | {
    status: "observed";
    platform: { locked: PlatformRelease; current: PlatformRelease | null; availability: CorePackageAvailability };
    cores: Array<{ locked: PackagePin; current: PackagePin | null; registered: boolean; availability: CorePackageAvailability }>;
    dataCapabilities?: Array<{
      locked: CorePlatformDataCapabilityRelease;
      current: CorePlatformDataCapabilityRelease | null;
      availability: CorePackageAvailability;
    }>;
  };

export interface CorePackageCatalogue {
  checkedAt: string;
  registered: CoreRegisteredSummary[];
  versions: CorePackageVersions;
}
export interface CorePackageDiscoveryRequest {
  query: z.input<typeof GitHubCoreDiscoveryQuerySchema>;
  refresh?: boolean;
}
export interface CorePackageRepositoryRequest { repository: string; includeReleases?: boolean }
/** 宿主可信策略按 Core ID 供给精确旧 API 路径，读取来源限于受控装配。 */
export type CorePackageLegacyApiRoutes = Readonly<Record<string, readonly string[]>>;
export type CorePackageRepositoryRead =
  | { status: "unavailable"; error: CorePackageReadFailure }
  | {
    status: "observed";
    inspection: GitHubCoreRepositoryInspection;
    compatibility: Array<{
      manifestFile: string;
      status: "checked" | "unavailable";
      issues: CoreCompatibilityIssue[];
    }>;
  };

/** 一次读取同一活动组合，不能把作者源码目录、待部署目录或锁文件副本作为实际安装证据。 */
export interface CorePackageDeploymentSource {
  read(): Promise<{
    lock: CoreDeploymentLock;
    /** 实际使用包沿 requireCorePackagePin / requirePlatformDataCapabilityFiles 核同一完整字节。 */
    installed: {
      platform: PlatformRelease | null;
      cores: PackagePin[];
      dataCapabilities?: CorePlatformDataCapabilityRelease[];
    };
    /** 来自原迁移账及实际物理读取，缺失保持 null。 */
    data: CoreDataObservation | null;
  } | undefined>;
}
export interface CorePackageDiscoverySource {
  discover(query: CorePackageDiscoveryRequest["query"], refresh: boolean): Promise<GitHubCoreDiscoveryResult>;
  inspect(repository: string, includeReleases: boolean): Promise<GitHubCoreRepositoryInspection>;
}
export interface CorePackageHttpApplication {
  catalogue(): Promise<CorePackageCatalogue>;
  discover(input: unknown): Promise<GitHubCoreDiscoveryResult>;
  repository(input: unknown): Promise<CorePackageRepositoryRead>;
}
