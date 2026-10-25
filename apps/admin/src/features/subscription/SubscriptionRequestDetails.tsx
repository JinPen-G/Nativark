import { Descriptions, Space, Tag, Timeline } from "antd";
import { Empty } from "@/components/ui";
import type { SubscriptionRequestRecord } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { formatMoney, formatSubscriptionDate, PLAN_LABEL, REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, REQUEST_TYPE_LABEL } from "./subscriptionLabels";

type RequestDetails = SubscriptionRequestRecord & { moduleIntent?: string[]; contactName?: string; contactPhone?: string; note?: string };

/** The tenant and platform views share the same public request facts; internal notes are never inferred. */
export function SubscriptionRequestDetails({ request, timeZone }: { request: RequestDetails; timeZone?: string }) {
  const { t } = useLocale();
  return <Space orientation="vertical" size={16} style={{ width: "100%" }}>
    <Descriptions column={{ xs: 1, md: 2 }} size="small" colon={false} items={[
      { key: "id", label: t("申请编号"), children: request.id },
      { key: "type", label: t("申请类型"), children: t(REQUEST_TYPE_LABEL[request.type]) },
      { key: "status", label: t("状态"), children: <Tag color={REQUEST_STATUS_TONE[request.status]}>{t(REQUEST_STATUS_LABEL[request.status])}</Tag> },
      { key: "target", label: t("目标套餐"), children: request.targetPlan ? t(PLAN_LABEL[request.targetPlan]) : t("不变更套餐 / 咨询意向") },
      { key: "submitted", label: t("提交人 / 时间"), children: `${request.submittedBy ?? t("待确认")} · ${formatSubscriptionDate(request.submittedAt, timeZone, t)}` },
      { key: "contact", label: t("联系人 / 联系方式"), children: [request.contactName, request.contactPhone].filter(Boolean).join(" / ") || t("未填写") },
      { key: "modules", label: t("希望使用的模块"), children: request.moduleIntent?.join("、") || t("未填写") },
      { key: "note", label: t("需求说明"), children: request.note || t("未填写") },
      { key: "amount", label: t("实际办理金额"), children: t(formatMoney(request.handledAmount)) },
      { key: "period", label: t("实际办理期间"), children: request.periodText || t("尚未登记") },
      { key: "reason", label: t("可公开处理原因"), children: request.reason || t("尚未登记") }
    ]} />
    {request.timeline?.length ? <Timeline items={request.timeline.map((item, index) => ({
      key: `${item.at}-${index}`, title: formatSubscriptionDate(item.at, timeZone, t),
      content: `${t(REQUEST_STATUS_LABEL[item.status])}${item.note ? ` · ${item.note}` : ""}`
    }))} /> : <Empty description={t("暂无处理过程记录")} />}
  </Space>;
}
