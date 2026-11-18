/** 原工具路径及权限，SaaS账号没有租户工具访问权。服务端复验原当前会话及租户。 */
export const PLATFORM_TOOLS_HTTP_OPERATIONS = [
  { method: "GET", path: "/platform/dictionaries", id: "listDictionaries", summary: "读取当前租户字典",
    access: "tenant", permission: "system:dictionary:manage", response: "PlatformTools.Dictionaries" },
  { method: "PUT", path: "/platform/dictionaries/:code", id: "saveDictionaryGroup", summary: "维护当前租户字典",
    access: "tenant", permission: "system:dictionary:manage", request: "PlatformTools.SaveDictionary", response: "PlatformTools.Dictionary" },
  { method: "GET", path: "/platform/number-rules", id: "listNumberRules", summary: "读取当前租户编号规则",
    access: "tenant", permission: "system:number-rule:manage", response: "PlatformTools.NumberRules" },
  { method: "PUT", path: "/platform/number-rules/:code", id: "saveNumberRule", summary: "维护当前租户编号规则",
    access: "tenant", permission: "system:number-rule:manage", request: "PlatformTools.SaveNumberRule", response: "PlatformTools.NumberRule" },
  { method: "POST", path: "/platform/number-rules/generate", id: "generateNumber", summary: "推进当前租户流水并生成编号",
    access: "tenant", permission: "system:number-rule:manage", request: "PlatformTools.GenerateNumber", response: "PlatformTools.GeneratedNumber" }
] as const;
