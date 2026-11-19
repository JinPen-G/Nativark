/** 治理配置沿原 Rental HTTP，版本发布、日历覆盖和通知结果由原服务端裁定。 */
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import type { OfficialCalendarSourceVersionSummary } from "@rental-os/platform-contracts";
import type {
  ApplyOfficialCalendarSourceRequest,
  ApplyRentalCalendarRangeOverrideRequest,
  ApplyRentalCalendarRangeOverrideResult,
  ApplyRentalCalendarRangeRemoveRequest,
  ApplyRentalCalendarRangeRemoveResult,
  PreviewRentalCalendarRangeOverrideRequest,
  PreviewRentalCalendarRangeRemoveRequest,
  PublishRentalCalendarRequest,
  PublishRentalRuleVersionRequest,
  RemoveRentalCalendarDayOverrideRequest,
  RentalCalendarOverrideAudit,
  RentalCalendarPublishPreview,
  RentalCalendarRangeOverridePreview,
  RentalCalendarRangeRemovePreview,
  RentalCalendarTimePriceDay,
  RentalCalendarVersionSummary,
  RentalCalendarYear,
  RentalCouponTemplate,
  RentalNotificationSendLogV1,
  RentalNotificationTemplateV1,
  RentalRulePublishPreview,
  RentalRuleVersion,
  RentalRuleVersionAudit,
  RestoreRentalCalendarVersionRequest,
  SaveRentalCalendarDayRequest,
  SaveRentalNotificationTemplateRequest,
  SaveRentalRuleVersionRequest,
  SaveTenantRentalBusinessSettingsRequest,
  SendRentalNotificationRequest,
  TenantRentalBusinessSettings,
  VoidRentalCalendarRequest,
} from "@rental-os/rental-core";
import { createRentalOrderApi } from "../orders/client";
import { createRentalLocationApi } from "../locations/client";

type ReadOptions = Pick<AdminRequestOptions, "signal">;
const readOptions = (options?: ReadOptions) =>
  options?.signal ? { signal: options.signal } : undefined;

export function createRentalGovernanceApi(request: AdminRuntime["request"]) {
  const orders = createRentalOrderApi(request);
  const locations = createRentalLocationApi(request);
  return {
    profile: orders.profile,
    businessSettings: orders.businessSettings,
    categories: locations.categories,
    ruleVersions: (options?: ReadOptions) =>
      request<RentalRuleVersion[]>("/rental/v1/rule-versions", readOptions(options)),
    couponTemplates: (options?: ReadOptions) =>
      request<RentalCouponTemplate[]>("/rental/v1/coupon-templates", readOptions(options)),
    calendar: (year: number) =>
      request<RentalCalendarYear & { timePriceSummary: RentalCalendarTimePriceDay[] }>(
        `/rental/v1/calendars/${year}`,
      ),
    calendarVersions: (year: number) =>
      request<RentalCalendarVersionSummary[]>(`/rental/v1/calendars/${year}/versions`),
    calendarVersion: (year: number, version: string) =>
      request<RentalCalendarYear>(
        `/rental/v1/calendars/${year}/versions/${encodeURIComponent(version)}`,
      ),
    calendarOverrideAudits: (year: number, version?: string) =>
      request<RentalCalendarOverrideAudit[]>(
        `/rental/v1/calendars/${year}/override-audits${version ? `?version=${encodeURIComponent(version)}` : ""}`,
      ),
    officialCalendarSourceVersions: (year?: number) =>
      request<OfficialCalendarSourceVersionSummary[]>(
        `/rental/v1/official-calendar-sources${year ? `?year=${year}` : ""}`,
      ),
    calendarPublishPreview: (year: number) =>
      request<RentalCalendarPublishPreview>(`/rental/v1/calendars/${year}/publish-preview`),
    saveCalendarDay: (year: number, data: SaveRentalCalendarDayRequest) =>
      request(`/rental/v1/calendars/${year}/days/${data.date}`, { method: "put", data }),
    applyOfficialCalendarSource: (year: number, data: ApplyOfficialCalendarSourceRequest) =>
      request<RentalCalendarYear>(`/rental/v1/calendars/${year}/apply-official-source`, {
        method: "post",
        data,
      }),
    publishCalendar: (year: number, data: PublishRentalCalendarRequest) =>
      request<RentalCalendarYear>(`/rental/v1/calendars/${year}/publish`, { method: "post", data }),
    restoreCalendarVersion: (
      year: number,
      version: string,
      data: RestoreRentalCalendarVersionRequest,
    ) =>
      request<RentalCalendarYear>(
        `/rental/v1/calendars/${year}/versions/${encodeURIComponent(version)}/restore`,
        { method: "post", data },
      ),
    voidCalendarVersion: (year: number, version: string, data: VoidRentalCalendarRequest) =>
      request<RentalCalendarYear>(
        `/rental/v1/calendars/${year}/versions/${encodeURIComponent(version)}/void`,
        { method: "post", data },
      ),
    removeCalendarDayOverride: (
      year: number,
      date: string,
      data: RemoveRentalCalendarDayOverrideRequest,
    ) => request(`/rental/v1/calendars/${year}/days/${date}`, { method: "delete", data }),
    notificationTemplates: () =>
      request<RentalNotificationTemplateV1[]>("/rental/v1/notification-templates"),
    notificationLogs: () => request<RentalNotificationSendLogV1[]>("/rental/v1/notification-logs"),
    saveNotificationTemplate: (data: SaveRentalNotificationTemplateRequest) =>
      request<RentalNotificationTemplateV1>(
        data.id
          ? `/rental/v1/notification-templates/${data.id}`
          : "/rental/v1/notification-templates",
        { method: data.id ? "put" : "post", data },
      ),
    sendNotification: (data: SendRentalNotificationRequest) =>
      request<RentalNotificationSendLogV1>("/rental/v1/notifications/send", {
        method: "post",
        data,
      }),
    retryNotification: (id: string) =>
      request<RentalNotificationSendLogV1>(`/rental/v1/notification-logs/${id}/retry`, {
        method: "post",
      }),
    queryNotificationDelivery: (id: string) =>
      request<RentalNotificationSendLogV1>(`/rental/v1/notification-logs/${id}/query-delivery`, {
        method: "post",
      }),
    retryDueNotifications: (limit = 20) =>
      request<{ attempted: number; sent: number; failed: number; ids: string[] }>(
        `/rental/v1/notification-logs/retry-due?limit=${limit}`,
        { method: "post" },
      ),
    saveRuleVersion: (data: SaveRentalRuleVersionRequest) =>
      request<RentalRuleVersion>("/rental/v1/rule-versions", { method: "post", data }),
    publishRuleVersion: (version: string, data: PublishRentalRuleVersionRequest) =>
      request<RentalRuleVersion>(`/rental/v1/rule-versions/${version}/publish`, {
        method: "post",
        data,
      }),
    saveBusinessSettings: (data: SaveTenantRentalBusinessSettingsRequest) =>
      request<TenantRentalBusinessSettings>("/rental/v1/business-settings", {
        method: "put",
        data,
      }),
    calendarRangePreview: (year: number, data: PreviewRentalCalendarRangeOverrideRequest) =>
      request<RentalCalendarRangeOverridePreview>(
        `/rental/v1/calendars/${year}/days/range-preview`,
        {
          method: "post",
          data,
        },
      ),
    calendarRangeRemovePreview: (year: number, data: PreviewRentalCalendarRangeRemoveRequest) =>
      request<RentalCalendarRangeRemovePreview>(
        `/rental/v1/calendars/${year}/days/range-remove-preview`,
        {
          method: "post",
          data,
        },
      ),
    calendarRangeApply: (year: number, data: ApplyRentalCalendarRangeOverrideRequest) =>
      request<ApplyRentalCalendarRangeOverrideResult>(`/rental/v1/calendars/${year}/days/range`, {
        method: "post",
        data,
      }),
    calendarRangeRemove: (year: number, data: ApplyRentalCalendarRangeRemoveRequest) =>
      request<ApplyRentalCalendarRangeRemoveResult>(
        `/rental/v1/calendars/${year}/days/range-remove`,
        {
          method: "post",
          data,
        },
      ),
    ruleVersionAudits: (version?: string) =>
      request<RentalRuleVersionAudit[]>("/rental/v1/rule-versions/audits", { params: { version } }),
    ruleVersionPublishPreview: (version: string, effectiveFrom?: string) =>
      request<RentalRulePublishPreview>(`/rental/v1/rule-versions/${version}/publish-preview`, {
        params: { effectiveFrom },
      }),
    restoreRuleVersion: (version: string, reason: string) =>
      request<RentalRuleVersion>(`/rental/v1/rule-versions/${version}/restore`, {
        method: "post",
        data: { reason },
      }),
    voidRuleVersion: (version: string, reason: string) =>
      request<RentalRuleVersion>(`/rental/v1/rule-versions/${version}/void`, {
        method: "post",
        data: { reason },
      }),
  };
}
export type RentalGovernanceApi = ReturnType<typeof createRentalGovernanceApi>;

export {
  createRentalCategoryPreparationApi,
  type RentalCategoryPreparationApi,
} from "./category-preparation-client";
