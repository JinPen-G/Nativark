/** 公共权限目录沿原system编码；Core权限由受控注册贡献，不从客户端字段自注册。 */
export const PLATFORM_PERMISSIONS = [
  { code: "system:tenant:manage", name: "租户管理", module: "SaaS平台" },
  { code: "system:tenant:bootstrap", name: "租户初始化", module: "SaaS平台" },
  { code: "system:user:manage", name: "账号管理", module: "系统设置" },
  { code: "system:role:manage", name: "角色权限", module: "系统设置" },
  { code: "system:integration:manage", name: "公共外观与集成设置", module: "系统设置" },
  { code: "system:params:manage", name: "公共参数与安全基线", module: "系统设置" },
  { code: "system:dictionary:manage", name: "数据字典", module: "系统设置" },
  { code: "system:number-rule:manage", name: "编号规则", module: "系统设置" },
  { code: "system:tenant:subscription:manage", name: "租户订阅办理", module: "SaaS平台" },
  // 已有角色继续使用原订阅编码，公共能力迁移保持原授权记录。
  { code: "rental-os:subscription:view", name: "查看版本与订阅", module: "版本与订阅" },
  { code: "rental-os:subscription:manage", name: "申请升级与续费", module: "版本与订阅" },
] as const;

export const managesPlatformTenants = (user: { isSaasAdmin?: boolean; permissions: string[] }) =>
  user.isSaasAdmin === true && (user.permissions.includes("*") || user.permissions.includes("system:tenant:manage"));

export const managesTenant = (user: { isSaasAdmin?: boolean; isPlatformAdmin: boolean; dataScope: string; permissions: string[] }, permission: string) =>
  user.isSaasAdmin !== true && (user.isPlatformAdmin || user.dataScope === "all" && user.permissions.includes(permission));
