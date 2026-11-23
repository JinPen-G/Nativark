/** 邮件预览复用原UIArc抽屉与Tabs，srcDoc为服务端安全模板并禁止脚本/导航。 */
import { useQuery } from "@tanstack/react-query";
import type { TenantDispatchRow, TenantDispatchStatus } from "@rental-os/platform-contracts";
import { Tag } from "antd";
import { useLocale } from "../../app/locale";
import { Drawer, Tabs } from "../../components/ui";
import { QueryState } from "../../components/QueryState";
import { RecordFacts } from "../../components/RecordFacts";
import { useAdminRuntime, useAdminSession } from "../../runtime";
import { useTenantMessagingApi } from "./client";
import { hasTenantMessagingPermission } from "./messagingAccess";
import styles from "./Dispatch.module.css";

export const DISPATCH_STATUS_LABELS: Record<TenantDispatchStatus, string> = {
  queued: "待发送", sent: "已受理", delivery_pending: "等待回执", delivered: "已送达", delivery_failed: "送达失败", failed: "发送失败",
  delivery_uncertain: "结果待核对", simulated: "模拟发送", simulation_failed: "模拟失败"
};
export function DispatchStatus({ value }: { value: TenantDispatchStatus }) {
  const { t } = useLocale();
  return <Tag color={value === "delivered" ? "success" : ["failed", "delivery_failed"].includes(value) ? "error"
    : value === "delivery_uncertain" ? "warning" : value === "sent" ? "processing" : "default"}>{t(DISPATCH_STATUS_LABELS[value])}</Tag>;
}
export function DispatchDetail({ selected, onClose, businessScopeLabel = "业务范围" }: { selected?: TenantDispatchRow; onClose: () => void; businessScopeLabel?: string }) {
  const { t, locale } = useLocale();
  const { user, sessionVerified } = useAdminSession();
  const runtime = useAdminRuntime();
  const api = useTenantMessagingApi();
  const allowed = sessionVerified && hasTenantMessagingPermission(user, "system:integration:manage");
  const detail = useQuery({ queryKey: ["tenant-dispatch-detail", runtime.currentSessionEpoch(), selected?.source, selected?.id, selected?.channel],
    enabled: allowed && Boolean(selected), queryFn: ({ signal }) => api.dispatchDetail(selected!.source, selected!.id, selected!.channel, signal) });
  const data = allowed ? detail.data : undefined;
  return <Drawer title={t("寄件详情")} open={Boolean(selected)} size={800} destroyOnHidden onClose={onClose}>
    <QueryState loading={detail.isLoading} error={detail.error} onRetry={() => detail.refetch({ throwOnError: true })}>
      {data && <div className={styles.detail}>
        <div className={styles.messageHeading}><h2>{data.subject}</h2><DispatchStatus value={data.status} /></div>
        <RecordFacts items={[
          { key: "recipient", label: "收件人", value: data.recipient }, { key: "sender", label: "发件人", value: data.sender ?? "—" },
          { key: "workspace", label: businessScopeLabel, value: data.workspaceName ?? t("租户通知") }, { key: "provider", label: "发送服务", value: data.provider },
          { key: "sentAt", label: "发送时间", value: data.sentAt ? new Date(data.sentAt).toLocaleString(locale) : "—" },
          { key: "attempts", label: "发送次数", value: data.attempts }, { key: "template", label: "模板版本", value: data.templateVersion ?? "—" },
          { key: "business", label: "关联对象", value: data.businessId ?? "—" }
        ]} />
        {data.errorMessage && <p className={styles.failure} role="status">{data.errorMessage}</p>}
        {data.status === "sent" && <p className={styles.note}>{t("已受理表示邮箱或短信服务器接受请求，不代表收件人已收到或阅读。")}</p>}
        {data.channel === "email" && !data.renderedHtml && <p className={styles.note}>{t("此历史邮件仅保留正文，未保存邮件样式。")}</p>}
        <Tabs items={[
          ...(data.channel === "email" && data.renderedHtml ? [{ key: "preview", label: t("邮件预览"), children:
            <iframe className={styles.email} title={t("邮件内容预览")} sandbox="" referrerPolicy="no-referrer" srcDoc={data.renderedHtml} /> }] : []),
          { key: "text", label: t("正文"), children: <div className={styles.text}>{data.renderedText}</div> },
          { key: "delivery", label: t("投递信息"), children: <RecordFacts items={[
            { key: "id", label: "寄件编号", value: data.id }, { key: "providerMessageId", label: "服务商消息号", value: data.providerMessageId ?? "—" },
            { key: "createdAt", label: "创建时间", value: new Date(data.createdAt).toLocaleString(locale) }
          ]} /> }
        ]} />
      </div>}
    </QueryState>
  </Drawer>;
}
