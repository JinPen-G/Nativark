/** 发行选择复用正式 GitHub pin，引用绑定完整发行指纹，保存结果可按原标识回读。 */
import { z } from "zod";
import {
  GitHubCoreReleasePinSchema, GitHubCoreReleaseSelectionSchema,
  type GitHubCoreReleasePin, type GitHubCoreReleaseSelection
} from "@rental-os/core-contracts/github";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import type {
  CorePackageReleasePreview, CorePackageReleaseReferenceRead, CorePackageReleaseSelectResult
} from "./protocol";

export const CorePackageReleaseReferenceSchema = z.string().regex(/^github-[a-f0-9]{64}$(?![\s\S])/);
export const CorePackageReleasePreviewRequestSchema = GitHubCoreReleaseSelectionSchema;
export const CorePackageReleaseSelectRequestSchema = z.object({ release: GitHubCoreReleasePinSchema }).strict();
export const CorePackageReleaseReceiptRequestSchema = z.object({ reference: CorePackageReleaseReferenceSchema }).strict();

export function corePackageReleaseReference(release: GitHubCoreReleasePin): string {
  return `github-${requestFingerprint(release)}`;
}

export const CorePackageReleaseReferenceRecordSchema = z.object({
  format: z.literal("core-release-reference-1"),
  reference: CorePackageReleaseReferenceSchema,
  selectedAt: z.string().datetime(),
  release: GitHubCoreReleasePinSchema,
  review: z.literal("unreviewed"),
  package: z.literal("unchecked")
}).strict().refine(record => record.reference === corePackageReleaseReference(record.release), "原引用须对应完整发行指纹");

export interface CorePackageReleaseSource {
  inspect(selection: GitHubCoreReleaseSelection): Promise<GitHubCoreReleasePin>;
}
export interface CorePackageReleaseReferenceStore {
  /** absent 只表示原目录内可核定地缺少记录，读取失败须返回 unavailable 或抛出。 */
  read(reference: string): CorePackageReleaseReferenceRead;
  /** 同一引用只能保存同一 pin，失应答沿原引用读取，禁止覆盖原记录。 */
  select(release: GitHubCoreReleasePin): CorePackageReleaseSelectResult;
}
export interface CorePackageReleaseApplication {
  preview(input: unknown): Promise<CorePackageReleasePreview>;
  select(input: unknown): Promise<CorePackageReleaseSelectResult>;
  receipt(input: unknown): Promise<CorePackageReleaseReferenceRead>;
}
