/** 浏览器仅消费固定发行资料和原引用结果，运行时常量保持无 Node 依赖。 */
import type { GitHubCoreReleasePin, GitHubCoreReleaseSelection } from "@rental-os/core-contracts/github";
import type { CorePackageReadFailure } from "../core-package-ports";

export type CorePackageReleasePreviewRequest = GitHubCoreReleaseSelection;
export interface CorePackageReleaseSelectRequest { release: GitHubCoreReleasePin }
export interface CorePackageReleaseReceiptRequest { reference: string }

export interface CorePackageReleaseReferenceRecord {
  format: "core-release-reference-1";
  reference: string;
  selectedAt: string;
  release: GitHubCoreReleasePin;
  review: "unreviewed";
  package: "unchecked";
}
export type CorePackageReleaseUnavailable = { status: "unavailable"; error: CorePackageReadFailure };
export type CorePackageReleasePreview = CorePackageReleaseUnavailable | {
  status: "inspected";
  reference: string;
  release: GitHubCoreReleasePin;
  checkedAt: string;
  review: "unreviewed";
  package: "unchecked";
};
export type CorePackageReleaseReferenceRead = CorePackageReleaseUnavailable
  | { status: "absent"; reference: string }
  | { status: "recorded"; record: CorePackageReleaseReferenceRecord };
export type CorePackageReleaseSelectResult = CorePackageReleaseUnavailable
  | { status: "unknown"; reference: string; error: CorePackageReadFailure }
  | { status: "selected" | "already_selected"; record: CorePackageReleaseReferenceRecord };

export const CORE_PACKAGE_SELECTION_HTTP = {
  preview: { method: "POST", path: "preview-release" },
  select: { method: "POST", path: "select-release" },
  receipt: { method: "POST", path: "release-reference" }
} as const;
