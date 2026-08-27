import type {
  OfficialCalendarSource,
  OfficialCalendarSourceVersion,
  OfficialCalendarSourceVersionSummary,
  RegisterOfficialCalendarSourceVersionRequest,
  SaveOfficialCalendarSourceRequest
} from "@store-rental/shared";
import { request } from "./http";

/**
 * 公共官方日历来源注册表（需求 4.5.2/4.5.8）。**仅 SaaS 平台管理员**可用：
 * 官方节假日数据是跨租户的公共基础来源，租户经营空间只能引用某个来源版本
 * 生成自己的年度草稿，再由有权限的空间人员确认发布。
 */
export const officialCalendarApi = {
  sources: () => request<OfficialCalendarSource[]>("/platform/official-calendars"),
  saveSource: (data: SaveOfficialCalendarSourceRequest) =>
    request<OfficialCalendarSource>(
      data.id ? `/platform/official-calendars/${data.id}` : "/platform/official-calendars",
      { method: data.id ? "put" : "post", data }
    ),
  versions: (sourceId: string, year?: number) =>
    request<OfficialCalendarSourceVersionSummary[]>(
      `/platform/official-calendars/${sourceId}/versions${year ? `?year=${year}` : ""}`
    ),
  registerVersion: (sourceId: string, data: RegisterOfficialCalendarSourceVersionRequest) =>
    request<OfficialCalendarSourceVersion>(`/platform/official-calendars/${sourceId}/versions`, {
      method: "post",
      data
    })
};
