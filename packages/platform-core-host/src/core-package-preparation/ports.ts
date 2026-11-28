/** 候选准备的请求、固定摘要和原结果投影。包来源、权限与实际材料由宿主供给。
 * pending 文件由部署者继续构建、迁移和注册，租户使用权沿原授权入口管理。 */
import { z } from "zod";
import { CoreArtifactHashSchema, CoreDeploymentLockSchema, CorePackagePathSchema } from "@rental-os/core-contracts";
import { GitHubCoreReleasePinSchema } from "@rental-os/core-contracts/github";
import {
  CorePackageArtifactSchema, CorePackageInspectRequestSchema, CorePackageUpdatePlanRequestSchema,
  type CorePackageArtifact
} from "../core-package-preflight/ports";
import type { CorePackageReadFailure } from "../core-package-ports";

export const CorePackagePreparationRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("install"), package: CorePackageInspectRequestSchema }).strict(),
  z.object({ operation: z.literal("update"), package: CorePackageUpdatePlanRequestSchema }).strict()
]);
export const CorePackagePrepareRequestSchema = z.object({
  request: CorePackagePreparationRequestSchema, expectedSha256: CoreArtifactHashSchema
}).strict();
export const CorePackagePreparationQuerySchema = z.object({ sha256: CoreArtifactHashSchema }).strict();
const artifactSummary = z.discriminatedUnion("kind", [
  CorePackageArtifactSchema.options[0].omit({ bytes: true }), CorePackageArtifactSchema.options[1].omit({ bytes: true }),
  CorePackageArtifactSchema.options[2].omit({ bytes: true })
]);
const filePath = z.string().min(1).max(1024).refine(value => value.split("/").every(part =>
  CorePackagePathSchema.safeParse(part).success && !/^(?:\.git|node_modules)$/i.test(part)
  && (!/^\.env(?:\.|$)/i.test(part) || part === ".env.example")), "候选文件须使用可移植的受控相对路径");
export const CorePackagePreparationPlanSchema = z.object({
  format: z.literal("core-preparation-1"), deployment: z.literal("pending"),
  request: CorePackagePreparationRequestSchema,
  artifact: artifactSummary,
  privateRelease: GitHubCoreReleasePinSchema.optional(),
  base: CoreDeploymentLockSchema,
  candidate: CoreDeploymentLockSchema,
  files: z.array(z.object({ file: filePath, sizeBytes: z.number().int().safe().nonnegative(), sha256: CoreArtifactHashSchema }).strict())
    .refine(files => new Set(files.map(file => file.file.toLowerCase())).size === files.length, "候选文件路径须唯一")
}).strict().refine(plan => !plan.privateRelease || plan.privateRelease.visibility === "private" && plan.artifact.kind === "core"
  && plan.privateRelease.coreId === plan.artifact.pin.manifest.id && plan.privateRelease.version === plan.artifact.pin.manifest.version
  && plan.privateRelease.sha256 === plan.artifact.pin.sha256
  && plan.privateRelease.repository === plan.artifact.pin.manifest.source.repository
  && plan.privateRelease.commit === plan.artifact.pin.manifest.source.commit, "私有候选须绑定同一原发行和包身份");
export const CorePackagePreparationRecordSchema = z.object({
  sha256: CoreArtifactHashSchema, preparedAt: z.string().datetime(), plan: CorePackagePreparationPlanSchema
}).strict();
export type CorePackagePreparationRequest = z.infer<typeof CorePackagePreparationRequestSchema>;
export type CorePackagePrepareRequest = z.infer<typeof CorePackagePrepareRequestSchema>;
export type CorePackagePreparationQuery = z.infer<typeof CorePackagePreparationQuerySchema>;
export type CorePackagePreparationPlan = z.infer<typeof CorePackagePreparationPlanSchema>;
export type CorePackagePreparationRecord = z.infer<typeof CorePackagePreparationRecordSchema>;
export type CorePackagePreparationUnavailable = { status: "unavailable"; error: CorePackageReadFailure };
export type CorePackagePreparationPreview = CorePackagePreparationUnavailable
  | { status: "ready"; sha256: string; plan: CorePackagePreparationPlan };
export type CorePackagePreparationResult = CorePackagePreparationUnavailable
  | { status: "unknown"; sha256: string; error: CorePackageReadFailure }
  | { status: "prepared" | "already_prepared"; record: CorePackagePreparationRecord };
export type CorePackagePreparationRead = CorePackagePreparationUnavailable
  | { status: "recorded"; record: CorePackagePreparationRecord };

export interface CorePackagePreparationMaterialsSource {
  /** 同一固定组合的原平台迁移、实际 Core 与所选能力完整包，所选新包由应用替换。 */
  read(): Promise<{
    base: z.infer<typeof CoreDeploymentLockSchema>;
    platform: readonly { name: string; sql: Uint8Array }[];
    cores: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>;
    dataCapabilities?: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>;
  } | undefined>;
}
export interface CorePackagePreparationBundle {
  plan: CorePackagePreparationPlan;
  sha256: string;
  artifact: CorePackageArtifact;
  files: ReadonlyMap<string, Uint8Array>;
}
export interface CorePackagePreparationStore {
  prepare(bundle: CorePackagePreparationBundle): CorePackagePreparationResult;
  read(sha256: string): CorePackagePreparationRead;
}
export interface CorePackagePreparationApplication {
  preview(input: unknown): Promise<CorePackagePreparationPreview>;
  prepare(input: unknown): Promise<CorePackagePreparationResult>;
  receipt(input: unknown): Promise<CorePackagePreparationRead>;
}
/** 仅供服务端原部署器在真正派发前调用；不是浏览器命令、持久授权或新的部署执行器。 */
export interface CorePackageDeploymentSourceGuard {
  withAccess<T>(sha256: string, dispatch: (record: CorePackagePreparationRecord) => Promise<T>): Promise<T>;
}
export { CORE_PACKAGE_PREPARATION_HTTP } from "./protocol";
