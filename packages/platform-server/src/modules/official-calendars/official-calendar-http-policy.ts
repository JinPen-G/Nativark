/** 原平台官方来源五个 HTTP 操作、三条路径；维护要求 SaaS 平台身份与原权限码。 */
export const OFFICIAL_CALENDAR_HTTP_OPERATIONS = [
  { method: "GET", path: "/platform/official-calendars", id: "listOfficialCalendarSources", summary: "读取公共官方日历来源",
    access: "saas", permission: "system:calendar-source:manage", response: "OfficialCalendar.Sources" },
  { method: "POST", path: "/platform/official-calendars", id: "createOfficialCalendarSource", summary: "登记公共官方日历来源",
    access: "saas", permission: "system:calendar-source:manage", request: "OfficialCalendar.SaveSource", response: "OfficialCalendar.Source" },
  { method: "PUT", path: "/platform/official-calendars/:id", id: "updateOfficialCalendarSource", summary: "维护公共官方日历来源主档",
    access: "saas", permission: "system:calendar-source:manage", request: "OfficialCalendar.SaveSource", response: "OfficialCalendar.Source" },
  { method: "GET", path: "/platform/official-calendars/:id/versions", id: "listOfficialCalendarSourceVersions", summary: "读取来源年度版本摘要",
    access: "saas", permission: "system:calendar-source:manage", query: ["year"], response: "OfficialCalendar.Versions" },
  { method: "POST", path: "/platform/official-calendars/:id/versions", id: "registerOfficialCalendarSourceVersion", summary: "追加公共来源的年度版本",
    access: "saas", permission: "system:calendar-source:manage", request: "OfficialCalendar.RegisterVersion", response: "OfficialCalendar.Version" }
] as const;
