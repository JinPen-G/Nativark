/**
 * 客户/员工各端的显式贡献与请求寿命；主体来自原 Auth，业务来自独立 Core。
 * 本合同不保存令牌，不将界面准入、路由参数或扫码内容变成服务端授权。
 */
import type { CorePrincipal } from "@rental-os/core-contracts";

export type ClientAudience = Exclude<CorePrincipal["audience"], "operator">;
export type ClientSurface = "customer-web" | "staff-web" | "wechat-customer" | "wechat-staff";
export type ClientLocale = "zh-CN" | "en-US";
export type ClientText = Readonly<Record<ClientLocale, string>>;

export interface ClientScope {
  readonly principal: CorePrincipal & { readonly audience: ClientAudience };
  /** 原会话采用代次，不是 accessToken；重新登录同一账号也必须变化。 */
  readonly sessionRevision: string;
  /** 原当前权限/数据范围观察的修订或指纹，撤权时必须变化。 */
  readonly authorizationRevision: string;
  readonly workspaceId?: string;
  /** 只接受原服务核定且属于当前权限集合的地点，不从 URL 或缓存自行采用。 */
  readonly locationId?: string;
}

export type ClientSession =
  | { readonly status: "loading" | "anonymous" | "unavailable" }
  | { readonly status: "authenticated"; readonly scope: ClientScope; readonly displayName: string;
      readonly tenantName: string; readonly workspaceName?: string; readonly locationName?: string };

/** 浏览器和微信共用取消合同；微信不依赖浏览器 AbortController 全局。 */
export interface ClientLifetime {
  current(): boolean;
  assertCurrent(): void;
  onCancel(listener: () => void): () => void;
}

export interface ClientScopeChoice { readonly id: string; readonly label: string }
export interface ClientLoginField {
  readonly name: string;
  readonly label: ClientText;
  readonly kind: "text" | "password";
  readonly autocomplete?: "username" | "current-password" | "organization";
}

export interface ClientSessionPort {
  getSnapshot(): ClientSession;
  subscribe(listener: () => void): () => void;
  /** 始终由原会话实现复核缓存、受众、租户、权限与数据范围。 */
  refresh(lifetime: ClientLifetime): Promise<void>;
  readonly loginFields: readonly ClientLoginField[];
  /** 原适配必须在采用会话前检查 lifetime，旧登录不得覆盖新会话。 */
  signIn(fields: Readonly<Record<string, string>>, lifetime: ClientLifetime): Promise<void>;
  /** 同步清理原私有会话和缓存，再沿原凭据撤销；旧撤销不得清除新登录。 */
  signOut(): Promise<void>;
  scopeChoices?(lifetime: ClientLifetime): Promise<readonly ClientScopeChoice[]>;
  /** id 仅定位候选；原服务复权成功后才采用新范围。 */
  selectScope?(id: string, lifetime: ClientLifetime): Promise<void>;
}

export type ClientAccess = { readonly status: "allowed" }
  | { readonly status: "denied" | "disabled" | "unavailable" };
export type ClientPurpose = "page" | "action" | "original_receipt";
export interface ClientAccessRequest {
  readonly coreId: string;
  readonly routeId: string;
  readonly actionId?: string;
  readonly purpose: ClientPurpose;
  readonly scope: ClientScope;
  /** 定位仍是不可信输入；原权威据此核对象、版本和字段范围。 */
  readonly request?: ClientPageRequest;
  readonly reference?: ClientOperationReference;
}
export interface ClientAccessPort {
  /** 每次从所属权威取得当前观察；不能按前端菜单、声明权限或旧缓存恒真放行。 */
  authorize(request: ClientAccessRequest, lifetime: ClientLifetime): Promise<ClientAccess>;
}

export interface ClientDestination {
  readonly routeId: string;
  readonly params?: Readonly<Record<string, string>>;
}
export interface ClientPageRequest {
  readonly params: Readonly<Record<string, string>>;
  readonly search: string;
  /** 原页面返回的安全版本/预览定位；不是权限或批准，服务端仍校验当前事实。 */
  readonly actionBasis?: string;
}
export interface ClientItem {
  readonly id: string;
  readonly title: string;
  readonly detail?: string;
  readonly status?: string;
  readonly destination?: ClientDestination;
}
export interface ClientPageData {
  readonly title: string;
  readonly description?: string;
  readonly items: readonly ClientItem[];
  readonly emptyText: string;
  readonly actionBasis?: string;
}

/** 只持久化原服务生成的安全定位；不保存密码、令牌或完整业务正文。 */
export interface ClientOperationReference {
  readonly operationKey: string;
  readonly coreId: string;
  readonly routeId: string;
  readonly actionId: string;
  readonly targetId: string;
}
export type ClientOperationResult =
  | { readonly status: "recorded"; readonly reference: ClientOperationReference; readonly message: string }
  | { readonly status: "rejected"; readonly reference: ClientOperationReference; readonly message: string }
  | { readonly status: "unknown"; readonly reference: ClientOperationReference };
export interface ClientActionField {
  readonly name: string;
  readonly label: ClientText;
  readonly kind: "text" | "textarea";
  readonly required?: boolean;
  readonly maxLength?: number;
}
export interface ClientAction {
  readonly id: string;
  readonly label: ClientText;
  readonly fields?: readonly ClientActionField[];
  /** 捕获原目标/版本/输入，由业务适配分配原键。准备不执行正式业务。 */
  prepare(request: ClientPageRequest, values: Readonly<Record<string, string>>, scope: ClientScope, lifetime: ClientLifetime): Promise<{
    readonly reference: ClientOperationReference;
    execute(lifetime: ClientLifetime): Promise<ClientOperationResult>;
  }>;
  readReceipt(reference: ClientOperationReference, scope: ClientScope, lifetime: ClientLifetime): Promise<ClientOperationResult>;
}
export interface ClientRoute {
  readonly id: string;
  readonly label: ClientText;
  readonly searchable?: boolean;
  /** 仅显式 true 进入导航；详情页由登记目标及参数进入。 */
  readonly navigation?: boolean;
  load(request: ClientPageRequest, scope: ClientScope, lifetime: ClientLifetime): Promise<ClientPageData>;
  readonly actions?: readonly ClientAction[];
}
export interface ClientContribution {
  readonly coreId: string;
  readonly version: string;
  readonly audience: ClientAudience;
  readonly routes: readonly ClientRoute[];
  /** 返回登记路由及参数；扫码原文不能直接作为导航 URL 或业务授权。 */
  scan?(value: string, scope: ClientScope, lifetime: ClientLifetime): Promise<ClientDestination | undefined>;
}
export interface ClientOperationStore {
  /** owner 仅分区缓存；读取仍须复核当前服务端原收据权限。 */
  read(owner: ClientScope): Promise<readonly ClientOperationReference[]>;
  save(owner: ClientScope, reference: ClientOperationReference): Promise<void>;
  remove(owner: ClientScope, reference: ClientOperationReference): Promise<void>;
}

export class ClientError extends Error {
  constructor(readonly code: "stale" | "anonymous" | "denied" | "disabled" | "unavailable" | "route_missing" | "operation_pending") {
    super(code); this.name = "ClientError";
  }
}
export function clientAudience(surface: ClientSurface): ClientAudience {
  if (!["customer-web", "staff-web", "wechat-customer", "wechat-staff"].includes(surface)) throw new ClientError("unavailable");
  return surface === "customer-web" || surface === "wechat-customer" ? "client" : "staff";
}
