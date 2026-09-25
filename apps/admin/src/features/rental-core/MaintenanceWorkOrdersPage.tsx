import { useNavigate } from "react-router-dom";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type {
  CreateRentalWorkOrderRequest,
  CancelRentalWorkOrderRequest,
  RentalStockDisposition,
  RentalWorkOrder,
  RentalWorkOrderType,
  ReviewRentalWorkOrderRequest,
  SubmitRentalWorkOrderRequest
} from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Descriptions, Empty, Form, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

const WORK_ORDER_TYPE_LABELS: Record<RentalWorkOrderType, string> = {
  cleaning: "清洁",
  restock: "补货/缺件",
  calibration: "校准",
  repair: "维修"
};

const WORK_ORDER_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "待处理", color: "default" },
  in_progress: { label: "处理中", color: "processing" },
  pending_review: { label: "待验收", color: "warning" },
  completed: { label: "已完成", color: "success" },
  rejected: { label: "验收驳回", color: "error" },
  cancelled: { label: "已取消", color: "default" }
};

const DISPOSITION_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  buffered: { label: "周转缓冲", color: "processing" },
  blocked: { label: "异常隔离", color: "error" },
  restored: { label: "已恢复可用", color: "success" },
  written_off: { label: "已核销", color: "default" }
};

type DialogKind = "create" | "assign" | "submit" | "review" | "cancel" | "history" | "detail" | "writeoff";
type SubmitFormValues = SubmitRentalWorkOrderRequest & { attachmentsText?: string };

function dateTime(value: string | undefined, locale: "zh-CN" | "en-US") {
  if (!value) return "-";
  return new Date(value).toLocaleString(locale, { hour12: false });
}

export function MaintenanceWorkOrdersPage() {
  const { message } = App.useApp();
  const { locale, t } = useLocale();
  const queryClient = useQueryClient();
  const canManage = useAuthStore((state) => state.hasPermission("rental-core:maintenance:manage"));
  const canReview = useAuthStore((state) => state.hasPermission("rental-core:maintenance:review"));
  const canViewOrders = useAuthStore((state) => state.hasPermission("rental-os:order:view"));
  const canRestore = useAuthStore((state) => state.hasPermission("rental-core:maintenance:review") || state.hasPermission("rental-core:asset:manage"));
  const [dialog, setDialog] = useState<DialogKind>();
  const [activeWorkOrder, setActiveWorkOrder] = useState<RentalWorkOrder>();
  const [createForm] = Form.useForm<CreateRentalWorkOrderRequest>();
  const [assignForm] = Form.useForm<{ assigneeId?: string }>();
  const [submitForm] = Form.useForm<SubmitFormValues>();
  const [reviewForm] = Form.useForm<ReviewRentalWorkOrderRequest>();
  const [cancelForm] = Form.useForm<CancelRentalWorkOrderRequest>();
  const [writeOffForm] = Form.useForm<{ reason: string }>();
  const [writeOffTarget, setWriteOffTarget] = useState<RentalStockDisposition>();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>();
  const [typeFilter, setTypeFilter] = useState<RentalWorkOrderType>();
  const [assigneeFilter, setAssigneeFilter] = useState<string>();
  const [resourceFilter, setResourceFilter] = useState("");

  const dispositions = useQuery({ queryKey: ["rental-core", "stock-dispositions"], queryFn: () => rentalCoreApi.stockDispositions() });
  const workOrders = useQuery({ queryKey: ["rental-core", "work-orders"], queryFn: () => rentalCoreApi.workOrders() });
  const selectedDispositionId = Form.useWatch("dispositionId", createForm);
  const selectedDisposition = (dispositions.data ?? []).find((row) => row.id === selectedDispositionId);
  const assigneeLocationId = dialog === "create"
    ? selectedDisposition?.locationId
    : dialog === "assign"
      ? activeWorkOrder?.locationId
      : undefined;
  const assignees = useQuery({
    queryKey: ["rental-core", "work-order-assignees", assigneeLocationId ?? null],
    queryFn: () => rentalCoreApi.workOrderAssignees(assigneeLocationId)
  });
  const history = useQuery({ queryKey: ["rental-core", "work-order-history", activeWorkOrder?.id], queryFn: () => rentalCoreApi.workOrderHistory(activeWorkOrder!.id), enabled: dialog === "history" && Boolean(activeWorkOrder) });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["rental-core", "stock-dispositions"] }),
      queryClient.invalidateQueries({ queryKey: ["rental-core", "work-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["rental-core", "stocks"] }),
      queryClient.invalidateQueries({ queryKey: ["rental-core", "assets"] })
    ]);
  };

  const run = useMutation({
    mutationFn: async (input: { kind: "create"; data: CreateRentalWorkOrderRequest } | { kind: "assign"; id: string; data: { assigneeId?: string } } | { kind: "start"; id: string } | { kind: "submit"; id: string; data: SubmitRentalWorkOrderRequest } | { kind: "review"; id: string; data: ReviewRentalWorkOrderRequest } | { kind: "cancel"; id: string; data: CancelRentalWorkOrderRequest } | { kind: "restore"; id: string } | { kind: "writeoff"; id: string; reason: string }) => {
      if (input.kind === "create") return rentalCoreApi.createWorkOrder(input.data);
      if (input.kind === "assign") return rentalCoreApi.assignWorkOrder(input.id, input.data);
      if (input.kind === "start") return rentalCoreApi.startWorkOrder(input.id);
      if (input.kind === "submit") return rentalCoreApi.submitWorkOrder(input.id, input.data);
      if (input.kind === "review") return rentalCoreApi.reviewWorkOrder(input.id, input.data);
      if (input.kind === "cancel") return rentalCoreApi.cancelWorkOrder(input.id, input.data);
      if (input.kind === "writeoff") return rentalCoreApi.writeOffStockDisposition(input.id, input.reason);
      return rentalCoreApi.restoreStockDisposition(input.id);
    },
    onSuccess: async () => {
      await refresh();
      setDialog(undefined);
      setActiveWorkOrder(undefined);
      createForm.resetFields();
      assignForm.resetFields();
      submitForm.resetFields();
      reviewForm.resetFields();
      cancelForm.resetFields();
      writeOffForm.resetFields();
      setWriteOffTarget(undefined);
       message.success(t("操作已完成"));
    },
    onError: (error: Error) => message.error(error.message || t("操作失败，请刷新后重试"))
  });

  function openDialog(kind: DialogKind, workOrder?: RentalWorkOrder) {
    setActiveWorkOrder(workOrder);
    setDialog(kind);
  }

  const workOrderDispositions = (dispositions.data ?? []).filter((row) => row.status === "buffered" || row.status === "blocked");
  const availableForRestore = (row: RentalStockDisposition) => row.status === "buffered" && Date.parse(row.bufferUntil) <= Date.now();
  const openWriteOff = (row: RentalStockDisposition) => {
    setWriteOffTarget(row);
    writeOffForm.resetFields();
    setDialog("writeoff");
  };
  useEffect(() => {
    if (dialog === "create") {
      createForm.setFieldsValue({ type: "repair", dispositionId: workOrderDispositions[0]?.id });
    }
  }, [createForm, dialog, workOrderDispositions[0]?.id]);
  useEffect(() => {
    if (dialog === "assign") {
      assignForm.setFieldsValue({ assigneeId: activeWorkOrder?.assigneeId });
    }
  }, [activeWorkOrder?.assigneeId, assignForm, dialog]);
  const filteredWorkOrders = (workOrders.data ?? []).filter((row) => {
    if (statusFilter && row.status !== statusFilter) return false;
    if (typeFilter && row.type !== typeFilter) return false;
    if (assigneeFilter && row.assigneeId !== assigneeFilter) return false;
    const keyword = resourceFilter.trim().toLowerCase();
    if (keyword && ![row.workNo, row.itemGroupId, row.locationId, row.assetId, row.orderId].some((value) => value?.toLowerCase().includes(keyword))) return false;
    return true;
  });
  const loading = dispositions.isLoading || workOrders.isLoading || assignees.isLoading;
  const error = dispositions.error || workOrders.error || assignees.error;

  return <>
    <PageHeader
      title={t("养护工单")}
      description={t("归还后的周转缓冲、异常隔离和养护处理在这里闭环；未完成验收的异常库存不能恢复可用。")}
      extra={<Space><Button icon={<ReloadOutlined />} onClick={() => refresh()}>{t("刷新")}</Button>{canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => openDialog("create")}>{t("新建工单")}</Button>}</Space>}
    />
    <QueryState loading={loading} error={error}>
      <Alert type="info" showIcon title={t("库存恢复规则")} description={t("周转缓冲结束后可直接恢复；异常隔离必须先完成养护工单并通过验收。恢复动作在服务端按租户、经营空间和剩余数量原子执行，重复点击不会重复加回库存。")} style={{ marginBottom: 16 }} />
      <Card title={`${t("归还处置")}（${dispositions.data?.length ?? 0}）`} style={{ marginBottom: 16 }}>
        <Table<RentalStockDisposition> rowKey="id" dataSource={dispositions.data ?? []} pagination={{ pageSize: 8 }} scroll={{ x: 1050 }} locale={{ emptyText: <Empty description={t("暂无归还处置记录")} /> }} columns={[
          { title: t("状态"), width: 110, render: (_, row) => { const status = DISPOSITION_STATUS_LABELS[row.status] ?? { label: row.status, color: "default" }; return <Tag color={status.color}>{t(status.label)}</Tag>; } },
          { title: t("商品/资产"), render: (_, row) => <><b>{row.itemGroupId}</b>{row.assetId && <><br /><Typography.Text type="secondary">{t("资产")}：{row.assetId}</Typography.Text></>}</> },
          { title: t("数量"), dataIndex: "quantity", width: 80, align: "right" },
          { title: t("接收时间"), dataIndex: "receivedAt", width: 180, render: (value: string) => dateTime(value, locale) },
          { title: t("缓冲结束"), dataIndex: "bufferUntil", width: 180, render: (value: string) => dateTime(value, locale) },
          { title: t("阻断原因"), dataIndex: "blockReason", render: (value) => value || "-" },
          { title: t("操作"), fixed: "right", width: 190, render: (_, row) => <Space size={0} wrap>
            {row.status === "buffered" && canRestore && <Button type="link" disabled={!availableForRestore(row)} loading={run.isPending} onClick={() => run.mutate({ kind: "restore", id: row.id })}>{availableForRestore(row) ? t("恢复可用") : t("缓冲中")}</Button>}
            {row.status === "blocked" && !row.assetId && canRestore && <Button type="link" danger loading={run.isPending} onClick={() => openWriteOff(row)}>{t("核销库存")}</Button>}
            {row.status !== "buffered" && row.status !== "blocked" ? t(DISPOSITION_STATUS_LABELS[row.status]?.label ?? row.status) : null}
            {row.status === "blocked" && row.assetId ? "-" : null}
          </Space> }
        ]} />
      </Card>
      <Card title={`${t("养护工单")}（${filteredWorkOrders.length}/${workOrders.data?.length ?? 0}）`}>
        <Space wrap style={{ marginBottom: 16 }}>
          <Select allowClear value={statusFilter} onChange={setStatusFilter} placeholder={t("状态")} style={{ width: 130 }} options={Object.entries(WORK_ORDER_STATUS_LABELS).map(([value, item]) => ({ value, label: t(item.label) }))} />
          <Select allowClear value={typeFilter} onChange={setTypeFilter} placeholder={t("类型")} style={{ width: 130 }} options={Object.entries(WORK_ORDER_TYPE_LABELS).map(([value, label]) => ({ value, label: t(label) }))} />
          <Select allowClear value={assigneeFilter} onChange={setAssigneeFilter} placeholder={t("负责人")} style={{ width: 190 }} options={assignees.data?.map((item) => ({ value: item.id, label: item.displayName }))} />
          <Input allowClear value={resourceFilter} onChange={(event) => setResourceFilter(event.target.value)} placeholder={t("搜索工单、商品、资产、地点或订单")} style={{ width: 280 }} />
          <Button onClick={() => { setStatusFilter(undefined); setTypeFilter(undefined); setAssigneeFilter(undefined); setResourceFilter(""); }}>{t("清除筛选")}</Button>
        </Space>
        <Table<RentalWorkOrder> rowKey="id" dataSource={filteredWorkOrders} pagination={{ pageSize: 8 }} scroll={{ x: 1280 }} locale={{ emptyText: <Empty description={t("暂无匹配的养护工单")} /> }} columns={[
          { title: t("工单号"), dataIndex: "workNo", width: 190 },
          {
            title: t("来源订单"),
            dataIndex: "orderId",
            width: 150,
            render: (value: string | undefined) =>
              value && canViewOrders ? (
                <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/rental/orders/${value}`)}>
                  {value.slice(0, 14)}…
                </Button>
              ) : value ? (
                <Typography.Text type="secondary">{value.slice(0, 14)}…</Typography.Text>
              ) : (
                "-"
              ),
          },
          { title: t("类型"), dataIndex: "type", width: 110, render: (value: RentalWorkOrderType) => t(WORK_ORDER_TYPE_LABELS[value] ?? value) },
          { title: t("状态"), dataIndex: "status", width: 110, render: (value) => { const status = WORK_ORDER_STATUS_LABELS[value] ?? { label: value, color: "default" }; return <Tag color={status.color}>{t(status.label)}</Tag>; } },
          { title: t("原因"), dataIndex: "reason", width: 260 },
          { title: t("处理人"), render: (_, row) => row.assigneeName || row.assigneeId || t("未派工") },
          { title: t("更新时间"), dataIndex: "updatedAt", width: 180, render: (value: string) => dateTime(value, locale) },
          { title: t("操作"), fixed: "right", width: 310, render: (_, row) => <Space size={0} wrap>
            {canManage && ["pending", "in_progress"].includes(row.status) && <Button type="link" onClick={() => openDialog("assign", row)}>{t("派工")}</Button>}
            {canManage && row.status === "pending" && <Button type="link" onClick={() => run.mutate({ kind: "start", id: row.id })}>{t("开始处理")}</Button>}
            {canManage && row.status === "in_progress" && <Button type="link" onClick={() => openDialog("submit", row)}>{t("提交验收")}</Button>}
            {canReview && row.status === "pending_review" && <Button type="link" onClick={() => openDialog("review", row)}>{t("验收")}</Button>}
            {canManage && ["pending", "in_progress", "pending_review"].includes(row.status) && <Button type="link" danger onClick={() => openDialog("cancel", row)}>{t("取消")}</Button>}
            <Button type="link" onClick={() => openDialog("detail", row)}>{t("详情")}</Button>
            <Button type="link" onClick={() => openDialog("history", row)}>{t("历史")}</Button>
            {row.status === "completed" && <Typography.Text type="secondary">{t("已完成")}</Typography.Text>}
          </Space> }
        ]} />
      </Card>
    </QueryState>

    <Modal title={t("新建养护工单")} open={dialog === "create"} confirmLoading={run.isPending} onCancel={() => setDialog(undefined)} onOk={() => createForm.submit()} destroyOnHidden>
      <Form form={createForm} layout="vertical" onFinish={(data) => run.mutate({ kind: "create", data })}>
        <Form.Item name="dispositionId" label={t("归还处置")} rules={[{ required: true, message: t("请选择归还处置") }]}><Select options={workOrderDispositions.map((row) => ({ value: row.id, label: `${row.itemGroupId} · ${row.blockReason || (row.status === "buffered" ? t("周转清洁") : t("异常隔离"))} · ${row.quantity} ${t("件")}` }))} placeholder={t("选择待处理的归还处置")} /></Form.Item>
        <Form.Item name="type" label={t("工单类型")} rules={[{ required: true }]}><Select options={Object.entries(WORK_ORDER_TYPE_LABELS).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item>
        <Form.Item name="assigneeId" label={t("处理人")}><Select allowClear options={assignees.data?.map((item) => ({ value: item.id, label: `${item.displayName} · ${item.account}` }))} placeholder={t("可稍后派工")} /></Form.Item>
        <Form.Item name="reason" label={t("处理要求")}><Input.TextArea rows={3} placeholder={t("可补充清洁、维修或缺件处理要求")} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={t("核销异常库存")} open={dialog === "writeoff"} confirmLoading={run.isPending} okText={t("确认核销")} okButtonProps={{ danger: true }} onCancel={() => setDialog(undefined)} onOk={() => writeOffForm.submit()} destroyOnHidden>
      <Alert type="warning" showIcon title={t("核销后该数量将从在手库存中扣除，且不能恢复；请确认商品已无法修复。")} style={{ marginBottom: 16 }} />
      <Form form={writeOffForm} layout="vertical" onFinish={({ reason }) => writeOffTarget && run.mutate({ kind: "writeoff", id: writeOffTarget.id, reason })}>
        <Form.Item name="reason" label={t("核销原因")} rules={[{ required: true, whitespace: true, message: t("请填写核销原因") }, { max: 500, message: t("核销原因不能超过 500 个字符") }]}>
          <Input.TextArea rows={4} maxLength={500} showCount placeholder={t("说明无法修复或继续使用的原因")} />
        </Form.Item>
      </Form>
    </Modal>
    <Modal title={`${t("派工")}：${activeWorkOrder?.workNo ?? ""}`} open={dialog === "assign"} confirmLoading={run.isPending} onCancel={() => setDialog(undefined)} onOk={() => assignForm.submit()} destroyOnHidden>
      <Form form={assignForm} layout="vertical" onFinish={(data) => activeWorkOrder && run.mutate({ kind: "assign", id: activeWorkOrder.id, data })}>
        <Form.Item name="assigneeId" label={t("当前空间运营账号")}><Select allowClear options={assignees.data?.map((item) => ({ value: item.id, label: `${item.displayName} · ${item.account}` }))} placeholder={t("清除派工可留空")} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={`${t("提交验收")}：${activeWorkOrder?.workNo ?? ""}`} open={dialog === "submit"} confirmLoading={run.isPending} onCancel={() => setDialog(undefined)} onOk={() => submitForm.submit()} destroyOnHidden>
      <Form form={submitForm} layout="vertical" onFinish={({ attachmentsText, ...data }) => activeWorkOrder && run.mutate({ kind: "submit", id: activeWorkOrder.id, data: { ...data, attachments: attachmentsText?.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean) } })}>
        <Form.Item name="result" label={t("处理结果")} rules={[{ required: true, message: t("请填写处理结果") }]}><Input.TextArea rows={4} placeholder={t("说明完成了什么处理、检查结果是什么")} /></Form.Item>
        <Form.Item name="attachmentsText" label={t("证据附件引用")}><Input.TextArea rows={3} placeholder={t("填写文件服务返回的附件引用，每行一个；不填写本地路径")} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={`${t("验收工单")}：${activeWorkOrder?.workNo ?? ""}`} open={dialog === "review"} confirmLoading={run.isPending} onCancel={() => setDialog(undefined)} onOk={() => reviewForm.submit()} destroyOnHidden>
      <Descriptions size="small" column={1} style={{ marginBottom: 16 }} items={[{ key: "reason", label: t("处理原因"), children: activeWorkOrder?.reason }, { key: "result", label: t("处理结果"), children: activeWorkOrder?.result || t("尚未提交") }]} />
      <Form form={reviewForm} layout="vertical" onFinish={(data) => activeWorkOrder && run.mutate({ kind: "review", id: activeWorkOrder.id, data })}>
        <Form.Item name="decision" label={t("验收结论")} rules={[{ required: true }]}><Select options={[{ value: "approved", label: t("通过并进入周转缓冲") }, { value: "rejected", label: t("驳回，继续隔离") }]} /></Form.Item>
        <Form.Item name="reason" label={t("验收说明")} rules={[{ required: true, message: t("请填写验收说明") }]}><Input.TextArea rows={3} placeholder={t("填写通过或驳回的依据")} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={`${t("取消工单")}：${activeWorkOrder?.workNo ?? ""}`} open={dialog === "cancel"} confirmLoading={run.isPending} onCancel={() => setDialog(undefined)} onOk={() => cancelForm.submit()} destroyOnHidden>
      <Form form={cancelForm} layout="vertical" onFinish={(data) => activeWorkOrder && run.mutate({ kind: "cancel", id: activeWorkOrder.id, data })}>
        <Alert type="warning" showIcon title={t("取消不会恢复库存")} description={t("取消只结束当前工单；关联资源会继续保持异常隔离，后续必须重新建立并通过养护验收。")} style={{ marginBottom: 16 }} />
        <Form.Item name="reason" label={t("取消原因")} rules={[{ required: true, message: t("请填写取消原因") }]}><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={`${t("养护工单详情")}：${activeWorkOrder?.workNo ?? ""}`} open={dialog === "detail"} footer={null} onCancel={() => setDialog(undefined)} destroyOnHidden>
      <Descriptions column={1} bordered size="small" items={[
        { key: "status", label: t("状态"), children: activeWorkOrder && t(WORK_ORDER_STATUS_LABELS[activeWorkOrder.status]?.label ?? activeWorkOrder.status) },
        { key: "type", label: t("类型"), children: activeWorkOrder && t(WORK_ORDER_TYPE_LABELS[activeWorkOrder.type]) },
        { key: "source", label: t("来源"), children: activeWorkOrder && `${activeWorkOrder.orderId ?? "-"} / ${activeWorkOrder.dispositionId ?? "-"}` },
        { key: "resource", label: t("资源"), children: activeWorkOrder && `${activeWorkOrder.itemGroupId} · ${activeWorkOrder.locationId}${activeWorkOrder.assetId ? ` · ${activeWorkOrder.assetId}` : ""}` },
        { key: "quantity", label: t("数量"), children: activeWorkOrder?.quantity },
        { key: "assignee", label: t("负责人"), children: activeWorkOrder?.assigneeName || t("未派工") },
        { key: "reason", label: t("处理原因"), children: activeWorkOrder?.reason },
        { key: "result", label: t("处理结果"), children: activeWorkOrder?.result || "-" },
        { key: "attachments", label: t("证据引用"), children: activeWorkOrder?.attachments?.length ? activeWorkOrder.attachments.join("、") : "-" },
        { key: "review", label: t("验收"), children: activeWorkOrder?.reviewReason ? `${activeWorkOrder.reviewReason}${activeWorkOrder.reviewedBy ? `（${activeWorkOrder.reviewedBy}）` : ""}` : "-" }
      ]} />
    </Modal>
    <Modal title={`${t("工单历史")}：${activeWorkOrder?.workNo ?? ""}`} open={dialog === "history"} footer={null} onCancel={() => setDialog(undefined)} destroyOnHidden>
      <Table rowKey="id" size="small" loading={history.isLoading} dataSource={history.data ?? []} pagination={false} locale={{ emptyText: t("暂无操作记录") }} columns={[{ title: t("时间"), dataIndex: "createdAt", width: 180, render: (value: string) => dateTime(value, locale) }, { title: t("动作"), dataIndex: "action", render: (value) => value.replace("rental.work_order.", "") }, { title: t("操作人"), dataIndex: "operator", width: 110 }, { title: t("说明"), dataIndex: "detail" }]} />
    </Modal>
  </>;
}
