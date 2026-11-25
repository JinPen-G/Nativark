/** 原筛选预设是已登录账号的租户级自助偏好。SaaS 身份由服务沿原 Guard 条件拒绝。 */
export const PLATFORM_FILTER_PRESET_HTTP_OPERATIONS = [
  { method: "GET", path: "/platform/filter-presets/scopes", id: "filterPresetScopes", summary: "读取当前宿主登记的筛选预设范围",
    access: "self", response: "PlatformTools.FilterPresetScopes" },
  { method: "GET", path: "/platform/filter-presets", id: "filterPresets", summary: "读取本租户筛选预设",
    access: "self", query: ["tenantId", "scopeKey"], response: "PlatformTools.FilterPresets" },
  { method: "POST", path: "/platform/filter-presets", id: "saveFilterPreset", summary: "保存本租户筛选预设",
    access: "self", request: "PlatformTools.SaveFilterPreset", response: "PlatformTools.FilterPreset" },
  { method: "PUT", path: "/platform/filter-presets/:id/default", id: "setDefaultFilterPreset", summary: "设置同范围默认筛选预设",
    access: "self", request: "PlatformTools.SetFilterPresetDefault", response: "PlatformTools.FilterPreset" },
  { method: "DELETE", path: "/platform/filter-presets/:id", id: "deleteFilterPreset", summary: "删除本租户筛选预设",
    access: "self", query: ["operator"], response: "PlatformTools.DeletedFilterPreset" }
] as const;
