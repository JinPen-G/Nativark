/** 包预检消费宿主登记的固定发行和实际字节，浏览器只选择引用标识。
 * 发布、部署、迁移与租户授权由各自原入口负责，预检结果只描述候选组合。 */
import { z } from "zod";
import {
  CoreIdSchema, CorePackagePinSchema, CorePlatformReleaseSchema, CorePlatformDataCapabilityReleaseSchema,
  type CoreDataContract, type CoreDeploymentLock, type CoreUpdateIssue, type CoreUpdateResult
} from "@rental-os/core-contracts";
import type { CorePackageInspection } from "@rental-os/core-contracts/package";
import type { CorePackageReadFailure } from "../core-package-ports";

export const CorePackageArtifactReferenceSchema = z.string().min(1).max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$(?![\s\S])/, "使用宿主已登记的包引用标识");
export const CorePackageInspectRequestSchema = z.object({ reference: CorePackageArtifactReferenceSchema }).strict();
export const CorePackageUpdatePlanRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("platform"), reference: CorePackageArtifactReferenceSchema }).strict(),
  z.object({ kind: z.literal("core"), coreId: CoreIdSchema, reference: CorePackageArtifactReferenceSchema }).strict(),
  z.object({ kind: z.literal("platform-capability"), capabilityId: CoreIdSchema, reference: CorePackageArtifactReferenceSchema }).strict()
]);
const artifactBytes = z.instanceof(Uint8Array);
export const CorePackageArtifactSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("core"), pin: CorePackagePinSchema, bytes: artifactBytes }).strict(),
  z.object({ kind: z.literal("platform"), release: CorePlatformReleaseSchema, bytes: artifactBytes }).strict(),
  z.object({ kind: z.literal("platform-capability"), release: CorePlatformDataCapabilityReleaseSchema, bytes: artifactBytes }).strict()
]);
export type CorePackageArtifact = z.infer<typeof CorePackageArtifactSchema>;
export type CorePackageArtifactSummary =
  | Pick<Extract<CorePackageArtifact, { kind: "core" }>, "kind" | "pin">
  | Pick<Extract<CorePackageArtifact, { kind: "platform" }>, "kind" | "release">
  | Pick<Extract<CorePackageArtifact, { kind: "platform-capability" }>, "kind" | "release">;

export interface CorePackageArtifactSource {
  /** 原来源按当前宿主政策供给固定包。缺包返回 undefined，失败向上返回，字节留在服务端。 */
  read(reference: string): Promise<CorePackageArtifact | undefined>;
}
export interface CorePackageInspectedArtifact {
  status: "inspected";
  reference: string;
  checkedAt: string;
  review: "unreviewed";
  artifact: CorePackageArtifactSummary;
  inspection: CorePackageInspection;
}
export type CorePackageArtifactRead =
  | { status: "unavailable"; error: CorePackageReadFailure }
  | CorePackageInspectedArtifact;
export type CorePackageInstallPlan =
  | { ok: false; scope: "install-preflight"; issues: CoreUpdateIssue[] }
  | {
    ok: true;
    scope: "install-preflight";
    status: "unchanged" | "candidate";
    candidate: CoreDeploymentLock;
    initialMigrations: CoreDataContract["migrations"];
  };
export type CorePackagePlanRead =
  | Extract<CorePackageArtifactRead, { status: "unavailable" }>
  | (CorePackageInspectedArtifact & {
    plan:
      | { status: "unavailable"; error: CorePackageReadFailure }
      | { status: "checked"; deployment: "pending"; result: CorePackageInstallPlan | CoreUpdateResult };
  });

export const CORE_PACKAGE_PREFLIGHT_HTTP = {
  inspect: { method: "POST", path: "inspect" },
  install: { method: "POST", path: "plan-install" },
  update: { method: "POST", path: "plan-update" }
} as const;
export interface CorePackagePreflightApplication {
  inspect(input: unknown): Promise<CorePackageArtifactRead>;
  install(input: unknown): Promise<CorePackagePlanRead>;
  update(input: unknown): Promise<CorePackagePlanRead>;
}
