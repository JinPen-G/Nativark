/** 任务中心沿用同一 Rental 助手会话、请求和登记导航；这里仅组装原 API，不创建认证或任务执行器。 */
import { useMemo } from "react";
import type { RentalBrowserAdminSession } from "../browser";
import { useRentalAssistant } from "../assistant/host";
import { createEntrySceneCatalogReader } from "./entry-scene-catalog-api";
import { createAiAutomationExplanationsApi } from "./api/aiAutomationExplanations";
import { createAiAutomationOriginalRefundsApi } from "./api/aiAutomationOriginalRefunds";
import { createAiAutomationPoliciesApi } from "./api/aiAutomationPolicies";
import { createAiAutomationReviewsApi } from "./api/aiAutomationReviews";
import { createAiMemberNameApi } from "./api/aiMemberName";
import { createAiNotificationChangesApi } from "./api/aiNotificationChanges";
import { createAiOpeningDiagnosticsApi } from "./api/aiOpeningDiagnostics";
import { createAiTaskCalendarDraftApi } from "./api/aiTaskCalendarDraft";
import { createAiTaskOpeningProposalsApi } from "./api/aiTaskOpeningProposals";
import { createAiTaskReadPolicyApi } from "./api/aiTaskReadPolicy";
import { createAiTaskRecoveryApi } from "./api/aiTaskRecovery";
import { createAiTaskRuleDraftApi } from "./api/aiTaskRuleDraft";

export function createRentalTaskCenterPorts(session: RentalBrowserAdminSession) {
  const aiAutomationReviewsApi = createAiAutomationReviewsApi(session);
  return Object.freeze({
    aiAutomationReviewsApi,
    aiAutomationExplanationsApi: createAiAutomationExplanationsApi(session),
    readAutomationOriginalRefund: createAiAutomationOriginalRefundsApi(session, aiAutomationReviewsApi),
    aiAutomationPoliciesApi: createAiAutomationPoliciesApi(session),
    aiMemberNameApi: createAiMemberNameApi(session),
    aiNotificationChangesApi: createAiNotificationChangesApi(session),
    aiOpeningDiagnosticsApi: createAiOpeningDiagnosticsApi(session),
    aiTaskCalendarDraftApi: createAiTaskCalendarDraftApi(session),
    aiTaskOpeningProposalsApi: createAiTaskOpeningProposalsApi(session),
    ...createAiTaskReadPolicyApi(session),
    aiTaskRecoveryApi: createAiTaskRecoveryApi(session),
    aiTaskRuleDraftApi: createAiTaskRuleDraftApi(session),
    readEntrySceneCatalog: createEntrySceneCatalogReader(session),
    identityKey: () => { const auth = session.useAuthStore.getState();
      return JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user, session.currentSessionEpoch()]); },
    authBinding: () => { const auth = session.useAuthStore.getState();
      return JSON.stringify([auth.token, auth.user, auth.tenant?.tenantId, auth.currentWorkspaceId, session.currentSessionEpoch()]); },
  });
}

export function useRentalTaskCenter() {
  const assistant = useRentalAssistant();
  const ports = useMemo(() => createRentalTaskCenterPorts(assistant.session), [assistant.session]);
  return { ...assistant, ...ports };
}
