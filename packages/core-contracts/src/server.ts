/**
 * 已受控装配的 Core 服务端贡献；只暴露范围和生命周期接点，不统一业务命令。
 * 宿主负责身份、Core/成员授权和事务，Core 保留对象权限、业务规则及原收据。
 */
import type { CoreManifest } from "./manifest";
import type { CoreHostVersions, CoreCompatibilityIssue } from "./compatibility";
import { checkCoreCombination } from "./compatibility";
import type {
  CoreBinding, CoreOperationReference, CoreReadiness, CoreRemovalAssessment, CoreScopeReference
} from "./lifecycle";

/** 原认证服务给出的身份定位；这里没有权限数组，也不接受客户端自行构造作为认证。 */
export interface CorePrincipal {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly audience: "operator" | "staff" | "client";
}

/** Core 自行验证候选容器的归属和当前成员范围；没有容器的业务只使用租户范围。 */
export interface CoreScopeRequest {
  readonly principal: CorePrincipal;
  readonly scope: CoreScopeReference;
}
export type CoreScopeResolution =
  | { status: "resolved"; binding: CoreBinding }
  | { status: "denied" }
  | { status: "unbound" };

/**
 * 由宿主事务适配器在一次回调内发放，并在结束时作废的不可序列化句柄。
 * 私有适配只将它解析为本 Core 的受限仓储；类型标记本身不是运行时安全检查。
 */
declare const coreTransactionBrand: unique symbol;
export interface CoreTransaction { readonly [coreTransactionBrand]: true }

export interface CoreInitializationContext {
  readonly principal: CorePrincipal;
  /** 宿主为本次初始化固定的候选绑定；事务成功前不对外发布。 */
  readonly binding: CoreBinding;
  readonly operation: CoreOperationReference;
  readonly transaction: CoreTransaction;
}

export interface CoreInputSchema<T> { parse(input: unknown): T }
export interface CoreInitializer {
  /** 只在当前授权、原操作及候选绑定均已锁定的事务回调内调用。 */
  initialize(context: CoreInitializationContext, input: unknown): Promise<void>;
}

/** 初始化输入只在此边界解析一次，领域实现接收已验证的类型。 */
export function defineCoreInitializer<T>(
  schema: CoreInputSchema<T>,
  initialize: (context: CoreInitializationContext, input: T) => Promise<void>
): CoreInitializer {
  return { initialize: (context, input) => initialize(context, schema.parse(input)) };
}

export interface CoreServerContribution {
  readonly coreId: string;
  readonly implementationVersion: string;
  resolveScope(request: CoreScopeRequest): Promise<CoreScopeResolution>;
  readReadiness(binding: CoreBinding): Promise<CoreReadiness>;
  /** 不需业务初始事实的 Core 可以省略；授权和绑定仍由宿主真实持久化。 */
  readonly initialization?: CoreInitializer;
  /** 缺少检查器时，宿主不能据此批准移除代码或丢弃历史执行依赖。 */
  assessRemoval?(tenantId?: string): Promise<CoreRemovalAssessment>;
}

/**
 * 服务由可信组合文件直接 import 后提供，路径字符串不作为加载器输入。
 * HTTP/页面/AI/作业仍用各自适配，注册本贡献不执行这些入口或授予任何权限。
 */
export interface CoreServerRegistration {
  readonly manifest: CoreManifest;
  readonly server: CoreServerContribution;
}
export interface CoreRegistrationIssue {
  coreId: string;
  code: CoreCompatibilityIssue["code"] | "server_identity" | "server_version" | "server_contract";
  field: string;
  message: string;
}
export type CoreRegistrationResult =
  | { ok: true; registrations: ReadonlyMap<string, CoreServerRegistration> }
  | { ok: false; issues: CoreRegistrationIssue[] };

/**
 * 对已解析清单及真实服务对象作一次装配检查；空组合合法，失败不返回部分注册表。
 * 不调用生命周期函数，不从清单路径加载代码，不创建租户/成员授权。
 */
export function registerCoreServers(
  registrations: readonly CoreServerRegistration[], host: CoreHostVersions
): CoreRegistrationResult {
  const issues: CoreRegistrationIssue[] = checkCoreCombination(registrations.map(item => item.manifest), host).issues;
  for (const { manifest, server } of registrations) {
    const add = (code: CoreRegistrationIssue["code"], field: string, message: string) =>
      issues.push({ coreId: manifest.id, code, field, message });
    if (server === null || typeof server !== "object") {
      add("server_contract", "server", "须提供受控装配的服务端对象");
      continue;
    }
    if (server.coreId !== manifest.id) add("server_identity", "server.coreId", "服务端贡献与清单 Core 标识不一致");
    if (server.implementationVersion !== manifest.version)
      add("server_version", "server.implementationVersion", "服务端实现版本与发布清单不一致");
    for (const key of ["resolveScope", "readReadiness"] as const)
      if (typeof server[key] !== "function") add("server_contract", `server.${key}`, "缺少必需服务端接点");
    if (server.initialization !== undefined && typeof server.initialization?.initialize !== "function")
      add("server_contract", "server.initialization.initialize", "已声明初始化但未提供实现");
    if (server.assessRemoval !== undefined && typeof server.assessRemoval !== "function")
      add("server_contract", "server.assessRemoval", "已声明移除检查但未提供实现");
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, registrations: new Map(registrations.map(item => [item.manifest.id, item])) };
}
