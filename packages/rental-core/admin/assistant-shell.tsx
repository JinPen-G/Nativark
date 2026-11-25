/** 原 Web 主壳的 Agent/Admin 与 Copilot 组合，复用同一 assistant 和 Rental 会话。
 * 导航只消费宿主当前登记与授权；业务正文、桌面布局及公共壳由各原入口维护。 */
import { Breadcrumb } from "antd";
import { useEffect, useRef } from "react";
import { matchPath, useLocation } from "react-router-dom";
import type { PlatformShellProps } from "@rental-os/platform-admin";
import { WorkspaceBreadcrumbCurrent } from "@rental-os/platform-admin/source/components/workspace/WorkspaceHeader";
import { AnimatedIcon, RightOutlined, Tooltip } from "@rental-os/platform-admin/ui";
import { useLocale } from "@rental-os/platform-admin/locale";
import { createRentalShell, type RentalShellOptions } from "./browser-shell";
import type { createRentalAssistant } from "./assistant";
import { useRentalAssistantContext } from "./assistant/host";
import { AiOperatorNavigation, OperatorModeSwitch } from "./assistant/ai-operator/AiOperatorNavigation";
import { OperatorProvider } from "./assistant/ai-operator/OperatorContext";
import { CopilotProvider, useCopilot } from "./assistant/copilot/CopilotProvider";
import { CopilotLayout } from "./assistant/copilot/CopilotLayout";
import "./assistant/ai-operator/ai-operator.css";

export interface RentalAssistantShellOptions extends RentalShellOptions {
  assistant: ReturnType<typeof createRentalAssistant>;
}

export function createRentalAssistantShell({ assistant, ...options }: RentalAssistantShellOptions) {
  const RentalShell = createRentalShell(options);

  function SessionShell(props: PlatformShellProps) {
    const context = useRentalAssistantContext();
    if (context.session !== options.session) throw new Error("Agent 与 Web 主壳必须使用同一 Rental 会话");
    const auth = options.session.useAuthStore();
    const identity = JSON.stringify([auth.tenant?.tenantId, auth.user?.id, auth.currentWorkspaceId,
      options.session.currentSessionEpoch()]);
    // 原状态 Provider 各挂一次；已绑定的 assistant 组件不再另包 Host Provider。
    return <CopilotProvider><OperatorProvider><ShellContents key={identity} {...props} /></OperatorProvider></CopilotProvider>;
  }

  function ShellContents(props: PlatformShellProps) {
    const copilot = useCopilot();
    const context = useRentalAssistantContext();
    const navigation = context.useNavigation();
    const currentNavigation = useRef(navigation);
    currentNavigation.current = navigation;
    const location = useLocation();
    const { t } = useLocale();
    const operatorRoute = navigation.routes.aiOperator;
    const originalPath = navigation.originalPath(location.pathname);
    const aiMode = Boolean(operatorRoute && originalPath === operatorRoute.path);
    const lastAdminPath = useRef("/workbench");
    useEffect(() => {
      if (!aiMode && originalPath) lastAdminPath.current = originalPath + location.search;
    }, [aiMode, originalPath, location.search]);

    function resolveAllowed(href: string) {
      const current = currentNavigation.current;
      const pathname = href.split(/[?#]/, 1)[0];
      const route = Object.values(current.routes).find(entry => matchPath(entry.path, pathname));
      return route && current.canAccess(route) ? current.resolve(href) : null;
    }

    const canUseOperator = Boolean(operatorRoute && resolveAllowed(operatorRoute.path));
    const breadcrumbItems = [
      { title: <span className="breadcrumb-section">{t("Agent工作台")}</span> },
      { title: <WorkspaceBreadcrumbCurrent>{t("对话")}</WorkspaceBreadcrumbCurrent> },
    ];

    return <RentalShell {...props} layout={{
      ...props.layout,
      navigation: aiMode ? ({ query }) => <AiOperatorNavigation query={query} /> : props.layout?.navigation,
      sidebarExtra: canUseOperator ? ({ resetSearch, onNavigate }) => <OperatorModeSwitch ai={aiMode} onChange={next => {
        const current = currentNavigation.current;
        const agent = current.routes.aiOperator;
        const agentTarget = agent && resolveAllowed(agent.path);
        if (!agentTarget) return;
        const fallback = Object.values(current.routes).find(route => route.menu && route.path !== agent.path
          && resolveAllowed(route.path));
        const target = next ? agentTarget : resolveAllowed(lastAdminPath.current)
          ?? (fallback ? resolveAllowed(fallback.path) : null);
        if (!target) return;
        resetSearch();
        onNavigate(target);
      }} /> : props.layout?.sidebarExtra,
      headerClassName: aiMode ? "operator-context-header" : props.layout?.headerClassName,
      headerContext: aiMode ? <Breadcrumb aria-label={t("面包屑")}
        separator={<RightOutlined size={13} className="workspace-breadcrumb-separator" />} items={breadcrumbItems} />
        : props.layout?.headerContext,
      contentClassName: aiMode ? "ai-operator-host" : props.layout?.contentClassName,
      headerPanelControl: !aiMode && copilot?.available && <Tooltip title={t(copilot.open ? "收起 Copilot" : "展开 Copilot")}>
        <button type="button" className="workspace-copilot-entry" aria-label={t(copilot.open ? "收起 Copilot" : "展开 Copilot")}
          aria-controls="business-copilot" aria-expanded={copilot.open} data-sound="press"
          onClick={() => copilot.open ? copilot.close() : copilot.show()}>
          <AnimatedIcon key={copilot.open ? "close" : "open"} name={copilot.open ? "panelRightClose" : "panelRightOpen"}
            style={{ fontSize: 16 }} />
        </button>
      </Tooltip>,
      wrapContent: column => <CopilotLayout suspended={aiMode}>{column}</CopilotLayout>,
    }} />;
  }

  return function RentalAssistantShell(props: PlatformShellProps) {
    return <assistant.Provider><SessionShell {...props} /></assistant.Provider>;
  };
}
