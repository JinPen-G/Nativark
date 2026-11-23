/** 公共官方日历来源与追加版本沿唯一 SaaS 请求。写入单次派发，不发布租户空间日历。 */
import { useMemo } from "react";
import type { OfficialCalendarSource, OfficialCalendarSourceVersion, OfficialCalendarSourceVersionSummary,
  RegisterOfficialCalendarSourceVersionRequest, SaveOfficialCalendarSourceRequest } from "@rental-os/platform-contracts";
import type { AdminRuntime } from "../../runtime";
import { usePlatformPageRuntime } from "./page-runtime";

export function createOfficialCalendarApi(request: AdminRuntime["request"]) {
  return {
    sources: (signal?: AbortSignal) => request<OfficialCalendarSource[]>("/platform/official-calendars", { signal }),
    saveSource: (data: SaveOfficialCalendarSourceRequest) => request<OfficialCalendarSource>(
      data.id ? `/platform/official-calendars/${encodeURIComponent(data.id)}` : "/platform/official-calendars",
      { method: data.id ? "put" : "post", data, retryAuthentication: false }),
    versions: (sourceId: string, year?: number, signal?: AbortSignal) =>
      request<OfficialCalendarSourceVersionSummary[]>(
        `/platform/official-calendars/${encodeURIComponent(sourceId)}/versions${year ? `?year=${year}` : ""}`, { signal }),
    registerVersion: (sourceId: string, data: RegisterOfficialCalendarSourceVersionRequest) =>
      request<OfficialCalendarSourceVersion>(`/platform/official-calendars/${encodeURIComponent(sourceId)}/versions`,
        { method: "post", data, retryAuthentication: false })
  };
}

export function useOfficialCalendarApi() {
  const { request, epoch, isCurrent } = usePlatformPageRuntime("saas", "system:calendar-source:manage");
  return { api: useMemo(() => createOfficialCalendarApi(request), [request]), epoch, isCurrent };
}
