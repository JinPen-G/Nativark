/** Rental 原登录、空间上下文与租户摘要合同；公共身份字段复用平台正式合同。 */
import type { TenantIdentity, PlatformTenantSummary, AuthUser } from "@rental-os/platform-contracts";
import type { RentalCategoryCode, RentalCapability, BusinessWorkspace, BusinessWorkspaceRunMode } from "./contracts";

export interface TenantContext extends TenantIdentity {
  categoryCode?: RentalCategoryCode;
  categoryName?: string;
  capabilities?: RentalCapability[];
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tenant: TenantContext;
  user: AuthUser;
  /** 新租户初始化管理员首次登录且已进入品类空间时，前端应打开开业配置。 */
  needsTenantOnboarding?: boolean;
  /**
   * SPACE-02：该账号可进入的经营空间（成员关系启用且空间启用）。
   * 切换空间时 refreshToken 不变，因此切换响应里它为空串。
   */
  workspaces?: BusinessWorkspace[];
  /** 当前经营空间。平台管理租户没有经营空间时为空。 */
  currentWorkspaceId?: string;
}

export interface SwitchWorkspaceRequest {
  workspaceId: string;
}

export interface SessionContextResponse {
  tenant: TenantContext;
  user: AuthUser;
  /**
   * SPACE-05：可进入的经营空间与当前空间。
   *
   * 必须由 session-context 返回，否则刷新页面后前端只剩 token，
   * 切换器无从知道「当前在哪个空间、还能去哪些空间」，只能退化成重新登录。
   */
  workspaces?: BusinessWorkspace[];
  currentWorkspaceId?: string;
  /** STAFF-BE-01：员工会话的服务端地点授权；缺省视为全部地点，仅用于兼容旧成员。 */
  locationScope?: { mode: "all" | "selected"; locationIds: string[] };
  /**
   * CORE-EXT-02C：本空间**缺失的首期必选能力**，与生产就绪标记配套。
   *
   * 两者与 `tenant.capabilities` 是不同的东西，必须分开表示（验收明确要求
   * 「空间『可访问』与『品类能力已达到生产经营条件』分开表示」）：
   * `tenant.capabilities` 决定**入口可见性**，而这两个字段决定管理端要不要显示
   * 「该空间尚未达到生产经营条件」。开发/演示空间可以继续验证通用 Core，
   * 但不得因为能进得去就被当成已具备完整品类能力。
   */
  missingRequiredCapabilities?: RentalCapability[];
  capabilityProductionReady?: boolean;
  /**
   * 当前空间的运行模式。前端据此明确标注「非生产」，而不是只靠 productionReady 猜。
   * 服务端的经营门禁也以它为准（`production` 且缺必选能力时拒绝业务写入）。
   */
  workspaceRunMode?: BusinessWorkspaceRunMode;
}

export interface TenantSummary extends PlatformTenantSummary {
  categoryCode?: RentalCategoryCode;
  categoryName?: string;
  capabilities?: RentalCapability[];
  /** Rental经营空间是品类事实源，业务汇总由Rental适配提供。 */
  workspaceCount?: number;
  workspaceCategoryCodes?: RentalCategoryCode[];
  orderCount?: number;
}
