import { WorkOrderBoard } from "./WorkOrderBoard";
import type { WorkOrderBoardAction } from "./workOrderBoardPolicy";
import { ActionButton, AnimatedNumber, Segmented } from "@/components/ui";
import { ListFilterItem } from "@/components/ui";
import { RecordDisclosure } from "@/components/RecordDisclosure";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PlusOutlined } from "@/components/ui/icons";
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
import { Descriptions, Space, Tag, Typography } from "antd";
import { ListSection, App, Empty, Modal } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, Table } from "@/components/ui";
import { Input } from "@/components/ui";
import { RecordDetailLayout, RecordFacts } from "@/components/RecordDetailLayout";
import recordStyles from "@/components/RecordDetailLayout.module.css";
import { Button, DataTableRowActions, DataTableStatus, DataTableText, SearchField, Select, Tabs } from "@/components/ui";
import { ClipboardCheck, Columns3, FileText, History, List, Play, UserRoundPen, X } from "lucide-react";
import type { DataTableRowAction } from "@/components/ui/data-table/DataTableRowActions";
import { useEffect, useState } from "react";
import { useServerFormSync } from "@/app/useServerFormSync";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { ContentTransition } from "@/components/workspace/ContentTransition";
import { useModalDismissal } from "@/components/ui/useModalDismissal";
import { useAuthStore } from "@/features/auth/authStore";
import { UNASSIGNED_WORK_ORDER } from "./workOrderBoardPolicy";
import styles from "./WorkOrderBoard.module.css";

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
function dateCell(value: string | undefined, locale: "zh-CN" | "en-US") {
  return value ? <DataTableText primary={new Date(value).toLocaleDateString(locale)} secondary={new Date(value).toLocaleTimeString(locale, { hour12: false })} /> : "—";
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
  const [actionWorkOrder, setActiveWorkOrder] = useState<RentalWorkOrder>();
  const [boardAssignment, setBoardAssignment] = useState<{ workOrderId: string; assigneeId?: string }>();
  const boardScope = useAuthStore(state => JSON.stringify([state.tenant?.tenantId, state.currentWorkspaceId, state.user?.id, state.user?.permissions, state.user?.dataScope, state.user?.locationScope]));
  const { workOrderId } = useParams<{ workOrderId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const detailTab = searchParams.get("tab") === "history" ? "history" : "detail";
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
  const [workView,setWorkView] = useState("board");
  const [mainView,setMainView] = useState("work");
  function resetActionForm(kind: DialogKind | undefined) {
    if (kind === "create") createForm.resetFields();
    if (kind === "assign") assignForm.resetFields();
    if (kind === "submit") submitForm.resetFields();
    if (kind === "review") reviewForm.resetFields();
    if (kind === "cancel") cancelForm.resetFields();
    if (kind === "writeoff") writeOffForm.resetFields();
  }
  function clearAction() {
    resetActionForm(dialog);
    setDialog(undefined);
    setActiveWorkOrder(undefined);
    setWriteOffTarget(undefined);
    setBoardAssignment(undefined);
  }
  const actionDialog = useModalDismissal(Boolean(dialog), clearAction);

  const dispositions = useQuery({ queryKey: ["rental-core", "stock-dispositions", boardScope], queryFn: () => rentalCoreApi.stockDispositions() });
  const workOrders = useQuery({ queryKey: ["rental-core", "work-orders", boardScope], queryFn: () => rentalCoreApi.workOrders() });
  const activeWorkOrder = workOrderId ? workOrders.data?.find(row => row.id === workOrderId) : actionWorkOrder;
  const selectedDispositionId = Form.useWatch("dispositionId", createForm);
  const selectedDisposition = (dispositions.data ?? []).find((row) => row.id === selectedDispositionId);
  const assigneeLocationId = dialog === "create"
    ? selectedDisposition?.locationId
    : dialog === "assign"
      ? activeWorkOrder?.locationId
      : undefined;
  const assignees = useQuery({
    queryKey: ["rental-core", "work-order-assignees", boardScope, null],
    queryFn: () => rentalCoreApi.workOrderAssignees(),
    enabled: !workOrderId,
  });
  // Location-specific candidates belong to the action form. A failed directory
  // read must not remove the work-order board or masquerade as no assignee.
  const assignmentCandidates = useQuery({
    queryKey: ["rental-core", "work-order-assignees", boardScope, assigneeLocationId ?? null],
    queryFn: () => rentalCoreApi.workOrderAssignees(assigneeLocationId),
    enabled: (dialog === "create" || dialog === "assign") && Boolean(assigneeLocationId),
  });
  const history = useQuery({ queryKey: ["rental-core", "work-order-history", boardScope, activeWorkOrder?.id], queryFn: () => rentalCoreApi.workOrderHistory(activeWorkOrder!.id), enabled: Boolean(workOrderId && detailTab === "history" && activeWorkOrder) });
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
      if (dialog) actionDialog.dismiss();
      else clearAction();
       message.success(t("操作已完成"));
    },
    onError: (error: Error) => message.error(error.message || t("操作失败，请刷新后重试"))
  });

  function openDialog(kind: DialogKind, workOrder?: RentalWorkOrder) {
    if ((kind === "detail" || kind === "history") && workOrder) {
      navigate(`/rental/work-orders/${encodeURIComponent(workOrder.id)}${kind === "history" ? "?tab=history" : ""}`);
      return;
    }
    if (run.isPending || dialog) return;
    resetActionForm(kind);
    if (kind === "create") createForm.setFieldsValue({ type: "repair", dispositionId: workOrderDispositions[0]?.id });
    setActiveWorkOrder(workOrder);
    setBoardAssignment(undefined);
    setDialog(kind);
  }

  async function handleBoardAction(row: RentalWorkOrder, action: WorkOrderBoardAction) {
    const session = useAuthStore.getState();
    if (JSON.stringify([session.tenant?.tenantId, session.currentWorkspaceId, session.user?.id, session.user?.permissions, session.user?.dataScope, session.user?.locationScope]) !== boardScope) return;
    const current = workOrders.data?.find(item => item.id === row.id);
    if (run.isPending || !current || current.updatedAt !== row.updatedAt) {
      message.warning(t("工单已更新，请重新拖动"));
      return;
    }
    if (action.kind === "review" ? !canReview : !canManage) {
      message.warning(t("当前账号无权执行此操作"));
      return;
    }
    if (action.kind === "start") return run.mutateAsync({ kind: "start", id: row.id });
    openDialog(action.kind, row);
    if (action.kind === "assign") setBoardAssignment({ workOrderId: row.id, assigneeId: action.assigneeId });
    if (action.kind === "review") reviewForm.setFieldsValue({ decision: action.decision });
  }

  const workOrderDispositions = (dispositions.data ?? []).filter((row) => row.status === "buffered" || row.status === "blocked");
  const availableForRestore = (row: RentalStockDisposition) => row.status === "buffered" && Date.parse(row.bufferUntil) <= Date.now();
  const openWriteOff = (row: RentalStockDisposition) => {
    openDialog("writeoff");
    setWriteOffTarget(row);
  };
  useServerFormSync(assignForm, dialog === "assign" ? activeWorkOrder : undefined, () => {
    if (activeWorkOrder) {
      assignForm.setFieldsValue({ assigneeId: boardAssignment?.workOrderId === activeWorkOrder.id ? boardAssignment.assigneeId : activeWorkOrder.assigneeId });
    }
  }, `${dialog}:${activeWorkOrder?.id}`);
  const filteredWorkOrders = (workOrders.data ?? []).filter((row) => {
    if (statusFilter && row.status !== statusFilter) return false;
    if (typeFilter && row.type !== typeFilter) return false;
    if (assigneeFilter && (row.assigneeId ?? UNASSIGNED_WORK_ORDER) !== assigneeFilter) return false;
    const keyword = resourceFilter.trim().toLowerCase();
    if (keyword && ![row.workNo, row.reason, row.assigneeName, row.itemGroupId, row.locationId, row.assetId, row.orderId, row.dispositionId].some((value) => value?.toLowerCase().includes(keyword))) return false;
    return true;
  });
  useEffect(clearAction, [workOrderId, boardScope]);
  const clearFilters = () => { setStatusFilter(undefined); setTypeFilter(undefined); setAssigneeFilter(undefined); setResourceFilter(""); };
  const hasFilters = Boolean(resourceFilter.trim() || statusFilter || typeFilter || assigneeFilter);
  const modalProps = {
    confirmLoading: run.isPending, onCancel: actionDialog.dismiss, afterClose: actionDialog.afterClose, destroyOnHidden: true,
    closable: !run.isPending, keyboard: !run.isPending, maskClosable: !run.isPending, cancelButtonProps: { disabled: run.isPending },
  };
  function rowActions(row: RentalWorkOrder) {
    const actions: DataTableRowAction[] = [];
    if (canManage && ["pending", "in_progress"].includes(row.status)) actions.push({ id: "assign", label: t("派工"), icon: UserRoundPen, onSelect: () => openDialog("assign", row) });
    if (canManage && row.status === "pending") actions.push({ id: "start", label: t("开始处理"), icon: Play, onSelect: () => run.mutate({ kind: "start", id: row.id }) });
    if (canManage && row.status === "in_progress") actions.push({ id: "submit", label: t("提交验收"), icon: ClipboardCheck, onSelect: () => openDialog("submit", row) });
    if (canReview && row.status === "pending_review") actions.push({ id: "review", label: t("验收"), icon: ClipboardCheck, onSelect: () => openDialog("review", row) });
    const primary = actions.find(action => ["start", "submit", "review"].includes(action.id));
    if (primary) actions.push({ id: "detail", label: t("详情"), icon: FileText, onSelect: () => openDialog("detail", row) });
    actions.push({ id: "history", label: t("历史"), icon: History, onSelect: () => openDialog("history", row) });
    if (canManage && ["pending", "in_progress", "pending_review"].includes(row.status)) actions.push({ id: "cancel", label: t("取消"), icon: X, danger: true, onSelect: () => openDialog("cancel", row) });
    actions.forEach(action => { action.disabled = run.isPending || Boolean(dialog) || workOrders.isError; });
    return <DataTableRowActions primary={primary} actions={actions} details={() => openDialog("detail", row)} detailLabel={t("详情")} detailAccessibleLabel={`${row.workNo} · ${t("详情")}`} menuLabel={`${row.workNo} · ${t("更多操作")}`} />;
  }

  return <>
    {!workOrderId && <>
    <PageHeader
      title={t("养护工单")}
      description={t("异常隔离须完成养护并通过验收后才能恢复库存。")}
      extra={<Space wrap><ActionButton variant="secondary" label={t("刷新")} pending={workOrders.isFetching || dispositions.isFetching} onAction={() => Promise.all([workOrders.refetch({ throwOnError: true }), dispositions.refetch({ throwOnError: true }), assignees.refetch({ throwOnError: true })])} />{canManage && <Button type="primary" icon={<PlusOutlined />} disabled={run.isPending || Boolean(dialog) || dispositions.isLoading || dispositions.isError} onClick={() => openDialog("create")}>{t("新建工单")}</Button>}</Space>}
    />
      <div className={styles.viewBar}>
      <Tabs aria-label={t("工单与归还处置")} activeKey={mainView} onChange={setMainView} items={[{key:"work",label:<>{t("养护工单")} {workOrders.data && <AnimatedNumber value={workOrders.data.length}/>}</>},{key:"dispositions",label:<>{t("归还处置")} {dispositions.data && <AnimatedNumber value={dispositions.data.length}/>}</>}]}/>
      {mainView === "work" && <Segmented iconOnly aria-label={t("工单视图")} value={workView} onChange={value=>setWorkView(String(value))} options={[
        { value:"board", label:<span title={t("任务看板")} aria-label={t("任务看板")}><Columns3 size={16} aria-hidden /></span> },
        { value:"list", label:<span title={t("列表")} aria-label={t("列表")}><List size={16} aria-hidden /></span> },
      ]}/>}
      </div>
      <ContentTransition value={`${mainView}:${workView}`}>
      <div hidden={mainView!=="dispositions"}><QueryState loading={dispositions.isLoading} error={dispositions.error} onRetry={() => dispositions.refetch({ throwOnError: true })}><ListSection>
        <Table<RentalStockDisposition> rowKey="id" onRefresh={() => dispositions.refetch()} loading={dispositions.isLoading} refreshing={dispositions.isFetching} dataSource={dispositions.data ?? []} pagination={{ pageSize: 8 }} scroll={{ x: 1050 }} locale={{ emptyText: <Empty scene="empty" compact description={t("暂无归还处置记录")} /> }} columns={[
          { title: t("状态"), width: 110, render: (_, row) => { const status = DISPOSITION_STATUS_LABELS[row.status] ?? { label: row.status, color: "default" }; return <Tag color={status.color}>{t(status.label)}</Tag>; } },
          { title: t("商品/资产"), render: (_, row) => <DataTableText primary={row.itemGroupId} secondary={row.assetId && `${t("资产")}：${row.assetId}`} /> },
          { title: t("数量"), dataIndex: "quantity", width: 80, align: "right" },
          { title: t("接收时间"), dataIndex: "receivedAt", width: 180, render: (value: string) => dateCell(value, locale) },
          { title: t("缓冲结束"), dataIndex: "bufferUntil", width: 180, render: (value: string) => dateCell(value, locale) },
          { title: t("阻断原因"), dataIndex: "blockReason", minWidth: 240, render: (value) => value || "—" },
          { title: t("操作"), fixed: "right", width: 190, render: (_, row) => {
            const related = workOrders.isError ? [] : (workOrders.data ?? []).filter(item => item.dispositionId === row.id);
            return <Space size={0} wrap>
            {!!related.length && <Button type="text" size="small" icon={<FileText size={14} />} onClick={() => {
              if (related.length === 1) openDialog("detail", related[0]);
              else { clearFilters(); setResourceFilter(row.id); setMainView("work"); setWorkView("list"); }
            }}>{t("查看关联工单")}</Button>}
            {row.status === "buffered" && canRestore && <Button type="link" disabled={!availableForRestore(row)} loading={run.isPending} onClick={() => run.mutate({ kind: "restore", id: row.id })}>{availableForRestore(row) ? t("恢复可用") : t("缓冲中")}</Button>}
            {row.status === "blocked" && !row.assetId && canRestore && <Button type="link" danger loading={run.isPending} onClick={() => openWriteOff(row)}>{t("核销库存")}</Button>}
            {!related.length && (row.status !== "buffered" && row.status !== "blocked" || row.status === "blocked" && row.assetId) ? "—" : null}
          </Space>; } }
        ]} />
      </ListSection></QueryState>
      </div><div hidden={mainView!=="work"}><QueryState loading={workOrders.isLoading} error={workOrders.error} onRetry={() => workOrders.refetch({ throwOnError: true })}>
      {assignees.isError && <Alert type="warning" showIcon title={t("负责人列表暂不可用，工单仍可查看")} action={<ActionButton variant="secondary" label={t("重试")} onAction={() => assignees.refetch({ throwOnError: true })} />} />}
      <ListSection controls={<>
        <SearchField label={t("搜索养护工单")} value={resourceFilter} onValueChange={setResourceFilter} placeholder={t("工单号、原因或负责人")} />
        <ListFilterItem label={t("工单状态")} priority active={Boolean(statusFilter)}>
          <Select aria-label={t("工单状态")} allowClear value={statusFilter} onChange={setStatusFilter} placeholder={t("状态")} options={Object.entries(WORK_ORDER_STATUS_LABELS).map(([value, item]) => ({ value, label: t(item.label) }))} />
        </ListFilterItem>
        <ListFilterItem label={t("工单类型")} collapsed active={Boolean(typeFilter)}>
          <Select aria-label={t("工单类型")} allowClear value={typeFilter} onChange={setTypeFilter} placeholder={t("类型")} options={Object.entries(WORK_ORDER_TYPE_LABELS).map(([value, label]) => ({ value, label: t(label) }))} />
        </ListFilterItem>
        <ListFilterItem label={t("负责人")} collapsed active={Boolean(assigneeFilter)}>
          <Select aria-label={t("负责人")} allowClear value={assigneeFilter} onChange={setAssigneeFilter} placeholder={t("负责人")} options={[{ value: UNASSIGNED_WORK_ORDER, label: t("未派工") }, ...(assignees.data ?? []).map((item) => ({ value: item.id, label: item.displayName }))]} />
        </ListFilterItem>
        {hasFilters&&<Button data-list-filter-reset onClick={clearFilters}>{t("清除筛选")}</Button>}
      </>}>

        {workView==="board"?<WorkOrderBoard key={boardScope} scope={boardScope} rows={filteredWorkOrders} people={assignees.data ?? []} pending={run.isPending} disabled={Boolean(dialog) || workOrders.isError} hasFilters={hasFilters} onClearFilters={clearFilters} canManage={canManage} canReview={canReview} statusLabel={value=>t(WORK_ORDER_STATUS_LABELS[value]?.label??value)} typeLabel={value=>t(WORK_ORDER_TYPE_LABELS[value as RentalWorkOrderType]??value)} actions={rowActions} onAction={handleBoardAction} onOpen={row=>openDialog("detail",row)} onCreate={assigneeId => { openDialog("create"); createForm.setFieldsValue({ assigneeId }); }}/>:<Table<RentalWorkOrder> exportConfig={{ filename: t("养护工单"), fields: [{ label: t("工单号"), value: row => row.workNo }, { label: t("类型"), value: row => t(WORK_ORDER_TYPE_LABELS[row.type] ?? row.type) }, { label: t("状态"), value: row => t(WORK_ORDER_STATUS_LABELS[row.status]?.label ?? row.status) }, { label: t("数量"), value: row => row.quantity }, { label: t("更新时间"), value: row => row.updatedAt }] }} rowKey="id" onRefresh={() => workOrders.refetch()} loading={workOrders.isLoading} refreshing={workOrders.isFetching} dataSource={filteredWorkOrders} pagination={{ pageSize: 8 }} scroll={{ x: 1280 }} locale={{ emptyText: <Empty scene={hasFilters ? "search" : "empty"} compact description={t("暂无匹配的养护工单")} /> }} columns={[
          { title: t("工单号"), dataIndex: "workNo", width: 190, render: (value: string) => <span className={styles.identifier}>{value}</span> },
          {
            title: t("来源订单"),
            dataIndex: "orderId",
            width: 150,
            render: (value: string | undefined) =>
              value && canViewOrders ? (
                <Button type="link" size="small" title={value} onClick={() => navigate(`/rental/orders/${encodeURIComponent(value)}`)}>
                  {t("查看来源订单")}
                </Button>
              ) : value ? (
                <Typography.Text type="secondary">{value}</Typography.Text>
              ) : (
                "-"
              ),
          },
          { title: t("类型"), dataIndex: "type", width: 110, render: (value: RentalWorkOrderType) => t(WORK_ORDER_TYPE_LABELS[value] ?? value) },
          { title: t("状态"), dataIndex: "status", width: 110, render: (value) => { const status = WORK_ORDER_STATUS_LABELS[value] ?? { label: value, color: "default" }; return <Tag color={status.color}>{t(status.label)}</Tag>; } },
          { title: t("原因"), dataIndex: "reason", minWidth: 240 },
          { title: t("处理人"), render: (_, row) => row.assigneeName || row.assigneeId || t("未派工") },
          { title: t("更新时间"), dataIndex: "updatedAt", width: 180, render: (value: string) => dateCell(value, locale) },
          { title: t("操作"), fixed: "right", render: (_, row) => rowActions(row) }
        ]} />}
      </ListSection></QueryState></div>
      </ContentTransition>

    </>}
    {workOrderId && <QueryState loading={workOrders.isLoading} error={workOrders.error} onRetry={() => workOrders.refetch({ throwOnError: true })} transitionKey={`${boardScope}:${workOrderId}`}><RecordDetailLayout title={activeWorkOrder?.workNo ?? t("养护工单详情")} onBack={() => navigate("/rental/work-orders")}
      status={activeWorkOrder && <DataTableStatus variant="soft" tone={activeWorkOrder.status === "completed" ? "success" : activeWorkOrder.status === "pending_review" ? "warning" : "neutral"}>{t(WORK_ORDER_STATUS_LABELS[activeWorkOrder.status]?.label ?? activeWorkOrder.status)}</DataTableStatus>}
      facts={activeWorkOrder ? [
        { key: "type", label: "类型", value: t(WORK_ORDER_TYPE_LABELS[activeWorkOrder.type]) },
        { key: "assignee", label: "负责人", value: activeWorkOrder.assigneeName || t("未派工") },
        { key: "quantity", label: "数量", value: activeWorkOrder.quantity },
        { key: "updated", label: "更新时间", value: dateTime(activeWorkOrder.updatedAt, locale) }
      ] : undefined}
      actions={activeWorkOrder && <>
        {canManage && ["pending", "in_progress"].includes(activeWorkOrder.status) && <Button disabled={run.isPending || Boolean(dialog) || workOrders.isError} onClick={() => openDialog("assign", activeWorkOrder)}>{t("派工")}</Button>}
        {canManage && activeWorkOrder.status === "pending" && <ActionButton label={t("开始处理")} intent="play" disabled={Boolean(dialog) || workOrders.isError} pending={run.isPending} onAction={() => run.mutateAsync({ kind: "start", id: activeWorkOrder.id })} />}
        {canManage && activeWorkOrder.status === "in_progress" && <Button type="primary" disabled={run.isPending || Boolean(dialog) || workOrders.isError} onClick={() => openDialog("submit", activeWorkOrder)}>{t("提交验收")}</Button>}
        {canReview && activeWorkOrder.status === "pending_review" && <Button type="primary" disabled={run.isPending || Boolean(dialog) || workOrders.isError} onClick={() => openDialog("review", activeWorkOrder)}>{t("验收")}</Button>}
        {canManage && ["pending", "in_progress", "pending_review"].includes(activeWorkOrder.status) && <Button danger disabled={run.isPending || Boolean(dialog) || workOrders.isError} onClick={() => openDialog("cancel", activeWorkOrder)}>{t("取消工单")}</Button>}
      </>}>
        {!activeWorkOrder ? <Alert type="warning" showIcon title={t("未找到养护工单")} /> : <Tabs aria-label={t("工单详情")} activeKey={detailTab} onChange={key => setSearchParams(key === "history" ? { tab: key } : {})} items={[
          { key: "detail", label: t("处理与验收"), children: <div className={recordStyles.stack}>
            <RecordFacts items={[
              { key: "reason", label: "处理原因", value: activeWorkOrder.reason || "—", wide: true },
              { key: "result", label: "处理结果", value: activeWorkOrder.result || "—", wide: true },
              { key: "review", label: "验收", value: activeWorkOrder.reviewReason || "—" },
              { key: "reviewer", label: "验收人", value: activeWorkOrder.reviewedBy || "—" }
            ]} />
            <ListSection title={t("关联资源")}><RecordFacts items={[
              { key: "group", label: "商品", value: activeWorkOrder.itemGroupId },
              { key: "location", label: "履约地点", value: activeWorkOrder.locationId },
              { key: "asset", label: "资产", value: activeWorkOrder.assetId || "—" },
              { key: "order", label: "来源订单", value: activeWorkOrder.orderId && canViewOrders ? <Button type="link" onClick={() => navigate('/rental/orders/' + activeWorkOrder.orderId)}>{activeWorkOrder.orderId}</Button> : activeWorkOrder.orderId || "—" }
            ]} /></ListSection>
            <RecordDisclosure key={activeWorkOrder.id} title={t("追溯资料")}><RecordFacts items={[
              { key: "disposition", label: "归还处置", value: activeWorkOrder.dispositionId || "—" },
              { key: "evidence", label: "证据引用", value: activeWorkOrder.attachments?.length ? activeWorkOrder.attachments.join('、') : "—", wide: true }
            ]} /></RecordDisclosure>
          </div> },
          { key: "history", label: t("工单历史"), children: <QueryState loading={history.isLoading} error={history.error} onRetry={() => history.refetch({ throwOnError: true })}><ListSection><Table rowKey="id" size="small" loading={history.isLoading} refreshing={history.isFetching} onRefresh={() => history.refetch()} dataSource={history.data ?? []} pagination={false} locale={{ emptyText: t("暂无操作记录") }} columns={[{ title: t("时间"), dataIndex: "createdAt", width: 180, render: (value: string) => dateTime(value, locale) }, { title: t("动作"), dataIndex: "action", render: (value) => value.replace("rental.work_order.", "") }, { title: t("操作人"), dataIndex: "operator", width: 110 }, { title: t("说明"), dataIndex: "detail" }]} /></ListSection></QueryState> }
        ]} />}
    </RecordDetailLayout></QueryState>}
    <Modal {...modalProps} title={t("新建养护工单")} open={dialog === "create" && actionDialog.visible} okText={t("新建工单")} okButtonProps={{ disabled: !selectedDisposition || dispositions.isError || assignmentCandidates.isError }} onConfirm={() => createForm.validateFields().then((data) => run.mutateAsync({ kind: "create", data }))}>
      {!workOrderDispositions.length && !dispositions.isError && <Alert type="info" showIcon title={t("暂无待处理的归还处置")} />}
      <QueryState loading={dispositions.isLoading} error={dispositions.error} onRetry={() => dispositions.refetch({ throwOnError: true })}>
      <Form form={createForm} layout="vertical" disabled={run.isPending} onFinish={(data) => run.mutate({ kind: "create", data })}>
        <Form.Item name="dispositionId" label={t("归还处置")} rules={[{ required: true, message: t("请选择归还处置") }]}><Select options={workOrderDispositions.map((row) => ({ value: row.id, label: `${row.itemGroupId} · ${row.blockReason || (row.status === "buffered" ? t("周转清洁") : t("异常隔离"))} · ${row.quantity} ${t("件")}` }))} placeholder={t("选择待处理的归还处置")} /></Form.Item>
        <Form.Item name="type" label={t("工单类型")} rules={[{ required: true }]}><Select options={Object.entries(WORK_ORDER_TYPE_LABELS).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item>
        <QueryState loading={assignmentCandidates.isLoading} error={assignmentCandidates.error} onRetry={() => assignmentCandidates.refetch({ throwOnError: true })}>
          <Form.Item name="assigneeId" label={t("处理人")}><Select allowClear disabled={run.isPending || !selectedDisposition || assignmentCandidates.isFetching} options={assignmentCandidates.data?.map((item) => ({ value: item.id, label: `${item.displayName} · ${item.account}` }))} placeholder={t("可稍后派工")} /></Form.Item>
        </QueryState>
        <Form.Item name="reason" label={t("处理要求")}><Input.TextArea rows={3} placeholder={t("可补充清洁、维修或缺件处理要求")} /></Form.Item>
      </Form>
      </QueryState>
    </Modal>
    <Modal {...modalProps} title={t("核销异常库存")} open={dialog === "writeoff" && actionDialog.visible} okText={t("确认核销")} okButtonProps={{ danger: true }} onConfirm={() => writeOffForm.validateFields().then(async ({ reason }) => { const operation = writeOffTarget && run.mutateAsync({ kind: "writeoff", id: writeOffTarget.id, reason }); if (!operation) throw new Error("Operation unavailable"); return operation; })}>
      <Alert type="warning" showIcon title={t("核销后该数量将从在手库存中扣除，且不能恢复；请确认商品已无法修复。")} style={{ marginBottom: 16 }} />
      <Form form={writeOffForm} layout="vertical" disabled={run.isPending} onFinish={({ reason }) => writeOffTarget && run.mutate({ kind: "writeoff", id: writeOffTarget.id, reason })}>
        <Form.Item name="reason" label={t("核销原因")} rules={[{ required: true, whitespace: true, message: t("请填写核销原因") }, { max: 500, message: t("核销原因不能超过 500 个字符") }]}>
          <Input.TextArea rows={4} maxLength={500} showCount placeholder={t("说明无法修复或继续使用的原因")} />
        </Form.Item>
      </Form>
    </Modal>
    <Modal {...modalProps} title={`${t("派工")}：${activeWorkOrder?.workNo ?? ""}`} open={dialog === "assign" && actionDialog.visible} okText={t("保存派工")} okButtonProps={{ disabled: !assigneeLocationId || assignmentCandidates.isFetching || assignmentCandidates.isError }} onConfirm={() => assignForm.validateFields().then(async data => { const operation = activeWorkOrder && run.mutateAsync({ kind: "assign", id: activeWorkOrder.id, data }); if (!operation) throw new Error("Operation unavailable"); return operation; })}>
      <QueryState loading={assignmentCandidates.isLoading} error={assignmentCandidates.error} onRetry={() => assignmentCandidates.refetch({ throwOnError: true })}>
      <Form form={assignForm} layout="vertical" disabled={run.isPending || assignmentCandidates.isFetching || assignmentCandidates.isError} onFinish={(data) => activeWorkOrder && run.mutate({ kind: "assign", id: activeWorkOrder.id, data })}>
        <Form.Item name="assigneeId" label={t("当前空间运营账号")}><Select allowClear options={assignmentCandidates.data?.map((item) => ({ value: item.id, label: `${item.displayName} · ${item.account}` }))} placeholder={t("清除派工可留空")} /></Form.Item>
      </Form>
      </QueryState>
    </Modal>
    <Modal {...modalProps} title={`${t("提交验收")}：${activeWorkOrder?.workNo ?? ""}`} open={dialog === "submit" && actionDialog.visible} okText={t("提交验收")} onConfirm={() => submitForm.validateFields().then(async ({ attachmentsText, ...data }) => { const operation = activeWorkOrder && run.mutateAsync({ kind: "submit", id: activeWorkOrder.id, data: { ...data, attachments: attachmentsText?.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean) } }); if (!operation) throw new Error("Operation unavailable"); return operation; })}>
      <Form form={submitForm} layout="vertical" disabled={run.isPending} onFinish={({ attachmentsText, ...data }) => activeWorkOrder && run.mutate({ kind: "submit", id: activeWorkOrder.id, data: { ...data, attachments: attachmentsText?.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean) } })}>
        <Form.Item name="result" label={t("处理结果")} rules={[{ required: true, message: t("请填写处理结果") }]}><Input.TextArea rows={4} placeholder={t("说明完成了什么处理、检查结果是什么")} /></Form.Item>
        <Form.Item name="attachmentsText" label={t("证据附件引用")}><Input.TextArea rows={3} placeholder={t("填写文件服务返回的附件引用，每行一个；不填写本地路径")} /></Form.Item>
      </Form>
    </Modal>
    <Modal {...modalProps} title={`${t("验收工单")}：${activeWorkOrder?.workNo ?? ""}`} open={dialog === "review" && actionDialog.visible} okText={t("确认验收")} onConfirm={() => reviewForm.validateFields().then(async data => { const operation = activeWorkOrder && run.mutateAsync({ kind: "review", id: activeWorkOrder.id, data }); if (!operation) throw new Error("Operation unavailable"); return operation; })}>
      <Descriptions size="small" column={1} style={{ marginBottom: 16 }} items={[{ key: "reason", label: t("处理原因"), children: activeWorkOrder?.reason }, { key: "result", label: t("处理结果"), children: activeWorkOrder?.result || t("尚未提交") }]} />
      <Form form={reviewForm} layout="vertical" disabled={run.isPending} onFinish={(data) => activeWorkOrder && run.mutate({ kind: "review", id: activeWorkOrder.id, data })}>
        <Form.Item name="decision" label={t("验收结论")} rules={[{ required: true }]}><Select options={[{ value: "approved", label: t("通过并进入周转缓冲") }, { value: "rejected", label: t("驳回，继续隔离") }]} /></Form.Item>
        <Form.Item name="reason" label={t("验收说明")} rules={[{ required: true, message: t("请填写验收说明") }]}><Input.TextArea rows={3} placeholder={t("填写通过或驳回的依据")} /></Form.Item>
      </Form>
    </Modal>
    <Modal {...modalProps} title={`${t("取消工单")}：${activeWorkOrder?.workNo ?? ""}`} open={dialog === "cancel" && actionDialog.visible} okText={t("确认取消")} onConfirm={() => cancelForm.validateFields().then(async data => { const operation = activeWorkOrder && run.mutateAsync({ kind: "cancel", id: activeWorkOrder.id, data }); if (!operation) throw new Error("Operation unavailable"); return operation; })}>
      <Form form={cancelForm} layout="vertical" disabled={run.isPending} onFinish={(data) => activeWorkOrder && run.mutate({ kind: "cancel", id: activeWorkOrder.id, data })}>
        <Alert type="warning" showIcon title={t("取消不会恢复库存")} description={t("取消只结束当前工单；关联资源会继续保持异常隔离，后续必须重新建立并通过养护验收。")} style={{ marginBottom: 16 }} />
        <Form.Item name="reason" label={t("取消原因")} rules={[{ required: true, message: t("请填写取消原因") }]}><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>


  </>;
}
