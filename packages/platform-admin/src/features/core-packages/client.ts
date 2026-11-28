/** Core 包管理复用宿主唯一认证客户端和会话代次，当前 SaaS 管理权在请求前后核对。
 * 发行保存与候选准备只派发一次，失应答由页面沿原引用或摘要读取结果。 */
import { CORE_PACKAGE_HTTP, CORE_PACKAGE_HTTP_BASE } from "@rental-os/platform-core-host/core-package-ports";
import type {
  CorePackageCatalogue, CorePackageDiscoveryRequest, CorePackageRepositoryRead, CorePackageRepositoryRequest
} from "@rental-os/platform-core-host/core-package-ports";
import { GitHubCoreDiscoveryQuerySchema, type GitHubCoreDiscoveryResult } from "@rental-os/core-contracts/github-discovery";
import {
  CORE_PACKAGE_SELECTION_HTTP, type CorePackageReleasePreviewRequest, type CorePackageReleasePreview,
  type CorePackageReleaseSelectRequest, type CorePackageReleaseSelectResult,
  type CorePackageReleaseReceiptRequest, type CorePackageReleaseReferenceRead
} from "@rental-os/platform-core-host/core-package-selection/protocol";
import {
  CORE_PACKAGE_PREPARATION_HTTP, type CorePackagePreparationRequest, type CorePackagePreparationPreview,
  type CorePackagePrepareRequest, type CorePackagePreparationResult,
  type CorePackagePreparationQuery, type CorePackagePreparationRead
} from "@rental-os/platform-core-host/core-package-preparation/protocol";
import { canManagePublicResource } from "../../application-access";
import { CORE_PACKAGE_SOURCE_HTTP, type CorePackageSourceSettings, type CorePackageSourceSettingsRequest
} from "@rental-os/platform-core-host/core-package-source-protocol";
import type { AdminRequestOptions, AdminRuntime } from "../../runtime";

export type CorePackagesApi = ReturnType<typeof createCorePackagesApi>;

export function createCorePackagesApi(runtime: AdminRuntime) {
  function allowed() {
    const session = runtime.getSession();
    return session.sessionVerified && canManagePublicResource(session.user, "saas", "system:tenant:manage");
  }
  async function send<Output>(route: { method: "GET" | "POST"; path: string }, signal: AbortSignal,
    data?: unknown, options: Pick<AdminRequestOptions, "timeout" | "retryAuthentication"> = {}): Promise<Output> {
    const epoch = runtime.currentSessionEpoch(), active = AbortSignal.any([signal, runtime.currentSessionSignal()]);
    if (active.aborted || !allowed()) throw new DOMException("当前 Core 包管理请求已失效", "AbortError");
    const result = await runtime.request<Output>(`/${CORE_PACKAGE_HTTP_BASE}/${route.path}`, {
      method: route.method === "GET" ? "get" : "post", data, signal: active, timeout: 120_000, ...options
    });
    if (active.aborted || runtime.currentSessionEpoch() !== epoch || !allowed())
      throw new DOMException("Core 包管理响应不能写入变化后的会话", "AbortError");
    return result;
  }
  return {
    privateSource: (signal: AbortSignal) => send<CorePackageSourceSettings>(CORE_PACKAGE_SOURCE_HTTP.read, signal),
    savePrivateSource: (input: CorePackageSourceSettingsRequest, signal: AbortSignal) =>
      send<CorePackageSourceSettings>(CORE_PACKAGE_SOURCE_HTTP.save, signal, input, { retryAuthentication: false }),
    catalogue: (signal: AbortSignal) => send<CorePackageCatalogue>(CORE_PACKAGE_HTTP.catalogue, signal),
    discover: (input: CorePackageDiscoveryRequest, signal: AbortSignal) => send<GitHubCoreDiscoveryResult>(CORE_PACKAGE_HTTP.discover, signal,
      { query: GitHubCoreDiscoveryQuerySchema.parse(input.query), refresh: input.refresh ?? false }),
    repository: (input: CorePackageRepositoryRequest, signal: AbortSignal) => send<CorePackageRepositoryRead>(CORE_PACKAGE_HTTP.repository, signal,
      { repository: input.repository, includeReleases: input.includeReleases ?? false }),
    previewRelease: (input: CorePackageReleasePreviewRequest, signal: AbortSignal) =>
      send<CorePackageReleasePreview>(CORE_PACKAGE_SELECTION_HTTP.preview, signal, input),
    selectRelease: (input: CorePackageReleaseSelectRequest, signal: AbortSignal) =>
      send<CorePackageReleaseSelectResult>(CORE_PACKAGE_SELECTION_HTTP.select, signal, input, { retryAuthentication: false }),
    releaseReceipt: (input: CorePackageReleaseReceiptRequest, signal: AbortSignal) =>
      send<CorePackageReleaseReferenceRead>(CORE_PACKAGE_SELECTION_HTTP.receipt, signal, input),
    previewPreparation: (input: CorePackagePreparationRequest, signal: AbortSignal) =>
      send<CorePackagePreparationPreview>(CORE_PACKAGE_PREPARATION_HTTP.preview, signal, input, { timeout: 240_000 }),
    prepare: (input: CorePackagePrepareRequest, signal: AbortSignal) =>
      send<CorePackagePreparationResult>(CORE_PACKAGE_PREPARATION_HTTP.prepare, signal, input,
        { timeout: 240_000, retryAuthentication: false }),
    preparationReceipt: (input: CorePackagePreparationQuery, signal: AbortSignal) =>
      send<CorePackagePreparationRead>(CORE_PACKAGE_PREPARATION_HTTP.receipt, signal, input)
  };
}
