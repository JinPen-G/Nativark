import { Space, Tag } from "antd";
import { DataTableRowActions, DataTableText, ListSection, App, Empty, Modal, Tabs } from "@/components/ui";
import { RecordFacts } from "@/components/RecordDetailLayout";
import { useModalDismissal } from "@/components/ui/useModalDismissal";
import { ClipboardCheck, FileText, XCircle } from "lucide-react";
import styles from "./TenantSubscription.module.css";
import { Form } from "@/components/ui";
import { Alert, Table, TableRefreshProvider } from "@/components/ui";
import { Input } from "@/components/ui";
import { Button } from "@/components/ui";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { FeatureEntitlementSource, FeatureReleaseStatus, SubscriptionRequestStatus, type SubscriptionFeatureEntitlement, type SubscriptionRequestRecord, type TenantSubscriptionView } from "@rental-os/shared";
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
  return <PageHeader title="租户订阅详情" description={t("订阅操作不会解除安全冻结。")}
    extra={<Button onClick={() => navigate(APP_ROUTES.platformSubscriptions.path)}>{t("返回列表")}</Button>}
    view={<QueryState loading={query.isLoading}>
      {query.error || !query.data ? <Alert type="error" showIcon message={t("租户订阅详情加载失败")} action={<Button onClick={() => query.refetch()}>{t("重试")}</Button>} />
        : <TableRefreshProvider onRefresh={() => query.refetch()} busy={query.isFetching}><DetailBody key={id} data={query.data} tenantId={id} /></TableRefreshProvider>}
    </QueryState>} />;
}

function DetailBody({ data, tenantId }: { data: TenantSubscriptionView; tenantId: string }) {
  const { t } = useLocale();
  const { overview, entitlements, requests, changeLog } = data;
  const [grant, setGrant] = useState<{ mode: "grant" | "revoke"; feature: SubscriptionFeatureEntitlement; revision: number } | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<SubscriptionRequestRecord | undefined>();
  const [actionOpen, setActionOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const actionDialog = useModalDismissal(actionOpen, () => { setActionOpen(false); setSelectedRequest(undefined); setActionBusy(false); });
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
    { title: t("申请"), key: "type", render: (_, row) => <DataTableText primary={t(REQUEST_TYPE_LABEL[row.type])} secondary={row.id} /> },
    { title: t("状态"), key: "status", render: (_, row) => <Tag color={REQUEST_STATUS_TONE[row.status]}>{t(REQUEST_STATUS_LABEL[row.status])}</Tag> },
    { title: t("提交时间"), key: "submitted", render: (_, row) => formatSubscriptionDate(row.submittedAt, overview.timeZone, t) },
    { title: t("办理金额 / 期间"), key: "handled", render: (_, row) => `${t(formatMoney(row.handledAmount))} · ${row.periodText || t("尚未登记")}` },
    { title: t("操作"), key: "action", render: (_, row) => <DataTableRowActions details={() => setDetails(row.id)} detailLabel={t("查看详情")} menuLabel={`${row.id} · ${t("更多操作")}`}
      primary={row.status === SubscriptionRequestStatus.Pending ? { id: "handle", label: t(operationForRequest(row) ? "办理授权" : "登记处理"), icon: ClipboardCheck, onSelect: () => {
        if (operationForRequest(row)) { setSelectedRequest(structuredClone(row)); setActionOpen(true); }
        else setHandling({ request: structuredClone(row), status: SubscriptionRequestStatus.Processed, revision: overview.revision });
      } } : undefined}
      actions={row.status === SubscriptionRequestStatus.Pending ? [
        { id: "details", label: t("查看详情"), icon: FileText, onSelect: () => setDetails(row.id) },
        { id: "reject", label: t("拒绝"), icon: XCircle, danger: true, onSelect: () => setHandling({ request: structuredClone(row), status: SubscriptionRequestStatus.Rejected, revision: overview.revision }) },
      ] : []} /> }
  ];

  return <div className={styles.stack}>
    <section className={styles.summary} aria-label={t("当前套餐与期限")}>
      <div className={styles.identity}><strong>{overview.tenantName}</strong><Tag>{t(PLAN_LABEL[overview.plan])}</Tag><Tag color={overview.serviceStatus === "active" ? "success" : "default"}>{t(SERVICE_STATUS_LABEL[overview.serviceStatus])}</Tag>
        <Button type="primary" onClick={() => { setSelectedRequest(undefined); setActionOpen(true); }}>{t("办理订阅")}</Button>
      </div>
      <RecordFacts items={[
        { key: "code", label: "租户编码", value: overview.tenantCode },
        { key: "period", label: "统一起止 [开始, 截止)", value: !overview.startAt && !overview.endAt ? t("待平台确认") : `${formatSubscriptionDate(overview.startAt, overview.timeZone, t)} ~ ${formatSubscriptionDate(overview.endAt, overview.timeZone, t)}` },
        { key: "amount", label: "本期确认金额", value: t(formatMoney(overview.currentAmount)) },
        { key: "next", label: "待生效套餐", value: overview.next ? `${t(PLAN_LABEL[overview.next.plan])} · ${formatSubscriptionDate(overview.next.effectiveAt, overview.timeZone, t)}` : t("无") },
      ]} />
    </section>
    <Tabs aria-label={t("租户订阅详情")} items={[
      { key: "requests", label: t("申请与办理"), children: <ListSection>
        <Table<SubscriptionRequestRecord> rowKey="id" size="small" columns={requestColumns} dataSource={requests} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 850 }} />
      </ListSection> },
      { key: "features", label: t("额外功能授权"), children: <ListSection>
      <Alert type="info" showIcon  message={t("仅可对已上线 / 受控试点功能向当前租户授权，不要求整体升级，不改变期限。公共下放在功能目录中维护；撤销须记录原因并保护既有业务。")} />
      <Table<SubscriptionFeatureEntitlement> rowKey="code" size="small" columns={entitlementColumns} dataSource={entitlements} pagination={{ pageSize: 20, hideOnSinglePage: true }} scroll={{ x: 700 }} />
    </ListSection>
      },
      { key: "history", label: t("订阅变更记录"), children: <ListSection>
      {!changeLog.length ? <Empty description={t("暂无变更记录")} /> : <Table rowKey="id" dataSource={changeLog} pagination={{ defaultPageSize: 20 }} columns={[
        { title: t("变更"), render: (_, entry) => <DataTableText primary={t(entry.action)} secondary={formatSubscriptionDate(entry.effectiveAt, overview.timeZone, t)} /> },
        { title: t("变更前"), dataIndex: "beforeText", render: value => value || "—" },
        { title: t("变更后"), dataIndex: "afterText", render: value => value || "—" },
        { title: t("原因"), dataIndex: "reason", render: value => value || "—" },
        { title: t("平台内部备注"), dataIndex: "internalNote", render: value => value || "—" },
      ]} />}
      </ListSection> },
    ]} />
    <Modal presentation="side" open={actionDialog.visible} title={t("办理订阅")} width={760} footer={null} destroyOnHidden
      onCancel={actionDialog.dismiss} afterClose={actionDialog.afterClose} closable={!actionBusy} keyboard={!actionBusy} maskClosable={!actionBusy}>
      {!selectedStillPending ? <Alert type="warning" title={t("所选申请已不再待处理，请取消关联并查看最新记录")} /> : <PlatformSubscriptionActionForm key={selectedRequest?.id ?? "direct"} tenantId={tenantId} overview={overview} standardPricing={data.standardPricing} request={selectedRequest} onPendingChange={setActionBusy} onSaved={actionDialog.dismiss} />}
    </Modal>
    {grant && <TenantFeatureGrantModal open mode={grant.mode} tenantId={tenantId} feature={grant.feature} expectedRevision={grant.revision} onClose={() => setGrant(null)} />}
    {handling && <RequestHandlingModal tenantId={tenantId} {...handling} onClose={() => setHandling(null)} />}
    <Modal presentation="side" open={Boolean(details)} title={t("申请详情与处理过程")} footer={null} width={880} onCancel={() => setDetails(null)}>
      {requests.find((r) => r.id === details) && <SubscriptionRequestDetails request={requests.find((r) => r.id === details)!} timeZone={overview.timeZone} />}
    </Modal>
  </div>;
}

function RequestHandlingModal({ tenantId, request, status, revision, onClose }: { tenantId: string; request: SubscriptionRequestRecord; status: SubscriptionRequestStatus; revision: number; onClose: () => void }) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ publicReason: string }>();
  const dismissal = useModalDismissal(true, onClose);
  const mutation = useMutation({
    mutationFn: ({ publicReason }: { publicReason: string }) => subscriptionApi.handleRequest(request.id, requestHandlingPayload(request, status, revision, publicReason)),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["subscription", "platform-detail", tenantId] }), queryClient.invalidateQueries({ queryKey: ["subscription", "platform-list"] }), queryClient.invalidateQueries({ queryKey: ["subscription", "tenant-view"] }), queryClient.invalidateQueries({ queryKey: ["subscription", "reminder"] })]);
      message.success(t("处理结果已保存")); dismissal.dismiss();
    },
    onError: (error) => message.error(subscriptionError(error))
  });
  return <Modal open={dismissal.visible} afterClose={dismissal.afterClose} title={t(status === SubscriptionRequestStatus.Rejected ? "拒绝申请" : "登记咨询 / 到期不续费结果")} onCancel={dismissal.dismiss} onConfirm={() => form.validateFields().then((values) => mutation.mutateAsync(values))} confirmLoading={mutation.isPending}
    closable={!mutation.isPending} keyboard={!mutation.isPending} maskClosable={!mutation.isPending} cancelButtonProps={{ disabled: mutation.isPending }}>
    <Alert type="info" message={t("处理原因对租户可见；登记咨询或不续费不改变当前已付费期限，不自动获得基础版授权。")} style={{ marginBottom: 12 }} />
    {mutation.error && <Alert type="error" message={subscriptionError(mutation.error)} style={{ marginBottom: 12 }} />}
    <Form form={form} layout="vertical" disabled={mutation.isPending} onFinish={(values) => mutation.mutate(values)}>
      <Form.Item name="publicReason" label={t("可公开原因")} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} maxLength={500} /></Form.Item>
    </Form>
  </Modal>;
}
