/** 原治理宿主供给当前会话、AI/Copilot 与列表身份，保存和采用继续走原 HTTP。 */
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { createRentalGovernancePageContext } from "@rental-os/rental-core/admin/governance/context";
import type { RentalOrderSession } from "@rental-os/rental-core/admin/orders";
import { adminRuntime } from "@/app/adminRuntime";
import { CATEGORY_GOVERNANCE_PREVIEW_ENABLED } from "@/app/categoryGovernancePreview";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { useAuthStore } from "@/features/auth/authStore";
import { CategoryAssistFlow } from "@/features/ai-native/CategoryAssistFlow";
import { RuleSourceEntry, useRuleSourceLocale } from "@/features/ai-native/RuleSourceEntry";
import { CalendarSourceEntry } from "@/features/ai-native/CalendarSourceEntry";
import { useCalendarDraftLocale } from "@/features/ai-native/CalendarDraftPreparation";
import { CopilotSection } from "@/features/copilot/CopilotSection";
import { navigationTarget } from "@/features/copilot/destinations";
import { rentalCatalogScopeKey } from "@/features/catalog/legacy-catalog-context";

const components = { CategoryAssistFlow, RuleSourceEntry, CalendarSourceEntry, CopilotSection };
function sessionSnapshot(auth: ReturnType<typeof useAuthStore.getState>): RentalOrderSession {
  return {
    sessionVerified: auth.sessionVerified,
    authenticated: Boolean(auth.token),
    tenant: auth.tenant,
    user: auth.user,
    currentWorkspaceId: auth.currentWorkspaceId,
    hasPermission: (permission) => auth.hasPermission(permission),
  };
}
const getSession = () => sessionSnapshot(useAuthStore.getState());
const currentScopeKey = () => rentalCatalogScopeKey(useAuthStore.getState());
const refreshSession = () => useAuthStore.getState().bootstrap();

export function useLegacyRentalGovernanceContext() {
  const auth = useAuthStore();
  const scopeKey = rentalCatalogScopeKey(auth) ?? "";
  const queryScope = useListQueryIdentity();
  const location = useLocation();
  const { t: ruleText } = useRuleSourceLocale();
  const { t: calendarText } = useCalendarDraftLocale();
  const target = navigationTarget(location.state, location.pathname);
  return useMemo(
    () =>
      createRentalGovernancePageContext({
        runtime: adminRuntime,
        session: sessionSnapshot(auth),
        getSession,
        refreshSession,
        scopeKey,
        currentScopeKey,
        queryScope,
        categoryGovernancePreviewEnabled: CATEGORY_GOVERNANCE_PREVIEW_ENABLED,
        navigationTarget: { key: location.key, tab: target?.tab },
        components,
        ruleText,
        calendarText,
      }),
    [auth, scopeKey, queryScope, location.key, target?.tab, ruleText, calendarText],
  );
}
