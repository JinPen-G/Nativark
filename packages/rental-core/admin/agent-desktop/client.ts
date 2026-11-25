/** 原桌面政策与只读目录运输。凭据由原 Runtime 持有，保存只派发一次并保留原操作键。 */
import { RENTAL_DESKTOP_BUSINESS_HTTP, parseRentalDesktopBusinessReadRequest, parseRentalDesktopCatalogResult,
  parseRentalDesktopCatalogSourcesResult, parseRentalDesktopBusinessPolicyRead, parseRentalDesktopPolicySave,
  parseRentalDesktopPolicySaved, parseRentalDesktopPolicyObservation, parseRentalDesktopCatalogCheckResult,
  type RentalDesktopPolicySave, type RentalDesktopBusinessReadRequest } from "@rental-os/shared/agent-desktop";
import type { AdminRuntime } from "@rental-os/platform-admin/runtime";

const path = (action: "policy" | "savePolicy" | "policyOperation") =>
  `/${RENTAL_DESKTOP_BUSINESS_HTTP.basePath}/${RENTAL_DESKTOP_BUSINESS_HTTP[action]}`;

export function createDesktopBusinessApi(request: AdminRuntime["request"]) {
  const desktopBusinessPolicyApi = Object.freeze({
    read: async (signal: AbortSignal) => parseRentalDesktopBusinessPolicyRead(await request<unknown>(path("policy"),
      { method: "post", data: {}, signal, retryAuthentication: false })),
    save: async (value: RentalDesktopPolicySave, signal: AbortSignal) => parseRentalDesktopPolicySaved(await request<unknown>(path("savePolicy"),
      { method: "post", data: parseRentalDesktopPolicySave(value), signal, retryAuthentication: false })),
    operation: async (operationKey: string, signal: AbortSignal) => parseRentalDesktopPolicyObservation(await request<unknown>(path("policyOperation"),
      { method: "post", data: { operationKey }, signal, retryAuthentication: false })),
  });

  async function readDesktopBusinessCatalog(value: RentalDesktopBusinessReadRequest, signal: AbortSignal) {
    const input = parseRentalDesktopBusinessReadRequest(value);
    try {
      const action = !("kind" in input) ? RENTAL_DESKTOP_BUSINESS_HTTP.catalog
        : input.kind === "catalog_sources" ? RENTAL_DESKTOP_BUSINESS_HTTP.catalogSources : RENTAL_DESKTOP_BUSINESS_HTTP.catalogCheck;
      const result = await request<unknown>(`/${RENTAL_DESKTOP_BUSINESS_HTTP.basePath}/${action}`,
        { method: "post", data: input, signal, retryAuthentication: false });
      return !("kind" in input) ? parseRentalDesktopCatalogResult(result)
        : input.kind === "catalog_sources" ? parseRentalDesktopCatalogSourcesResult(result) : parseRentalDesktopCatalogCheckResult(result);
    } catch (error) {
      const code = error && typeof error === "object" && "response" in error
        ? (error.response as { data?: { code?: unknown } } | undefined)?.data?.code : undefined;
      if (typeof code === "string" && ["AI_ACCESS_DENIED", "AI_SCOPE_CHANGED", "AI_INVALID_INPUT", "AI_RESOURCE_UNAVAILABLE"].includes(code)) throw new Error(code);
      throw new Error("AI_RESOURCE_UNAVAILABLE");
    }
  }

  return { desktopBusinessPolicyApi, readDesktopBusinessCatalog };
}
