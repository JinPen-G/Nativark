/** 原员工场景目录运输与结果校验。宿主供给原会话、服务器时钟、Native 校验和页面寿命，目录仅用于原入口观察。 */
import type { AiEntrySceneCatalogRequest } from "@rental-os/shared";
import type { RentalStaffClientPorts } from "./ports";
import type { RentalStaffEntryActionSession } from "./ai-entry-actions";

export interface RentalStaffSceneCatalogPorts extends RentalStaffClientPorts {
  contracts: Pick<
    typeof import("@rental-os/shared"),
    "AI_ENTRY_SCENE_CATALOG_HTTP" | "isAiEntrySceneCatalogRequest" | "isAiEntrySceneCatalogResponse"
  >;
  currentSession(): RentalStaffEntryActionSession | undefined;
  contextVersion(): number;
  serverNow(): number;
}

function withinWireLimit(value: unknown) {
  const text = JSON.stringify(value);
  if (typeof text !== "string" || text.length > 131072) return false;
  let bytes = 0;
  for (let index = 0; index < text.length && bytes <= 131072; index++) {
    const code = text.charCodeAt(index);
    if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes <= 131072;
}

export function createRentalStaffSceneCatalogApi(ports: RentalStaffSceneCatalogPorts) {
  const { request, currentSession, contextVersion, serverNow } = ports;
  const { AI_ENTRY_SCENE_CATALOG_HTTP, isAiEntrySceneCatalogRequest, isAiEntrySceneCatalogResponse } = ports.contracts;
  function captureContext(options: { current(): boolean }) {
    const session = currentSession(),
      version = contextVersion();
    if (!session?.accessToken || !session.currentWorkspaceId) return null;
    const token = session.accessToken,
      tenantId = session.tenant.tenantId,
      workspaceId = session.currentWorkspaceId;
    const identity = JSON.stringify(session.user);
    const current = () =>
      options.current() &&
      contextVersion() === version &&
      currentSession() === session &&
      session.accessToken === token &&
      session.tenant.tenantId === tenantId &&
      session.currentWorkspaceId === workspaceId &&
      JSON.stringify(session.user) === identity;
    return {
      current,
      async readPage(command: AiEntrySceneCatalogRequest) {
        if (
          !isAiEntrySceneCatalogRequest(command) ||
          !AI_ENTRY_SCENE_CATALOG_HTTP.staffBasePath.startsWith("staff/v1/")
        )
          throw Error("scene_directory_unavailable");
        const value: unknown = await request(
          `/${AI_ENTRY_SCENE_CATALOG_HTTP.staffBasePath.slice("staff/v1/".length)}/${AI_ENTRY_SCENE_CATALOG_HTTP.read}`,
          { method: "POST", data: command, timeoutMs: 15000, replayAfterRefresh: false },
        );
        if (!current()) return;
        if (
          !withinWireLimit(value) ||
          !isAiEntrySceneCatalogResponse(value) ||
          value.surface !== "staff_miniprogram" ||
          value.audience !== "staff" ||
          value.scope.kind !== "workspace" ||
          value.scope.tenantId !== tenantId ||
          value.scope.workspaceId !== workspaceId
        )
          throw Error("scene_directory_unavailable");

        const now = serverNow(),
          remaining = Math.min(30000, Date.parse(value.expiresAt) - now);
        if (!(remaining > 0) || Date.parse(value.observedAt) > now) throw Error("scene_directory_expired");
        return { page: value, remaining };
      },
    };
  }
  return { captureContext };
}
