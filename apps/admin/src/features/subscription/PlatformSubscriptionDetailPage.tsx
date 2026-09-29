import { Alert, App, Button, Card, Descriptions, Empty, Form, Input, Modal, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { FeatureEntitlementSource, FeatureReleaseStatus, SubscriptionPlan, SubscriptionRequestStatus, type SubscriptionFeatureEntitlement, type SubscriptionRequestRecord, type TenantSubscriptionView } from "@rental-os/shared";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useLocale } from "@/app/locale";
import { APP_ROUTES } from "@/app/navigation";
import { subscriptionApi } from "@/api/subscription";
import { ENTITLEMENT_SOURCE_LABEL, PLAN_LABEL, RELEASE_STATUS_LABEL, REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, REQUEST_TYPE_LABEL, SERVICE_STATUS_LABEL, formatMoney, formatSubscriptionDate } from "./subscriptionLabels";
import { PlatformSubscriptionActionForm } from "./PlatformSubscriptionActionForm";
import { TenantFeatureGrantModal } from "./TenantFeatureGrantModal";
import { SubscriptionRequestDetails } from "./SubscriptionRequestDetails";
import { operationForRequest, requestHandlingPayload, subscriptionError } from "./subscriptionOperations";

const SOURCE_TONE: Partial<Record<FeatureEntitlementSource, string>> = {
  [FeatureEntitlementSource.StandardPublic]: "green", [FeatureEntitlementSource.TenantGrant]: "blue", [FeatureEntitlementSource.Pro]: "gold"
};

export function PlatformSubscriptionDetailPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const query = useQuery({ queryKey: ["subscription", "platform-detail", id], queryFn: () => subscriptionApi.platformDetail(id), enabled: Boolean(id) });
  return <PageHeader title="租户订阅详情" description="查看并直接办理该租户的订阅、功能授权和申请；订阅操作不解除安全冻结。"
    extra={<Button onClick={() => navigate(APP_ROUTES.platformSubscriptions.path)}>{t("返回列表")}</Button>}
    view={<QueryState loading={query.isLoading}>
      {query.error || !query.data ? <Alert type="error" showIcon message={t("租户订阅详情加载失败")} action={<Button onClick={() => query.refetch()}>{t("重试")}</Button>} />
        : <DetailBody key={id} data={query.data} tenantId={id} />}
    </QueryState>} />;
}

function DetailBody({ data, tenantId }: { data: TenantSubscriptionView; tenantId: string }) {
  const { t } = useLocale();
  const { overview, entitlements, requests, changeLog } = data;
  const [grant, setGrant] = useState<{ mode: "grant" | "revoke"; feature: SubscriptionFeatureEntitlement; revision: number } | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<SubscriptionRequestRecord | undefined>();
  const [handling, setHandling] = useState<{ request: SubscriptionRequestRecord; status: SubscriptionRequestStatus; revision: number } | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const selectedStillPending = !selectedRequest || requests.some((r) => r.id === selectedRequest.id && r.status === SubscriptionRequestStatus.Pending);

  const entitlementColumns: ColumnsType<SubscriptionFeatureEntitlement> = [
    { title: t("功能"), dataIndex: "name", key: "name" },
    { title: t("模块"), dataIndex: "module", key: "module" },
    { title: t("上线状态"), dataIndex: "releaseStatus", key: "release", render: (value: SubscriptionFeatureEntitlement["releaseStatus"]) => t(RELEASE_STATUS_LABEL[value]) },
    { title: t("权益来源"), dataIndex: "source", key: "source", render: (value: FeatureEntitlementSource) => <Tag color={SOURCE_TONE[value]}>{t(ENTITLEMENT_SOURCE_LABEL[value])}</Tag> },
    { title: t("可用状态"), key: "available", render: (_, row) => row.available ? t("已可用") : row.needsConfig ? t("需先配置") : t("未启用") },
    { title: t("操作"), key: "action", render: (_, row) => {
      if (row.hasTenantGrant) return <Button danger type="link" onClick={() => setGrant({ mode: "revoke", feature: row, revision: overview.revision })}>{t("撤销授权")}</Button>;
      if ((row.source === FeatureEntitlementSource.NeedsUpgrade || row.releaseStatus === FeatureReleaseStatus.Pilot) && [FeatureReleaseStatus.Released, FeatureReleaseStatus.Pilot].includes(row.releaseStatus)) return <Button type="link" onClick={() => setGrant({ mode: "grant", feature: row, revision: overview.revision })}>{t("额外授权")}</Button>;
      return <span className="text-meta">{t("随套餐 / 目录维护")}</span>;
    } }
  ];
  const requestColumns: ColumnsType<SubscriptionRequestRecord> = [
    { title: t("申请编号 / 类型"), key: "type", render: (_, row) => <Space orientation="vertical" size={0}><span>{row.id}</span><span>{t(REQUEST_TYPE_LABEL[row.type])}</span></Space> },
    { title: t("状态"), key: "status", render: (_, row) => <Tag color={REQUEST_STATUS_TONE[row.status]}>{t(REQUEST_STATUS_LABEL[row.status])}</Tag> },
    { title: t("提交时间"), key: "submitted", render: (_, row) => formatSubscriptionDate(row.submittedAt, overview.timeZone) },
    { title: t("办理金额 / 期间"), key: "handled", render: (_, row) => `${formatMoney(row.handledAmount)} · ${row.periodText || t("尚未登记")}` },
    { title: t("操作"), key: "action", render: (_, row) => <Space wrap>
      <Button type="link" onClick={() => setDetails(row.id)}>{t("详情")}</Button>
      {row.status === SubscriptionRequestStatus.Pending && <>
        {operationForRequest(row)
          ? <Button type="link" onClick={() => { setSelectedRequest(structuredClone(row)); document.getElementById("subscription-action")?.scrollIntoView({ block: "start", behavior: "smooth" }); }}>{t("办理授权")}</Button>
          : <Button type="link" onClick={() => setHandling({ request: structuredClone(row), status: SubscriptionRequestStatus.Processed, revision: overview.revision })}>{t("登记处理")}</Button>}
        <Button type="link" danger onClick={() => setHandling({ request: structuredClone(row), status: SubscriptionRequestStatus.Rejected, revision: overview.revision })}>{t("拒绝")}</Button>
      </>}
    </Space> }
  ];

  return <Space orientation="vertical" size={16} style={{ width: "100%" }}>
    <Card size="small" title={`${t("当前套餐与期限")}（${overview.tenantName}）`}>
      <Descriptions column={{ xs: 1, md: 2 }} size="small" colon={false} items={[
        { key: "plan", label: t("当前套餐"), children: <Tag color={overview.plan === SubscriptionPlan.Pro ? "gold" : "default"}>{t(PLAN_LABEL[overview.plan])}</Tag> },
        { key: "status", label: t("服务状态"), children: t(SERVICE_STATUS_LABEL[overview.serviceStatus]) },
        { key: "period", label: t("统一起止 [开始, 截止)"), children: `${formatSubscriptionDate(overview.startAt, overview.timeZone)} ~ ${formatSubscriptionDate(overview.endAt, overview.timeZone)}` },
        { key: "amount", label: t("本期确认金额"), children: t(formatMoney(overview.currentAmount)) },
        { key: "next", label: t("待生效套餐"), children: overview.next ? `${t(PLAN_LABEL[overview.next.plan])} · ${formatSubscriptionDate(overview.next.effectiveAt, overview.timeZone)}` : t("无") }
      ]} />
    </Card>
    <Card id="subscription-action" size="small" title={t("直接办理")} extra={selectedRequest && <Button onClick={() => setSelectedRequest(undefined)}>{t("取消关联申请")}</Button>}>
      {!selectedStillPending ? <Alert type="warning" message={t("所选申请已不再待处理，请取消关联并查看最新记录")} /> : <PlatformSubscriptionActionForm key={selectedRequest?.id ?? "direct"} tenantId={tenantId} overview={overview} standardPricing={data.standardPricing} request={selectedRequest} onSaved={() => setSelectedRequest(undefined)} />}
    </Card>
    <Card size="small" title={t("额外功能授权")}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t("仅可对已上线 / 受控试点功能向当前租户授权，不要求整体升级，不改变期限。公共下放在功能目录中维护；撤销须记录原因并保护既有业务。")} />
      <Table<SubscriptionFeatureEntitlement> rowKey="code" size="small" columns={entitlementColumns} dataSource={entitlements} pagination={{ pageSize: 20, hideOnSinglePage: true }} scroll={{ x: 700 }} />
    </Card>
    <Card size="small" title={t("申请与线下收款记录")}>
      <Table<SubscriptionRequestRecord> rowKey="id" size="small" columns={requestColumns} dataSource={requests} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 850 }} />
    </Card>
    <Card size="small" title={t("订阅变更记录")}>
      {!changeLog.length ? <Empty description={t("暂无变更记录")} /> : <Descriptions column={1} items={changeLog.map((entry) => ({ key: entry.id, label: `${entry.action} · ${formatSubscriptionDate(entry.effectiveAt, overview.timeZone)}`, children: `${entry.beforeText ?? "—"} → ${entry.afterText ?? "—"}${entry.reason ? ` · ${entry.reason}` : ""}${entry.internalNote ? ` · 平台内部：${entry.internalNote}` : ""}` }))} />}
    </Card>
    {grant && <TenantFeatureGrantModal open mode={grant.mode} tenantId={tenantId} feature={grant.feature} expectedRevision={grant.revision} onClose={() => setGrant(null)} />}
    {handling && <RequestHandlingModal tenantId={tenantId} {...handling} onClose={() => setHandling(null)} />}
    <Modal open={Boolean(details)} title={t("申请详情与处理过程")} footer={null} width={760} onCancel={() => setDetails(null)}>
      {requests.find((r) => r.id === details) && <SubscriptionRequestDetails request={requests.find((r) => r.id === details)!} timeZone={overview.timeZone} />}
    </Modal>
  </Space>;
}

function RequestHandlingModal({ tenantId, request, status, revision, onClose }: { tenantId: string; request: SubscriptionRequestRecord; status: SubscriptionRequestStatus; revision: number; onClose: () => void }) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ publicReason: string }>();
  const mutation = useMutation({
    mutationFn: ({ publicReason }: { publicReason: string }) => subscriptionApi.handleRequest(request.id, requestHandlingPayload(request, status, revision, publicReason)),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["subscription", "platform-detail", tenantId] }), queryClient.invalidateQueries({ queryKey: ["subscription", "platform-list"] }), queryClient.invalidateQueries({ queryKey: ["subscription", "tenant-view"] }), queryClient.invalidateQueries({ queryKey: ["subscription", "reminder"] })]);
      message.success(t("处理结果已保存")); onClose();
    },
    onError: (error) => message.error(subscriptionError(error))
  });
  return <Modal open title={t(status === SubscriptionRequestStatus.Rejected ? "拒绝申请" : "登记咨询 / 到期不续费结果")} onCancel={onClose} onOk={() => form.submit()} confirmLoading={mutation.isPending}>
    <Alert type="info" message={t("处理原因对租户可见；登记咨询或不续费不改变当前已付费期限，不自动获得基础版授权。")} style={{ marginBottom: 12 }} />
    {mutation.error && <Alert type="error" message={subscriptionError(mutation.error)} style={{ marginBottom: 12 }} />}
    <Form form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)}>
      <Form.Item name="publicReason" label={t("可公开原因")} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} maxLength={500} /></Form.Item>
    </Form>
  </Modal>;
}
