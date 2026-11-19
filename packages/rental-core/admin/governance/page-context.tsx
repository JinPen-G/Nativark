/** 宿主供给已验证的 Rental 会话与原 AI 入口，治理请求前后复验同一范围。 */
import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import type { RentalOrderSession } from "../orders/page-context";
import { createRentalGovernanceApi, type RentalGovernanceApi } from "./client";
import {
  createRentalCategoryPreparationApi,
  type RentalCategoryPreparationApi,
} from "./category-preparation-client";
import { RENTAL_GOVERNANCE_LEGACY_PERMISSIONS } from "./pages";

export interface RentalGovernanceConfigField {
  key: string;
  label: string;
  value: string;
  options?: { value: string; label: string }[];
}

export interface RentalGovernanceSectionProps {
  id: string;
  title: string;
  fields: RentalGovernanceConfigField[];
  onFill?: (values: Record<string, string>) => void;
  children: ReactNode;
}

export interface RentalGovernanceComponents {
  CopilotSection: ComponentType<RentalGovernanceSectionProps>;
  CategoryAssistFlow?: ComponentType<{
    mode: "platform" | "workspace";
    code?: string;
    identity?: string;
    current?: () => boolean;
    onChanged?: () => void | Promise<void>;
  }>;
  RuleSourceEntry?: ComponentType<{
    targetId: string;
    version: string;
    identity: string;
    current: () => boolean;
    onAccessDenied: () => void;
  }>;
  CalendarSourceEntry?: ComponentType<{
    date: string;
    identity: string;
    current: () => boolean;
    onAccessDenied: () => void;
    onComplete: () => void;
  }>;
}

export interface RentalGovernancePageContext {
  api: RentalGovernanceApi;
  categoryPreparationApi: RentalCategoryPreparationApi;
  runtime: AdminRuntime;
  session: RentalOrderSession;
  getSession: () => RentalOrderSession;
  refreshSession: () => Promise<void>;
  scopeKey: string;
  currentScopeKey: () => string | undefined;
  /** 原列表身份用于页签和 AI 来源绑定，原采用存储继续使用自身稳定三元组。 */
  queryScope: string;
  categoryGovernancePreviewEnabled: boolean;
  navigationTarget?: { key: string; tab?: string };
  components: RentalGovernanceComponents;
  ruleText?: (text: string) => string;
  calendarText?: (text: string) => string;
}

/** 未装配 Copilot 时保留原配置区的语义标记，字段仍由当前页面显式投影。 */
function GovernanceSection({ id, title, children }: RentalGovernanceSectionProps) {
  return (
    <section
      data-copilot-anchor={id}
      data-copilot-record={`configuration:${id}`}
      data-copilot-config={id}
      data-copilot-label={title}
      aria-label={title}
    >
      {children}
    </section>
  );
}

export function createRentalGovernancePageContext(
  dependencies: Omit<
    RentalGovernancePageContext,
    "api" | "categoryPreparationApi" | "components"
  > & {
    components?: Partial<RentalGovernanceComponents>;
  },
): RentalGovernancePageContext {
  const { runtime, scopeKey, currentScopeKey, getSession } = dependencies;
  const assertCurrent = () => {
    const current = getSession();
    if (
      !scopeKey ||
      currentScopeKey() !== scopeKey ||
      !current.sessionVerified ||
      !current.authenticated ||
      !current.tenant?.tenantId ||
      !current.currentWorkspaceId ||
      !current.user?.id ||
      current.user.isSaasAdmin
    ) {
      throw new DOMException("治理页面的会话或经营空间已变化", "AbortError");
    }
    if (
      !RENTAL_GOVERNANCE_LEGACY_PERMISSIONS.some((permission) => current.hasPermission(permission))
    ) {
      throw new Error("当前治理操作不可用");
    }
  };
  const request: AdminRuntime["request"] = async <Output,>(
    path: string,
    options?: AdminRequestOptions,
  ): Promise<Output> => {
    assertCurrent();
    const result = await runtime.request<Output>(path, options);
    assertCurrent();
    return result;
  };
  return {
    ...dependencies,
    api: createRentalGovernanceApi(request),
    categoryPreparationApi: createRentalCategoryPreparationApi(request),
    components: {
      ...dependencies.components,
      CopilotSection: dependencies.components?.CopilotSection ?? GovernanceSection,
    },
  };
}

const Context = createContext<RentalGovernancePageContext | null>(null);

export function RentalGovernancePageProvider({
  context,
  children,
}: {
  context: RentalGovernancePageContext;
  children: ReactNode;
}) {
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

export function useRentalGovernanceContext(): RentalGovernancePageContext {
  const context = useContext(Context);
  if (!context) throw new Error("治理页面须绑定当前宿主接点");
  return context;
}
