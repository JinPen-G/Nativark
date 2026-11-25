/** 原通知草稿 API 委托同一 Rental 会话，保留原操作键与运输。 */
import { createAiNotificationDraftsApi } from "@rental-os/rental-core/admin/assistant/source/api/aiNotificationDrafts";
import { legacyRentalAssistant } from "@/features/ai-operator/legacy-host";
export const aiNotificationDraftsApi = createAiNotificationDraftsApi(legacyRentalAssistant.session);
