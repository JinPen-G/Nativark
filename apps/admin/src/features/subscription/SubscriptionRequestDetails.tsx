import { Space, Tag } from "antd";
import { ListSection, Table } from "@/components/ui";
import { RecordFacts } from "@/components/RecordDetailLayout";
import type { SubscriptionRequestRecord } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { formatMoney, formatSubscriptionDate, PLAN_LABEL, REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, REQUEST_TYPE_LABEL } from "./subscriptionLabels";
import { useSubscriptionCategoryLabels } from "./useSubscriptionCategoryLabels";

type RequestDetails = SubscriptionRequestRecord & { moduleIntent?: string[]; contactName?: string; contactPhone?: string; note?: string };

/** The tenant and platform views share the same public request facts; internal notes are never inferred. */
export function SubscriptionRequestDetails({ request, timeZone }: { request: RequestDetails; timeZone?: string }) {
  const { t } = useLocale();
  const categoryLabels = useSubscriptionCategoryLabels();
  return <Space orientation="vertical" size={16} style={{ width: "100%" }}>
    <RecordFacts items={[
      { key: "type", label: "申请类型", value: t(REQUEST_TYPE_LABEL[request.type]) },
      { key: "status", label: "状态", value: <Tag color={REQUEST_STATUS_TONE[request.status]}>{t(REQUEST_STATUS_LABEL[request.status])}</Tag> },
      { key: "target", label: "目标套餐", value: request.targetPlan ? t(PLAN_LABEL[request.targetPlan]) : t("不变更套餐 / 咨询意向") },
      { key: "amount", label: "实际办理金额", value: t(formatMoney(request.handledAmount)) },
      { key: "id", label: "申请编号", value: request.id, wide: true },
      { key: "submitted", label: "提交人 / 时间", value: `${request.submittedBy ?? t("待确认")} · ${formatSubscriptionDate(request.submittedAt, timeZone, t)}`, wide: true },
      ...(request.contactName || request.contactPhone ? [{ key: "contact", label: "联系人 / 联系方式", value: [request.contactName, request.contactPhone].filter(Boolean).join(" / "), wide: true }] : []),
      ...(request.moduleIntent?.length ? [{ key: "modules", label: "希望使用的模块", value: request.moduleIntent.map(code => categoryLabels.label(code)).join("、"), wide: true }] : []),
      ...(request.note ? [{ key: "note", label: "需求说明", value: request.note, wide: true }] : []),
      { key: "period", label: "实际办理期间", value: request.periodText || t("尚未登记"), wide: true },
      ...(request.reason ? [{ key: "reason", label: "可公开处理原因", value: request.reason, wide: true }] : []),
    ]} />
    <ListSection title={t("处理过程")}>
      {request.timeline?.length ? <Table rowKey={row => row.key} dataSource={request.timeline.map((item, index) => ({ ...item, key: `${item.at}-${index}` }))} pagination={{ defaultPageSize: 10 }} columns={[
        { title: t("时间"), dataIndex: "at", render: value => formatSubscriptionDate(value, timeZone, t) },
        { title: t("状态"), dataIndex: "status", render: (value: SubscriptionRequestRecord["status"]) => <Tag color={REQUEST_STATUS_TONE[value]}>{t(REQUEST_STATUS_LABEL[value])}</Tag> },
        { title: t("说明"), dataIndex: "note", render: value => value || "—" },
      ]} /> : <span className="text-meta">{t("暂无处理过程记录")}</span>}
    </ListSection>
  </Space>;
}
