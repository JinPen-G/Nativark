/** 原 AI 组合使用的 Rental 业务源；返回同一业务实例的窄视图，不创建执行器或模型账。
 * 这些是可信宿主端口，不能直接发布给模型。工具发布、Core/成员/对象授权、批准及投影仍由原 AI 组合执行。 */
import type { RentalCoreService } from "./mysql-core-runtime";
import type { RentalBusinessFactStore } from "./mysql-business-facts";
import type { MembershipService } from "./mysql-membership";
import type { RentalOrderConfirmationService } from "./mysql-order-confirmation";
import type { RentalOrderConfirmationTransaction } from "./order-confirmation-ports";
import type { RentalIdempotentActionService } from "./mysql-idempotent-actions";

export interface RentalAiApplicationSources<TTransaction extends RentalOrderConfirmationTransaction> {
  /** 保留原有界分页/可用性/订单事实及冻结报价上下文，不暴露通用数据库读取器。 */
  core: Pick<RentalCoreService<TTransaction>, "listItemGroupsPage" | "readAvailability" | "readOrderFacts"
    | "resolveWorkspaceId" | "readBusinessContext" | "getProfile" | "getWorkspaceCategory"
    | "getBusinessSettings" | "listItemGroups" | "listPricingGroups" | "listCouponTemplates"
    | "listLocations" | "listOperators" | "getOrder" | "readQuoteConfiguration" | "resolvePricingGroupQuoteRequest">;
  memberships: Pick<MembershipService, "listPersonalOptions">;
  confirmation: Pick<RentalOrderConfirmationService<TTransaction>, "createApprovedOrder" | "assertOrderMatchesQuote"
    | "fingerprintOrderRequest" | "readOrderCreation">;
  quoteFacts: Pick<RentalBusinessFactStore<TTransaction>, "findQuote">;
  /** 原键只读；没有执行、重发或自动换键的备用路径。 */
  originalResults: Pick<RentalIdempotentActionService<TTransaction>, "readReceipt">;
}

/** 与原 composeAiBusinessReadFacts / persisted approved-order 组合结构兼容。
 * 普通 Rental 宿主可以完全省略本入口；提供源不等于发布工具，亦不授予 Gateway 或批准。 */
export function createRentalAiApplicationSources<TTransaction extends RentalOrderConfirmationTransaction>(
  sources: RentalAiApplicationSources<TTransaction>
): Readonly<RentalAiApplicationSources<TTransaction>> {
  const methods = {
    core: ["listItemGroupsPage", "readAvailability", "readOrderFacts", "resolveWorkspaceId", "readBusinessContext",
      "getProfile", "getWorkspaceCategory", "getBusinessSettings", "listItemGroups", "listPricingGroups",
      "listCouponTemplates", "listLocations", "listOperators", "getOrder", "readQuoteConfiguration", "resolvePricingGroupQuoteRequest"],
    memberships: ["listPersonalOptions"],
    confirmation: ["createApprovedOrder", "assertOrderMatchesQuote", "fingerprintOrderRequest", "readOrderCreation"],
    quoteFacts: ["findQuote"], originalResults: ["readReceipt"],
  } as const;
  for (const key of Object.keys(methods) as (keyof typeof methods)[]) {
    const service = sources?.[key] as unknown as Record<string, unknown> | undefined;
    for (const method of methods[key]) if (typeof service?.[method] !== "function")
      throw new Error(`Rental AI 业务源缺少原方法: ${key}.${method}`);
  }
  // 冻结组合而非领域服务；原服务的恢复缓存及事务状态保持由唯一实例维护。
  return Object.freeze({ core: sources.core, memberships: sources.memberships, confirmation: sources.confirmation,
    quoteFacts: sources.quoteFacts, originalResults: sources.originalResults });
}
