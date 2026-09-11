import { ArrowLeftOutlined, CheckCircleOutlined, DollarOutlined, MinusCircleOutlined, PlusOutlined, RetweetOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { RentalCoreOrderStatus, formatRentalMoney, rentalCurrencySymbol, type CreateRentalInspectionRequest, type RentalAllocation, type RentalFundingAction, type RentalFundingInstrument, type RentalInspectionTemplate, type RentalOrderExtension, type RentalOrderExtensionPreview, type RentalOrderFeeReview, type RentalOrderServiceOccurrence, type RentalReservation, type RentalServiceExecutionAction, type UpdateRentalServiceOccurrenceRequest } from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";
import { OrderAllocationPanel } from "./OrderAllocationPanel";
import { FEE_REVIEW_STATUS_COLORS, FEE_REVIEW_TYPE_LABELS, feeReviewStatusText, hasPendingFeeReview } from "./orderFeeReview";
import { serviceOccurrenceNetAmount, serviceOccurrenceOriginText } from "./orderServiceOccurrence";

type FundingOperation = {
  instrument: RentalFundingInstrument;
  action: RentalFundingAction;
};

const FUNDING_ACTION_LABELS: Record<RentalFundingAction, string> = {
  initiate: "发起",
  append: "追加",
  capture: "抵扣",
  refund: "退款",
  release: "释放",
  fail: "记录失败"
};

const FUNDING_INSTRUMENT_LABELS: Record<RentalFundingInstrument, string> = {
  rental: "租金与费用",
  deposit: "押金",
  preauthorization: "预授权"
};

const MEMBERSHIP_BENEFIT_LABELS: Record<string, string> = {
  rental_discount: "租金减免",
  service_benefit: "服务减免",
  deposit_reduction: "押金减免",
  preauth_reduction: "预授权减免",
  priority_reservation: "配货优先",
  quote_validity_extension: "报价有效期"
};

const SERVICE_EXECUTION_STATUS_LABELS: Record<NonNullable<RentalOrderServiceOccurrence["executionStatus"]>, string> = {
  not_started: "未开始",
  in_progress: "执行中",
  completed: "已完成",
  cancelled: "已取消",
  failed: "执行失败",
  no_show: "未到场"
};

const SERVICE_EXECUTION_STATUS_COLORS: Record<NonNullable<RentalOrderServiceOccurrence["executionStatus"]>, string> = {
  not_started: "default",
  in_progress: "processing",
  completed: "success",
  cancelled: "default",
  failed: "error",
  no_show: "warning"
};

export function RentalOrderDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const canViewFunding = hasPermission("store-rental:order:view") || hasPermission("store-rental:order:settle");
  const canSettleFunding = hasPermission("store-rental:order:settle");
  // ORDER-CLOSE-02：裁定「该收/该退多少」与实际动钱是两个权限。只有裁定权的人看得到
  // 审核按钮但看不到收退款按钮；只有资金权的人反之。两者都不给的账号只能查看。
  const canReviewFees = hasPermission("store-rental:order:fee-review");
  const canOperate = hasPermission("store-rental:order:operate");
  const canPickup = canOperate || hasPermission("store-rental:order:pickup");
  const canReturn = canOperate || hasPermission("store-rental:order:return");
  const canExtend = canOperate || hasPermission("store-rental:order:extend");
  const canCancel = canOperate || hasPermission("store-rental:order:cancel");
  const [operationSession, setOperationSession] = useState<{ id: string; token?: string }>();
  const operationToken = operationSession?.id === id ? operationSession.token : sessionStorage.getItem(`rental-operation:${id}`) ?? undefined;
  const setOperationToken = (token?: string) => { if (token) sessionStorage.setItem(`rental-operation:${id}`, token); else sessionStorage.removeItem(`rental-operation:${id}`); setOperationSession({ id, token }); };
  const [inspection, setInspection] = useState<RentalInspectionTemplate>();
  const [inspectionReturnItems, setInspectionReturnItems] = useState<Array<{ allocationId: string; quantity: number }>>();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [substitution, setSubstitution] = useState<{ orderLineId: string; fromItemGroupId: string }>();
  const [partialReturnOpen, setPartialReturnOpen] = useState(false);
  const [fundingOperation, setFundingOperation] = useState<FundingOperation>();
  const [exceptionReview, setExceptionReview] = useState<{ inspectionId: string; exceptionIndex: number; description: string; suggested?: number }>();
  const [feeReview, setFeeReview] = useState<RentalOrderFeeReview>();
  const [feeReviewForm] = Form.useForm<{ decision: "approved" | "rejected"; amount?: number; reason: string }>();
  const [inspectionForm] = Form.useForm<Record<string, unknown> & { exceptionCode?: string; exceptionDescription?: string; exceptionChargeAmount?: number }>();
  const [cancelForm] = Form.useForm<{ reason: string }>();
  const [noShowForm] = Form.useForm<{ reason: string }>();
  const [substitutionForm] = Form.useForm<{ toItemGroupId: string }>();
  const [partialReturnForm] = Form.useForm<{ items: Array<{ allocationId: string; quantity: number }> }>();
  const [fundingForm] = Form.useForm<{ amount?: number; reason: string; failureCode?: string }>();
  const [exceptionReviewForm] = Form.useForm<{ decision: "approved" | "rejected"; approvedChargeAmount?: number; reason: string }>();
  const [extensionOpen, setExtensionOpen] = useState(false);
  const [extensionRefundReview, setExtensionRefundReview] = useState<RentalOrderExtension>();
  const [serviceExecution, setServiceExecution] = useState<{ occurrence: RentalOrderServiceOccurrence; action: RentalServiceExecutionAction }>();
  const [extensionRefundForm] = Form.useForm<{ decision: "approved" | "rejected"; reason: string }>();
  // 试算结果单独存：金额要先摆给运营/客户确认，确认后才提交申请。
  const [extensionPreview, setExtensionPreview] = useState<RentalOrderExtensionPreview>();
  const [extensionForm] = Form.useForm<{ newEndAt: Dayjs; memo?: string }>();
  const [serviceExecutionForm] = Form.useForm<{ result?: string; reason?: string; customerConfirmed?: boolean; refundAmount?: number; compensationAmount?: number; evidenceAttachments?: string }>();
  const order = useQuery({ queryKey: ["rental-core", "order", id], queryFn: () => rentalCoreApi.order(id), enabled: Boolean(id) });
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const templates = useQuery({ queryKey: ["rental-core", "templates"], queryFn: () => rentalCoreApi.inspectionTemplates() });
  const groups = useQuery({ queryKey: ["rental-core", "groups"], queryFn: rentalCoreApi.itemGroups });
  const funding = useQuery({ queryKey: ["rental-core", "order", id, "funding"], queryFn: () => rentalCoreApi.fundingEvents(id), enabled: Boolean(id) && canViewFunding });
  const inspections = useQuery({ queryKey: ["rental-core", "order", id, "inspections"], queryFn: () => rentalCoreApi.inspections(id), enabled: Boolean(id) });
  const extensions = useQuery({ queryKey: ["rental-core", "order", id, "extensions"], queryFn: () => rentalCoreApi.orderExtensions(id), enabled: Boolean(id) });
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id] }), queryClient.invalidateQueries({ queryKey: ["rental-core", "orders"] })]); };
  const operationLock = useMutation({ mutationFn: (type: "acquire" | "release") => rentalCoreApi.operationLock(id, type, operationToken), onSuccess: async (result) => { setOperationToken(result.token); await refresh(); }, onError: (e: Error) => message.error(e.message) });
  const beginInspection = async (stage: "pickup" | "return", returnItems?: Array<{ allocationId: string; quantity: number }>) => {
    const template = templates.data?.find((item) => item.stage === stage && item.enabled);
    if (!template) { message.error("未配置有效的交接检查模板，请先在经营设置中配置"); return false; }
    try {
      const result = await rentalCoreApi.operationLock(id, "acquire", operationToken);
      setOperationToken(result.token); await refresh(); setInspectionReturnItems(returnItems); setInspection(template); return true;
    } catch { message.error("其他人员正在办理，或订单状态已变化，请刷新后重试"); return false; }
  };
  const action = useMutation({ mutationFn: (type: "confirm" | "allocate") => type === "confirm" ? rentalCoreApi.confirmOrder(id) : rentalCoreApi.allocateOrder(id), onSuccess: async () => { await refresh(); message.success("订单状态已更新"); }, onError: () => message.error("操作失败，请检查状态、库存或优惠券") });
  const cancel = useMutation({ mutationFn: (values: { reason: string }) => rentalCoreApi.cancelOrder(id, values), onSuccess: async () => { setCancelOpen(false); cancelForm.resetFields(); await refresh(); message.success("订单已取消，费用和优惠券状态已更新"); }, onError: () => message.error("取消失败，请检查规则与订单状态") });
  const expirePending = useMutation({ mutationFn: () => rentalCoreApi.expirePendingOrder(id), onSuccess: async () => { await refresh(); message.success("待支付占用已超时取消，库存、服务容量和优惠已释放"); }, onError: (error: Error) => message.error(error.message || "处理失败：订单可能尚未全部到期或已被其他操作改变") });
  const markPickupOverdue = useMutation({
    mutationFn: () => rentalCoreApi.markPickupOverdue(id),
    onSuccess: async () => { await refresh(); message.success("订单已进入待确认爽约"); },
    onError: (error: Error) => message.error(error.message || "进入待确认爽约失败")
  });
  const sendNoShowNotice = useMutation({
    mutationFn: () => rentalCoreApi.sendNoShowNotice(id),
    onSuccess: async () => { await refresh(); message.success("客户通知记录已保存"); },
    onError: (error: Error) => message.error(error.message || "通知记录失败，请先配置待确认爽约通知模板")
  });
  const confirmNoShow = useMutation({
    mutationFn: (values: { reason: string }) => rentalCoreApi.confirmNoShow(id, values),
    onSuccess: async () => { setNoShowOpen(false); noShowForm.resetFields(); await refresh(); message.success("订单已确认爽约，资源和优惠占用已释放"); },
    onError: (error: Error) => message.error(error.message || "确认爽约失败")
  });
  const handover = useMutation({ mutationFn: async (stage: "pickup" | "return") => { const token = operationToken ?? (await rentalCoreApi.operationLock(id, "acquire")).token; setOperationToken(token); return rentalCoreApi.handoverOrder(id, stage, token); }, onSuccess: async () => { setOperationToken(undefined); await refresh(); message.success("交接已完成"); }, onError: () => message.error("当前规则要求检查，或订单状态不允许直接交接") });
  const settle = useMutation({ mutationFn: () => rentalCoreApi.settleOrder(id), onSuccess: async () => { await refresh(); await queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "funding"] }); message.success("订单已结算并关闭"); }, onError: () => message.error("结算失败，请先处理全部押金和预授权余额") });
  const substitute = useMutation({ mutationFn: (values: { toItemGroupId: string }) => rentalCoreApi.substituteBundleComponent(id, { ...substitution!, toItemGroupId: values.toItemGroupId }), onSuccess: async () => { setSubstitution(undefined); substitutionForm.resetFields(); await refresh(); message.success("套装组成已替换并重新预占"); }, onError: () => message.error("替换失败，请检查替代组、订单状态和候选库存") });
  // 每次真实归还生成新的批次号：分批归还是可重复动作，服务端靠这个号区分
  // "又还了一批"和"同一批的网络重试"。在 mutationFn 里生成，与资金操作同一范式——
  // React Query 默认不重试 mutation，浏览器层的网络重试不会重跑这段 JS。
  const partialReturn = useMutation({ mutationFn: (input: { items: Array<{ allocationId: string; quantity: number }> }) => rentalCoreApi.partialReturnOrder(id, { ...input, batchNo: crypto.randomUUID() }, operationToken), onSuccess: async () => { setPartialReturnOpen(false); partialReturnForm.resetFields(); await refresh(); message.success("部分归还已完成，剩余项目继续在租"); }, onError: () => message.error("部分归还失败；最后一批请使用归还检查或整单归还") });
  const inspect = useMutation({ mutationFn: (values: Record<string, unknown> & { exceptionCode?: string; exceptionDescription?: string; exceptionChargeAmount?: number }) => { const { exceptionCode, exceptionDescription, exceptionChargeAmount, ...results } = values; const exceptions: CreateRentalInspectionRequest["exceptions"] = exceptionDescription ? [{ code: exceptionCode || "damage", description: exceptionDescription, chargeAmount: Number(exceptionChargeAmount) || undefined }] : []; return rentalCoreApi.createInspection(id, { templateId: inspection!.id, results, returnItems: inspectionReturnItems, returnBatchNo: inspectionReturnItems?.length ? crypto.randomUUID() : undefined, exceptions }, operationToken); }, onSuccess: async () => { const wasPartialReturn = Boolean(inspectionReturnItems?.length); setInspection(undefined); setInspectionReturnItems(undefined); setOperationToken(undefined); inspectionForm.resetFields(); await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "inspections"] })]); message.success(wasPartialReturn ? "本批归还检查已保存，剩余项目继续在租" : "检查记录已保存；异常建议须由结算人员审核后才计费"); }, onError: () => message.error("检查提交失败") });
  const fundingAction = useMutation({
    mutationFn: async (values: { amount?: number; reason: string; failureCode?: string }) => {
      const operation = fundingOperation!;
      const idempotencyKey = crypto.randomUUID();
      if (operation.action === "initiate") return rentalCoreApi.initiateFunding(id, { instrument: operation.instrument, idempotencyKey, reason: values.reason });
      if (operation.action === "release") return rentalCoreApi.releaseFunding(id, { idempotencyKey, reason: values.reason });
      if (operation.action === "fail") return rentalCoreApi.failFunding(id, { instrument: operation.instrument, failureCode: values.failureCode!, idempotencyKey, reason: values.reason });
      const request = { instrument: operation.instrument, amount: Number(values.amount), idempotencyKey, reason: values.reason };
      if (operation.action === "append") return rentalCoreApi.appendFunding(id, request);
      if (operation.action === "capture") return rentalCoreApi.captureFunding(id, request);
      return rentalCoreApi.refundFunding(id, request);
    },
    onSuccess: async () => {
      setFundingOperation(undefined);
      fundingForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "funding"] });
      message.success("模拟资金事件已记录");
    },
    onError: () => message.error("操作失败，请检查当前余额、动作顺序和订单范围")
  });
  const refreshExtensions = async () => { await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "extensions"] })]); };
  /**
   * 费用裁定。落账口径由服务端决定，这里只提交结论：
   * 认定额不得超过建议额（超出属于另立一笔异常费用，走检查异常流程），原因必填。
   * 成功后同时刷新订单与资金余额——裁定会改应收，但**不会**产生实际收退款。
   */
  const decideFeeReview = useMutation({
    mutationFn: (values: { decision: "approved" | "rejected"; amount?: number; reason: string }) =>
      rentalCoreApi.reviewOrderFeeReview(id, feeReview!.id, {
        decision: values.decision,
        reason: values.reason,
        amount: values.decision === "approved" && values.amount !== undefined ? Number(values.amount) : undefined
      }),
    onSuccess: async () => {
      setFeeReview(undefined);
      feeReviewForm.resetFields();
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "funding"] })]);
      message.success("裁定已记录；应收已按结论调整，实际收退款仍需在资金区单独办理");
    },
    onError: async (error: Error) => {
      // 冲突多半是已被他人裁定或被新续租替代：刷新到最新状态再让用户重新判断，
      // 不保留一个已经失效的表单。
      await refresh();
      message.error(error.message || "裁定失败：该事项可能已被处理或已被新的续租替代，请查看最新状态");
    }
  });
  const previewExtension = useMutation({
    mutationFn: (values: { newEndAt: Dayjs }) => rentalCoreApi.previewOrderExtension(id, { newEndAt: values.newEndAt.toISOString() }),
    onSuccess: (data) => setExtensionPreview(data),
    onError: () => message.error("试算失败：请检查新归还时间、后续占用及缓冲、原订单价格与优惠快照")
  });
  const applyExtension = useMutation({
    mutationFn: (values: { newEndAt: Dayjs; memo?: string }) => rentalCoreApi.requestOrderExtension(id, { newEndAt: values.newEndAt.toISOString(), memo: values.memo }),
    onSuccess: async (data) => {
      setExtensionOpen(false);
      setExtensionPreview(undefined);
      extensionForm.resetFields();
      await refreshExtensions();
      message.success(data.extension.status !== "effective" ? "续租申请已创建，补差价后生效" : data.extension.pricingSnapshot?.refundReview ? "续租已生效，负差额待退款审核" : data.extension.payableAmount === 0 ? "续租已生效，无需补款" : "续租已生效，差额记入月结");
    },
    onError: () => message.error("续租失败：请检查订单状态、后续库存占用与规则上限")
  });
  const payExtension = useMutation({
    mutationFn: (extensionId: string) => rentalCoreApi.payOrderExtension(id, extensionId),
    onSuccess: async () => { await refreshExtensions(); message.success("补款已确认，租期与占用已延长"); },
    onError: () => message.error("补款确认失败：请检查续租记录状态与订单当前归还时间")
  });
  const reviewExtensionRefund = useMutation({
    mutationFn: (values: { decision: "approved" | "rejected"; reason: string }) => rentalCoreApi.reviewExtensionRefund(id, extensionRefundReview!.id, values),
    onSuccess: async () => { setExtensionRefundReview(undefined); extensionRefundForm.resetFields(); await refreshExtensions(); message.success("退款审核已记录；通过仅核减应收，不代表实际退款到账"); },
    onError: () => message.error("审核失败：记录可能已处理或被后续续租替代，请刷新后重试")
  });
  const reviewException = useMutation({    mutationFn: (values: { decision: "approved" | "rejected"; approvedChargeAmount?: number; reason: string }) => rentalCoreApi.reviewInspectionException(id, exceptionReview!.inspectionId, exceptionReview!.exceptionIndex, values),
    onSuccess: async () => {
      setExceptionReview(undefined);
      exceptionReviewForm.resetFields();
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "inspections"] })]);
      message.success("检查异常已审核");
    },
    onError: () => message.error("审核失败，请检查订单状态或该异常是否已处理")
  });
  const executeService = useMutation({
    mutationFn: (values: { result?: string; reason?: string; customerConfirmed?: boolean; refundAmount?: number; compensationAmount?: number; evidenceAttachments?: string }) => {
      const selected = serviceExecution!;
      const data: UpdateRentalServiceOccurrenceRequest = {
        action: selected.action,
        actualAt: new Date().toISOString(),
        result: values.result,
        reason: values.reason,
        customerConfirmed: values.customerConfirmed,
        refundAmount: values.refundAmount === undefined ? undefined : Number(values.refundAmount),
        compensationAmount: values.compensationAmount === undefined ? undefined : Number(values.compensationAmount),
        evidenceAttachments: values.evidenceAttachments?.split(/[\n,]/u).map((item) => item.trim()).filter(Boolean)
      };
      return rentalCoreApi.updateServiceOccurrence(id, selected.occurrence.occurrenceId!, data);
    },
    onSuccess: async () => {
      setServiceExecution(undefined);
      serviceExecutionForm.resetFields();
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "funding"] })]);
      message.success("服务履约记录已保存；如产生退款，已进入费用审核")
    },
    onError: (error: Error) => message.error(error.message || "服务履约记录失败，请刷新后重试")
  });
  const detail = order.data;
  const feeReviews = detail?.feeReviews ?? [];
  const pendingFeeReviews = feeReviews.filter((row) => row.status === "pending");
  const orderHasPendingFee = hasPendingFeeReview(detail ?? {});
  // 服务端关单有三道闸门（rental-core.service 的 feeReviews 与续租退款审核、控制器的检查异常）。
  // 界面把三道都列出来，否则按钮可点却必然 409，运营只能靠猜。
  const settleBlockers = [
    orderHasPendingFee ? "有待裁定的费用事项" : undefined,
    (extensions.data ?? []).some((row) => row.status === "effective" && row.pricingSnapshot?.refundReview?.status === "pending")
      ? "有待审核的续租退款差额" : undefined,
    (inspections.data ?? []).some((row) => row.exceptions.some((exception) => exception.reviewStatus === "pending"))
      ? "有待审核的检查异常" : undefined
  ].filter((row): row is string => Boolean(row));
  // 金额一律按**订单自己的**结算币种展示（需求 §948）：币种是下单时的快照，
  // 不能改读当前经营空间的设置——空间后来改了币种，历史单的金额含义不会跟着改。
  const money = (value: number | undefined) => formatRentalMoney(Number(value ?? 0), detail?.currency);
  const symbol = rentalCurrencySymbol(detail?.currency);
  // 当前该还的时间：续租过就是新时间。约定归还（endAt）不因续租改写（需求 4.6.9）。
  const detailEndAt = detail?.effectiveEndAt ?? detail?.endAt ?? new Date().toISOString();
  const noShowRule = detail?.ruleSnapshot?.cancellation?.noShow;
  const pickupOverdueReady = Boolean(
    detail
      && [RentalCoreOrderStatus.Reserved, RentalCoreOrderStatus.ReadyForPickup].includes(detail.status)
      && noShowRule?.enabled === true
      && Date.parse(detail.startAt) + (noShowRule?.pickupGraceMinutes ?? 0) * 60_000 <= Date.now()
  );
  const noShowNoticeReady = Boolean(
    detail?.status === RentalCoreOrderStatus.PickupOverdue
      && detail.pickupOverdueAt
      && detail.noShowNoticeAt
  );
  const noShowFinalReady = noShowNoticeReady && Date.parse(detail!.pickupOverdueAt!) + (noShowRule?.finalizationMinutes ?? 60) * 60_000 <= Date.now();
  const substitutionLine = detail?.lines.find((line) => line.id === substitution?.orderLineId);
  const substitutionBundle = groups.data?.find((group) => group.id === substitutionLine?.itemGroupId);
  const substitutionSource = substitutionBundle?.bundleComponents.find((component) => component.itemGroupId === substitution?.fromItemGroupId);
  const substitutionOptions = substitutionBundle?.bundleComponents.filter((component) => component.substitutionGroup && component.substitutionGroup === substitutionSource?.substitutionGroup && component.itemGroupId !== substitutionSource?.itemGroupId).map((component) => ({ value: component.itemGroupId, label: `${component.itemGroupCode} · ${component.itemGroupName} × ${component.quantity}` })) ?? [];
  const canSubstituteReservation = (row: { orderLineId: string; itemGroupId: string }) => {
    const line = detail?.lines.find((item) => item.id === row.orderLineId);
    const bundle = groups.data?.find((group) => group.id === line?.itemGroupId);
    const component = bundle?.bundleComponents.find((item) => item.itemGroupId === row.itemGroupId);
    return Boolean(component?.substitutionGroup && bundle?.bundleComponents.some((item) => item.substitutionGroup === component.substitutionGroup && item.itemGroupId !== component.itemGroupId));
  };

  return <>
    <PageHeader title={detail?.orderNo ?? "订单详情"} description="订单保存价格、优惠、规则、日历、服务条款和履约检查快照。" extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/rental/orders")}>返回列表</Button>} />
    <QueryState loading={order.isLoading} error={order.error}>{detail && <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Space wrap>
        {canOperate && detail.status === RentalCoreOrderStatus.Draft && detail.reservations.some((row) => row.status === "soft" && row.expiresAt && Date.parse(row.expiresAt) < Date.now()) && <Button danger loading={expirePending.isPending} onClick={() => modal.confirm({ title: "处理待支付超时？", content: "系统会取消该订单，并释放库存预占、服务容量和优惠券占用。", okText: "确认处理", cancelText: "暂不处理", okButtonProps: { danger: true }, onOk: () => expirePending.mutateAsync() })}>处理待支付超时</Button>}
        {canOperate && detail.status === RentalCoreOrderStatus.Draft && <Button type="primary" onClick={() => action.mutate("confirm")}>确认订单并核销优惠券</Button>}
        {canOperate && pickupOverdueReady && <Button danger loading={markPickupOverdue.isPending} onClick={() => modal.confirm({ title: "进入待确认爽约？", content: "订单将标记为领取超时，但不会立即释放资源或收取爽约费用；请先通知客户，达到最终时限后再确认爽约。", okText: "确认进入", cancelText: "暂不处理", okButtonProps: { danger: true }, onOk: () => markPickupOverdue.mutateAsync() })}>领取超时</Button>}
        {canOperate && detail.status === RentalCoreOrderStatus.PickupOverdue && !detail.noShowNoticeAt && <Button loading={sendNoShowNotice.isPending} onClick={() => sendNoShowNotice.mutate()}>通知客户</Button>}
        {canOperate && noShowNoticeReady && <Button danger loading={confirmNoShow.isPending} onClick={() => { noShowForm.resetFields(); setNoShowOpen(true); }}>{noShowFinalReady ? "确认爽约" : "提前确认爽约"}</Button>}
        {((canPickup && detail.status === RentalCoreOrderStatus.ReadyForPickup) || (canReturn && detail.status === RentalCoreOrderStatus.Renting)) && <Button loading={operationLock.isPending} onClick={() => operationLock.mutate(operationToken ? "release" : "acquire")}>{operationToken ? "结束办理" : "开始 / 接手办理"}</Button>}
        {canPickup && detail.status === RentalCoreOrderStatus.ReadyForPickup && ((detail.ruleSnapshot?.fulfillment.pickupInspectionRequired ?? true) ? <Button type="primary" icon={<SafetyCertificateOutlined />} onClick={() => beginInspection("pickup")}>{profile.data?.terminology.pickupLabel}检查</Button> : <Button type="primary" onClick={() => handover.mutate("pickup")}>直接完成{profile.data?.terminology.pickupLabel}</Button>)}
        {canReturn && detail.status === RentalCoreOrderStatus.Renting && ((detail.ruleSnapshot?.fulfillment.returnInspectionRequired ?? true) ? <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => beginInspection("return")}>{profile.data?.terminology.returnLabel}检查</Button> : <Button type="primary" onClick={() => handover.mutate("return")}>直接完成{profile.data?.terminology.returnLabel}</Button>)}
        {canReturn && detail.status === RentalCoreOrderStatus.Renting && (detail.allocations.filter((allocation) => allocation.status === "picked_up").length > 1 || detail.allocations.some((allocation) => allocation.status === "picked_up" && allocation.quantity > 1)) && <Button onClick={() => { partialReturnForm.setFieldsValue({ items: [{ allocationId: "", quantity: 1 }] }); setPartialReturnOpen(true); }}>{detail.ruleSnapshot?.fulfillment.returnInspectionRequired ? "部分归还检查" : "部分归还"}</Button>}
        {detail.status === RentalCoreOrderStatus.Settling && canSettleFunding && <Button type="primary" loading={settle.isPending} disabled={settleBlockers.length > 0} title={settleBlockers.length ? `服务端会拒绝关单：${settleBlockers.join("、")}` : undefined} onClick={() => settle.mutate()}>结算并关闭订单</Button>}
        {canExtend && [RentalCoreOrderStatus.ReadyForPickup, RentalCoreOrderStatus.Renting].includes(detail.status) && <Button icon={<RetweetOutlined />} onClick={() => { extensionForm.resetFields(); setExtensionPreview(undefined); extensionForm.setFieldsValue({ newEndAt: dayjs(detail.effectiveEndAt ?? detail.endAt).add(1, "day") }); setExtensionOpen(true); }}>续租 / 延期</Button>}
        {canCancel && [RentalCoreOrderStatus.Draft, RentalCoreOrderStatus.Reserved, RentalCoreOrderStatus.ReadyForPickup].includes(detail.status) && <Button danger onClick={() => setCancelOpen(true)}>取消并按规则计费</Button>}
      </Space>
      <OrderAllocationPanel key={detail.id} order={detail} />
      <Card><Descriptions column={{ xs: 1, md: 2, xl: 4 }} items={[
        { key: "status", label: "状态", children: <Tag>{{ draft: "待确认", reserved: "已确认", pickup_overdue: "待确认爽约", ready_for_pickup: "待领取", renting: "租赁中", return_inspection: "归还检查", settling: "待结算", completed: "已完成", cancelled: "已取消", no_show: "已爽约" }[detail.status]}</Tag> },
        { key: "customer", label: "客户", children: detail.customerName },
        { key: "mode", label: "租赁方式", children: detail.fulfillmentMode },
        {
          key: "period",
          label: "租期",
          // 续租后两个时间会不同：约定归还是下单当时的，当前归还是最近一次生效续租推进到的。
          children: detail.effectiveEndAt && detail.effectiveEndAt !== detail.endAt
            ? <>{dayjs(detail.startAt).format("MM-DD HH:mm")} → {dayjs(detail.effectiveEndAt).format("MM-DD HH:mm")}<br /><span className="muted">约定归还 {dayjs(detail.endAt).format("MM-DD HH:mm")}，已续租</span></>
            : `${dayjs(detail.startAt).format("MM-DD HH:mm")} → ${dayjs(detail.endAt).format("MM-DD HH:mm")}`
        },
        { key: "location", label: "领取/归还", children: `${detail.fulfillmentLocationSnapshot.name}（${detail.fulfillmentLocationSnapshot.operator.name}） → ${detail.returnLocationSnapshot.name}（${detail.returnLocationSnapshot.operator.name}）` },
        { key: "quote", label: "报价", children: detail.quoteNo },
        { key: "pricing", label: "价格版本", children: detail.pricingPlanVersion },
        { key: "rule", label: "规则版本", children: detail.ruleVersion },
        { key: "calendar", label: "日历版本", children: detail.calendarVersion ?? "未发布" },
        { key: "payable", label: "原应付/最终应付/押金", children: `${money(detail.payableAmount)} / ${money(detail.finalPayableAmount ?? detail.payableAmount)} / ${money(detail.depositAmount)}` },
        // 价内税：应付本身就含税，这里只把税额拆出来给财务看，不额外加钱。
        {
          key: "tax",
          label: "其中税额",
          children: detail.taxRate
            ? `${money(detail.taxAmount ?? 0)}（含税价内，税率 ${(detail.taxRate * 100).toFixed(2)}%）`
            : "不计税"
        }
      ]} /></Card>
      <Card title="商品明细"><Table rowKey="id" pagination={false} dataSource={detail.lines} columns={[{ title: "商品", dataIndex: "itemGroupName" }, { title: "数量", dataIndex: "quantity" }, { title: "租金", dataIndex: "amount", render: (value) => money(Number(value)) }]} /></Card>
      <Card title="库存拆分与归还">{detail.allocations.length ? <Table<RentalAllocation> rowKey="id" pagination={false} dataSource={detail.allocations} columns={[
        { title: "实际商品", render: (_, row) => groups.data?.find((group) => group.id === row.itemGroupId)?.name ?? row.assetNo ?? "历史分配" },
        { title: "资产 / 数量", render: (_, row) => row.assetNo ?? `${row.quantity} 件` },
        { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }
      ]} /> : <Table<RentalReservation> rowKey="id" pagination={false} dataSource={detail.reservations} columns={[
        { title: "实际预占商品", render: (_, row) => groups.data?.find((group) => group.id === row.itemGroupId)?.name ?? row.itemGroupId },
        { title: "数量", render: (_, row) => `${Math.max(0, row.quantity - row.releasedQuantity)} / ${row.quantity}` },
        { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> },
        { title: "操作", render: (_, row) => detail.status === RentalCoreOrderStatus.Reserved && canSubstituteReservation(row) ? <Button type="link" icon={<RetweetOutlined />} onClick={() => setSubstitution({ orderLineId: row.orderLineId, fromItemGroupId: row.itemGroupId })}>替换组成</Button> : "-" }
      ]} />}</Card>
      {Boolean(detail.serviceSnapshots?.length) && <Card title="增值服务与履约承诺" extra={<Tag color="blue">按发生次数分别记录</Tag>}>
        <Alert
          type="info"
          showIcon
          title="这里只展示已承诺的服务与计划时段；实际开始与完成另行记录，不能用计划时间当作已履约。"
          style={{ marginBottom: 16 }}
        />
        <Table<RentalOrderServiceOccurrence>
          rowKey={(row) => row.occurrenceId ?? `${row.serviceId}:${row.scheduledStartAt}`}
          size="small"
          pagination={false}
          dataSource={detail.serviceSnapshots}
          columns={[
            { title: "来源", width: 150, render: (_, row) => serviceOccurrenceOriginText(row) },
            { title: "服务", render: (_, row) => <Space orientation="vertical" size={0}><span>{row.serviceName}</span><span style={{ color: "#999" }}>{row.serviceCode} · 服务版本 {row.serviceVersion} · 条款 {row.termsVersion}</span></Space> },
            { title: "计划时段", render: (_, row) => `${new Date(row.scheduledStartAt).toLocaleString()} ～ ${new Date(row.scheduledEndAt).toLocaleString()}` },
            { title: "数量 × 单位数 × 单价", align: "right", render: (_, row) => `${row.quantity} × ${row.billingUnits} × ${money(row.unitPrice)}` },
            { title: "原价", align: "right", render: (_, row) => money(row.amount) },
            { title: "减免", align: "right", render: (_, row) => money(Number(row.discountAllocatedAmount ?? 0) + Number(row.couponAllocatedAmount ?? 0)) },
            { title: "净额", align: "right", render: (_, row) => money(serviceOccurrenceNetAmount(row)) },
            { title: "实际履约", width: 150, render: (_, row) => {
              const status = row.executionStatus ?? "not_started";
              return <Space orientation="vertical" size={0}><Tag color={SERVICE_EXECUTION_STATUS_COLORS[status]}>{SERVICE_EXECUTION_STATUS_LABELS[status]}</Tag><span style={{ color: "#999" }}>{row.actualStartAt ? `开始 ${new Date(row.actualStartAt).toLocaleString()}` : "未记录实际开始"}</span>{row.actualEndAt && <span style={{ color: "#999" }}>结束 {new Date(row.actualEndAt).toLocaleString()}</span>}</Space>;
            }},
            { title: "退款", width: 150, render: (_, row) => row.refundStatus && row.refundStatus !== "none"
              ? <Tag color={row.refundStatus === "pending_review" ? "orange" : row.refundStatus === "approved_pending_refund" ? "gold" : "default"}>{row.refundStatus === "pending_review" ? `待审核 ${money(row.refundAmount)}` : row.refundStatus === "approved_pending_refund" ? `已核减，待退款 ${money(row.refundAmount)}` : "已驳回"}</Tag>
              : "-" },
            { title: "容量", width: 130, render: (_, row) => row.requiresCapacity
              ? <Tag color={row.reservationKey ? "green" : "orange"}>{row.reservationKey ? `已占 ${row.capacityQuantity}` : "无容量依据"}</Tag>
              : <Tag color="default">不需要容量</Tag> },
            { title: "操作", width: 260, render: (_, row) => {
              if (!canOperate || !row.occurrenceId) return <span style={{ color: "#999" }}>无操作权限/历史记录</span>;
              const status = row.executionStatus ?? "not_started";
              const actions: Array<{ action: RentalServiceExecutionAction; label: string; danger?: boolean }> = status === "not_started"
                ? [{ action: "start", label: "开始" }, { action: "complete", label: "直接完成" }, { action: "cancel", label: "取消" }, { action: "no_show", label: "未到场", danger: true }]
                : status === "in_progress"
                  ? [{ action: "complete", label: "完成" }, { action: "fail", label: "记录失败", danger: true }]
                  : [];
              return <Space wrap>{actions.map((item) => <Button key={item.action} type={item.action === "complete" ? "primary" : "link"} danger={item.danger} size="small" onClick={() => { serviceExecutionForm.resetFields(); setServiceExecution({ occurrence: row, action: item.action }); }}>{item.label}</Button>)}</Space>;
            } }
          ]}
        />
      </Card>}
      <Card title="费用与版本快照"><Table rowKey="code" pagination={false} dataSource={detail.chargeLines} columns={[{ title: "费用项", dataIndex: "name" }, { title: "类型", dataIndex: "type" }, { title: "来源版本", dataIndex: "sourceVersion", render: (value) => value ?? "-" }, { title: "说明", dataIndex: "detail", render: (value) => value ?? "-" }, { title: "金额", dataIndex: "amount", render: (value) => money(Number(value)) }]} /></Card>
      {Boolean(detail.membershipBenefitEvaluations?.length) && <Card title="会员权益应用快照" extra={<Tag color="blue">按下单时会员方案固化</Tag>}>
        <Table rowKey={(row) => `${row.planVersionId}:${row.type}:${row.appliesTo}`} pagination={false} size="small" dataSource={detail.membershipBenefitEvaluations} columns={[
          { title: "权益来源", render: (_, row) => <>{row.planName}<br /><span className="muted">{row.source === "corporate" ? "企业员工权益" : "个人会员权益"}</span></> },
          { title: "权益", dataIndex: "type", render: (value) => MEMBERSHIP_BENEFIT_LABELS[String(value)] ?? value },
          { title: "配置", render: (_, row) => `${row.calculation} · ${row.configuredValue}` },
          { title: "本次效果", render: (_, row) => row.appliedAmount > 0 ? <Tag color="green">减免 {money(row.appliedAmount)}</Tag> : <Tag>{row.skippedReason ?? "未生效"}</Tag> },
          { title: "说明", dataIndex: "detail", render: (value) => value ?? "-" }
        ]} />
      </Card>}
      <Card title="检查、使用量与异常审核"><Space orientation="vertical" style={{ width: "100%" }} size={16}>
        <Table rowKey={(row) => `${row.inspectionId}:${row.fieldCode}`} size="small" pagination={false} dataSource={(inspections.data ?? []).flatMap((record) => (record.usageReadings ?? []).map((reading) => ({ ...reading, inspectionId: record.id, stage: record.stage })))} columns={[
          { title: "阶段", dataIndex: "stage", render: (value) => value === "pickup" ? "领取基线" : "归还读数" },
          { title: "读数字段", dataIndex: "fieldCode" },
          { title: "领取基线", dataIndex: "baseline", render: (value) => value ?? "-" },
          { title: "归还原始值", dataIndex: "current" },
          { title: "使用量", dataIndex: "delta", render: (value) => value ?? "-" }
        ]} />
        <Table rowKey={(row) => `${row.inspectionId}:${row.exceptionIndex}`} pagination={false} dataSource={(inspections.data ?? []).flatMap((record) => record.exceptions.map((exception, exceptionIndex) => ({ ...exception, inspectionId: record.id, exceptionIndex, stage: record.stage, operator: record.operator })))} columns={[
        { title: "阶段", dataIndex: "stage", render: (value) => value === "pickup" ? "领取" : "归还" },
        { title: "异常", render: (_, row) => `${row.code} · ${row.description}` },
        { title: "建议费用", dataIndex: "suggestedChargeAmount", render: (value) => value === undefined ? "-" : money(Number(value)) },
        { title: "审核", dataIndex: "reviewStatus", render: (value) => <Tag color={value === "approved" ? "green" : value === "rejected" ? "default" : "orange"}>{value === "approved" ? "已通过" : value === "rejected" ? "已驳回" : "待审核"}</Tag> },
        { title: "最终费用", dataIndex: "approvedChargeAmount", render: (value) => value === undefined ? "-" : money(Number(value)) },
        { title: "操作", render: (_, row) => canReviewFees && row.reviewStatus === "pending" ? <Button type="link" onClick={() => { setExceptionReview({ inspectionId: row.inspectionId, exceptionIndex: row.exceptionIndex, description: row.description, suggested: row.suggestedChargeAmount }); exceptionReviewForm.setFieldsValue({ decision: "approved", approvedChargeAmount: row.suggestedChargeAmount }); }}>审核</Button> : "-" }
        ]} />
      </Space></Card>
      <Card title="待审费用与裁定历史" extra={<Tag color={pendingFeeReviews.length ? "orange" : "default"}>{pendingFeeReviews.length ? `${pendingFeeReviews.length} 项待裁定` : "无待办"}</Tag>}>
        <Alert
          type="info"
          showIcon
          title="裁定只决定应收金额；批准退款表示应收已核减、等待实际退款，实际收退款仍要在下方资金区按资金权限单独办理。"
          style={{ marginBottom: 16 }}
        />
        {feeReviews.length ? <Table<RentalOrderFeeReview> rowKey="id" size="small" pagination={false} dataSource={feeReviews} columns={[
          { title: "类型", dataIndex: "type", render: (value) => FEE_REVIEW_TYPE_LABELS[value as RentalOrderFeeReview["type"]] ?? String(value) },
          { title: "来源", render: () => "订单费用审核" },
          { title: "建议金额", dataIndex: "suggestedAmount", render: (value) => money(Number(value)) },
          { title: "依据", dataIndex: "basis", render: (value) => <Space orientation="vertical" size={0}>{((value as string[]) ?? []).map((row) => <span key={row}>{row}</span>)}</Space> },
          { title: "状态", render: (_, row) => <Tag color={FEE_REVIEW_STATUS_COLORS[row.status]}>{feeReviewStatusText(row)}</Tag> },
          { title: "裁定额", dataIndex: "decidedAmount", render: (value, row) => row.status === "pending" ? "-" : money(Number(value ?? 0)) },
          { title: "原因", dataIndex: "reason", render: (value) => value ?? "-" },
          { title: "操作者", dataIndex: "reviewedBy", render: (value) => value ?? "-" },
          { title: "时间", render: (_, row) => new Date(row.reviewedAt ?? row.createdAt).toLocaleString() },
          {
            title: "操作",
            render: (_, row) => row.status !== "pending"
              ? "-"
              : canReviewFees
                ? <Button type="link" onClick={() => { setFeeReview(row); feeReviewForm.setFieldsValue({ decision: "approved", amount: row.suggestedAmount, reason: undefined }); }}>裁定</Button>
                : <span style={{ color: "#999" }}>无费用裁定权限</span>
          }
        ]} /> : <span style={{ color: "#999" }}>当前订单没有需要人工裁定的费用事项。</span>}
      </Card>
      {canViewFunding && <Card title={<Space><DollarOutlined />收付款、押金与预授权 <Tag color="orange">模拟资金</Tag></Space>}>
        {funding.data?.rental && <Space orientation="vertical" style={{ marginBottom: 16 }}>
          <span>最终应收 {money(funding.data.rental.payable)} · 已收 {money(funding.data.rental.collected)} · 已退 {money(funding.data.rental.refunded)} · 保证金抵扣 {money(funding.data.rental.securityCaptured)}</span>
          <span>{funding.data.rental.balance < 0 ? "待退" : "待收"} {money(Math.abs(funding.data.rental.balance))} · 续租待补 {money(funding.data.rental.pendingExtensionAmount)}</span>
          {canSettleFunding && <Space>
            {funding.data.rental.balance + funding.data.rental.pendingExtensionAmount > 0 && <Button onClick={() => setFundingOperation({ instrument: "rental", action: "append" })}>登记模拟收款／补款</Button>}
            {funding.data.rental.balance < 0 && <Button onClick={() => setFundingOperation({ instrument: "rental", action: "refund" })}>办理模拟退款</Button>}
          </Space>}
        </Space>}
        <Alert type="warning" showIcon title="当前未接入真实支付机构；以下操作只记录可追溯的模拟资金事件，不代表真实收款、冻结或退款。" style={{ marginBottom: 16 }} />
        <Descriptions column={{ xs: 1, md: 2 }} items={[
          { key: "deposit", label: `应收押金 ${money(detail.depositAmount)}`, children: funding.data ? `已收 ${money(funding.data.deposit.collected)} / 已抵扣 ${money(funding.data.deposit.captured)} / 已退 ${money(funding.data.deposit.refunded)} / 余额 ${money(funding.data.deposit.balance)}` : "加载中" },
          { key: "preauth", label: `应冻结预授权 ${money(detail.preAuthAmount)}`, children: funding.data ? `已冻结 ${money(funding.data.preauthorization.frozen)} / 已转扣 ${money(funding.data.preauthorization.captured)} / 已释放 ${money(funding.data.preauthorization.released)} / 余额 ${money(funding.data.preauthorization.balance)}` : "加载中" }
        ]} />
        {canSettleFunding && <Space wrap style={{ margin: "12px 0" }}>
          {detail.depositAmount > 0 && !funding.data?.deposit.collected && <Button onClick={() => setFundingOperation({ instrument: "deposit", action: "initiate" })}>模拟收取押金</Button>}
          {(funding.data?.deposit.collected ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "deposit", action: "append" })}>追加押金</Button>}
          {(funding.data?.deposit.balance ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "deposit", action: "capture" })}>押金抵扣</Button>}
          {(funding.data?.deposit.balance ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "deposit", action: "refund" })}>押金退款</Button>}
          {detail.preAuthAmount > 0 && !funding.data?.preauthorization.frozen && <Button onClick={() => setFundingOperation({ instrument: "preauthorization", action: "initiate" })}>模拟冻结预授权</Button>}
          {(funding.data?.preauthorization.frozen ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "preauthorization", action: "append" })}>追加预授权</Button>}
          {(funding.data?.preauthorization.balance ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "preauthorization", action: "capture" })}>预授权转扣</Button>}
          {(funding.data?.preauthorization.balance ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "preauthorization", action: "release" })}>释放全部预授权</Button>}
          <Button danger onClick={() => setFundingOperation({ instrument: detail.preAuthAmount > 0 ? "preauthorization" : "deposit", action: "fail" })}>记录资金失败</Button>
        </Space>}
        <Table rowKey="id" size="small" pagination={false} loading={funding.isLoading} dataSource={funding.data?.events ?? []} columns={[
          { title: "时间", dataIndex: "at", render: (value) => new Date(String(value)).toLocaleString() },
          { title: "对象", dataIndex: "instrument", render: (value) => FUNDING_INSTRUMENT_LABELS[value as RentalFundingInstrument] },
          { title: "动作", dataIndex: "action", render: (value) => FUNDING_ACTION_LABELS[value as RentalFundingAction] },
          { title: "金额", dataIndex: "amount", render: (value) => money(Number(value)) },
          { title: "事件后余额", dataIndex: "balanceAfter", render: (value) => money(Number(value)) },
          { title: "原因", dataIndex: "reason" },
          { title: "状态", render: (_, row) => <Tag color={row.action === "fail" ? "red" : "orange"}>{row.action === "fail" ? `失败 · ${row.failureCode}` : "模拟成功"}</Tag> }
        ]} />
      </Card>}
      {Boolean(extensions.data?.length) && <Card className="data-panel" title={<span className="panel-title">续租记录 <span className="panel-count">{extensions.data?.length}</span></span>}>
        <Alert type="info" showIcon title={order.data.ruleSnapshot?.extension?.pricingMode === "original_total" ? "按原价格重算完整租期，只补差价" : "新增时段单独计费"} description="续租方式以本单规则快照为准；须检查后续占用及缓冲，原始账单保留。缓冲只占库存，不计租金。" style={{ marginBottom: 12 }} />
        <Table<RentalOrderExtension> rowKey="id" size="small" pagination={false} dataSource={extensions.data ?? []} columns={[
          { title: "次序", dataIndex: "sequence", width: 72 },
          { title: "延长期间", render: (_, row) => <>{dayjs(row.originalEndAt).format("YYYY-MM-DD HH:mm")} → {dayjs(row.newEndAt).format("YYYY-MM-DD HH:mm")}</> },
          { title: "租金差额", align: "right", render: (_, row) => money(row.rentalAmount) },
          { title: "增值服务", align: "right", render: (_, row) => money(row.serviceAmount) },
          { title: "需补差价", align: "right", render: (_, row) => <b>{money(row.payableAmount)}</b> },
          { title: "退款审核", render: (_, row) => row.pricingSnapshot?.refundReview ? <>{money(row.pricingSnapshot.refundReview.amount)} · {{ pending: "待审核", approved: "已核减（实际退款另办）", rejected: "已拒绝", superseded: "已由后续重算替代" }[row.pricingSnapshot.refundReview.status]}</> : "—" },
          { title: "结算方式", render: (_, row) => <Tag color={row.settlementMode === "monthly" ? "blue" : "gold"}>{row.settlementMode === "monthly" ? "企业月结" : "客户补款"}</Tag> },
          { title: "状态", render: (_, row) => <Tag color={row.status === "effective" ? "success" : row.status === "pending_payment" ? "gold" : "default"}>{{ pending_payment: "待补款", effective: "已生效", cancelled: "已取消", expired: "已过期" }[row.status]}</Tag> },
          { title: "价格版本", render: (_, row) => row.priceVersion ?? "—" },
          { title: "操作", align: "right", render: (_, row) => row.status === "pending_payment" ? <Button type="link" loading={payExtension.isPending} onClick={() => payExtension.mutate(row.id)}>确认补款</Button> : row.pricingSnapshot?.refundReview?.status === "pending" && canReviewFees ? <Button type="link" onClick={() => { setExtensionRefundReview(row); extensionRefundForm.setFieldsValue({ decision: "approved", reason: "" }); }}>审核退款差额</Button> : "—" }
        ]} />
      </Card>}
    </Space>}</QueryState>
    <Modal title={inspectionReturnItems?.length ? "部分归还检查" : inspection?.name} open={Boolean(inspection)} onCancel={() => { setInspection(undefined); setInspectionReturnItems(undefined); }} onOk={() => inspectionForm.submit()} confirmLoading={inspect.isPending} destroyOnHidden>{inspection && <Form form={inspectionForm} layout="vertical" onFinish={(values) => inspect.mutate(values)}>{inspectionReturnItems?.length ? <Alert type="info" showIcon title={`本次检查并归还 ${inspectionReturnItems.length} 个分配项`} description="只会释放本批实物；剩余项目继续在租。最后一批请使用整单归还，以统一结算逾期和提前归还。" style={{ marginBottom: 16 }} /> : null}{inspection.fields.map((field) => <Form.Item key={field.code} name={field.code} label={field.label} rules={inspectionFieldRules(field)}>{field.type === "number" ? <InputNumber suffix={field.unit} style={{ width: "100%" }} /> : field.type === "boolean" ? <Select options={[{ value: true, label: "是 / 正常" }, { value: false, label: "否 / 异常" }]} /> : <Input />}</Form.Item>)}{inspection.stage === "return" && <Card size="small" title="异常与损坏建议（可选）"><Alert type="info" showIcon title="检查员只记录事实和建议损失额，不会直接向客户计费。" style={{ marginBottom: 12 }} /><Form.Item name="exceptionCode" label="异常编码"><Input placeholder="damage / missing_item / cleaning" /></Form.Item><Form.Item name="exceptionDescription" label="异常说明"><Input.TextArea rows={2} /></Form.Item><Form.Item name="exceptionChargeAmount" label="建议损失金额"><InputNumber min={0} precision={2} prefix={symbol} style={{ width: "100%" }} /></Form.Item></Card>}</Form>}</Modal>
    <Modal title="续租 / 延期" open={extensionOpen} onCancel={() => { setExtensionOpen(false); setExtensionPreview(undefined); }} destroyOnHidden width={640}
      footer={[
        <Button key="cancel" onClick={() => { setExtensionOpen(false); setExtensionPreview(undefined); }}>取消</Button>,
        <Button key="preview" loading={previewExtension.isPending} onClick={() => extensionForm.validateFields().then((values) => previewExtension.mutate(values))}>试算费用</Button>,
        <Button key="submit" type="primary" disabled={!extensionPreview} loading={applyExtension.isPending} onClick={() => extensionForm.validateFields().then((values) => applyExtension.mutate(values))}>
          {extensionPreview?.paymentRequired ? "提交申请（待补款）" : "提交并生效"}
        </Button>
      ]}>
      <Form form={extensionForm} layout="vertical">
        <Alert type="info" showIcon title="先检查后续占用及缓冲，再计算续租费" description={order.data?.ruleSnapshot?.extension?.pricingMode === "original_total" ? "从原起租时间算到新归还时间，沿用原价格版本和原优惠规则，扣除此前已计金额；零差额无需补款，负差额另走退款审核。" : "原租期费用不变，新增时段按申请续租时的价格单独计算，不追溯重算原订单优惠。"} style={{ marginBottom: 16 }} />
        <Form.Item label="当前归还时间">
          <Input disabled value={dayjs(detailEndAt).format("YYYY-MM-DD HH:mm")} />
        </Form.Item>
        <Form.Item name="newEndAt" label="新的归还时间" rules={[{ required: true, message: "请选择新的归还时间" }]}>
          {/* 换时间就作废上一次试算：让"金额"和"时间"不可能对不上。 */}
          <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} onChange={() => setExtensionPreview(undefined)} disabledDate={(current) => current.isBefore(dayjs(detailEndAt), "day")} />
        </Form.Item>
        <Form.Item name="memo" label="备注"><Input.TextArea rows={2} placeholder="客户申请原因、沟通记录等" /></Form.Item>
        {extensionPreview && <Card size="small" title="试算结果">
          <Descriptions column={2} size="small" items={[
            { key: "period", label: "延长期间", span: 2, children: `${dayjs(extensionPreview.originalEndAt).format("MM-DD HH:mm")} → ${dayjs(extensionPreview.newEndAt).format("MM-DD HH:mm")}` },
            { key: "units", label: "计费单位数", children: extensionPreview.billableUnits },
            ...(extensionPreview.pricingSnapshot ? [
              { key: "previous", label: "此前已计应付", children: money(extensionPreview.pricingSnapshot.previousPayableAmount) },
              { key: "recalculated", label: "新租期重算应付", children: money(extensionPreview.pricingSnapshot.recalculatedPayableAmount) },
            ] : []),
            { key: "rental", label: "租金差额", children: money(extensionPreview.rentalAmount) },
            { key: "service", label: "新增服务费", children: money(extensionPreview.serviceAmount) },
            { key: "deposit", label: "押金差额", children: money(extensionPreview.depositDelta) },
            { key: "preauth", label: "预授权差额", children: money(extensionPreview.preAuthDelta) },
            { key: "payable", label: "本次需补差价", children: <b>{money(extensionPreview.payableAmount)}</b> },
            { key: "refund", label: "待审核退款差额", children: money(extensionPreview.pricingSnapshot?.refundReview?.amount) },
            { key: "settlement", label: "生效方式", span: 2, children: extensionPreview.paymentRequired ? "补差价后才延长租期与占用" : extensionPreview.payableAmount === 0 ? "无需补款即可续租；若有负差额，另行审核退款" : "企业月结：提交即生效，差额记入月结" },
            { key: "version", label: "价格版本", children: extensionPreview.priceVersion ?? "—" },
            { key: "rule", label: "规则版本", children: extensionPreview.ruleVersion }
          ]} />
          <Table size="small" pagination={false} style={{ marginTop: 12 }} rowKey="code" dataSource={extensionPreview.chargeLines} columns={[
            { title: "费用", dataIndex: "name" },
            { title: "金额", align: "right", render: (_, row) => money(row.amount) },
            { title: "计算说明", dataIndex: "detail", render: (value) => <span className="muted">{value ?? "—"}</span> }
          ]} />
        </Card>}
      </Form>
    </Modal>
    <Modal title="续租价差退款审核" open={Boolean(extensionRefundReview)} onCancel={() => setExtensionRefundReview(undefined)} onOk={() => extensionRefundForm.submit()} confirmLoading={reviewExtensionRefund.isPending} destroyOnHidden>
      <Alert type="warning" showIcon title={`待审核差额 ${money(extensionRefundReview?.pricingSnapshot?.refundReview?.amount)}`} description="审核通过只核减订单应收，并不会自动向客户转账退款。实际退款需另行处理。" />
      <Form form={extensionRefundForm} layout="vertical" onFinish={(values) => reviewExtensionRefund.mutate(values)}>
        <Form.Item name="decision" label="审核结果" rules={[{ required: true }]}><Select options={[{ value: "approved", label: "通过并核减应收" }, { value: "rejected", label: "拒绝" }]} /></Form.Item>
        <Form.Item name="reason" label="审核原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} maxLength={500} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="取消租赁订单" open={cancelOpen} onCancel={() => setCancelOpen(false)} onOk={() => cancelForm.submit()} confirmLoading={cancel.isPending} destroyOnHidden><Form form={cancelForm} layout="vertical" onFinish={(values) => cancel.mutate(values)}><Alert type="info" showIcon title="系统会撤销未履行租金，再按当前冻结规则计入取消费。" description="天气等特殊豁免必须走审批，不可由本页面直接免除。" style={{ marginBottom: 16 }} /><Form.Item name="reason" label="取消原因" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item></Form></Modal>
    <Modal title="确认客户爽约" open={noShowOpen} onCancel={() => { setNoShowOpen(false); noShowForm.resetFields(); }} onOk={() => noShowForm.submit()} confirmLoading={confirmNoShow.isPending} destroyOnHidden>
      <Alert type="warning" showIcon title={noShowFinalReady ? "最终时限已到。确认后会释放库存、服务容量和优惠券占用；已支付金额按规则进入待退款/资金处理。" : "这是有权限人员的提前确认。请确认已通知客户并填写事实原因；确认后会释放库存、服务容量和优惠券占用。"} style={{ marginBottom: 16 }} />
      <Form form={noShowForm} layout="vertical" onFinish={(values) => confirmNoShow.mutate(values)}>
        <Form.Item name="reason" label="爽约原因" rules={[{ required: true, whitespace: true, message: "请输入爽约原因" }]}>
          <Input.TextArea rows={3} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
    <Modal title="替换套装组成" open={Boolean(substitution)} onCancel={() => setSubstitution(undefined)} onOk={() => substitutionForm.submit()} confirmLoading={substitute.isPending} destroyOnHidden><Form form={substitutionForm} layout="vertical" onFinish={(values) => substitute.mutate(values)}><Form.Item label="当前组成"><Input disabled value={groups.data?.find((group) => group.id === substitution?.fromItemGroupId)?.name} /></Form.Item><Form.Item name="toItemGroupId" label="替代商品" rules={[{ required: true }]}><Select options={substitutionOptions} placeholder="选择同一替代组的候选商品" /></Form.Item></Form></Modal>
    <Modal title={detail?.ruleSnapshot?.fulfillment.returnInspectionRequired ? "部分归还检查" : "部分归还"} open={partialReturnOpen} onCancel={() => setPartialReturnOpen(false)} onOk={() => partialReturnForm.submit()} confirmLoading={partialReturn.isPending} destroyOnHidden><Form form={partialReturnForm} layout="vertical" onFinish={async (values) => { if (detail?.ruleSnapshot?.fulfillment.returnInspectionRequired) { if (await beginInspection("return", values.items)) setPartialReturnOpen(false); return; } partialReturn.mutate(values); }}><Alert type="info" showIcon title={detail?.ruleSnapshot?.fulfillment.returnInspectionRequired ? "选择本批归还项后，下一步填写归还检查。" : "本批实物会直接释放；最后一批仍须使用整单归还。"} style={{ marginBottom: 16 }} /><Form.List name="items">{(fields, { add, remove }) => <Space orientation="vertical" style={{ width: "100%" }}>{fields.map((field) => <Space key={field.key} align="start"><Form.Item {...field} name={[field.name, "allocationId"]} rules={[{ required: true }]}><Select style={{ width: 320 }} placeholder="选择待归还资产或数量项" options={detail?.allocations.filter((allocation) => allocation.status === "picked_up").map((allocation) => ({ value: allocation.id, label: allocation.assetNo ?? `${groups.data?.find((group) => group.id === allocation.itemGroupId)?.name ?? "数量库存"} · 剩余 ${allocation.quantity}` }))} /></Form.Item><Form.Item {...field} name={[field.name, "quantity"]} rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: 100 }} /></Form.Item><Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} /></Space>)}<Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ quantity: 1 })}>增加归还项</Button></Space>}</Form.List></Form></Modal>
    <Modal title={fundingOperation ? `${FUNDING_ACTION_LABELS[fundingOperation.action]}${FUNDING_INSTRUMENT_LABELS[fundingOperation.instrument]}（模拟）` : "模拟资金操作"} open={Boolean(fundingOperation)} onCancel={() => { setFundingOperation(undefined); fundingForm.resetFields(); }} onOk={() => fundingForm.submit()} confirmLoading={fundingAction.isPending} destroyOnHidden>
      <Alert type="warning" showIcon title="本操作仅写入模拟资金流水，不会发起真实扣款或冻结。" style={{ marginBottom: 16 }} />
      <Form form={fundingForm} layout="vertical" onFinish={(values) => fundingAction.mutate(values)}>
        {fundingOperation && !["initiate", "release", "fail"].includes(fundingOperation.action) && <Form.Item name="amount" label="金额" rules={[{ required: true }]}><InputNumber min={0.01} precision={2} prefix={symbol} style={{ width: "100%" }} /></Form.Item>}
        {fundingOperation?.action === "fail" && <Form.Item name="failureCode" label="失败原因码" rules={[{ required: true }]}><Input placeholder="例如 provider_timeout" /></Form.Item>}
        <Form.Item name="reason" label="操作原因" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="审核检查异常" open={Boolean(exceptionReview)} onCancel={() => { setExceptionReview(undefined); exceptionReviewForm.resetFields(); }} onOk={() => exceptionReviewForm.submit()} confirmLoading={reviewException.isPending} destroyOnHidden>
      <Alert type="info" showIcon title={exceptionReview?.description} description={`检查员建议费用：${exceptionReview?.suggested === undefined ? "未填写" : money(exceptionReview.suggested)}。最终费用由具备结算权限的人员确认。`} style={{ marginBottom: 16 }} />
      <Form form={exceptionReviewForm} layout="vertical" onFinish={(values) => reviewException.mutate(values)}>
        <Form.Item name="decision" label="审核结论" rules={[{ required: true }]}><Select options={[{ value: "approved", label: "通过并计费" }, { value: "rejected", label: "驳回，不计费" }]} /></Form.Item>
        <Form.Item noStyle shouldUpdate={(before, after) => before.decision !== after.decision}>{({ getFieldValue }) => getFieldValue("decision") === "approved" ? <Form.Item name="approvedChargeAmount" label="最终费用" rules={[{ required: true }]}><InputNumber min={0} precision={2} prefix={symbol} style={{ width: "100%" }} /></Form.Item> : null}</Form.Item>
        <Form.Item name="reason" label="审核理由" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>
    <Modal
      title={serviceExecution ? `${serviceExecution.action === "start" ? "开始" : serviceExecution.action === "complete" ? "完成" : serviceExecution.action === "cancel" ? "取消" : serviceExecution.action === "no_show" ? "登记未到场" : "记录失败"}服务：${serviceExecution.occurrence.serviceName}` : "服务履约"}
      open={Boolean(serviceExecution)}
      onCancel={() => { setServiceExecution(undefined); serviceExecutionForm.resetFields(); }}
      onOk={() => serviceExecutionForm.submit()}
      confirmLoading={executeService.isPending}
      destroyOnHidden
    >
      <Alert
        type={serviceExecution?.action === "complete" ? "info" : "warning"}
        showIcon
        title="实际时间由本次操作记录，计划时段不能自动证明服务已经履约。"
        description={serviceExecution?.action === "complete" ? "完成服务必须填写执行结果，并明确记录客户是否确认。" : "取消、失败或未到场会按服务净额生成待审核退款；批准后仍需到资金区办理实际退款。"}
        style={{ marginBottom: 16 }}
      />
      <Form form={serviceExecutionForm} layout="vertical" onFinish={(values) => executeService.mutate(values)}>
        {serviceExecution?.action === "start" && <span style={{ color: "#666" }}>点击确认后记录当前时间为实际开始时间。</span>}
        {serviceExecution?.action === "complete" && <>
          <Form.Item name="result" label="执行结果" rules={[{ required: true, whitespace: true, message: "请填写执行结果" }]}><Input.TextArea rows={3} placeholder="例如：服务已完成，客户现场确认" /></Form.Item>
          <Form.Item name="customerConfirmed" label="客户确认" rules={[{ required: true, message: "请选择客户是否确认" }]}><Select options={[{ value: true, label: "客户已确认" }, { value: false, label: "客户未确认" }]} /></Form.Item>
        </>}
        {serviceExecution && ["cancel", "fail", "no_show"].includes(serviceExecution.action) && <>
          <Form.Item name="reason" label="处理原因" rules={[{ required: true, whitespace: true, message: "请填写处理原因" }]}><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="refundAmount" label="建议退款净额" extra={`留空按服务客户实际净支付 ${money(serviceOccurrenceNetAmount(serviceExecution.occurrence))} 全额退款；实际退款仍需审核。`}><InputNumber min={0} max={serviceOccurrenceNetAmount(serviceExecution.occurrence)} precision={2} prefix={symbol} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="compensationAmount" label="补偿金额（记录用）"><InputNumber min={0} precision={2} prefix={symbol} style={{ width: "100%" }} /></Form.Item>
        </>}
        {serviceExecution?.action !== "start" && <Form.Item name="evidenceAttachments" label="证据引用（可选）" extra="每行或用逗号填写一条照片、签名或附件引用，不在本任务接入文件存储。"><Input.TextArea rows={2} /></Form.Item>}
      </Form>
    </Modal>
    <Modal
      title={feeReview ? `裁定${FEE_REVIEW_TYPE_LABELS[feeReview.type]}` : "费用裁定"}
      open={Boolean(feeReview)}
      onCancel={() => { setFeeReview(undefined); feeReviewForm.resetFields(); }}
      onOk={() => feeReviewForm.submit()}
      confirmLoading={decideFeeReview.isPending}
      okButtonProps={{ disabled: decideFeeReview.isPending }}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        title={`规则建议金额 ${money(feeReview?.suggestedAmount)}`}
        description={<Space orientation="vertical" size={0}>
          {(feeReview?.basis ?? []).map((row) => <span key={row}>{row}</span>)}
          <span>
            {feeReview?.type === "early_return_refund" || feeReview?.type === "service_refund"
              ? "批准后只核减应收并生成待退款；实际退款要到资金区由具备资金权限的人员办理。"
              : "批准后按认定额计入应收；实际收款要到资金区单独登记。"}
          </span>
        </Space>}
        style={{ marginBottom: 16 }}
      />
      <Form form={feeReviewForm} layout="vertical" onFinish={(values) => decideFeeReview.mutate(values)}>
        <Form.Item name="decision" label="裁定结论" rules={[{ required: true }]}>
          <Select options={[
            { value: "approved", label: feeReview?.type === "early_return_refund" || feeReview?.type === "service_refund" ? "批准退款（核减应收）" : "批准计费" },
            { value: "rejected", label: feeReview?.type === "early_return_refund" || feeReview?.type === "service_refund" ? "驳回，不退款" : "驳回，不计费" }
          ]} />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(before, after) => before.decision !== after.decision}>
          {({ getFieldValue }) => getFieldValue("decision") === "approved"
            ? <Form.Item
                name="amount"
                label="认定金额"
                extra="不填按建议金额。认定额不得超过建议额——超出部分属于另立一笔异常费用，须走检查异常流程并留下自己的依据。"
                rules={[
                  { required: true, message: "请填写认定金额" },
                  {
                    validator: (_rule, value) =>
                      value === undefined || Number(value) <= Number(feeReview?.suggestedAmount ?? 0)
                        ? Promise.resolve()
                        : Promise.reject(new Error(`认定额不能超过建议额 ${money(feeReview?.suggestedAmount)}`))
                  }
                ]}
              ><InputNumber min={0} precision={2} prefix={symbol} style={{ width: "100%" }} /></Form.Item>
            : null}
        </Form.Item>
        <Form.Item name="reason" label="裁定原因" rules={[{ required: true, message: "请填写裁定原因，客服要据此向客户解释" }]}>
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  </>;
}

function inspectionFieldRules(field: RentalInspectionTemplate["fields"][number]) {
  if (!field.required) return undefined;
  if (field.type === "boolean") {
    return [{ validator: (_rule: unknown, value: unknown) => typeof value === "boolean" ? Promise.resolve() : Promise.reject(new Error(`请输入${field.label}`)) }];
  }
  return [{ required: true, message: `请输入${field.label}` }];
}
