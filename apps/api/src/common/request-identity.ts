import { AsyncLocalStorage } from "node:async_hooks";
import { ForbiddenException } from "@nestjs/common";

export interface RequestIdentity {
  tenantId: string;
  userId: string;
  /** 原认证分面，区分运营账号与客户；不由请求体/模型推断。 */
  audience?: 'operator' | 'staff' | 'client';
  /** Signed access-token evidence captured by Auth / Guard; never read from a body or URL. */
  accessSession?: { sessionId: string; expiresAt: number };
  /** 当前有效操作权限，仅由 Auth / Guard 解析；调用方的 owner 不是授权。 */
  permissions?: readonly string[];
  isPlatformAdmin?: boolean;
  /** 办理凭证只用于与订单服务端保存的随机令牌比较，不授予权限。 */
  operationToken?: string;
  isSaasAdmin: boolean;
  /**
   * SPACE-02：当前经营空间。只由认证守卫从**会话**写入，
   * 绝不接受客户端请求体或查询参数里的 workspaceId。
   *
   * 可选：平台管理租户的账号没有经营空间成员关系，其请求合法地没有当前空间；
   * 经营接口对此 fail-closed（见 requireRequestWorkspaceId）。
   */
  workspaceId?: string;
  /** 当前空间成员的有效业务数据范围；仅由认证守卫从会话解析后写入。 */
  dataScope?: "all" | "organization" | "store" | "own";
  organizationId?: string;
  /** 履约地点范围应用于所有运营端经营 API，不因客户端是后台还是员工端而变化。 */
  locationScope?: { mode: "all" | "selected"; locationIds: string[] };
  /** 仅由员工 API 路由中间件 + 已验证 staff 会话写入，禁止通过请求参数设定。 */
  staffApi?: boolean;
  /** 旧字段只为迁移兼容保留；新代码读 locationScope。 */
  staffLocationScope?: { mode: "all" | "selected"; locationIds: string[] };
}

// 存储类型允许字段缺失：中间件先建立空上下文，守卫认证后才补全，
// 类型上必须能表达“尚未认证”，避免依赖类型断言掩盖未认证状态。
type RequestIdentityStore = Partial<RequestIdentity>;

const requestIdentityStorage = new AsyncLocalStorage<RequestIdentityStore>();

// 请求入口中间件：用 ALS.run 建立贯穿整条请求链的上下文。
// 守卫中的 enterWith 在部分执行链上不会传播到 controller，曾导致仓储层
// 静默回退演示租户，形成跨租户数据泄露；此处是根因修复。
export function requestIdentityMiddleware(_req: unknown, _res: unknown, next: () => void) {
  requestIdentityStorage.run({}, next);
}

export function enterRequestIdentity(identity: RequestIdentity) {
  const store = requestIdentityStorage.getStore();
  if (store) {
    Object.assign(store, identity);
    return;
  }
  requestIdentityStorage.enterWith(identity);
}

export function getRequestIdentity(): RequestIdentityStore | undefined {
  return requestIdentityStorage.getStore();
}

// 测试、Seed 和后台任务显式建立租户上下文的入口，等价于请求中间件建立的存储。
export function runWithRequestIdentity<T>(identity: RequestIdentityStore, fn: () => T): T {
  return requestIdentityStorage.run({ ...identity }, fn);
}

// 可选读取：调用方需要自行处理未认证（undefined）的情况。
export function getRequestTenantId(): string | undefined {
  return requestIdentityStorage.getStore()?.tenantId;
}

// fail-closed：租户业务仓储的唯一取值入口。缺少已验证租户身份时直接拒绝，
// 禁止任何默认租户回退。
export function requireRequestTenantId(): string {
  const tenantId = requestIdentityStorage.getStore()?.tenantId;
  if (!tenantId) {
    throw new ForbiddenException("缺少已验证的租户身份，拒绝访问");
  }
  return tenantId;
}

// 可选读取：调用方需要自行处理"当前会话没有经营空间"的情况。
export function getRequestWorkspaceId(): string | undefined {
  return requestIdentityStorage.getStore()?.workspaceId;
}

export function getRequestLocationIds(): string[] | undefined {
  const identity = requestIdentityStorage.getStore();
  const scope = identity?.locationScope ?? (identity?.staffApi ? identity.staffLocationScope : undefined);
  if (!scope || scope.mode === "all") return undefined;
  return scope.mode === "selected" ? scope.locationIds : [];
}

/** 兼容旧调用点；地点授权本质上属于当前空间成员，不只属于员工小程序。 */
export function getRequestStaffLocationIds(): string[] | undefined {
  return getRequestLocationIds();
}

export function getRequestDataScope(): RequestIdentity["dataScope"] {
  return requestIdentityStorage.getStore()?.dataScope;
}

export function getRequestUserId(): string | undefined {
  return requestIdentityStorage.getStore()?.userId;
}

// fail-closed：账户级自助设置的唯一取值入口。缺少已验证账号身份时直接拒绝，不做任何回退。
export function requireRequestUserId(): string {
  const userId = requestIdentityStorage.getStore()?.userId;
  if (!userId) {
    throw new ForbiddenException("缺少已验证的账号身份，拒绝访问");
  }
  return userId;
}

export function getRequestOrganizationId(): string | undefined {
  return requestIdentityStorage.getStore()?.organizationId;
}

/** 服务端地点过滤条件；selected 空集合对应不可能命中的 sentinel，保持 fail-closed。 */
export function staffLocationWhere(field = "locationId") {
  const ids = getRequestStaffLocationIds();
  if (ids === undefined) return {};
  return { [field]: { in: ids.length ? ids : ["__no_authorized_location__"] } };
}

/**
 * SPACE-02 fail-closed：经营业务的经营空间唯一取值入口。
 *
 * 与租户同理，这里绝不提供"默认空间"回退。默认空间只是**升级兼容层**，
 * 由登录时的成员关系解析决定；如果在这里回退到默认空间，
 * 一个本该被拒绝的无空间会话就会静默拿到某个空间的数据——
 * 那正是 P0-01（默认租户回退导致跨租户泄露）的同型缺陷。
 */
export function requireRequestWorkspaceId(): string {
  const workspaceId = requestIdentityStorage.getStore()?.workspaceId;
  if (!workspaceId) {
    throw new ForbiddenException("缺少已验证的经营空间，拒绝访问");
  }
  return workspaceId;
}
