import { ArrowLeftOutlined, CheckCircleOutlined, DollarOutlined, MinusCircleOutlined, PlusOutlined, RetweetOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { RentalCoreOrderStatus, formatRentalMoney, rentalCurrencySymbol, type AdjustRentalInspectionExceptionRequest, type ApplyRentalOrderChangeRequest, type CorrectRentalInspectionUsageRequest, type CreateRentalInspectionRequest, type PreviewRentalOrderChangeRequest, type RecordRentalInspectionExceptionCustomerResponseRequest, type RentalAllocation, type RentalDeliveryAddressSnapshot, type RentalFundingAction, type RentalFundingInstrument, type RentalInspectionTemplate, type RentalOfflinePaymentMethod, type RentalOrderExtension, type RentalOrderExtensionPreview, type RentalOrderFeeReview, type RentalOrderServiceOccurrence, type RentalReservation, type RentalServiceExecutionAction, type UpdateRentalServiceOccurrenceRequest, type RentalWorkOrder, type RentalStockDisposition, type RentalOrderChangePreview } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Card, Descriptions, InputNumber, Modal, Space, Tag, Typography } from "antd";
import { Checkbox } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, DatePicker, Table, Upload } from "@/components/ui";
import { Input } from "@/components/ui";
import { ActionButton, Button, Select } from "@/components/ui";
import type { UploadFile, UploadProps } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";
import { OrderAllocationPanel } from "./OrderAllocationPanel";
import { OrderDocumentsPanel } from "./OrderDocumentsPanel";
import { CarrierShipmentPanel } from "./CarrierShipmentPanel";
import { FEE_REVIEW_STATUS_COLORS, FEE_REVIEW_TYPE_LABELS, feeReviewStatusText, hasPendingFeeReview } from "./orderFeeReview";
import { serviceOccurrenceNetAmount, serviceOccurrenceOriginText } from "./orderServiceOccurrence";

type FundingOperation = {
  instrument: RentalFundingInstrument;
  action: RentalFundingAction;
};

type ExceptionReviewValues = { decision: "approved" | "rejected"; approvedChargeAmount?: number; waiverDecision?: "covered" | "excluded"; liability?: "customer" | "normal_wear" | "lessor" | "third_party" | "undetermined"; incidentAt?: string; incidentBasis?: string; waiverOccurrenceId?: string; reason: string };

type PostPickupExchangeFormValues = {
  orderLineId: string;
  allocationId: string;
  replacementItemGroupId: string;
  replacementAssetId?: string;
  replacementPricingGroupId?: string;
  priceBasis: "original_order_price" | "replacement_current_price";
  originalDisposition: "return_to_warehouse" | "off_shelf";
  cancelServiceOccurrenceIds?: string[];
  condition: string;
  reason: string;
  customerConfirmed: boolean;
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

const OFFLINE_PAYMENT_METHOD_LABELS: Record<RentalOfflinePaymentMethod, string> = {
  offline_cash: "线下现金",
  offline_transfer: "线下转账",
};

const SERVICE_EXECUTION_ORDER_STATUSES = [
  RentalCoreOrderStatus.ReadyForPickup,
  RentalCoreOrderStatus.Renting,
  RentalCoreOrderStatus.Settling
];

const SERVICE_START_ORDER_STATUSES = [
  RentalCoreOrderStatus.ReadyForPickup,
  RentalCoreOrderStatus.Renting
];

const serviceOccurrenceTotalQuantity = (row: RentalOrderServiceOccurrence) => Number.isInteger(row.quantity) && row.quantity > 0 ? row.quantity : 1;
const serviceOccurrenceExecutedQuantity = (row: RentalOrderServiceOccurrence) => Math.min(
  serviceOccurrenceTotalQuantity(row),
  Number.isInteger(row.executedQuantity) && row.executedQuantity !== undefined && row.executedQuantity >= 0 ? row.executedQuantity : 0
);
const serviceOccurrenceRemainingQuantity = (row: RentalOrderServiceOccurrence) => Math.max(0, serviceOccurrenceTotalQuantity(row) - serviceOccurrenceExecutedQuantity(row));

export function RentalOrderDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const canViewFunding = hasPermission("rental-os:order:view") || hasPermission("rental-os:order:settle");
  const canRevealSensitive = hasPermission("rental-os:customer:reveal-sensitive");
  const canSettleFunding = hasPermission("rental-os:order:settle");
  // ORDER-CLOSE-02：裁定「该收/该退多少」与实际动钱是两个权限。只有裁定权的人看得到
  // 审核按钮但看不到收退款按钮；只有资金权的人反之。两者都不给的账号只能查看。
  const WORK_ORDER_STATUS_LABELS: Record<string, { label: string; color: string }> = { pending: { label: "待处理", color: "default" }, in_progress: { label: "处理中", color: "processing" }, pending_review: { label: "待验收", color: "warning" }, completed: { label: "已完成", color: "success" }, rejected: { label: "验收驳回", color: "error" }, cancelled: { label: "已取消", color: "default" } };
  const canViewWorkOrders = hasPermission("rental-core:maintenance:view");
  const canViewDispositions = canViewWorkOrders || hasPermission("rental-core:asset:view") || hasPermission("rental-core:asset:manage");
  const canReviewFees = hasPermission("rental-os:order:fee-review");
  const canOperate = hasPermission("rental-os:order:operate");
  const canPickup = canOperate || hasPermission("rental-os:order:pickup");
  const canReturn = canOperate || hasPermission("rental-os:order:return");
  const canExtend = canOperate || hasPermission("rental-os:order:extend");
  const canCancel = canOperate || hasPermission("rental-os:order:cancel");
  const [operationSession, setOperationSession] = useState<{ id: string; token?: string }>();
  const operationToken = operationSession?.id === id ? operationSession.token : sessionStorage.getItem(`rental-operation:${id}`) ?? undefined;
  const setOperationToken = (token?: string) => { if (token) sessionStorage.setItem(`rental-operation:${id}`, token); else sessionStorage.removeItem(`rental-operation:${id}`); setOperationSession({ id, token }); };
  const [inspection, setInspection] = useState<RentalInspectionTemplate>();
  const [carrierEvidenceFiles, setCarrierEvidenceFiles] = useState<UploadFile<{ id: string; mimeType: string }>[]>([]);
  const [inspectionReturnItems, setInspectionReturnItems] = useState<Array<{ allocationId: string; quantity: number }>>();
  const [inspectionClosing, setInspectionClosing] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [substitution, setSubstitution] = useState<{ orderLineId: string; fromItemGroupId: string }>();
  const [partialReturnOpen, setPartialReturnOpen] = useState(false);
  const [fundingOperation, setFundingOperation] = useState<FundingOperation>();
  const [exceptionReview, setExceptionReview] = useState<{ inspectionId: string; exceptionIndex: number; description: string; suggested?: number }>();
  const [exceptionCustomerResponse, setExceptionCustomerResponse] = useState<{ inspectionId: string; exceptionIndex: number; description: string; status?: string }>();
  const [exceptionAdjustment, setExceptionAdjustment] = useState<{ inspectionId: string; exceptionIndex: number; description: string; current: number; suggested?: number }>();
  const [usageCorrection, setUsageCorrection] = useState<{ inspectionId: string; fieldCode: string; stage: "pickup" | "return"; current: number; baseline?: number }>();
  const [feeReview, setFeeReview] = useState<RentalOrderFeeReview>();
  const [feeReviewForm] = Form.useForm<{ decision: "approved" | "rejected"; amount?: number; reason: string }>();
  const [inspectionForm] = Form.useForm<Record<string, unknown> & { exceptionCode?: string; exceptionDescription?: string; exceptionChargeAmount?: number }>();
  const [cancelForm] = Form.useForm<{ reason: string }>();
  const [noShowForm] = Form.useForm<{ reason: string }>();
  const [substitutionForm] = Form.useForm<{ toItemGroupId: string }>();
  const [partialReturnForm] = Form.useForm<{ items: Array<{ allocationId: string; quantity: number }> }>();
  const [fundingForm] = Form.useForm<{ amount?: number; reason: string; failureCode?: string; paymentMethod?: RentalOfflinePaymentMethod }>();
  const [exceptionReviewForm] = Form.useForm<ExceptionReviewValues>();
  const [exceptionCustomerResponseForm] = Form.useForm<RecordRentalInspectionExceptionCustomerResponseRequest>();
  const [exceptionAdjustmentForm] = Form.useForm<AdjustRentalInspectionExceptionRequest>();
  const [usageCorrectionForm] = Form.useForm<{ correctedCurrent: number; reason: string; evidenceAttachments?: string }>();
  const [extensionOpen, setExtensionOpen] = useState(false);
  const [extensionRefundReview, setExtensionRefundReview] = useState<RentalOrderExtension>();
  const [partialCancelOpen, setPartialCancelOpen] = useState(false);
  const [partialCancelPreview, setPartialCancelPreview] = useState<Awaited<ReturnType<typeof rentalCoreApi.previewPartialLineCancellation>>>();
  const [postPickupExchangeOpen, setPostPickupExchangeOpen] = useState(false);
  const [postPickupExchangePreview, setPostPickupExchangePreview] = useState<RentalOrderChangePreview>();
  const [exchangeTarget, setExchangeTarget] = useState<{ exchangeOrderLineId: string; replacementItemGroupId: string }>();
  const [serviceExecution, setServiceExecution] = useState<{ occurrence: RentalOrderServiceOccurrence; action: RentalServiceExecutionAction }>();
  const [serviceRefund, setServiceRefund] = useState<RentalOrderServiceOccurrence>();
  const [revealedDeliveryAddress, setRevealedDeliveryAddress] = useState<{ orderId: string; snapshot: RentalDeliveryAddressSnapshot }>();
  const [extensionRefundForm] = Form.useForm<{ decision: "approved" | "rejected"; reason: string }>();
  const [partialCancelForm] = Form.useForm<ApplyRentalOrderChangeRequest>();
  const [postPickupExchangeForm] = Form.useForm<PostPickupExchangeFormValues>();
  // 试算结果单独存：金额要先摆给运营/客户确认，确认后才提交申请。
  const [extensionPreview, setExtensionPreview] = useState<RentalOrderExtensionPreview>();
  const [extensionForm] = Form.useForm<{ newEndAt: Dayjs; memo?: string }>();
  const [serviceExecutionForm] = Form.useForm<{ executedQuantity?: number; result?: string; reason?: string; customerConfirmed?: boolean; refundAmount?: number; compensationAmount?: number; evidenceAttachments?: string }>();
  const [serviceRefundForm] = Form.useForm<{ reason: string; paymentMethod?: RentalOfflinePaymentMethod }>();
  const order = useQuery({ queryKey: ["rental-core", "order", id], queryFn: () => rentalCoreApi.order(id), enabled: Boolean(id) });
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const templates = useQuery({ queryKey: ["rental-core", "templates"], queryFn: () => rentalCoreApi.inspectionTemplates() });
  const carrierShipment = useQuery({ queryKey: ["rental-core", "carrier-shipment", id], queryFn: () => rentalCoreApi.carrierShipmentEvents(id), enabled: Boolean(id && order.data?.fulfillmentMode === "carrier_shipping") });
  const groups = useQuery({ queryKey: ["rental-core", "groups"], queryFn: rentalCoreApi.itemGroups });
  const pricingGroups = useQuery({ queryKey: ["rental-core", "pricing-groups"], queryFn: rentalCoreApi.pricingGroups, enabled: postPickupExchangeOpen });
  const exchangeAssetCandidates = useQuery({
    queryKey: ["rental-core", "order", id, "exchange-candidates", exchangeTarget],
    queryFn: () => rentalCoreApi.allocationCandidates(id, exchangeTarget),
    enabled: postPickupExchangeOpen && Boolean(exchangeTarget)
  });
  const businessSettings = useQuery({ queryKey: ["rental-core", "business-settings"], queryFn: rentalCoreApi.businessSettings });
  const offlinePaymentMethods = useMemo<RentalOfflinePaymentMethod[]>(() => businessSettings.data?.payment.enabledMethods?.filter((method): method is RentalOfflinePaymentMethod => method === "offline_cash" || method === "offline_transfer") ?? ["offline_cash", "offline_transfer"], [businessSettings.data?.payment.enabledMethods]);
  const funding = useQuery({ queryKey: ["rental-core", "order", id, "funding"], queryFn: () => rentalCoreApi.fundingEvents(id), enabled: Boolean(id) && canViewFunding });
  const inspections = useQuery({ queryKey: ["rental-core", "order", id, "inspections"], queryFn: () => rentalCoreApi.inspections(id), enabled: Boolean(id) });
  const extensions = useQuery({ queryKey: ["rental-core", "order", id, "extensions"], queryFn: () => rentalCoreApi.orderExtensions(id), enabled: Boolean(id) });
  const changes = useQuery({ queryKey: ["rental-core", "order", id, "changes"], queryFn: () => rentalCoreApi.orderChanges(id), enabled: Boolean(id) });
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id] }), queryClient.invalidateQueries({ queryKey: ["rental-core", "orders"] })]); };
  useEffect(() => {
    // Modal 挂载后再清空表单，避免在 Form 尚未连接时 resetFields 产生运行时告警。
    if (inspection) {
      inspectionForm.resetFields();
      if (inspection.stage === "pickup" && order.data?.fulfillmentMode === "carrier_shipping") {
        inspectionForm.setFieldValue("carrierActualAt", dayjs());
      }
    }
  }, [inspection, inspectionForm, order.data?.fulfillmentMode]);
  useEffect(() => {
    // Form.List 所在的 Modal 是按需挂载的，必须等它打开后再写初始行，
    // 否则 Ant Design 会报 form instance 尚未连接到 Form。
    if (partialReturnOpen) partialReturnForm.setFieldsValue({ items: [{ allocationId: "", quantity: 1 }] });
  }, [partialReturnOpen, partialReturnForm]);
  useEffect(() => {
    if (fundingOperation) fundingForm.setFieldsValue({ paymentMethod: offlinePaymentMethods[0] ?? "offline_cash" });
  }, [fundingOperation, fundingForm, offlinePaymentMethods]);
  useEffect(() => {
    if (serviceRefund) serviceRefundForm.setFieldsValue({ paymentMethod: offlinePaymentMethods[0] ?? "offline_cash" });
  }, [serviceRefund, serviceRefundForm, offlinePaymentMethods]);
  const operationLock = useMutation({ mutationFn: (type: "acquire" | "release") => rentalCoreApi.operationLock(id, type, operationToken), onSuccess: async (result) => { setOperationToken(result.token); await refresh(); }, onError: (e: Error) => message.error(e.message) });
  const revealDeliveryAddress = useMutation({
    mutationFn: () => rentalCoreApi.revealOrderDeliveryAddress(id),
    onSuccess: (snapshot) => setRevealedDeliveryAddress({ orderId: id, snapshot }),
    onError: (error: Error) => message.error(error.message || t("查看完整收件电话失败"))
  });
  const closeInspection = async () => {
    if (inspectionClosing || inspect.isPending) return;
    setInspectionClosing(true);
    try {
      if (operationToken) {
        await rentalCoreApi.operationLock(id, "release", operationToken);
        setOperationToken(undefined);
        await refresh();
      } else {
        setOperationToken(undefined);
      }
      inspectionForm.resetFields();
      setInspection(undefined);
      setInspectionReturnItems(undefined);
      setCarrierEvidenceFiles([]);
    } catch (error) {
      // 释放失败时保留 token 和表单，避免界面关闭后订单仍被本账号锁住，
      // 也避免误导操作员以为已经结束办理。
      message.error((error as Error).message || t("结束办理失败，请重试"));
    } finally {
      setInspectionClosing(false);
    }
  };
  const beginInspection = async (stage: "pickup" | "return", returnItems?: Array<{ allocationId: string; quantity: number }>) => {
    const template = templates.data?.find((item) => item.stage === stage && item.enabled);
    if (!template) { message.error(t("未配置有效的交接检查模板，请先在经营设置中配置")); return false; }
    try {
      const result = await rentalCoreApi.operationLock(id, "acquire", operationToken);
      setOperationToken(result.token); await refresh(); setInspectionReturnItems(returnItems); setCarrierEvidenceFiles([]); setInspection(template);
      return true;
    } catch { message.error(t("其他人员正在办理，或订单状态已变化，请刷新后重试")); return false; }
  };
  const action = useMutation({ mutationFn: (type: "confirm" | "allocate") => type === "confirm" ? rentalCoreApi.confirmOrder(id) : rentalCoreApi.allocateOrder(id), onSuccess: async () => { await refresh(); message.success(t("订单状态已更新")); }, onError: () => message.error(t("操作失败，请检查状态、库存或优惠券")) });
  const cancel = useMutation({ mutationFn: (values: { reason: string }) => rentalCoreApi.cancelOrder(id, values), onSuccess: async () => { setCancelOpen(false); cancelForm.resetFields(); await refresh(); message.success(t("订单已取消，费用和优惠券状态已更新")); }, onError: () => message.error(t("取消失败，请检查规则与订单状态")) });
  const expirePending = useMutation({ mutationFn: () => rentalCoreApi.expirePendingOrder(id), onSuccess: async () => { await refresh(); message.success(t("待支付占用已超时取消，库存、服务容量和优惠已释放")); }, onError: (error: Error) => message.error(error.message || t("处理失败：订单可能尚未全部到期或已被其他操作改变")) });
  const markPickupOverdue = useMutation({
    mutationFn: () => rentalCoreApi.markPickupOverdue(id),
    onSuccess: async () => { await refresh(); message.success(t("订单已进入待确认爽约")); },
    onError: (error: Error) => message.error(error.message || t("进入待确认爽约失败"))
  });
  const sendNoShowNotice = useMutation({
    mutationFn: () => rentalCoreApi.sendNoShowNotice(id),
    onSuccess: async () => { await refresh(); message.success(t("客户通知记录已保存")); },
    onError: (error: Error) => message.error(error.message || t("通知记录失败，请先配置待确认爽约通知模板"))
  });
  const confirmNoShow = useMutation({
    mutationFn: (values: { reason: string }) => rentalCoreApi.confirmNoShow(id, values),
    onSuccess: async () => { setNoShowOpen(false); noShowForm.resetFields(); await refresh(); message.success(t("订单已确认爽约，资源和优惠占用已释放")); },
    onError: (error: Error) => message.error(error.message || t("确认爽约失败"))
  });
  const resumePickup = useMutation({
    mutationFn: () => rentalCoreApi.resumePickup(id, { reason: "客户返回领取，恢复为待领取" }),
    onSuccess: async () => { await refresh(); message.success(t("订单已恢复为待领取")); },
    onError: (error: Error) => message.error(error.message || t("恢复领取失败，请检查资产与库存是否仍可用"))
  });
  const handover = useMutation({ mutationFn: async (stage: "pickup" | "return") => { const token = operationToken ?? (await rentalCoreApi.operationLock(id, "acquire")).token; setOperationToken(token); return rentalCoreApi.handoverOrder(id, stage, token); }, onSuccess: async () => { setOperationToken(undefined); await refresh(); message.success(t("交接已完成")); }, onError: () => message.error(t("当前规则要求检查，或订单状态不允许直接交接")) });
  const settle = useMutation({ mutationFn: () => rentalCoreApi.settleOrder(id), onSuccess: async () => { await refresh(); await queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "funding"] }); message.success(t("订单已结算并关闭")); }, onError: () => message.error(t("结算失败，请先处理全部押金和预授权余额")) });
  const substitute = useMutation({ mutationFn: (values: { toItemGroupId: string }) => rentalCoreApi.substituteBundleComponent(id, { ...substitution!, toItemGroupId: values.toItemGroupId }), onSuccess: async () => { setSubstitution(undefined); substitutionForm.resetFields(); await refresh(); message.success(t("套装组成已替换并重新预占")); }, onError: () => message.error(t("替换失败，请检查替代组、订单状态和候选库存")) });
  // 每次真实归还生成新的批次号：分批归还是可重复动作，服务端靠这个号区分
  // "又还了一批"和"同一批的网络重试"。在 mutationFn 里生成，与资金操作同一范式——
  // React Query 默认不重试 mutation，浏览器层的网络重试不会重跑这段 JS。
  const partialReturn = useMutation({ mutationFn: (input: { items: Array<{ allocationId: string; quantity: number }> }) => rentalCoreApi.partialReturnOrder(id, { ...input, batchNo: crypto.randomUUID() }, operationToken), onSuccess: async () => { setPartialReturnOpen(false); setOperationToken(undefined); await refresh(); message.success(t("部分归还已完成，剩余项目继续在租")); }, onError: () => message.error(t("部分归还失败；最后一批请使用归还检查或整单归还")) });
  const inspect = useMutation({
    mutationFn: (values: Record<string, unknown> & { attachments?: string[]; attachmentsText?: string; exceptions?: CreateRentalInspectionRequest["exceptions"]; carrierActualAt?: Dayjs }) => {
      const { attachments, attachmentsText, exceptions, carrierActualAt, ...results } = values;
      const typedAttachments = [
        ...(attachments ?? []),
        ...(attachmentsText?.split(/[\n,]/u).map((item) => item.trim()).filter(Boolean) ?? []),
        ...carrierEvidenceFiles.filter((file) => file.status === "done").map((file) => file.response?.id).filter((assetId): assetId is string => Boolean(assetId))
      ];
      return rentalCoreApi.createInspection(id, {
        templateId: inspection!.id, results, returnItems: inspectionReturnItems,
        returnBatchNo: inspectionReturnItems?.length ? crypto.randomUUID() : undefined,
        attachments: [...new Set(typedAttachments)], exceptions,
        carrierActualAt: carrierActualAt?.toISOString()
      }, operationToken);
    },
    onSuccess: async () => {
      const wasPartialReturn = Boolean(inspectionReturnItems?.length);
      inspectionForm.resetFields(); setInspection(undefined); setInspectionReturnItems(undefined); setCarrierEvidenceFiles([]); setOperationToken(undefined);
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "inspections"] }), queryClient.invalidateQueries({ queryKey: ["rental-core", "work-orders", id] }), queryClient.invalidateQueries({ queryKey: ["rental-core", "stock-dispositions", id] }), queryClient.invalidateQueries({ queryKey: ["rental-core", "carrier-shipment", id] })]);
      message.success(wasPartialReturn ? t("本批归还检查已保存，剩余项目继续在租") : t("检查记录已保存；异常建议须由结算人员审核后才计费"));
    },
    onError: (error: Error) => message.error(error.message || t("检查提交失败"))
  });
  const carrierEvidenceUploadRequest: UploadProps["customRequest"] = async (options) => {
    try {
      const file = options.file as File;
      const session = await rentalCoreApi.createCarrierEvidenceUploadSession(id, { fileName: file.name, mimeType: file.type, sizeBytes: file.size, idempotencyKey: crypto.randomUUID() });
      if (session.mode === "provider") {
        if (!session.uploadUrl) throw new Error(t("文件平台未返回上传地址"));
        const uploaded = await fetch(session.uploadUrl, { method: "PUT", headers: session.uploadHeaders, body: file });
        if (!uploaded.ok) throw new Error(t("承运凭证上传失败"));
      }
      const asset = await rentalCoreApi.completeCarrierEvidenceUpload(id, session.sessionId);
      options.onSuccess?.({ id: asset.id, mimeType: asset.mimeType });
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error(t("承运凭证上传失败")));
    }
  };
  const fundingAction = useMutation({
    mutationFn: async (values: { amount?: number; reason: string; failureCode?: string; paymentMethod?: RentalOfflinePaymentMethod }) => {
      const operation = fundingOperation!;
      const idempotencyKey = crypto.randomUUID();
      if (operation.action === "initiate") return rentalCoreApi.initiateFunding(id, { instrument: operation.instrument, idempotencyKey, reason: values.reason, paymentMethod: values.paymentMethod });
      if (operation.action === "release") return rentalCoreApi.releaseFunding(id, { idempotencyKey, reason: values.reason });
      if (operation.action === "fail") return rentalCoreApi.failFunding(id, { instrument: operation.instrument, failureCode: values.failureCode!, idempotencyKey, reason: values.reason, paymentMethod: values.paymentMethod });
      const request = { instrument: operation.instrument, amount: Number(values.amount), idempotencyKey, reason: values.reason, paymentMethod: values.paymentMethod };
      if (operation.action === "append") return rentalCoreApi.appendFunding(id, request);
      if (operation.action === "capture") return rentalCoreApi.captureFunding(id, request);
      return rentalCoreApi.refundFunding(id, request);
    },
    onSuccess: async () => {
      setFundingOperation(undefined);
      fundingForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "funding"] });
      message.success(t("模拟资金事件已记录"));
    },
    onError: () => message.error(t("操作失败，请检查当前余额、动作顺序和订单范围"))
  });
  const refreshExtensions = async () => { await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "extensions"] })]); };
  const refreshChanges = async () => { await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "changes"] }), queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "funding"] })]); };
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
    onSuccess: async (_data, values) => {
      setFeeReview(undefined);
      feeReviewForm.resetFields();
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "funding"] })]);
      // ORDER-CLOSE-02：批准只代表核定金额，不等于实际收退款；驳回也必须明确显示为驳回，
      // 不能复用“批准”文案让操作员误以为已经产生资金事件。
      message.success(t(values.decision === "approved"
        ? "费用已批准：应收/应退已按核定金额调整，实际收退款仍需在资金区单独办理"
        : "费用已驳回：该费用不按本次事项计入，实际收退款仍需按资金事件办理"));
    },
    onError: async (error: Error) => {
      // 冲突多半是已被他人裁定或被新续租替代：刷新到最新状态再让用户重新判断，
      // 不保留一个已经失效的表单。
      await refresh();
      message.error(error.message || t("裁定失败：该事项可能已被处理或已被新的续租替代，请查看最新状态"));
    }
  });
  const previewExtension = useMutation({
    mutationFn: (values: { newEndAt: Dayjs }) => rentalCoreApi.previewOrderExtension(id, { newEndAt: values.newEndAt.toISOString() }),
    onSuccess: (data) => setExtensionPreview(data),
    onError: () => message.error(t("试算失败：请检查新归还时间、后续占用及缓冲、原订单价格与优惠快照"))
  });
  const applyExtension = useMutation({
    mutationFn: (values: { newEndAt: Dayjs; memo?: string }) => rentalCoreApi.requestOrderExtension(id, { newEndAt: values.newEndAt.toISOString(), memo: values.memo }),
    onSuccess: async (data) => {
      setExtensionOpen(false);
      setExtensionPreview(undefined);
      extensionForm.resetFields();
      await refreshExtensions();
      message.success(t(data.extension.status !== "effective" ? "续租申请已创建，补差价后生效" : data.extension.pricingSnapshot?.refundReview ? "续租已生效，负差额待退款审核" : data.extension.payableAmount === 0 ? "续租已生效，无需补款" : "续租已生效，差额记入月结"));
    },
    onError: () => message.error(t("续租失败：请检查订单状态、后续库存占用与规则上限"))
  });
  const payExtension = useMutation({
    mutationFn: (extensionId: string) => rentalCoreApi.payOrderExtension(id, extensionId),
    onSuccess: async () => { await refreshExtensions(); message.success(t("补款已确认，租期与占用已延长")); },
    onError: () => message.error(t("补款确认失败：请检查续租记录状态与订单当前归还时间"))
  });
  const reviewExtensionRefund = useMutation({
    mutationFn: (values: { decision: "approved" | "rejected"; reason: string }) => rentalCoreApi.reviewExtensionRefund(id, extensionRefundReview!.id, values),
    onSuccess: async () => { setExtensionRefundReview(undefined); extensionRefundForm.resetFields(); await refreshExtensions(); message.success(t("退款审核已记录；通过仅核减应收，不代表实际退款到账")); },
    onError: () => message.error(t("审核失败：记录可能已处理或被后续续租替代，请刷新后重试"))
  });
  const reviewException = useMutation({    mutationFn: (values: ExceptionReviewValues) => rentalCoreApi.reviewInspectionException(id, exceptionReview!.inspectionId, exceptionReview!.exceptionIndex, values),
    onSuccess: async () => {
      setExceptionReview(undefined);
      exceptionReviewForm.resetFields();
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "inspections"] })]);
      message.success(t("检查异常已审核"));
    },
    onError: () => message.error(t("审核失败，请检查订单状态或该异常是否已处理"))
  });
  const previewPartialCancel = useMutation({
    mutationFn: (values: PreviewRentalOrderChangeRequest) => rentalCoreApi.previewPartialLineCancellation(id, values),
    onSuccess: (data) => setPartialCancelPreview(data),
    onError: (error: Error) => message.error(error.message || t("部分取消试算失败，请检查订单状态、服务和已生效续租"))
  });
  const applyPartialCancel = useMutation({
    mutationFn: (values: ApplyRentalOrderChangeRequest) => {
      if (!partialCancelPreview) throw new Error(t("请先试算部分取消费用"));
      return rentalCoreApi.applyPartialLineCancellation(id, {
        type: values.serviceOccurrenceIds?.length || values.serviceItems?.length ? "service_cancel" : "partial_line_cancel",
        items: values.items,
        serviceOccurrenceIds: values.serviceOccurrenceIds,
        serviceItems: values.serviceItems,
        reason: values.reason,
        customerConfirmed: values.customerConfirmed,
        expectedUpdatedAt: partialCancelPreview.expectedUpdatedAt
      });
    },
    onSuccess: async () => {
      setPartialCancelOpen(false);
      setPartialCancelPreview(undefined);
      partialCancelForm.resetFields();
      await Promise.all([refresh(), refreshChanges()]);
      message.success(t("订单部分取消已生效，资源与差额记录已更新"));
    },
    onError: (error: Error) => message.error(error.message || t("部分取消失败，请刷新订单后重试"))
  });
  const previewPostPickupExchange = useMutation({
    mutationFn: (values: PostPickupExchangeFormValues) => rentalCoreApi.previewPostPickupExchange(id, {
      type: "post_pickup_exchange",
      orderLineId: values.orderLineId,
      allocationId: values.allocationId,
      replacementItemGroupId: values.replacementItemGroupId,
      replacementAssetId: values.replacementAssetId,
      replacementPricingGroupId: values.replacementPricingGroupId,
      priceBasis: values.priceBasis,
      originalDisposition: values.originalDisposition,
      exchangeLocationId: detail?.fulfillmentLocationId,
      cancelServiceOccurrenceIds: values.cancelServiceOccurrenceIds,
      inspectionSnapshot: { condition: values.condition.trim(), customerConfirmed: false }
    }),
    onSuccess: (data) => setPostPickupExchangePreview(data),
    onError: (error: Error) => message.error(t(error.message || "换货试算失败，请检查订单状态、替换型号和可用资源"))
  });
  const applyPostPickupExchange = useMutation({
    mutationFn: (values: PostPickupExchangeFormValues) => {
      if (!postPickupExchangePreview) throw new Error(t("请先试算换货差额"));
      return rentalCoreApi.applyPostPickupExchange(id, {
        type: "post_pickup_exchange",
        orderLineId: values.orderLineId,
        allocationId: values.allocationId,
        replacementItemGroupId: values.replacementItemGroupId,
        replacementAssetId: values.replacementAssetId,
        replacementPricingGroupId: values.replacementPricingGroupId,
        priceBasis: values.priceBasis,
        originalDisposition: values.originalDisposition,
        exchangeLocationId: detail?.fulfillmentLocationId,
        cancelServiceOccurrenceIds: values.cancelServiceOccurrenceIds,
        inspectionSnapshot: { condition: values.condition.trim(), customerConfirmed: true },
        reason: values.reason.trim(),
        customerConfirmed: true,
        expectedUpdatedAt: postPickupExchangePreview.expectedUpdatedAt
      });
    },
    onSuccess: async () => {
      setPostPickupExchangeOpen(false);
      setPostPickupExchangePreview(undefined);
      setExchangeTarget(undefined);
      postPickupExchangeForm.resetFields();
      await refreshChanges();
      message.success(t("换货已生效：新商品已锁定，原商品按所选方式处理，差额进入订单结算"));
    },
    onError: async (error: Error) => {
      await refresh();
      message.error(t(error.message || "换货失败：订单或替换资源已变化，请刷新并重新试算"));
    }
  });
  const recordExceptionCustomerResponse = useMutation({
    mutationFn: (values: RecordRentalInspectionExceptionCustomerResponseRequest) => rentalCoreApi.recordInspectionExceptionCustomerResponse(id, exceptionCustomerResponse!.inspectionId, exceptionCustomerResponse!.exceptionIndex, values, crypto.randomUUID()),
    onSuccess: async () => {
      setExceptionCustomerResponse(undefined);
      exceptionCustomerResponseForm.resetFields();
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "inspections"] })]);
      message.success(t("客户确认/申诉记录已保存"));
    },
    onError: (error: Error) => message.error(error.message || t("客户确认/申诉记录失败，请刷新后重试"))
  });
  const adjustException = useMutation({
    mutationFn: (values: AdjustRentalInspectionExceptionRequest) => rentalCoreApi.reReviewInspectionException(
      id,
      exceptionAdjustment!.inspectionId,
      exceptionAdjustment!.exceptionIndex,
      values,
      crypto.randomUUID()
    ),
    onSuccess: async () => {
      setExceptionAdjustment(undefined);
      exceptionAdjustmentForm.resetFields();
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "inspections"] })]);
      message.success(t("申诉金额已复核，等待客户重新确认"));
    },
    onError: (error: Error) => message.error(error.message || t("申诉金额复核失败，请刷新后重试"))
  });
  const correctUsage = useMutation({
    mutationFn: (values: { correctedCurrent: number; reason: string; evidenceAttachments?: string }) => {
      if (!usageCorrection) throw new Error(t("未选择要修正的使用量读数"));
      const data: CorrectRentalInspectionUsageRequest = {
        fieldCode: usageCorrection.fieldCode,
        correctedCurrent: Number(values.correctedCurrent),
        reason: values.reason,
        evidenceAttachments: values.evidenceAttachments?.split(/[\n,]/u).map((item) => item.trim()).filter(Boolean)
      };
      return rentalCoreApi.correctInspectionUsage(id, usageCorrection.inspectionId, data);
    },
    onSuccess: async () => {
      setUsageCorrection(undefined);
      usageCorrectionForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "inspections"] });
      message.success(t("使用量已修正，原始读数和修正记录均已保留"));
    },
    onError: (error: Error) => message.error(error.message || t("使用量修正失败，请刷新后重试"))
  });
  const executeService = useMutation({
    mutationFn: (values: { executedQuantity?: number; result?: string; reason?: string; customerConfirmed?: boolean; refundAmount?: number; compensationAmount?: number; evidenceAttachments?: string }) => {
      const selected = serviceExecution!;
      const data: UpdateRentalServiceOccurrenceRequest = {
        action: selected.action,
        actualAt: new Date().toISOString(),
        executedQuantity: values.executedQuantity === undefined ? undefined : Number(values.executedQuantity),
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
      message.success(t("服务履约记录已保存；如产生退款，已进入费用审核"))
    },
    onError: (error: Error) => message.error(error.message || t("服务履约记录失败，请刷新后重试"))
  });
  const refundService = useMutation({
    mutationFn: (values: { reason: string; paymentMethod?: RentalOfflinePaymentMethod }) => {
      const occurrence = serviceRefund;
      if (!occurrence?.occurrenceId || occurrence.refundAmount === undefined) throw new Error(t("服务退款事实不完整"));
      return rentalCoreApi.refundServiceOccurrence(id, occurrence.occurrenceId, {
        amount: Number(occurrence.refundAmount),
        idempotencyKey: crypto.randomUUID(),
        reason: values.reason,
        paymentMethod: values.paymentMethod
      });
    },
    onSuccess: async () => {
      setServiceRefund(undefined);
      serviceRefundForm.resetFields();
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "funding"] })]);
      message.success(t("服务退款已登记，服务发生项已闭环"));
    },
    onError: (error: Error) => message.error(error.message || t("服务退款失败，请检查已批准金额和资金余额"))
  });
  const detail = order.data;
  const isCarrierShipping = detail?.fulfillmentMode === "carrier_shipping";
  const carrierSignedRecorded = carrierShipment.data?.some((event) => event.type === "customer_signed") ?? false;
  const carrierHandoffRecorded = carrierShipment.data?.some((event) => event.type === "customer_handoff") ?? false;
  const exchangeableAllocations = (detail?.status === RentalCoreOrderStatus.Renting ? detail.allocations : []).filter((allocation) => {
    if (allocation.status !== "picked_up") return false;
    const line = detail?.lines.find((row) => row.id === allocation.orderLineId);
    return Boolean(line && ["serialized", "quantity"].includes(line.inventoryMode) && allocation.quantity === line.quantity - (line.cancelledQuantity ?? 0));
  });
  const selectedExchangeAllocationId = Form.useWatch("allocationId", postPickupExchangeForm);
  const selectedExchangeAllocation = exchangeableAllocations.find((row) => row.id === selectedExchangeAllocationId);
  const selectedExchangeLine = detail?.lines.find((row) => row.id === selectedExchangeAllocation?.orderLineId);
  const selectedReplacementGroupId = Form.useWatch("replacementItemGroupId", postPickupExchangeForm);
  const selectedExchangeCandidateRow = exchangeAssetCandidates.data?.reservations.find((row) => row.orderLineId === selectedExchangeLine?.id);
  const exchangeReplacementGroups = selectedExchangeLine ? groups.data?.filter((group) => group.status === "enabled" && group.inventoryMode === selectedExchangeLine.inventoryMode && group.id !== selectedExchangeLine.itemGroupId) ?? [] : [];
  const replacementPricingGroupOptions = pricingGroups.data?.filter((group) => group.status === "enabled" && group.memberItemGroupIds.includes(selectedReplacementGroupId ?? "")) ?? [];
  const cancelableServiceCount = (detail?.serviceSnapshots ?? []).filter((row) =>
    Boolean(row.occurrenceId) && (row.executionStatus ?? "not_started") === "not_started" && !row.requiredByRule
  ).length;
  // SHARED-WORK-01A：订单详情与养护工单联动——按订单过滤本空间的养护工单与归还处置。
  const relatedWorkOrders = useQuery({
    queryKey: ["rental-core", "work-orders", id],
    queryFn: () => rentalCoreApi.workOrders(),
    enabled: Boolean(id) && canViewWorkOrders,
    select: (rows) => rows.filter((row) => row.orderId === id)
  });
  const relatedDispositions = useQuery({
    queryKey: ["rental-core", "stock-dispositions", id],
    queryFn: () => rentalCoreApi.stockDispositions(id),
    enabled: Boolean(id) && canViewDispositions
  });
  const feeReviews = detail?.feeReviews ?? [];
  const pendingFeeReviews = feeReviews.filter((row) => row.status === "pending");
  const orderHasPendingFee = hasPendingFeeReview(detail ?? {});
  // 金额一律按**订单自己的**结算币种展示（需求 §948）：币种是下单时的快照，
  // 不能改读当前经营空间的设置——空间后来改了币种，历史单的金额含义不会跟着改。
  const money = (value: number | undefined) => formatRentalMoney(Number(value ?? 0), detail?.currency);
  const symbol = rentalCurrencySymbol(detail?.currency);
  // 续租不会改写原订单金额列，资金摘要返回包含已生效/待补续租的完整目标。
  // 这里优先消费服务端目标，旧响应缺字段时才回退到基础目标，避免页面自算漏掉已生效增量。
  const pendingDepositAmount = funding.data?.deposit.pendingExtensionAmount ?? 0;
  const pendingPreauthorizationAmount = funding.data?.preauthorization.pendingExtensionAmount ?? 0;
  const depositRequirement = funding.data?.deposit.requiredAmount ?? Number(detail?.depositAmount ?? 0) + pendingDepositAmount;
  const preauthorizationRequirement = funding.data?.preauthorization.requiredAmount ?? Number(detail?.preAuthAmount ?? 0) + pendingPreauthorizationAmount;
  // 服务端关单会同时检查费用审核、续租退款审核、检查异常和三本资金账。
  // 页面必须展示同一组阻断原因，否则按钮可点却必然 409，运营只能靠猜。
  const settleBlockers = [
    !funding.data ? (funding.isLoading ? "正在读取资金余额" : "资金余额读取失败") : undefined,
    extensions.isLoading || inspections.isLoading ? "正在读取结算审核状态" : undefined,
    orderHasPendingFee ? "有待裁定的费用事项" : undefined,
    (extensions.data ?? []).some((row) => row.status === "effective" && row.pricingSnapshot?.refundReview?.status === "pending")
      ? "有待审核的续租退款差额" : undefined,
    (inspections.data ?? []).some((row) => row.exceptions.some((exception) => exception.reviewStatus === "pending"))
      ? "有待审核的检查异常" : undefined,
    (inspections.data ?? []).some((row) => row.exceptions.some((exception) => exception.reviewStatus === "approved"
      && Number(exception.approvedChargeAmount ?? 0) > 0 && exception.customerResponseStatus !== "confirmed"))
      ? "有异常费用待客户确认或申诉处理" : undefined,
    // MKT-02D：只有带 occurrenceId 的新履约发生项进入状态机；旧订单服务快照
    // 没有实际履约字段，不能因缺省值而永久阻断历史订单结算。
    (detail?.serviceSnapshots ?? []).some((row) => Boolean(row.occurrenceId) && ["not_started", "in_progress"].includes(row.executionStatus ?? "not_started"))
      ? "有未收口的增值服务（需先完成、取消或记录失败）" : undefined,
    funding.data && funding.data.rental.balance > 0.005 ? "租金及费用尚未收齐" : undefined,
    funding.data && funding.data.rental.balance < -0.005 ? "仍有租金退款待办理" : undefined,
    funding.data && depositRequirement > 0 && funding.data.deposit.collected + 0.005 < depositRequirement
      ? "押金尚未足额收取" : undefined,
    funding.data && preauthorizationRequirement > 0 && funding.data.preauthorization.frozen + 0.005 < preauthorizationRequirement
      ? "预授权尚未足额冻结" : undefined,
    funding.data && funding.data.deposit.balance > 0.005 ? "仍有押金余额未处理" : undefined,
    funding.data && funding.data.preauthorization.balance > 0.005 ? "仍有预授权余额未处理" : undefined
  ].filter((row): row is string => Boolean(row));
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
    <PageHeader title={detail?.orderNo ?? t("订单详情")} description={t("订单保存价格、优惠、规则、日历、服务条款和履约检查快照。" )} extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/rental/orders")}>{t("返回列表")}</Button>} />
    <QueryState loading={order.isLoading} error={order.error}>{detail && <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Space wrap>
        {canOperate && detail.status === RentalCoreOrderStatus.Draft && detail.reservations.some((row) => row.status === "soft" && row.expiresAt && Date.parse(row.expiresAt) < Date.now()) && <Button danger loading={expirePending.isPending} onClick={() => modal.confirm({ title: t("处理待支付超时？"), content: t("系统会取消该订单，并释放库存预占、服务容量和优惠券占用。"), okText: t("确认处理"), cancelText: t("暂不处理"), okButtonProps: { danger: true }, onOk: () => expirePending.mutateAsync() })}>{t("处理待支付超时")}</Button>}
        {canOperate && detail.status === RentalCoreOrderStatus.Draft && <ActionButton label={t("确认订单并核销优惠券")} pending={action.isPending} onAction={() => action.mutateAsync("confirm")} />}
        {canOperate && pickupOverdueReady && <Button danger loading={markPickupOverdue.isPending} onClick={() => modal.confirm({ title: t("进入待确认爽约？"), content: t("订单将标记为领取超时，但不会立即释放资源或收取爽约费用；请先通知客户，达到最终时限后再确认爽约。"), okText: t("确认进入"), cancelText: t("暂不处理"), okButtonProps: { danger: true }, onOk: () => markPickupOverdue.mutateAsync() })}>{t("领取超时")}</Button>}
        {canOperate && detail.status === RentalCoreOrderStatus.PickupOverdue && !detail.noShowNoticeAt && <ActionButton label={t("通知客户")} successLabel={t("客户通知记录已保存")} pending={sendNoShowNotice.isPending} onAction={() => sendNoShowNotice.mutateAsync()} />}
        {canOperate && noShowNoticeReady && <Button danger loading={confirmNoShow.isPending} onClick={() => { noShowForm.resetFields(); setNoShowOpen(true); }}>{t(noShowFinalReady ? "确认爽约" : "提前确认爽约")}</Button>}
        {canOperate && detail.status === RentalCoreOrderStatus.PickupOverdue && <Button loading={resumePickup.isPending} onClick={() => modal.confirm({ title: t("恢复为待领取？"), content: t("客户返回领取时，将订单从待确认爽约恢复为待领取；系统会复核资产与库存仍可交付，不改动金额或资金。"), okText: t("确认恢复"), cancelText: t("暂不处理"), onOk: () => resumePickup.mutateAsync() })}>{t("恢复领取")}</Button>}
        {((canPickup && detail.status === RentalCoreOrderStatus.ReadyForPickup) || (canReturn && detail.status === RentalCoreOrderStatus.Renting)) && <Button loading={operationLock.isPending} onClick={() => operationLock.mutate(operationToken ? "release" : "acquire")}>{t(operationToken ? "结束办理" : "开始 / 接手办理")}</Button>}
        {canPickup && detail.status === RentalCoreOrderStatus.ReadyForPickup && ((isCarrierShipping || (detail.ruleSnapshot?.fulfillment?.pickupInspectionRequired ?? true)) ? <Button type="primary" icon={<SafetyCertificateOutlined />} onClick={() => beginInspection("pickup")}>{t(profile.data?.terminology.pickupLabel ?? "领取")}{t("检查")}</Button> : <Button type="primary" onClick={() => handover.mutate("pickup")}>{t("直接完成")}{t(profile.data?.terminology.pickupLabel ?? "领取")}</Button>)}
        {canReturn && detail.status === RentalCoreOrderStatus.Renting && ((isCarrierShipping || (detail.ruleSnapshot?.fulfillment?.returnInspectionRequired ?? true)) ? <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => beginInspection("return")}>{t(profile.data?.terminology.returnLabel ?? "归还")}{t("检查")}</Button> : <Button type="primary" onClick={() => handover.mutate("return")}>{t("直接完成")}{t(profile.data?.terminology.returnLabel ?? "归还")}</Button>)}
        {canReturn && !isCarrierShipping && detail.status === RentalCoreOrderStatus.Renting && (detail.allocations.filter((allocation) => allocation.status === "picked_up").length > 1 || detail.allocations.some((allocation) => allocation.status === "picked_up" && allocation.quantity > 1)) && <Button onClick={() => setPartialReturnOpen(true)}>{t(detail.ruleSnapshot?.fulfillment?.returnInspectionRequired ? "部分归还检查" : "部分归还")}</Button>}
        {detail.status === RentalCoreOrderStatus.Settling && canSettleFunding && <Button type="primary" loading={settle.isPending} disabled={settleBlockers.length > 0} title={settleBlockers.length ? `${t("服务端会拒绝关单：")}${settleBlockers.join(locale === "en-US" ? ", " : "、")}` : undefined} onClick={() => settle.mutate()}>{t("结算并关闭订单")}</Button>}
        {canExtend && [RentalCoreOrderStatus.ReadyForPickup, RentalCoreOrderStatus.Renting].includes(detail.status) && (!isCarrierShipping || (detail.status === RentalCoreOrderStatus.Renting && carrierSignedRecorded && !carrierHandoffRecorded)) && <Button icon={<RetweetOutlined />} onClick={() => { extensionForm.resetFields(); setExtensionPreview(undefined); extensionForm.setFieldsValue({ newEndAt: dayjs(detail.effectiveEndAt ?? detail.endAt).add(1, "day") }); setExtensionOpen(true); }}>{t("续租 / 延期")}</Button>}
        {canOperate && detail.status === RentalCoreOrderStatus.Renting && exchangeableAllocations.length > 0 && <Button onClick={() => { postPickupExchangeForm.resetFields(); postPickupExchangeForm.setFieldsValue({ priceBasis: "original_order_price", originalDisposition: "return_to_warehouse", customerConfirmed: false }); setPostPickupExchangePreview(undefined); setExchangeTarget(undefined); setPostPickupExchangeOpen(true); }}>{t("办理换货")}</Button>}
        {canOperate && [RentalCoreOrderStatus.Reserved, RentalCoreOrderStatus.ReadyForPickup].includes(detail.status) && (detail.lines.filter((line) => (line.cancelledQuantity ?? 0) < line.quantity).length > 1 || detail.lines.some((line) => ["quantity", "consumable"].includes(line.inventoryMode) && line.quantity - (line.cancelledQuantity ?? 0) > 1) || cancelableServiceCount > 0) && <Button onClick={() => { partialCancelForm.resetFields(); setPartialCancelPreview(undefined); setPartialCancelOpen(true); }}>{t("部分取消商品 / 服务")}</Button>}
        {canCancel && [RentalCoreOrderStatus.Draft, RentalCoreOrderStatus.Reserved, RentalCoreOrderStatus.ReadyForPickup].includes(detail.status) && <Button danger onClick={() => setCancelOpen(true)}>{t("取消并按规则计费")}</Button>}
      </Space>
      {isCarrierShipping && <CarrierShipmentPanel order={detail} />}
      <OrderAllocationPanel key={detail.id} order={detail} />
      <Card><Descriptions column={{ xs: 1, md: 2, xl: 4 }} items={[
        { key: "status", label: t("状态"), children: <Tag>{t({ draft: "待确认", reserved: "已确认", pickup_overdue: "待确认爽约", ready_for_pickup: "待领取", renting: "租赁中", return_inspection: "归还检查", settling: "待结算", completed: "已完成", cancelled: "已取消", no_show: "已爽约" }[detail.status])}</Tag> },
        { key: "customer", label: t("客户"), children: detail.customerName },
        { key: "mode", label: t("租赁方式"), children: t(detail.fulfillmentMode) },
        {
          key: "period",
            label: t("租期"),
          // 续租后两个时间会不同：约定归还是下单当时的，当前归还是最近一次生效续租推进到的。
          children: detail.effectiveEndAt && detail.effectiveEndAt !== detail.endAt
            ? <>{dayjs(detail.startAt).format("MM-DD HH:mm")} → {dayjs(detail.effectiveEndAt).format("MM-DD HH:mm")}<br /><span className="muted">{t("约定归还")} {dayjs(detail.endAt).format("MM-DD HH:mm")}，{t("已续租")}</span></>
            : `${dayjs(detail.startAt).format("MM-DD HH:mm")} → ${dayjs(detail.endAt).format("MM-DD HH:mm")}`
        },
        { key: "location", label: t("领取/归还"), children: `${detail.fulfillmentLocationSnapshot.name}（${detail.fulfillmentLocationSnapshot.operator.name}） → ${detail.returnLocationSnapshot.name}（${detail.returnLocationSnapshot.operator.name}）` },
        ...(detail.deliveryAddressSnapshot ? [{
          key: "deliveryAddress",
          label: t("收货地址"),
          children: (() => {
            const address = revealedDeliveryAddress?.orderId === detail.id ? revealedDeliveryAddress.snapshot : detail.deliveryAddressSnapshot!;
            const fullPhoneVisible = revealedDeliveryAddress?.orderId === detail.id;
            return <Space wrap>
              <span>{address.recipient} {fullPhoneVisible ? address.phone : address.phoneMasked} · {address.province}{address.city}{address.district ?? ""}{address.detail}</span>
              {canRevealSensitive && !fullPhoneVisible && <Button type="link" size="small" loading={revealDeliveryAddress.isPending} onClick={() => revealDeliveryAddress.mutate()}>{t("查看完整收件电话")}</Button>}
              {canRevealSensitive && fullPhoneVisible && <Button type="link" size="small" onClick={() => setRevealedDeliveryAddress(undefined)}>{t("隐藏完整收件电话")}</Button>}
            </Space>;
          })(),
        }] : []),
        { key: "quote", label: t("报价"), children: detail.quoteNo },
        { key: "pricing", label: t("价格版本"), children: detail.pricingPlanVersion },
        { key: "rule", label: t("规则版本"), children: detail.ruleVersion },
        { key: "calendar", label: t("日历版本"), children: detail.calendarVersion ?? t("未发布") },
        { key: "payable", label: t("原应付/最终应付/押金"), children: `${money(detail.payableAmount)} / ${money(detail.finalPayableAmount ?? detail.payableAmount)} / ${money(detail.depositAmount)}` },
        // 价内税：应付本身就含税，这里只把税额拆出来给财务看，不额外加钱。
        {
          key: "tax",
          label: t("其中税额"),
          children: detail.taxRate
            ? `${money(detail.taxAmount ?? 0)}（${t("含税价内")}，${t("税率")} ${(detail.taxRate * 100).toFixed(2)}%）`
            : t("不计税")
        }
      ]} /></Card>
      <OrderDocumentsPanel
        order={detail}
        inspections={inspections.data ?? []}
        templates={templates.data ?? []}
        funding={funding.data}
        terminology={profile.data?.terminology}
        money={money}
      />
      <Card title={t("商品明细")}><Table rowKey="id" pagination={false} dataSource={detail.lines} columns={[{ title: t("商品"), dataIndex: "itemGroupName" }, { title: t("数量"), dataIndex: "quantity", render: (value, row) => <>{value}{row.cancelledQuantity ? <Tag color="default" style={{ marginLeft: 8 }}>{t("已取消")} {row.cancelledQuantity}</Tag> : null}</> }, { title: t("租金"), dataIndex: "amount", render: (value) => money(Number(value)) }]} /></Card>
      {Boolean(changes.data?.length) && <Card title={t("订单变更记录")} extra={<Tag color="processing">{t("原订单与原报价快照保留")}</Tag>}>
        <Table rowKey="id" size="small" pagination={false} dataSource={changes.data ?? []} columns={[
          { title: t("时间"), dataIndex: "appliedAt", render: (value) => value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—" },
          { title: t("变更"), render: (_, row) => t(row.type === "resume_pickup" ? "待确认爽约恢复领取" : row.type === "post_pickup_exchange" ? "取货后换货" : row.type === "service_cancel" ? "取货前取消服务" : "取货前整行部分取消") },
          { title: t("取消商品"), render: (_, row) => (("lineIds" in row.request ? row.request.lineIds ?? [] : []).map((lineId) => detail.lines.find((line) => line.id === lineId)?.itemGroupName ?? lineId).join(locale === "en-US" ? ", " : "、")) },
          { title: t("退款差额"), align: "right", render: (_, row) => money(row.refundAmount) },
          { title: t("补款差额"), align: "right", render: (_, row) => money(row.additionalAmount) },
          { title: t("原因"), render: (_, row) => row.request.reason }
        ]} />
      </Card>}
      <Card title={t("库存拆分与归还")}>{detail.allocations.length ? <Table<RentalAllocation> rowKey="id" pagination={false} dataSource={detail.allocations} columns={[
        { title: t("实际商品"), render: (_, row) => groups.data?.find((group) => group.id === row.itemGroupId)?.name ?? row.assetNo ?? t("历史分配") },
        { title: t("资产 / 数量"), render: (_, row) => row.assetNo ?? `${row.quantity} ${t("件")}` },
        { title: t("状态"), dataIndex: "status", render: (value) => <Tag>{t(value)}</Tag> }
      ]} /> : <Table<RentalReservation> rowKey="id" pagination={false} dataSource={detail.reservations} columns={[
        { title: t("实际预占商品"), render: (_, row) => groups.data?.find((group) => group.id === row.itemGroupId)?.name ?? row.itemGroupId },
        { title: t("数量"), render: (_, row) => `${Math.max(0, row.quantity - row.releasedQuantity)} / ${row.quantity}` },
        { title: t("状态"), dataIndex: "status", render: (value) => <Tag>{t(value)}</Tag> },
        { title: t("操作"), render: (_, row) => detail.status === RentalCoreOrderStatus.Reserved && canSubstituteReservation(row) ? <Button type="link" icon={<RetweetOutlined />} onClick={() => setSubstitution({ orderLineId: row.orderLineId, fromItemGroupId: row.itemGroupId })}>{t("替换组成")}</Button> : "-" }
      ]} />}</Card>
      {Boolean(detail.serviceSnapshots?.length) && <Card title={t("增值服务与履约承诺")} extra={<Tag color="processing">{t("按发生次数分别记录")}</Tag>}>
        <Alert
          type="info"
          showIcon
          title={t("这里只展示已承诺的服务与计划时段；实际开始与完成另行记录，不能用计划时间当作已履约。")}
          style={{ marginBottom: 16 }}
        />
        <Table<RentalOrderServiceOccurrence>
          rowKey={(row) => row.occurrenceId ?? `${row.serviceId}:${row.scheduledStartAt}`}
          size="small"
          pagination={false}
          dataSource={detail.serviceSnapshots}
          columns={[
            { title: t("来源"), width: 150, render: (_, row) => t(serviceOccurrenceOriginText(row)) },
            { title: t("服务"), render: (_, row) => <Space orientation="vertical" size={0}><span>{row.serviceName}</span><span style={{ color: "#999" }}>{row.serviceCode} · {t("服务版本")} {row.serviceVersion} · {t("条款")} {row.termsVersion}</span></Space> },
            { title: t("计划时段"), render: (_, row) => `${new Date(row.scheduledStartAt).toLocaleString()} ～ ${new Date(row.scheduledEndAt).toLocaleString()}` },
            { title: t("数量 × 单位数 × 单价"), align: "right", render: (_, row) => `${row.quantity} × ${row.billingUnits} × ${money(row.unitPrice)}` },
            { title: t("原价"), align: "right", render: (_, row) => money(row.amount) },
            { title: t("减免"), align: "right", render: (_, row) => money(Number(row.discountAllocatedAmount ?? 0) + Number(row.couponAllocatedAmount ?? 0)) },
            { title: t("净额"), align: "right", render: (_, row) => money(serviceOccurrenceNetAmount(row)) },
            { title: t("实际履约"), width: 180, render: (_, row) => {
              const status = row.executionStatus ?? "not_started";
              const total = serviceOccurrenceTotalQuantity(row);
              const executed = serviceOccurrenceExecutedQuantity(row);
              return <Space orientation="vertical" size={0}><Tag color={SERVICE_EXECUTION_STATUS_COLORS[status]}>{t(SERVICE_EXECUTION_STATUS_LABELS[status])}</Tag>{total > 1 && <span style={{ color: "#666" }}>{t("已执行")} {executed} / {total}</span>}<span style={{ color: "#999" }}>{row.actualStartAt ? `${t("开始")} ${new Date(row.actualStartAt).toLocaleString()}` : t("未记录实际开始")}</span>{row.actualEndAt && <span style={{ color: "#999" }}>{t("结束")} {new Date(row.actualEndAt).toLocaleString()}</span>}</Space>;
            }},
            { title: t("退款"), width: 150, render: (_, row) => row.refundStatus && row.refundStatus !== "none"
              ? <Tag color={row.refundStatus === "pending_review" ? "orange" : row.refundStatus === "approved_pending_refund" ? "gold" : row.refundStatus === "refunded" ? "green" : row.refundStatus === "included_in_order_change" ? "blue" : "default"}>{row.refundStatus === "pending_review" ? `${t("待审核")} ${money(row.refundAmount)}` : row.refundStatus === "approved_pending_refund" ? `${t("已核减，待退款")} ${money(row.refundAmount)}` : row.refundStatus === "refunded" ? `${t("已退款")} ${money(row.refundAmount)}` : row.refundStatus === "included_in_order_change" ? `${t("已纳入订单变更")} ${money(row.refundAmount)}` : t("已驳回")}</Tag>
              : "-" },
            { title: t("容量"), width: 130, render: (_, row) => row.requiresCapacity
              ? <Tag color={row.reservationKey ? "green" : "orange"}>{row.reservationKey ? `${t("已占")} ${row.capacityQuantity}` : t("无容量依据")}</Tag>
              : <Tag color="default">{t("不需要容量")}</Tag> },
            { title: t("操作"), width: 260, render: (_, row) => {
              if (!row.occurrenceId) return <span style={{ color: "#999" }}>{t("历史记录，无操作")}</span>;
              const status = row.executionStatus ?? "not_started";
              const canRecordForOrder = SERVICE_EXECUTION_ORDER_STATUSES.includes(detail.status);
              const canStartForOrder = SERVICE_START_ORDER_STATUSES.includes(detail.status);
              const actions: Array<{ action: RentalServiceExecutionAction; label: string; danger?: boolean }> = canRecordForOrder && status === "not_started"
                ? [
                    ...(canStartForOrder ? [{ action: "start" as const, label: t("开始") }] : []),
                    { action: "complete", label: t("直接完成") },
                    { action: "cancel", label: t("取消") },
                    { action: "no_show", label: t("未到场"), danger: true }
                  ]
                : canRecordForOrder && status === "in_progress"
                  ? [{ action: "complete", label: t("完成") }, { action: "fail", label: t("记录失败"), danger: true }]
                  : [];
              const terminalHint = !canRecordForOrder
                ? t("订单当前状态不允许履约")
                : status === "completed"
                  ? t("服务已完成")
                  : status === "cancelled"
                    ? t("服务已取消")
                    : status === "failed"
                      ? t("服务已记录失败")
                      : status === "no_show"
                        ? t("已记录未到场")
                        : t("暂无可用操作");
              return <Space wrap>
                {canOperate && actions.map((item) => <Button key={item.action} type={item.action === "complete" ? "primary" : "link"} danger={item.danger} size="small" onClick={() => { serviceExecutionForm.resetFields(); setServiceExecution({ occurrence: row, action: item.action }); }}>{item.label}</Button>)}
                {canSettleFunding && row.refundStatus === "approved_pending_refund" && <Button key="refund" type="primary" size="small" onClick={() => { serviceRefundForm.resetFields(); setServiceRefund(row); }}>{t("办理退款")}</Button>}
                {canOperate && !actions.length && !(canSettleFunding && row.refundStatus === "approved_pending_refund") && <span style={{ color: "#999" }}>{terminalHint}</span>}
                {!canOperate && !(canSettleFunding && row.refundStatus === "approved_pending_refund") && <span style={{ color: "#999" }}>{t("无操作权限")}</span>}
              </Space>;
            } }
          ]}
        />
      </Card>}
      <Card title={t("费用与版本快照")}><Table rowKey="code" pagination={false} dataSource={detail.chargeLines} columns={[{ title: t("费用项"), dataIndex: "name" }, { title: t("类型"), dataIndex: "type", render: (value) => t(String(value)) }, { title: t("来源版本"), dataIndex: "sourceVersion", render: (value) => value ?? "-" }, { title: t("说明"), dataIndex: "detail", render: (value) => value ?? "-" }, { title: t("金额"), dataIndex: "amount", render: (value) => money(Number(value)) }]} /></Card>
      {Boolean(detail.membershipBenefitEvaluations?.length) && <Card title={t("会员权益应用快照")} extra={<Tag color="processing">{t("按下单时会员方案固化")}</Tag>}>
        <Table rowKey={(row) => `${row.planVersionId}:${row.type}:${row.appliesTo}`} pagination={false} size="small" dataSource={detail.membershipBenefitEvaluations} columns={[
          { title: t("权益来源"), render: (_, row) => <>{row.planName}<br /><span className="muted">{t(row.source === "corporate" ? "企业员工权益" : "个人会员权益")}</span></> },
          { title: t("权益"), dataIndex: "type", render: (value) => t(MEMBERSHIP_BENEFIT_LABELS[String(value)] ?? String(value)) },
          { title: t("配置"), render: (_, row) => `${t(row.calculation)} · ${row.configuredValue}` },
          { title: t("本次效果"), render: (_, row) => row.appliedAmount > 0 ? <Tag color="green">{t("减免")} {money(row.appliedAmount)}</Tag> : <Tag>{row.skippedReason ? t(row.skippedReason) : t("未生效")}</Tag> },
          { title: t("说明"), dataIndex: "detail", render: (value) => value ?? "-" }
        ]} />
      </Card>}
      <Card title={t("检查、使用量与异常审核")}><Space orientation="vertical" style={{ width: "100%" }} size={16}>
        <Table rowKey={(row) => `${row.inspectionId}:${row.fieldCode}`} size="small" pagination={false} dataSource={(inspections.data ?? []).flatMap((record) => (record.usageReadings ?? []).map((reading) => ({ ...reading, inspectionId: record.id, stage: record.stage, corrections: (record.usageCorrections ?? []).filter((correction) => correction.fieldCode === reading.fieldCode) })))} columns={[
          { title: t("阶段"), dataIndex: "stage", render: (value) => value === "pickup" ? t("领取基线") : t("归还读数") },
          { title: t("读数字段"), dataIndex: "fieldCode" },
          { title: t("领取基线"), dataIndex: "baseline", render: (value) => value ?? "-" },
          { title: t("当前有效读数"), dataIndex: "current" },
          { title: t("使用量"), dataIndex: "delta", render: (value) => value ?? "-" },
          { title: t("修正记录"), render: (_, row) => {
             const latest = row.corrections?.at(-1);
             return latest ? <Typography.Text type="secondary">{t("原")} {latest.from} → {latest.to} · {latest.operator}<br />{latest.reason}</Typography.Text> : "-";
           } },
          { title: t("操作"), render: (_, row) => canOperate ? <Button type="link" size="small" onClick={() => {
             usageCorrectionForm.resetFields();
             usageCorrectionForm.setFieldsValue({ correctedCurrent: row.current });
             setUsageCorrection({ inspectionId: row.inspectionId, fieldCode: row.fieldCode, stage: row.stage, current: row.current, baseline: row.baseline });
           }}>{t("修正读数")}</Button> : "-" }
        ]} />
        <Table rowKey="id" size="small" pagination={false} dataSource={inspections.data ?? []} columns={[
          { title: t("检查记录"), render: (_, row) => row.stage === "pickup" ? t("领取检查") : t("归还检查") },
          { title: t("照片/证据引用"), dataIndex: "attachments", render: (value: string[]) => value?.length ? <Space size={[4, 4]} wrap>{value.map((ref) => <Tag key={ref}>{ref}</Tag>)}</Space> : <Typography.Text type="secondary">{t("未登记")}</Typography.Text> },
          { title: t("操作人"), dataIndex: "operator" },
          { title: t("时间"), dataIndex: "createdAt", render: (value) => new Date(value).toLocaleString() }
        ]} />
        <Table rowKey={(row) => `${row.inspectionId}:${row.exceptionIndex}`} pagination={false} dataSource={(inspections.data ?? []).flatMap((record) => record.exceptions.map((exception, exceptionIndex) => ({ ...exception, inspectionId: record.id, exceptionIndex, stage: record.stage, operator: record.operator })))} columns={[
          { title: t("阶段"), dataIndex: "stage", render: (value) => value === "pickup" ? t("领取") : t("归还") },
          { title: t("异常"), render: (_, row) => <>{row.code} · {row.description}<br /><Typography.Text type="secondary">{row.allocationId ? `${t("关联分配：")}${row.allocationId}` : t("本批全部归还资源")}</Typography.Text></> },
          { title: t("建议费用"), dataIndex: "suggestedChargeAmount", render: (value) => value === undefined ? "-" : money(Number(value)) },
          { title: t("审核"), dataIndex: "reviewStatus", render: (value) => <Tag color={value === "approved" ? "green" : value === "rejected" ? "default" : "orange"}>{value === "approved" ? t("已通过") : value === "rejected" ? t("已驳回") : t("待审核")}</Tag> },
          { title: t("最终费用"), dataIndex: "approvedChargeAmount", render: (value) => value === undefined ? "-" : money(Number(value)) },
          { title: t("赔偿责任认定"), dataIndex: "liability", render: (value: string | undefined) => t(({ customer: "客户承担赔偿责任", normal_wear: "正常使用损耗", lessor: "出租方责任", third_party: "第三方责任，非客户承担", undetermined: "责任未明，暂不收费" } as Record<string, string>)[value ?? "undetermined"] ?? "责任未明，暂不收费") },
          { title: t("事故与免赔裁定依据"), render: (_, row) => <><Typography.Text>{row.incidentAt ? dayjs(row.incidentAt).format("YYYY-MM-DD HH:mm") : t("未登记")}</Typography.Text><br /><Typography.Text type="secondary">{row.incidentBasis ?? "-"}</Typography.Text>{row.waiverCustomerChargeCeiling !== undefined && <><br />{t("客户承担上限")}: {money(row.waiverCustomerChargeCeiling)}<br /><Typography.Text type="secondary">{row.waiverOccurrenceId ?? row.waiverServiceId} · {row.waiverTermsVersion}</Typography.Text></>}</> },
          { title: t("客户响应"), render: (_, row) => row.customerResponseStatus === "pending" ? <Tag color="orange">{t("待确认/申诉")}</Tag> : row.customerResponseStatus === "confirmed" ? <Tag color="green">{t("已确认")}</Tag> : row.customerResponseStatus === "disputed" ? <Tag color="red">{t("已申诉")}</Tag> : row.customerResponseStatus === "not_required" ? <Tag>{t("无需确认")}</Tag> : "-" },
          { title: t("操作"), render: (_, row) => {
            const canReview = canReviewFees && row.reviewStatus === "pending";
            const canRecordResponse = canReviewFees && row.reviewStatus === "approved" && Number(row.approvedChargeAmount ?? 0) > 0 && row.customerResponseStatus !== "confirmed";
            const canAdjust = canReviewFees && row.reviewStatus === "approved" && row.customerResponseStatus === "disputed" && Number(row.approvedChargeAmount ?? 0) > 0;
            return <Space>
             {canReview && <Button type="link" onClick={() => { setExceptionReview({ inspectionId: row.inspectionId, exceptionIndex: row.exceptionIndex, description: row.description, suggested: row.suggestedChargeAmount }); exceptionReviewForm.setFieldsValue({ decision: "approved", approvedChargeAmount: row.suggestedChargeAmount }); }}>{t("审核")}</Button>}
             {canRecordResponse && <Button type="link" onClick={() => { setExceptionCustomerResponse({ inspectionId: row.inspectionId, exceptionIndex: row.exceptionIndex, description: row.description, status: row.customerResponseStatus }); exceptionCustomerResponseForm.setFieldsValue({ decision: "confirmed" }); }}>{t("记录客户响应")}</Button>}
             {canAdjust && <Button type="link" onClick={() => { setExceptionAdjustment({ inspectionId: row.inspectionId, exceptionIndex: row.exceptionIndex, description: row.description, current: Number(row.approvedChargeAmount), suggested: row.suggestedChargeAmount }); exceptionAdjustmentForm.setFieldsValue({ approvedChargeAmount: Number(row.approvedChargeAmount), reason: undefined }); }}>{t("复核金额")}</Button>}
            {!(canReview || canRecordResponse || canAdjust) && "-"}
          </Space>; } }
        ]} />
      </Space></Card>
      <Card title={t("待审费用与裁定历史")} extra={<Tag color={pendingFeeReviews.length ? "orange" : "default"}>{pendingFeeReviews.length ? `${pendingFeeReviews.length} ${t("项待裁定")}` : t("无待办")}</Tag>}>
        <Alert
          type="info"
          showIcon
          title={t("裁定只决定应收金额；批准退款表示应收已核减、等待实际退款，实际收退款仍要在下方资金区按资金权限单独办理。")}
          style={{ marginBottom: 16 }}
        />
        {feeReviews.length ? <Table<RentalOrderFeeReview> rowKey="id" size="small" pagination={false} dataSource={feeReviews} columns={[
          { title: t("类型"), dataIndex: "type", render: (value) => t(FEE_REVIEW_TYPE_LABELS[value as RentalOrderFeeReview["type"]] ?? String(value)) },
          { title: t("来源"), render: () => t("订单费用审核") },
          { title: t("建议金额"), dataIndex: "suggestedAmount", render: (value) => money(Number(value)) },
          { title: t("依据"), dataIndex: "basis", render: (value) => <Space orientation="vertical" size={0}>{((value as string[]) ?? []).map((row) => <span key={row}>{t(row)}</span>)}</Space> },
          { title: t("状态"), render: (_, row) => <Tag color={FEE_REVIEW_STATUS_COLORS[row.status]}>{t(feeReviewStatusText(row))}</Tag> },
          { title: t("裁定额"), dataIndex: "decidedAmount", render: (value, row) => row.status === "pending" ? "-" : money(Number(value ?? 0)) },
          { title: t("原因"), dataIndex: "reason", render: (value) => value ?? "-" },
          { title: t("操作者"), dataIndex: "reviewedBy", render: (value) => value ?? "-" },
          { title: t("时间"), render: (_, row) => new Date(row.reviewedAt ?? row.createdAt).toLocaleString() },
          {
            title: t("操作"),
            render: (_, row) => row.status !== "pending"
              ? "-"
              : canReviewFees
                ? <Button type="link" onClick={() => { setFeeReview(row); feeReviewForm.setFieldsValue({ decision: "approved", amount: row.suggestedAmount, reason: undefined }); }}>{t("裁定")}</Button>
                : <span style={{ color: "#999" }}>{t("无费用裁定权限")}</span>
          }
        ]} /> : <span style={{ color: "#999" }}>{t("当前订单没有需要人工裁定的费用事项。")}</span>}
      </Card>
      {relatedWorkOrders.data?.length || relatedDispositions.data?.length ? (
        <Card title={t("归还处置与养护工单")} size="small">
          {relatedWorkOrders.data?.length ? (
            <Table<RentalWorkOrder> rowKey="id" size="small" pagination={false} dataSource={relatedWorkOrders.data} columns={[
              { title: t("工单号"), dataIndex: "workNo", width: 190 },
              { title: t("类型"), dataIndex: "type", width: 110, render: (value) => t(String(value)) },
              { title: t("状态"), dataIndex: "status", width: 110, render: (value) => { const status = WORK_ORDER_STATUS_LABELS[value] ?? { label: value, color: "default" }; return <Tag color={status.color}>{t(status.label)}</Tag>; } },
              { title: t("处理人"), render: (_, row) => row.assigneeName || row.assigneeId || t("未派工") },
              { title: t("原因"), dataIndex: "reason", ellipsis: true }
            ]} />
          ) : (
            <Typography.Text type="secondary">{t("本订单暂无关联养护工单。")}</Typography.Text>
          )}
          {relatedDispositions.data?.length ? (
            <>
              <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 4 }}>{t("归还处置（周转/隔离）：")}</Typography.Paragraph>
              <Table<RentalStockDisposition> rowKey="id" size="small" pagination={false} dataSource={relatedDispositions.data} columns={[
                { title: t("归还批次"), dataIndex: "returnBatchKey", ellipsis: true },
                { title: t("数量"), dataIndex: "quantity", width: 70 },
                { title: t("状态"), dataIndex: "status", width: 110, render: (value) => ({ buffered: <Tag color="orange">{t("周转缓冲")}</Tag>, blocked: <Tag color="red">{t("异常隔离")}</Tag>, restored: <Tag color="success">{t("已恢复")}</Tag>, written_off: <Tag>{t("已核销")}</Tag> }[value as string] ?? String(value)) },
                { title: t("阻断原因"), dataIndex: "blockReason", render: (value) => value ?? "-" },
                { title: t("预计恢复"), dataIndex: "bufferUntil", width: 170, render: (value) => new Date(value).toLocaleString() }
              ]} />
            </>
          ) : null}
          {canViewWorkOrders && <Button type="link" style={{ marginTop: 8, padding: 0 }} onClick={() => navigate("/rental/work-orders")}>{t("前往养护工单管理")}</Button>}
        </Card>
      ) : null}
      {canViewFunding && <Card title={<Space><DollarOutlined />{t("收付款、押金与预授权")} <Tag color="orange">{t("模拟资金")}</Tag></Space>}>
        {funding.data?.rental && <Space orientation="vertical" style={{ marginBottom: 16 }}>
          <span>{t("最终应收")} {money(funding.data.rental.payable)} · {t("已收")} {money(funding.data.rental.collected)} · {t("已退")} {money(funding.data.rental.refunded)} · {t("保证金抵扣")} {money(funding.data.rental.securityCaptured)}</span>
          <span>{funding.data.rental.balance < 0 ? t("待退") : t("待收")} {money(Math.abs(funding.data.rental.balance))} · {t("续租待补")} {money(funding.data.rental.pendingExtensionAmount)}</span>
          {canSettleFunding && <Space>
            {funding.data.rental.balance + funding.data.rental.pendingExtensionAmount > 0 && <Button onClick={() => setFundingOperation({ instrument: "rental", action: "append" })}>{t("登记模拟收款／补款")}</Button>}
            {funding.data.rental.balance < 0 && <Button onClick={() => setFundingOperation({ instrument: "rental", action: "refund" })}>{t("办理模拟退款")}</Button>}
          </Space>}
        </Space>}
        <Alert type="warning" showIcon title={t("当前未接入真实支付机构；以下操作只记录可追溯的模拟资金事件，不代表真实收款、冻结或退款。")} style={{ marginBottom: 16 }} />
        <Descriptions column={{ xs: 1, md: 2 }} items={[
          { key: "deposit", label: `${t("应收押金")} ${money(depositRequirement)}`, children: funding.data ? `${t("已收")} ${money(funding.data.deposit.collected)} / ${t("已抵扣")} ${money(funding.data.deposit.captured)} / ${t("已退")} ${money(funding.data.deposit.refunded)} / ${t("余额")} ${money(funding.data.deposit.balance)}${pendingDepositAmount > 0 ? ` / ${t("续租待补")} ${money(pendingDepositAmount)}` : ""}` : t("加载中") },
          { key: "preauth", label: `${t("应冻结预授权")} ${money(preauthorizationRequirement)}`, children: funding.data ? `${t("已冻结")} ${money(funding.data.preauthorization.frozen)} / ${t("已转扣")} ${money(funding.data.preauthorization.captured)} / ${t("已释放")} ${money(funding.data.preauthorization.released)} / ${t("余额")} ${money(funding.data.preauthorization.balance)}${pendingPreauthorizationAmount > 0 ? ` / ${t("续租待补")} ${money(pendingPreauthorizationAmount)}` : ""}` : t("加载中") }
        ]} />
        {canSettleFunding && <Space wrap style={{ margin: "12px 0" }}>
          {depositRequirement > 0 && !funding.data?.deposit.collected && <Button onClick={() => setFundingOperation({ instrument: "deposit", action: "initiate" })}>{t("模拟收取押金")}</Button>}
          {(funding.data?.deposit.collected ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "deposit", action: "append" })}>{t("追加押金")}</Button>}
          {(funding.data?.deposit.balance ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "deposit", action: "capture" })}>{t("押金抵扣")}</Button>}
          {(funding.data?.deposit.balance ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "deposit", action: "refund" })}>{t("押金退款")}</Button>}
          {preauthorizationRequirement > 0 && !funding.data?.preauthorization.frozen && <Button onClick={() => setFundingOperation({ instrument: "preauthorization", action: "initiate" })}>{t("模拟冻结预授权")}</Button>}
          {(funding.data?.preauthorization.frozen ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "preauthorization", action: "append" })}>{t("追加预授权")}</Button>}
          {(funding.data?.preauthorization.balance ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "preauthorization", action: "capture" })}>{t("预授权转扣")}</Button>}
          {(funding.data?.preauthorization.balance ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "preauthorization", action: "release" })}>{t("释放全部预授权")}</Button>}
          {depositRequirement > 0 && <Button danger onClick={() => setFundingOperation({ instrument: "deposit", action: "fail" })}>{t("记录押金收取失败")}</Button>}
          {preauthorizationRequirement > 0 && <Button danger onClick={() => setFundingOperation({ instrument: "preauthorization", action: "fail" })}>{t("记录预授权冻结失败")}</Button>}
        </Space>}
        <Table rowKey="id" size="small" pagination={false} loading={funding.isLoading} dataSource={funding.data?.events ?? []} columns={[
          { title: t("时间"), dataIndex: "at", render: (value) => new Date(String(value)).toLocaleString() },
          { title: t("对象"), dataIndex: "instrument", render: (value) => t(FUNDING_INSTRUMENT_LABELS[value as RentalFundingInstrument]) },
          { title: t("动作"), dataIndex: "action", render: (value) => t(FUNDING_ACTION_LABELS[value as RentalFundingAction]) },
          { title: t("方式"), dataIndex: "paymentMethod", render: (value) => value ? t(OFFLINE_PAYMENT_METHOD_LABELS[value as RentalOfflinePaymentMethod]) : "—" },
          { title: t("金额"), dataIndex: "amount", render: (value) => money(Number(value)) },
          { title: t("事件后余额"), dataIndex: "balanceAfter", render: (value) => money(Number(value)) },
          { title: t("原因"), dataIndex: "reason" },
          { title: t("状态"), render: (_, row) => <Tag color={row.action === "fail" ? "red" : "orange"}>{row.action === "fail" ? `${t("失败 · ")}${row.failureCode}` : t("模拟成功")}</Tag> }
        ]} />
      </Card>}
      {Boolean(extensions.data?.length) && <Card className="data-panel" title={<span className="panel-title">{t("续租记录")} <span className="panel-count">{extensions.data?.length}</span></span>}>
        <Alert type="info" showIcon title={order.data.ruleSnapshot?.extension?.pricingMode === "original_total" ? t("按原价格重算完整租期，只补差价") : t("新增时段单独计费")} description={t("续租方式以本单规则快照为准；须检查后续占用及缓冲，原始账单保留。缓冲只占库存，不计租金。")} style={{ marginBottom: 12 }} />
        <Table<RentalOrderExtension> rowKey="id" size="small" pagination={false} dataSource={extensions.data ?? []} columns={[
          { title: t("次序"), dataIndex: "sequence", width: 72 },
          { title: t("延长期间"), render: (_, row) => <>{dayjs(row.originalEndAt).format("YYYY-MM-DD HH:mm")} → {dayjs(row.newEndAt).format("YYYY-MM-DD HH:mm")}</> },
          { title: t("租金差额"), align: "right", render: (_, row) => money(row.rentalAmount) },
          { title: t("增值服务"), align: "right", render: (_, row) => money(row.serviceAmount) },
          { title: t("需补差价"), align: "right", render: (_, row) => <b>{money(row.payableAmount)}</b> },
          { title: t("退款审核"), render: (_, row) => row.pricingSnapshot?.refundReview ? <>{money(row.pricingSnapshot.refundReview.amount)} · {t({ pending: "待审核", approved: "已核减（实际退款另办）", rejected: "已拒绝", superseded: "已由后续重算替代" }[row.pricingSnapshot.refundReview.status])}</> : "—" },
          { title: t("结算方式"), render: (_, row) => <Tag color={row.settlementMode === "monthly" ? "blue" : "gold"}>{t(row.settlementMode === "monthly" ? "企业月结" : "客户补款")}</Tag> },
          { title: t("状态"), render: (_, row) => <Tag color={row.status === "effective" ? "success" : row.status === "pending_payment" ? "gold" : "default"}>{t({ pending_payment: "待补款", effective: "已生效", cancelled: "已取消", expired: "已过期" }[row.status])}</Tag> },
          { title: t("价格版本"), render: (_, row) => row.priceVersion ?? "—" },
          { title: t("操作"), align: "right", render: (_, row) => row.status === "pending_payment" ? <Button type="link" loading={payExtension.isPending} onClick={() => payExtension.mutate(row.id)}>{t("确认补款")}</Button> : row.pricingSnapshot?.refundReview?.status === "pending" && canReviewFees ? <Button type="link" onClick={() => { setExtensionRefundReview(row); extensionRefundForm.setFieldsValue({ decision: "approved", reason: "" }); }}>{t("审核退款差额")}</Button> : "—" }
        ]} />
      </Card>}
    </Space>}</QueryState>
     <Modal title={inspectionReturnItems?.length ? t("部分归还检查") : inspection?.name} open={Boolean(inspection)} onCancel={closeInspection} onOk={() => inspectionForm.submit()} confirmLoading={inspect.isPending || inspectionClosing} cancelButtonProps={{ loading: inspectionClosing, disabled: inspectionClosing || inspect.isPending }} okButtonProps={{ disabled: inspectionClosing }} closable={!inspectionClosing && !inspect.isPending} destroyOnHidden>
      {inspection && <Form form={inspectionForm} layout="vertical" onFinish={(values) => {
        const { attachmentsText, exceptionCode, exceptionDescription, exceptionAllocationId, exceptionChargeAmount, ...results } = values as Record<string, unknown> & { attachmentsText?: string; exceptionCode?: string; exceptionDescription?: string; exceptionAllocationId?: string; exceptionChargeAmount?: number };
        const textEvidence = attachmentsText?.split(/[\n,]/u).map((item) => item.trim()).filter(Boolean) ?? [];
        const uploadedEvidence = carrierEvidenceFiles.filter((file) => file.status === "done").map((file) => file.response?.id).filter((assetId): assetId is string => Boolean(assetId));
        if (isCarrierShipping && uploadedEvidence.length === 0) {
          message.error(t("承运订单必须上传本次签收或仓库验收凭证"));
          return;
        }
        const attachments = [...new Set([...textEvidence, ...uploadedEvidence])];
        const exceptions = exceptionDescription ? [{ code: exceptionCode || "damage", description: exceptionDescription, allocationId: exceptionAllocationId, chargeAmount: Number(exceptionChargeAmount) || undefined, evidenceAttachments: attachments }] : undefined;
        inspect.mutate({ ...results, attachments, exceptions });
      }}>
        {inspectionReturnItems?.length ? <Alert type="info" showIcon title={`${t("本次检查并归还")} ${inspectionReturnItems.length}${t("个分配项")}`} description={t("只会释放本批实物；剩余项目继续在租。最后一批请使用整单归还，以统一结算逾期和提前归还。")} style={{ marginBottom: 16 }} /> : null}
        {inspection.fields.map((field) => <Form.Item key={field.code} name={field.code} label={field.label} rules={inspectionFieldRules(field, t)}>{field.type === "number" ? <InputNumber suffix={field.unit} style={{ width: "100%" }} /> : field.type === "boolean" ? <Select options={[{ value: true, label: t("是 / 正常") }, { value: false, label: t("否 / 异常") }]} /> : <Input />}</Form.Item>)}
        {isCarrierShipping && inspection.stage === "pickup" && <Form.Item name="carrierActualAt" label={t("客户实际签收时间（起租时间）")} rules={[{ required: true, message: t("请填写凭证对应的客户实际签收时间") }, { validator: async (_, value: Dayjs | undefined) => { if (value && value.isAfter(dayjs())) throw new Error(t("签收时间不能晚于当前时间")); } }]}><DatePicker showTime style={{ width: "100%" }} disabledDate={(date) => date.isAfter(dayjs(), "day")} /></Form.Item>}
        {isCarrierShipping ? <Form.Item label={t("签收 / 实物验收凭证")} required extra={t("请上传与登记时间相符的客户签收或仓库验收凭证；没有可靠凭证时不要提交。") }>
          <Upload accept="image/jpeg,image/png,image/webp,application/pdf" multiple maxCount={10} fileList={carrierEvidenceFiles} customRequest={carrierEvidenceUploadRequest} onChange={({ fileList }) => setCarrierEvidenceFiles(fileList as UploadFile<{ id: string; mimeType: string }>[])}>
            <Button icon={<PlusOutlined />}>{t("上传凭证（图片或 PDF）")}</Button>
          </Upload>
        </Form.Item> : <Form.Item name="attachmentsText" label={t("照片/证据引用")}><Input.TextArea rows={3} placeholder={t("每行填写一个文件服务返回的引用；不填写本地文件路径")} /></Form.Item>}
        {inspection.stage === "return" && <Card size="small" title={t("异常与损坏建议（可选)")}><Alert type="info" showIcon title={t("检查员只记录事实和建议损失额，不会直接向客户计费。")} style={{ marginBottom: 12 }} /><Form.Item name="exceptionCode" label={t("异常编码")}><Input placeholder="damage / missing_item / cleaning" /></Form.Item><Form.Item name="exceptionDescription" label={t("异常说明")}><Input.TextArea rows={2} /></Form.Item><Form.Item name="exceptionAllocationId" label={t("关联实物/分配项")} extra={t("不选择时按本批全部归还资源处理")}><Select allowClear placeholder={t("选择本次归还的具体资源")} options={(detail?.allocations ?? []).filter((allocation) => allocation.status === "picked_up" && (!inspectionReturnItems?.length || inspectionReturnItems.some((item) => item.allocationId === allocation.id))).map((allocation) => ({ value: allocation.id, label: `${allocation.assetNo ?? groups.data?.find((group) => group.id === allocation.itemGroupId)?.name ?? t("数量库存")} · ${allocation.id}` }))} /></Form.Item><Form.Item name="exceptionChargeAmount" label={t("建议损失金额")}><InputNumber min={0} precision={2} prefix={symbol} style={{ width: "100%" }} /></Form.Item></Card>}
      </Form>}
     </Modal>
     <Modal title={t("续租 / 延期")} open={extensionOpen} onCancel={() => { setExtensionOpen(false); setExtensionPreview(undefined); }} destroyOnHidden width={640}
      footer={[
        <Button key="cancel" onClick={() => { setExtensionOpen(false); setExtensionPreview(undefined); }}>{t("取消")}</Button>,
        <Button key="preview" loading={previewExtension.isPending} onClick={() => extensionForm.validateFields().then((values) => previewExtension.mutate(values))}>{t("试算费用")}</Button>,
        <Button key="submit" type="primary" disabled={!extensionPreview} loading={applyExtension.isPending} onClick={() => extensionForm.validateFields().then((values) => applyExtension.mutate(values))}>
          {extensionPreview?.paymentRequired ? t("提交申请（待补款）") : t("提交并生效")}
        </Button>
      ]}>
      <Form form={extensionForm} layout="vertical">
        <Alert type="info" showIcon title={t("先检查后续占用及缓冲，再计算续租费")} description={order.data?.ruleSnapshot?.extension?.pricingMode === "original_total" ? t("从原起租时间算到新归还时间，沿用原价格版本和原优惠规则，扣除此前已计金额；零差额无需补款，负差额另走退款审核。") : t("原租期费用不变，新增时段按申请续租时的价格单独计算，不追溯重算原订单优惠。")} style={{ marginBottom: 16 }} />
        <Form.Item label={t("当前归还时间")}>
          <Input disabled value={dayjs(detailEndAt).format("YYYY-MM-DD HH:mm")} />
        </Form.Item>
        <Form.Item name="newEndAt" label={t("新的归还时间")} rules={[{ required: true, message: t("请选择新的归还时间") }]}>
          {/* 换时间就作废上一次试算：让"金额"和"时间"不可能对不上。 */}
          <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} onChange={() => setExtensionPreview(undefined)} disabledDate={(current) => current.isBefore(dayjs(detailEndAt), "day")} />
        </Form.Item>
        <Form.Item name="memo" label={t("备注")}><Input.TextArea rows={2} placeholder={t("客户申请原因、沟通记录等")} /></Form.Item>
        {extensionPreview && <Card size="small" title={t("试算结果")}>
          <Descriptions column={2} size="small" items={[
            { key: "period", label: t("延长期间"), span: 2, children: `${dayjs(extensionPreview.originalEndAt).format("MM-DD HH:mm")} → ${dayjs(extensionPreview.newEndAt).format("MM-DD HH:mm")}` },
            { key: "units", label: t("计费单位数"), children: extensionPreview.billableUnits },
            ...(extensionPreview.pricingSnapshot ? [
              { key: "previous", label: t("此前已计应付"), children: money(extensionPreview.pricingSnapshot.previousPayableAmount) },
              { key: "recalculated", label: t("新租期重算应付"), children: money(extensionPreview.pricingSnapshot.recalculatedPayableAmount) },
            ] : []),
            { key: "rental", label: t("租金差额"), children: money(extensionPreview.rentalAmount) },
            { key: "service", label: t("新增服务费"), children: money(extensionPreview.serviceAmount) },
            { key: "deposit", label: t("押金差额"), children: money(extensionPreview.depositDelta) },
            { key: "preauth", label: t("预授权差额"), children: money(extensionPreview.preAuthDelta) },
            { key: "payable", label: t("本次需补差价"), children: <b>{money(extensionPreview.payableAmount)}</b> },
            { key: "refund", label: t("待审核退款差额"), children: money(extensionPreview.pricingSnapshot?.refundReview?.amount) },
            { key: "settlement", label: t("生效方式"), span: 2, children: extensionPreview.paymentRequired ? t("补差价后才延长租期与占用") : extensionPreview.payableAmount === 0 ? t("无需补款即可续租；若有负差额，另行审核退款") : t("企业月结：提交即生效，差额记入月结") },
            { key: "version", label: t("价格版本"), children: extensionPreview.priceVersion ?? "—" },
            { key: "rule", label: t("规则版本"), children: extensionPreview.ruleVersion }
          ]} />
          <Table size="small" pagination={false} style={{ marginTop: 12 }} rowKey="code" dataSource={extensionPreview.chargeLines} columns={[
            { title: t("费用"), dataIndex: "name" },
            { title: t("金额"), align: "right", render: (_, row) => money(row.amount) },
            { title: t("计算说明"), dataIndex: "detail", render: (value) => <span className="muted">{value ?? "—"}</span> }
          ]} />
        </Card>}
      </Form>
    </Modal>
    <Modal
      title={t("办理取货后换货")}
      open={postPickupExchangeOpen}
      onCancel={() => { setPostPickupExchangeOpen(false); setPostPickupExchangePreview(undefined); setExchangeTarget(undefined); postPickupExchangeForm.resetFields(); }}
      destroyOnHidden
      width={760}
      footer={[
        <Button key="cancel" onClick={() => { setPostPickupExchangeOpen(false); setPostPickupExchangePreview(undefined); setExchangeTarget(undefined); postPickupExchangeForm.resetFields(); }}>{t("取消")}</Button>,
        <Button key="preview" loading={previewPostPickupExchange.isPending} onClick={() => postPickupExchangeForm.validateFields(["allocationId", "replacementItemGroupId", "replacementAssetId", "replacementPricingGroupId", "priceBasis", "originalDisposition", "condition", "cancelServiceOccurrenceIds"]).then((values) => previewPostPickupExchange.mutate(values))}>{t("试算换货差额")}</Button>,
        <Button key="apply" type="primary" disabled={!postPickupExchangePreview} loading={applyPostPickupExchange.isPending} onClick={() => postPickupExchangeForm.submit()}>{t("确认换货")}</Button>
      ]}
    >
      <Form
        form={postPickupExchangeForm}
        layout="vertical"
        initialValues={{ priceBasis: "original_order_price", originalDisposition: "return_to_warehouse", customerConfirmed: false }}
        onValuesChange={(changed, values) => {
          if (Object.keys(changed).some((key) => !["customerConfirmed", "reason"].includes(key))) setPostPickupExchangePreview(undefined);
          if (Object.prototype.hasOwnProperty.call(changed, "allocationId")) {
            const allocation = exchangeableAllocations.find((row) => row.id === values.allocationId);
            postPickupExchangeForm.setFieldValue("orderLineId", allocation?.orderLineId);
            postPickupExchangeForm.setFieldValue("replacementItemGroupId", undefined);
            postPickupExchangeForm.setFieldValue("replacementAssetId", undefined);
            postPickupExchangeForm.setFieldValue("replacementPricingGroupId", undefined);
            setExchangeTarget(undefined);
          }
          if (Object.prototype.hasOwnProperty.call(changed, "replacementItemGroupId")) {
            postPickupExchangeForm.setFieldValue("replacementAssetId", undefined);
            postPickupExchangeForm.setFieldValue("replacementPricingGroupId", undefined);
            setExchangeTarget(values.orderLineId && values.replacementItemGroupId ? { exchangeOrderLineId: values.orderLineId, replacementItemGroupId: values.replacementItemGroupId } : undefined);
          }
        }}
        onFinish={(values) => applyPostPickupExchange.mutate(values)}
      >
        <Alert type="info" showIcon title={t("仅支持租赁中的整行换货；新商品会立即锁定。原商品可返回仓库释放库存，或下架隔离。金额按所选价格依据重算，差额统一进入订单结算。")} style={{ marginBottom: 16 }} />
        <Form.Item name="orderLineId" hidden><Input /></Form.Item>
        <Form.Item name="allocationId" label={t("要换出的已领取商品")} rules={[{ required: true, message: t("请选择本次换货商品") }]}>
          <Select
            placeholder={t("选择一条完整领取的商品行")}
            options={exchangeableAllocations.map((allocation) => {
              const line = detail?.lines.find((row) => row.id === allocation.orderLineId);
              return { value: allocation.id, label: (line?.itemGroupName ?? t("商品")) + " × " + allocation.quantity + (allocation.assetNo ? " · " + allocation.assetNo : "") };
            })}
          />
        </Form.Item>
        <Form.Item name="replacementItemGroupId" label={t("替换后的商品型号")} rules={[{ required: true, message: t("请选择替换型号") }]}>
          <Select
            placeholder={selectedExchangeLine ? t("选择同库存方式的启用型号") : t("请先选择换出商品")}
            disabled={!selectedExchangeLine}
            options={exchangeReplacementGroups.map((group) => ({ value: group.id, label: group.name + "（" + group.code + "）" }))}
          />
        </Form.Item>
        {selectedExchangeLine?.inventoryMode === "serialized" && <Form.Item name="replacementAssetId" label={t("新商品资产")} rules={[{ required: true, message: t("请选择可用的新资产") }]}>
          <Select
            loading={exchangeAssetCandidates.isLoading}
            disabled={!selectedReplacementGroupId || exchangeAssetCandidates.isError}
            placeholder={exchangeAssetCandidates.isError ? t("无法读取候选资产，请刷新重试") : t("选择订单领取地点当前可用的资产")}
            options={(selectedExchangeCandidateRow?.candidates ?? []).map((candidate) => ({ value: candidate.assetId, disabled: !candidate.available, label: candidate.available ? candidate.assetNo : candidate.assetNo + " · " + t(candidate.reason ?? "不可用") }))}
          />
        </Form.Item>}
        {selectedExchangeLine?.pricingGroupId && selectedReplacementGroupId && !(
          selectedExchangeLine.pricingGroupMemberItemGroupIds?.includes(selectedReplacementGroupId)
          ?? pricingGroups.data?.find((group) => group.id === selectedExchangeLine.pricingGroupId)?.memberItemGroupIds.includes(selectedReplacementGroupId)
          ?? false
        ) && <Form.Item name="replacementPricingGroupId" label={t("新商品所属定价组")} rules={[{ required: true, message: t("新型号不在原定价组内，请选择一个包含该型号的定价组") }]}>
          <Select loading={pricingGroups.isLoading} placeholder={t("选择包含该型号的定价组")} options={replacementPricingGroupOptions.map((group) => ({ value: group.id, label: group.name + "（" + group.code + "）" }))} />
        </Form.Item>}
        <Form.Item name="priceBasis" label={t("换货计价方式")} rules={[{ required: true }]}>
          <Select options={[
            { value: "original_order_price", label: t("按原订单价格版本重算") },
            { value: "replacement_current_price", label: t("按新商品当前价格重算") }
          ]} />
        </Form.Item>
        <Form.Item name="originalDisposition" label={t("原商品处理方式")} rules={[{ required: true }]}>
          <Select options={[
            { value: "return_to_warehouse", label: t("返回仓库并释放库存") },
            { value: "off_shelf", label: t("下架隔离，不释放库存") }
          ]} />
        </Form.Item>
        <Form.Item name="cancelServiceOccurrenceIds" label={t("一并取消未开始的可选服务")}>
          <Select mode="multiple" allowClear placeholder={t("可选；已开始或规则强制服务不能在此取消")} options={(detail?.serviceSnapshots ?? []).filter((row) => Boolean(row.occurrenceId) && (row.executionStatus ?? "not_started") === "not_started" && !row.requiredByRule).map((row) => ({ value: row.occurrenceId, label: row.serviceName + " × " + row.quantity }))} />
        </Form.Item>
        <Form.Item name="condition" label={t("原商品检查情况")} rules={[{ required: true, whitespace: true, message: t("请记录原商品检查情况") }]}>
          <Input.TextArea rows={3} maxLength={500} placeholder={t("记录外观、配件、读数和异常；异常费用仍须另行审核")} />
        </Form.Item>
        <Form.Item name="reason" label={t("换货原因")} rules={[{ required: true, whitespace: true, message: t("请填写换货原因") }]}>
          <Input.TextArea rows={2} maxLength={500} placeholder={t("例如：原商品故障，经客户确认更换")} />
        </Form.Item>
        <Form.Item name="customerConfirmed" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error(t("办理换货前必须取得客户确认"))) }]}>
          <Checkbox>{t("客户已确认替换商品、计价方式、差额和原商品处理方式")}</Checkbox>
        </Form.Item>
        {postPickupExchangePreview?.exchange && <Card size="small" title={t("换货试算结果")}>
          <Descriptions column={2} size="small" items={[
            { key: "from", label: t("换出商品"), children: postPickupExchangePreview.exchange.originalItemGroupName + (postPickupExchangePreview.exchange.replacementAssetNo ? " · " + postPickupExchangePreview.exchange.replacementAssetNo : "") },
            { key: "to", label: t("替换商品"), children: postPickupExchangePreview.exchange.replacementItemGroupName + (postPickupExchangePreview.exchange.replacementAssetNo ? " · " + postPickupExchangePreview.exchange.replacementAssetNo : "") },
            { key: "basis", label: t("价格版本"), children: postPickupExchangePreview.exchange.priceBasis === "original_order_price" ? postPickupExchangePreview.exchange.originalPriceVersion ?? "—" : postPickupExchangePreview.exchange.replacementPriceVersion ?? "—" },
            { key: "rent", label: t("重算后应收"), children: money(postPickupExchangePreview.recalculatedPayableAmount) },
            { key: "difference", label: t("应补差价"), children: <b>{money(postPickupExchangePreview.additionalAmount)}</b> },
            { key: "refund", label: t("待统一结算退差"), children: money(postPickupExchangePreview.refundAmount) },
            { key: "deposit", label: t("押金差额"), children: money(postPickupExchangePreview.depositDelta) },
            { key: "preauth", label: t("预授权差额"), children: money(postPickupExchangePreview.preAuthDelta) }
          ]} />
          {postPickupExchangePreview.warnings.map((warning) => <Alert key={warning} type="warning" showIcon title={t(warning)} style={{ marginTop: 12 }} />)}
        </Card>}
      </Form>
    </Modal>
    <Modal
      title={t("部分取消商品 / 服务")}
      open={partialCancelOpen}
      onCancel={() => { setPartialCancelOpen(false); setPartialCancelPreview(undefined); partialCancelForm.resetFields(); }}
      destroyOnHidden
      width={680}
      footer={[
        <Button key="cancel" onClick={() => { setPartialCancelOpen(false); setPartialCancelPreview(undefined); partialCancelForm.resetFields(); }}>{t("取消")}</Button>,
        <Button key="preview" loading={previewPartialCancel.isPending} onClick={() => partialCancelForm.validateFields(["items", "serviceOccurrenceIds", "serviceItems"]).then((values) => {
          const items = values.items?.filter((item: { lineId?: string; quantity?: number }) => item?.lineId && item.quantity);
          const serviceOccurrenceIds = values.serviceOccurrenceIds?.filter(Boolean);
          const serviceItems = values.serviceItems?.filter((item: { occurrenceId?: string; quantity?: number }) => item?.occurrenceId && item.quantity);
          const hasServices = Boolean(serviceOccurrenceIds?.length) || Boolean(serviceItems?.length);
          if (Boolean(items?.length) === hasServices) {
            message.error(t("请选择商品取消项或未开始的增值服务，且两者只能选一种"));
            return;
          }
          if (serviceOccurrenceIds?.length && serviceItems?.length) {
            message.error(t("整项取消与按数量取消只能选择一种服务方式"));
            return;
          }
          previewPartialCancel.mutate({ type: hasServices ? "service_cancel" : "partial_line_cancel", items, serviceOccurrenceIds, serviceItems });
        })}>{t("试算差额")}</Button>,
        <Button key="apply" type="primary" disabled={!partialCancelPreview} loading={applyPartialCancel.isPending} onClick={() => partialCancelForm.submit()}>{t("确认并应用")}</Button>
      ]}
    >
      <Form form={partialCancelForm} layout="vertical" onFinish={(values) => applyPartialCancel.mutate(values)} initialValues={{ customerConfirmed: false }}>
        <Alert type="info" showIcon title={t("仅支持取货前部分取消")} description={t("数量库存和一次性耗材可以按数量取消；序列化资产只能整行取消。未开始的可选增值服务可以单独取消，退款按订单快照中的客户净支付计算并释放服务容量。原订单与原报价不会被覆盖；商品与服务取消不能在同一次变更中混合。")} style={{ marginBottom: 16 }} />
        <Form.List name="items">
          {(fields, { add, remove }) => <Space orientation="vertical" style={{ width: "100%" }}>
            {fields.map((field) => <Space key={field.key} align="start" style={{ width: "100%" }}>
              <Form.Item name={[field.name, "lineId"]} rules={[{ required: true, message: t("请选择商品") }]} style={{ flex: 1 }}>
                <Select style={{ width: 360 }} placeholder={t("选择要取消的商品")} onChange={() => setPartialCancelPreview(undefined)} options={(detail?.lines ?? []).filter((line) => (line.cancelledQuantity ?? 0) < line.quantity).map((line) => ({ value: line.id, label: `${line.itemGroupName} · ${t("可取消")} ${line.quantity - (line.cancelledQuantity ?? 0)} ${t("件")}${["quantity", "consumable"].includes(line.inventoryMode) ? (line.inventoryMode === "consumable" ? `（${t("一次性耗材")}）` : `（${t("数量库存")}）`) : `（${t("序列化资产，仅整行")}）`}` }))} />
              </Form.Item>
              <Form.Item name={[field.name, "quantity"]} rules={[{ required: true, message: t("请输入数量") }]}>
                <InputNumber min={1} precision={0} style={{ width: 110 }} placeholder={t("数量")} onChange={() => setPartialCancelPreview(undefined)} />
              </Form.Item>
              <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => { remove(field.name); setPartialCancelPreview(undefined); }} />
            </Space>)}
            <Button type="dashed" icon={<PlusOutlined />} onClick={() => { add({ quantity: 1 }); setPartialCancelPreview(undefined); }}>{t("增加取消项")}</Button>
          </Space>}
        </Form.List>
        <Form.Item name="serviceOccurrenceIds" label={t("整项取消未开始的增值服务")} extra={t("业务规则要求的服务、已开始或已结束的服务不能从此处取消；如需只取消部分数量，请使用下方数量取消。")}>
          <Select
            mode="multiple"
            allowClear
            placeholder={t("可选；与商品取消二选一")}
            onChange={() => setPartialCancelPreview(undefined)}
            options={(detail?.serviceSnapshots ?? []).filter((row) => Boolean(row.occurrenceId) && (row.executionStatus ?? "not_started") === "not_started" && !row.requiredByRule).map((row) => ({
              value: row.occurrenceId,
              label: `${row.serviceName} · ${row.quantity} 份 · 可退 ${money(serviceOccurrenceNetAmount(row))}`
            }))}
          />
        </Form.Item>
        <Form.List name="serviceItems">
          {(fields, { add, remove }) => <Space orientation="vertical" style={{ width: "100%" }}>
            {fields.map((field) => <Space key={field.key} align="start" style={{ width: "100%" }}>
              <Form.Item name={[field.name, "occurrenceId"]} rules={[{ required: true, message: t("请选择服务") }]}>
                <Select style={{ width: 360 }} placeholder={t("选择按数量取消的服务")} onChange={() => setPartialCancelPreview(undefined)} options={(detail?.serviceSnapshots ?? []).filter((row) => Boolean(row.occurrenceId) && (row.executionStatus ?? "not_started") === "not_started" && !row.requiredByRule).map((row) => ({ value: row.occurrenceId, label: `${row.serviceName} · ${t("可取消")} ${row.quantity} ${t("份")}` }))} />
              </Form.Item>
              <Form.Item name={[field.name, "quantity"]} rules={[{ required: true, message: t("请输入数量") }]}>
                <InputNumber min={1} precision={0} style={{ width: 110 }} placeholder={t("数量")} onChange={() => setPartialCancelPreview(undefined)} />
              </Form.Item>
              <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => { remove(field.name); setPartialCancelPreview(undefined); }} />
            </Space>)}
            <Button type="dashed" icon={<PlusOutlined />} onClick={() => { add({ quantity: 1 }); setPartialCancelPreview(undefined); }}>{t("增加服务取消数量项")}</Button>
          </Space>}
        </Form.List>
        <Form.Item name="reason" label={t("变更原因")} rules={[{ required: true, whitespace: true, message: t("请填写变更原因") }]}><Input.TextArea rows={3} maxLength={500} placeholder={t("例如：客户减少租赁设备")} /></Form.Item>
        <Form.Item name="customerConfirmed" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error(t("必须取得客户确认"))) }]}><Checkbox>{t("我已取得客户对本次商品取消及金额变化的确认")}</Checkbox></Form.Item>
        {partialCancelPreview && <Card size="small" title={t("试算结果")}>
          <Descriptions column={2} size="small" items={[
            { key: "before", label: t("原最终应收"), children: money(partialCancelPreview.beforePayableAmount) },
            { key: "after", label: t("重算后应收"), children: money(partialCancelPreview.recalculatedPayableAmount) },
            { key: "difference", label: t("差额"), children: <b>{money(partialCancelPreview.differenceAmount)}</b> },
            { key: "deposit", label: t("押金差额"), children: money(partialCancelPreview.depositDelta) },
            { key: "preauth", label: t("预授权差额"), children: money(partialCancelPreview.preAuthDelta) },
            { key: "release", label: t("释放商品资源"), span: 2, children: partialCancelPreview.resourceRelease.length ? partialCancelPreview.resourceRelease.map((row) => `${row.itemGroupName} × ${row.quantity}`).join(locale === "en-US" ? ", " : "、") : "—" },
            { key: "serviceRelease", label: t("释放服务容量"), span: 2, children: partialCancelPreview.serviceResourceRelease.length ? partialCancelPreview.serviceResourceRelease.map((row) => `${row.serviceName} × ${row.quantity}`).join(locale === "en-US" ? ", " : "、") : "—" }
          ]} />
          {partialCancelPreview.warnings.map((warning) => <Alert key={warning} type="warning" showIcon title={warning} style={{ marginTop: 12 }} />)}
        </Card>}
      </Form>
    </Modal>
    <Modal title={t("续租价差退款审核")} open={Boolean(extensionRefundReview)} onCancel={() => setExtensionRefundReview(undefined)} onOk={() => extensionRefundForm.submit()} confirmLoading={reviewExtensionRefund.isPending} destroyOnHidden>
      <Alert type="warning" showIcon title={`${t("待审核差额")} ${money(extensionRefundReview?.pricingSnapshot?.refundReview?.amount)}`} description={t("审核通过只核减订单应收，并不会自动向客户转账退款。实际退款需另行处理。")} />
      <Form form={extensionRefundForm} layout="vertical" onFinish={(values) => reviewExtensionRefund.mutate(values)}>
        <Form.Item name="decision" label={t("审核结果")} rules={[{ required: true }]}><Select options={[{ value: "approved", label: t("通过并核减应收") }, { value: "rejected", label: t("拒绝") }]} /></Form.Item>
        <Form.Item name="reason" label={t("审核原因")} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} maxLength={500} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={t("取消租赁订单")} open={cancelOpen} onCancel={() => setCancelOpen(false)} onOk={() => cancelForm.submit()} confirmLoading={cancel.isPending} destroyOnHidden><Form form={cancelForm} layout="vertical" onFinish={(values) => cancel.mutate(values)}><Alert type="info" showIcon title={t("系统会撤销未履行租金，再按当前冻结规则计入取消费。")} description={t("天气等特殊豁免必须走审批，不可由本页面直接免除。")} style={{ marginBottom: 16 }} /><Form.Item name="reason" label={t("取消原因")} rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item></Form></Modal>
    <Modal title={t("确认客户爽约")} open={noShowOpen} onCancel={() => { setNoShowOpen(false); noShowForm.resetFields(); }} onOk={() => noShowForm.submit()} confirmLoading={confirmNoShow.isPending} destroyOnHidden>
      <Alert type="warning" showIcon title={t(noShowFinalReady ? "最终时限已到。确认后会释放库存、服务容量和优惠券占用；已支付金额按规则进入待退款/资金处理。" : "这是有权限人员的提前确认。请确认已通知客户并填写事实原因；确认后会释放库存、服务容量和优惠券占用。")} style={{ marginBottom: 16 }} />
      <Form form={noShowForm} layout="vertical" onFinish={(values) => confirmNoShow.mutate(values)}>
        <Form.Item name="reason" label={t("爽约原因")} rules={[{ required: true, whitespace: true, message: t("请输入爽约原因") }]}>
          <Input.TextArea rows={3} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
    <Modal title={t("替换套装组成")} open={Boolean(substitution)} onCancel={() => setSubstitution(undefined)} onOk={() => substitutionForm.submit()} confirmLoading={substitute.isPending} destroyOnHidden><Form form={substitutionForm} layout="vertical" onFinish={(values) => substitute.mutate(values)}><Form.Item label={t("当前组成")}><Input disabled value={groups.data?.find((group) => group.id === substitution?.fromItemGroupId)?.name} /></Form.Item><Form.Item name="toItemGroupId" label={t("替代商品")} rules={[{ required: true }]}><Select options={substitutionOptions} placeholder={t("选择同一替代组的候选商品")} /></Form.Item></Form></Modal>
    <Modal title={detail?.ruleSnapshot?.fulfillment?.returnInspectionRequired ? t("部分归还检查") : t("部分归还")} open={partialReturnOpen} onCancel={() => setPartialReturnOpen(false)} onOk={() => partialReturnForm.submit()} confirmLoading={partialReturn.isPending} destroyOnHidden><Form form={partialReturnForm} layout="vertical" onFinish={async (values) => { if (detail?.ruleSnapshot?.fulfillment?.returnInspectionRequired) { if (await beginInspection("return", values.items)) setPartialReturnOpen(false); return; } partialReturn.mutate(values); }}><Alert type="info" showIcon title={detail?.ruleSnapshot?.fulfillment?.returnInspectionRequired ? t("选择本批归还项后，下一步填写归还检查。") : t("本批实物会直接释放；最后一批仍须使用整单归还。")} style={{ marginBottom: 16 }} /><Form.List name="items">{(fields, { add, remove }) => <Space orientation="vertical" style={{ width: "100%" }}>{fields.map((field) => <Space key={field.key} align="start"><Form.Item name={[field.name, "allocationId"]} rules={[{ required: true }]}><Select style={{ width: 320 }} placeholder={t("选择待归还资产或数量项")} options={detail?.allocations.filter((allocation) => allocation.status === "picked_up").map((allocation) => ({ value: allocation.id, label: allocation.assetNo ?? `${groups.data?.find((group) => group.id === allocation.itemGroupId)?.name ?? t("数量库存")} · ${t("剩余")} ${allocation.quantity}` }))} /></Form.Item><Form.Item name={[field.name, "quantity"]} rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: 100 }} /></Form.Item><Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} /></Space>)}<Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ quantity: 1 })}>{t("增加归还项")}</Button></Space>}</Form.List></Form></Modal>
    <Modal title={fundingOperation ? `${t(FUNDING_ACTION_LABELS[fundingOperation.action])}${t(FUNDING_INSTRUMENT_LABELS[fundingOperation.instrument])}（${t("模拟")}）` : t("模拟资金操作")} open={Boolean(fundingOperation)} onCancel={() => { setFundingOperation(undefined); fundingForm.resetFields(); }} onOk={() => fundingForm.submit()} confirmLoading={fundingAction.isPending} destroyOnHidden>
      <Alert type="warning" showIcon title={t("本操作仅写入模拟资金流水，不会发起真实扣款或冻结。")} style={{ marginBottom: 16 }} />
      <Form form={fundingForm} layout="vertical" onFinish={(values) => fundingAction.mutate(values)}>
        {fundingOperation && !["initiate", "release", "fail"].includes(fundingOperation.action) && <Form.Item name="amount" label={t("金额")} rules={[{ required: true }]}><InputNumber min={0.01} precision={2} prefix={symbol} style={{ width: "100%" }} /></Form.Item>}
        {fundingOperation && !["capture", "release"].includes(fundingOperation.action) && <Form.Item name="paymentMethod" label={t("收退款方式")} rules={[{ required: true, message: t("请选择收退款方式") }]}><Select options={offlinePaymentMethods.map((value) => ({ value, label: t(OFFLINE_PAYMENT_METHOD_LABELS[value]) }))} /></Form.Item>}
        {fundingOperation?.action === "fail" && <Form.Item name="failureCode" label={t("失败原因码")} rules={[{ required: true }]}><Input placeholder={t("例如 provider_timeout")} /></Form.Item>}
        <Form.Item name="reason" label={t("操作原因")} rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={t("审核检查异常")} open={Boolean(exceptionReview)} onCancel={() => { setExceptionReview(undefined); exceptionReviewForm.resetFields(); }} onOk={() => exceptionReviewForm.submit()} confirmLoading={reviewException.isPending} destroyOnHidden>
      <Alert type="info" showIcon title={exceptionReview?.description} description={`${t("检查员建议费用：")}${exceptionReview?.suggested === undefined ? t("未填写") : money(exceptionReview.suggested)}。${t("最终费用由具备结算权限的人员确认。")}`} style={{ marginBottom: 16 }} />
      <Form form={exceptionReviewForm} layout="vertical" onFinish={(values) => reviewException.mutate(values)}>
        <Form.Item name="decision" label={t("审核结论")} rules={[{ required: true }]}><Select options={[{ value: "approved", label: t("通过并计费") }, { value: "rejected", label: t("驳回，不计费") }]} /></Form.Item>
        <Form.Item name="liability" label={t("赔偿责任认定")} rules={[{ required: true }]} extra={t("正数客户费用须有客户责任依据；正常损耗和责任未明不能收费。请在审核理由中记录证据与合同依据。")}><Select options={[{ value: "customer", label: t("客户承担赔偿责任") }, { value: "normal_wear", label: t("正常使用损耗") }, { value: "lessor", label: t("出租方责任") }, { value: "third_party", label: t("第三方责任，非客户承担") }, { value: "undetermined", label: t("责任未明，暂不收费") }]} /></Form.Item>
        <Form.Item noStyle shouldUpdate={(before, after) => before.decision !== after.decision}>{({ getFieldValue }) => getFieldValue("decision") === "approved" ? <Form.Item name="approvedChargeAmount" label={t("最终费用")} rules={[{ required: true }]}><InputNumber min={0} precision={2} prefix={symbol} style={{ width: "100%" }} /></Form.Item> : null}</Form.Item>
        {(detail?.serviceSnapshots ?? []).some((service) => service.serviceType === "damage_waiver") && <Form.Item noStyle shouldUpdate={(before, after) => before.decision !== after.decision}>{({ getFieldValue }) => getFieldValue("decision") === "approved" ? <Form.Item name="waiverDecision" label={t("损坏免赔适用性")} preserve={false} rules={[{ required: true }]} extra={t("请核对冻结条款、异常商品与责任范围，并在审核理由中说明依据。费用填写免赔计算前的裁定金额。")}><Select options={[{ value: "covered", label: t("符合免赔条款，按快照计算减免") }, { value: "excluded", label: t("不适用免赔，按裁定金额计费") }]} /></Form.Item> : null}</Form.Item>}
        {(detail?.serviceSnapshots ?? []).some((service) => service.serviceType === "damage_waiver") && <Form.Item noStyle shouldUpdate={(before, after) => before.decision !== after.decision || before.approvedChargeAmount !== after.approvedChargeAmount}>{({ getFieldValue }) => getFieldValue("decision") === "approved" && Number(getFieldValue("approvedChargeAmount")) > 0 ? <>
          <Form.Item name="incidentAt" label={t("实际事故时间")} preserve={false} rules={[{ required: true }]} getValueProps={(value: string | undefined) => ({ value: value ? dayjs(value) : null })} getValueFromEvent={(value: Dayjs | null) => value?.toISOString()} extra={t("按事故证据填写，不要以检查或审核时间代替。")}> <DatePicker showTime format="YYYY-MM-DD HH:mm" /></Form.Item>
          <Form.Item name="incidentBasis" label={t("事故时间核实依据")} preserve={false} rules={[{ required: true, whitespace: true }, { max: 1000 }]}><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="waiverOccurrenceId" label={t("指定冻结免赔发生项")} preserve={false} extra={t("可留空按可适用保障比较；不叠加不同发生项的额度。")}> <Select allowClear options={(detail?.serviceSnapshots ?? []).filter((service) => service.serviceType === "damage_waiver" && service.occurrenceId).map((service) => ({ value: service.occurrenceId!, label: `${service.serviceName} · ${service.termsVersion} · ${service.scheduledStartAt ?? "-"} → ${service.scheduledEndAt ?? "-"}` }))} /></Form.Item>
        </> : null}</Form.Item>}
        <Form.Item name="reason" label={t("审核理由")} rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={t("记录客户确认 / 申诉")} open={Boolean(exceptionCustomerResponse)} onCancel={() => { setExceptionCustomerResponse(undefined); exceptionCustomerResponseForm.resetFields(); }} onOk={() => exceptionCustomerResponseForm.submit()} confirmLoading={recordExceptionCustomerResponse.isPending} destroyOnHidden>
      <Alert
        type={exceptionCustomerResponse?.status === "disputed" ? "warning" : "info"}
        showIcon
        title={exceptionCustomerResponse?.description}
        description={t(exceptionCustomerResponse?.status === "disputed" ? "当前已有客户申诉；只有再次明确记录客户确认后，订单才可以继续结算。" : "审核通过的异常费用必须有客户确认或申诉记录；申诉会继续阻断结算，不会被当作已处理。")}
        style={{ marginBottom: 16 }}
      />
      <Form form={exceptionCustomerResponseForm} layout="vertical" onFinish={(values) => recordExceptionCustomerResponse.mutate(values)}>
        <Form.Item name="decision" label={t("客户响应")} rules={[{ required: true }]}>
          <Select options={[{ value: "confirmed", label: t("客户已确认费用") }, { value: "disputed", label: t("客户提出申诉") }]} />
        </Form.Item>
        <Form.Item name="reason" label={t("响应记录")} rules={[{ required: true, whitespace: true, message: t("请记录客户确认或申诉的事实") }]}>
          <Input.TextArea rows={4} maxLength={1000} placeholder={t("记录确认方式、客户意见或申诉内容")} />
        </Form.Item>
      </Form>
    </Modal>
    <Modal title={t("复核客户申诉费用")} open={Boolean(exceptionAdjustment)} onCancel={() => { setExceptionAdjustment(undefined); exceptionAdjustmentForm.resetFields(); }} onOk={() => exceptionAdjustmentForm.submit()} confirmLoading={adjustException.isPending} destroyOnHidden>
      <Alert
        type="warning"
        showIcon
        title={exceptionAdjustment?.description}
        description={`${t("当前已审核费用：")}${exceptionAdjustment ? money(exceptionAdjustment.current) : "-"}；${t("检查员建议费用：")}${exceptionAdjustment?.suggested === undefined ? t("未填写") : money(exceptionAdjustment.suggested)}。${t("复核后会保留原金额和申诉记录，并要求客户重新确认。")}`}
        style={{ marginBottom: 16 }}
      />
      <Form form={exceptionAdjustmentForm} layout="vertical" onFinish={(values) => adjustException.mutate(values)}>
        <Form.Item name="approvedChargeAmount" label={t("复核后最终费用")} rules={[{ required: true, message: t("请填写复核后的费用") }]}>
          <InputNumber min={0} precision={2} prefix={symbol} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="reason" label={t("复核理由")} rules={[{ required: true, whitespace: true, message: t("请填写金额调整原因") }]}>
          <Input.TextArea rows={4} maxLength={1000} placeholder={t("记录客户申诉依据、核减原因和复核结论")} />
        </Form.Item>
      </Form>
    </Modal>
    <Modal
      title={usageCorrection ? `${t("修正")}${t(usageCorrection.stage === "pickup" ? "领取" : "归还")}${t("使用量")}：${usageCorrection.fieldCode}` : t("修正使用量")}
      open={Boolean(usageCorrection)}
      onCancel={() => { setUsageCorrection(undefined); usageCorrectionForm.resetFields(); }}
      onOk={() => usageCorrectionForm.submit()}
      confirmLoading={correctUsage.isPending}
      destroyOnHidden
    >
      <Alert
        type="warning"
        showIcon
        title={`${t("当前有效读数")}: ${usageCorrection?.current ?? "-"}`}
        description={t("原始检查结果不会被覆盖；修正只保存为追加记录，不会直接重算订单金额。")}
        style={{ marginBottom: 16 }}
      />
      <Form form={usageCorrectionForm} layout="vertical" onFinish={(values) => correctUsage.mutate(values)}>
        <Form.Item name="correctedCurrent" label={t("修正后读数")} rules={[{ required: true, message: t("请输入修正后的读数") }]}>
          <InputNumber min={0} precision={2} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="reason" label={t("修正原因")} rules={[{ required: true, whitespace: true, message: t("请输入修正原因") }]}>
          <Input.TextArea rows={3} maxLength={1000} />
        </Form.Item>
        <Form.Item name="evidenceAttachments" label={t("证据引用")} extra={t("每行或用逗号填写一条照片、签名或附件引用。")}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
    <Modal
      title={serviceExecution ? `${t(serviceExecution.action === "start" ? "开始" : serviceExecution.action === "complete" ? "完成" : serviceExecution.action === "cancel" ? "取消" : serviceExecution.action === "no_show" ? "登记未到场" : "记录失败")}${t("服务")}：${serviceExecution.occurrence.serviceName}` : t("服务履约")}
      open={Boolean(serviceExecution)}
      onCancel={() => { setServiceExecution(undefined); serviceExecutionForm.resetFields(); }}
      onOk={() => serviceExecutionForm.submit()}
      confirmLoading={executeService.isPending}
      destroyOnHidden
    >
      <Alert
        type={serviceExecution?.action === "complete" ? "info" : "warning"}
        showIcon
        title={t("实际时间由本次操作记录，计划时段不能自动证明服务已经履约。")}
          description={serviceExecution?.action === "complete" ? t("完成服务必须填写执行结果，并明确记录客户是否确认；数量服务可以分次记录，未执行部分仍会保持待处理。") : t("取消、失败或未到场会按未执行部分的净额生成待审核退款；批准后仍需到资金区办理实际退款。")}
        style={{ marginBottom: 16 }}
      />
      <Form form={serviceExecutionForm} layout="vertical" onFinish={(values) => executeService.mutate(values)}>
        {serviceExecution?.action === "start" && <span style={{ color: "#666" }}>{t("点击确认后记录当前时间为实际开始时间。")}</span>}
        {serviceExecution?.action === "complete" && <>
          {serviceOccurrenceTotalQuantity(serviceExecution.occurrence) > 1 && <Form.Item name="executedQuantity" label={t("本次实际执行数量")} initialValue={serviceOccurrenceRemainingQuantity(serviceExecution.occurrence)} rules={[{ required: true, message: t("请输入本次实际执行数量") }]} extra={`${t("剩余可执行")} ${serviceOccurrenceRemainingQuantity(serviceExecution.occurrence)}${t("份；全部执行后才会结束该服务。")}`}><InputNumber min={1} max={serviceOccurrenceRemainingQuantity(serviceExecution.occurrence)} precision={0} style={{ width: "100%" }} /></Form.Item>}
          <Form.Item name="result" label={t("执行结果")} rules={[{ required: true, whitespace: true, message: t("请填写执行结果") }]}><Input.TextArea rows={3} placeholder={t("例如：服务已完成，客户现场确认")} /></Form.Item>
          <Form.Item name="customerConfirmed" label={t("客户确认")} rules={[{ required: true, message: t("请选择客户是否确认") }]}><Select options={[{ value: true, label: t("客户已确认") }, { value: false, label: t("客户未确认") }]} /></Form.Item>
        </>}
        {serviceExecution && ["cancel", "fail", "no_show"].includes(serviceExecution.action) && <>
          <Form.Item name="reason" label={t("处理原因")} rules={[{ required: true, whitespace: true, message: t("请填写处理原因") }]}><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="refundAmount" label={t("建议退款净额")} extra={`${t("留空按未执行部分的客户实际净支付")} ${money(serviceOccurrenceNetAmount(serviceExecution.occurrence) * serviceOccurrenceRemainingQuantity(serviceExecution.occurrence) / serviceOccurrenceTotalQuantity(serviceExecution.occurrence))} ${t("退款仍需审核。")}`}><InputNumber min={0} max={serviceOccurrenceNetAmount(serviceExecution.occurrence) * serviceOccurrenceRemainingQuantity(serviceExecution.occurrence) / serviceOccurrenceTotalQuantity(serviceExecution.occurrence)} precision={2} prefix={symbol} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="compensationAmount" label={t("补偿金额（记录用）")}><InputNumber min={0} precision={2} prefix={symbol} style={{ width: "100%" }} /></Form.Item>
        </>}
        {serviceExecution?.action !== "start" && <Form.Item name="evidenceAttachments" label={t("证据引用（可选）")} extra={t("每行或用逗号填写一条照片、签名或附件引用，不在本任务接入文件存储。")}><Input.TextArea rows={2} /></Form.Item>}
     </Form>
    </Modal>
    <Modal
      title={serviceRefund ? `${t("办理服务退款：")}${serviceRefund.serviceName}` : t("办理服务退款")}
      open={Boolean(serviceRefund)}
      onCancel={() => { setServiceRefund(undefined); serviceRefundForm.resetFields(); }}
      onOk={() => serviceRefundForm.submit()}
      confirmLoading={refundService.isPending}
      destroyOnHidden
    >
      <Alert
        type="warning"
        showIcon
        title={`${t("本次将登记模拟退款")}${money(serviceRefund?.refundAmount)}`}
        description={t("金额必须与已批准的服务退款一致；资金事件与服务发生项状态会在同一事务内提交。")}
        style={{ marginBottom: 16 }}
      />
      <Form form={serviceRefundForm} layout="vertical" onFinish={(values) => refundService.mutate(values)}>
        <Form.Item label={t("已批准金额")}><InputNumber disabled value={serviceRefund?.refundAmount} precision={2} prefix={symbol} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="paymentMethod" label={t("退款方式")} rules={[{ required: true, message: t("请选择退款方式") }]}>
          <Select options={offlinePaymentMethods.map((value) => ({ value, label: t(OFFLINE_PAYMENT_METHOD_LABELS[value]) }))} />
        </Form.Item>
        <Form.Item name="reason" label={t("退款办理原因")} rules={[{ required: true, whitespace: true, message: t("请填写退款办理原因") }]}>
          <Input.TextArea rows={3} placeholder={t("例如：服务退款审核已通过，现办理模拟退款")} />
        </Form.Item>
      </Form>
    </Modal>
    <Modal
      title={feeReview ? `${t("裁定")}${t(FEE_REVIEW_TYPE_LABELS[feeReview.type])}` : t("费用裁定")}
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
        title={`${t("规则建议金额")} ${money(feeReview?.suggestedAmount)}`}
        description={<Space orientation="vertical" size={0}>
          {(feeReview?.basis ?? []).map((row) => <span key={row}>{row}</span>)}
          <span>
            {feeReview?.type === "refund_due"
               ? t("批准只表示退款/释放已获认可，本单不动账；押金、预授权与多收租金的实际退款/释放要到资金区由具备资金权限的人员办理。")
               : feeReview?.type === "early_return_refund" || feeReview?.type === "service_refund"
                 ? t("批准后只核减应收并生成待退款；实际退款要到资金区由具备资金权限的人员办理。")
                 : t("批准后按认定额计入应收；实际收款要到资金区单独登记。")}
          </span>
        </Space>}
        style={{ marginBottom: 16 }}
      />
      <Form form={feeReviewForm} layout="vertical" onFinish={(values) => decideFeeReview.mutate(values)}>
        <Form.Item name="decision" label={t("裁定结论")} rules={[{ required: true }]}>
          <Select options={[
            { value: "approved", label: t(["early_return_refund", "service_refund", "refund_due"].includes(feeReview?.type ?? "") ? "批准退款 / 释放" : "批准计费") },
            { value: "rejected", label: t(["early_return_refund", "service_refund", "refund_due"].includes(feeReview?.type ?? "") ? "驳回，不退款" : "驳回，不计费") }
          ]} />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(before, after) => before.decision !== after.decision}>
          {({ getFieldValue }) => getFieldValue("decision") === "approved"
            ? <Form.Item
                name="amount"
                label={t("认定金额")}
                extra={t("不填按建议金额。认定额不得超过建议额——超出部分属于另立一笔异常费用，须走检查异常流程并留下自己的依据。")}
                rules={[
                  { required: true, message: t("请填写认定金额") },
                  {
                    validator: (_rule, value) =>
                      value === undefined || Number(value) <= Number(feeReview?.suggestedAmount ?? 0)
                        ? Promise.resolve()
                        : Promise.reject(new Error(`${t("认定额不能超过建议额")} ${money(feeReview?.suggestedAmount)}`))
                  }
                ]}
              ><InputNumber min={0} precision={2} prefix={symbol} style={{ width: "100%" }} /></Form.Item>
            : null}
        </Form.Item>
        <Form.Item name="reason" label={t("裁定原因")} rules={[{ required: true, message: t("请填写裁定原因，客服要据此向客户解释") }]}>
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  </>;
}

function inspectionFieldRules(field: RentalInspectionTemplate["fields"][number], translate: (value: string) => string = (value) => value) {
  if (!field.required) return undefined;
  if (field.type === "boolean") {
    return [{ validator: (_rule: unknown, value: unknown) => typeof value === "boolean" ? Promise.resolve() : Promise.reject(new Error(`${translate("请输入")}${field.label}`)) }];
  }
  return [{ required: true, message: `${translate("请输入")}${field.label}` }];
}
