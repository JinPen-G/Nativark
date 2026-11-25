/** 原客户场景目录运输与结果校验。宿主供给原会话、服务器时钟、Native 校验和页面寿命，目录仅用于原入口观察。 */
import type { AiEntrySceneCatalogRequest, AiEntrySceneCatalogResponse } from "@rental-os/shared";
import type { RentalMiniProgramClientPorts } from "./ports";
import type { RentalMiniProgramEntryActionSession } from "./ai-entry-actions";

export interface RentalMiniProgramSceneCatalogPorts extends RentalMiniProgramClientPorts {
  contracts: Pick<
    typeof import("@rental-os/shared"),
    "AI_ENTRY_SCENE_CATALOG_HTTP" | "isAiEntrySceneCatalogRequest" | "isAiEntrySceneCatalogResponse"
  >;
  currentSession(): RentalMiniProgramEntryActionSession | undefined;
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

export function createRentalMiniProgramSceneCatalogApi(ports: RentalMiniProgramSceneCatalogPorts) {
  const { request, currentSession, contextVersion, serverNow } = ports;
  const { AI_ENTRY_SCENE_CATALOG_HTTP, isAiEntrySceneCatalogRequest, isAiEntrySceneCatalogResponse } = ports.contracts;
  function captureContext(options: { serviceCode: string; current(): boolean }) {
    const session = currentSession(),
      version = contextVersion(),
      service = options.serviceCode;
    if (!session?.accessToken || !service || session.serviceCode !== service) return null;
    const token = session.accessToken,
      identity = JSON.stringify(session.customer);
    const current = () =>
      options.current() &&
      contextVersion() === version &&
      currentSession() === session &&
      session.accessToken === token &&
      JSON.stringify(session.customer) === identity &&
      session.serviceCode === service;
    return {
      current,
      async readPage(command: AiEntrySceneCatalogRequest, previousScope?: AiEntrySceneCatalogResponse["scope"]) {
        if (!isAiEntrySceneCatalogRequest(command)) throw Error("scene_directory_unavailable");
        const value: unknown = await request(
          `/api/${AI_ENTRY_SCENE_CATALOG_HTTP.wechatBasePath}/${AI_ENTRY_SCENE_CATALOG_HTTP.read}`,
          { method: "POST", data: command, timeoutMs: 15000, replayAfterRefresh: false },
        );
        if (!current()) return;
        if (
          !withinWireLimit(value) ||
          !isAiEntrySceneCatalogResponse(value) ||
          value.surface !== "client_miniprogram" ||
          value.audience !== "customer" ||
          value.scope.kind !== "workspace"
        )
          throw Error("scene_directory_unavailable");
        if (previousScope && JSON.stringify(value.scope) !== JSON.stringify(previousScope))
          throw Error("scene_directory_changed");
        const now = serverNow(),
          remaining = Math.min(30000, Date.parse(value.expiresAt) - now);
        if (!(remaining > 0) || Date.parse(value.observedAt) > now) throw Error("scene_directory_expired");
        return { page: value, remaining };
      },
    };
  }
  return { captureContext };
}
