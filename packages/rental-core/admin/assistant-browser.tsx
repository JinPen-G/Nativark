/** 浏览器宿主接回原 AI/会员/治理插槽；复用同一会话、导航及助手，不创建第二执行器。 */
import { useMemo, type ComponentProps } from "react";
import type { CoreRegisteredPage } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import type { PlatformSaasPage } from "@rental-os/platform-admin/application";
import { AnimatedIcon, AppstoreOutlined, ControlOutlined } from "@rental-os/platform-admin/ui";
import { useAiManagementLocale } from "@rental-os/ai-native-admin/source/ai-native/management-locale";
import { createRentalAssistant } from "./assistant";
import { createRentalAssistantNavigation, type RentalAssistantNavigationOptions } from "./assistant-navigation";
import { createRentalBrowserAdminHost, type RentalBrowserAdminHostOptions } from "./browser-host";
import { MemberNameFlow } from "./task-center/MemberNameFlow";
import { useCalendarDraftLocale } from "./task-center/CalendarDraftPreparation";
import { useRuleSourceLocale } from "./assistant/ai-native/RuleSourceEntry";
import { CategoryGovernancePage, CategoryCapabilityCatalogPage } from "./governance/CategoryGovernancePage";

export function createRentalAssistantBrowserHost(options: RentalBrowserAdminHostOptions & RentalAssistantNavigationOptions & {
  pages: ReadonlyMap<string, CoreRegisteredPage<CoreRouteComponent>>;
}) {
  const assistant = createRentalAssistant({ session: options.session,
    useNavigation: createRentalAssistantNavigation(options.pages, options.session, { publicNavigation: options.publicNavigation }) });
  function BoundMemberNameFlow(props: ComponentProps<typeof MemberNameFlow>) {
    return <assistant.Provider><MemberNameFlow {...props} /></assistant.Provider>;
  }
  const host = createRentalBrowserAdminHost({ ...options,
    membership: { ...options.membership, components: {
      ...options.membership?.components, MemberNameFlow: BoundMemberNameFlow, NotificationDraftFlow: assistant.NotificationDraftFlow,
    } },
    governance: { ...options.governance, components: {
      ...options.governance?.components, CopilotSection: assistant.CopilotSection, CategoryAssistFlow: assistant.CategoryAssistFlow,
      RuleSourceEntry: assistant.RuleSourceEntry, CalendarSourceEntry: assistant.CalendarSourceEntry,
    } },
  });
  function useMembershipContext() {
    const context = host.contexts.useMembershipContext(), { t } = useAiManagementLocale();
    return useMemo(() => ({ ...context, managementText: t }), [context, t]);
  }
  function useGovernanceContext() {
    const context = host.contexts.useGovernanceContext();
    const { t: ruleText } = useRuleSourceLocale(), { t: calendarText } = useCalendarDraftLocale();
    return useMemo(() => ({ ...context, ruleText, calendarText }), [context, ruleText, calendarText]);
  }
  function Categories() { return <assistant.Provider><CategoryGovernancePage /></assistant.Provider>; }
  function Capabilities() { return <assistant.Provider><CategoryCapabilityCatalogPage /></assistant.Provider>; }
  const section = { key: "platform-rental-core", label: "租赁内核", icon: <AnimatedIcon name="rules" /> };
  const saasPages: PlatformSaasPage[] = options.categoryGovernancePreviewEnabled ? [
    { path: "/platform/rental-categories", label: "租赁品类", permission: "system:rental-category:view",
      icon: <AppstoreOutlined />, section, component: Categories },
    { path: "/platform/rental-category-capabilities", label: "内核能力目录", permission: "system:rental-category:view",
      icon: <ControlOutlined />, section, component: Capabilities },
  ] : [];
  return { ...host, assistant, saasPages, contexts: { ...host.contexts, useMembershipContext, useGovernanceContext } };
}
