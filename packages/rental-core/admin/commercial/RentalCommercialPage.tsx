import { discountCards, serviceCards } from "./commercialCards";
import { DiscountPlanShowcase } from "./DiscountPlanShowcase";
import { DISCOUNT_PLAN_DEMO } from "./discountPlanDemo";
import {
  ADMIN_TABLE_COLUMN_WIDTH,
  ActionButton,
  Alert,
  App,
  ArrowLeftOutlined,
  Button,
  ConfirmAction,
  DataTableMoney,
  DataTableRowActions,
  DataTableText,
  DatePicker,
  Drawer,
  EditOutlined,
  Form,
  FormSection,
  HistoryOutlined,
  Input,
  ListFilters,
  ListSection,
  Modal,
  PlusOutlined,
  RecordDetailLayout,
  SaveButton,
  Select,
  Switch,
  Table,
  useListFilter,
  useModalDismissal,
} from "@rental-os/platform-admin/ui";

import { RENTAL_PRICING_UNIT_LABELS, formatRentalMoney, rentalCurrencySymbol } from "@rental-os/rental-core";
import type {
  CreateRentalPriceAdjustmentRequest,
  RentalDiscountPlan,
  RentalPriceAdjustmentPreviewRow,
  RentalPricingGroup,
  RentalPricingPlanV1,
  RentalServiceCapacity,
  RentalValueAddedService,
  SaveRentalDiscountPlanRequest,
  SaveRentalServiceCapacityRequest,
  SaveRentalValueAddedServiceRequest,
} from "@rental-os/rental-core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Col, InputNumber, Row, Space, Tag, Typography } from "antd";

import dayjs from "dayjs";
import { CalendarRange, FileDiff, Pencil, RotateCcw } from "lucide-react";
import { resolveCorePageLocation } from "@rental-os/core-contracts";

import { useMemo, useRef, useState } from "react";
import {
  RentalCommercialPageProvider,
  useRentalCommercialWorkspaceAccess,
  type RentalCommercialPageContext,
} from "./page-context";
import { RENTAL_COMMERCIAL_ACCESS, RENTAL_COMMERCIAL_CORE_ID, RENTAL_COMMERCIAL_PAGES } from "./pages";
import { useOrderEditor } from "../orders/useOrderEditor";
import { useLocale } from "@rental-os/platform-admin/locale";
import { CorePage, UnsavedChangesGuard } from "@rental-os/platform-admin/core";
import { QueryState } from "@rental-os/platform-admin/core";
import { usePriceVersions } from "./usePriceVersions";
import { SettingsWorkspace } from "@rental-os/platform-admin/shell";
import { detailFulfillmentLabels as fulfillmentModeLabels } from "../orders/orderDetailPresentation";
import editorStyles from "./CommercialEditor.module.css";



export type RentalCommercialSection = "pricing" | "discounts" | "services";

const unitLabels = RENTAL_PRICING_UNIT_LABELS;
const pricingRateKey = (rate: { pricingGroupId?: string; itemGroupId: string; unit: string }) =>
  `${rate.pricingGroupId ?? rate.itemGroupId}:${rate.unit}`;
const serviceTypeLabels: Record<string, string> = {
  insurance: "保险",
  damage_waiver: "损坏免赔",
  delivery: "配送/运输",
  consumable: "耗材/配件",
  operator: "操作员",
  support: "技术支持",
  other: "其他",
};
const billingUnitLabels: Record<string, string> = {
  per_order: "每订单",
  per_unit: "每份/每件",
  per_day: "每自然日",
  per_night: "每晚",
  per_hour: "每小时",
  per_rental_period: "每租期",
};
const customerScopeLabels: Record<string, string> = {
  all: "全部客户",
  personal: "个人客户",
  corporate: "企业客户",
  member: "会员",
};
const adjustmentStatusLabels: Record<string, string> = {
  draft: "草稿",
  pending: "待生效",
  applied: "已生效",
  cancelled: "已取消",
  failed: "执行失败",
};

/** 商业分区共享当前宿主及原价格/服务权限，附属资料失败独立于服务列表；价格版本参数来自正式路由。 */
export function RentalCommercialPage({
  section,
  ...context
}: RentalCommercialPageContext & { section: RentalCommercialSection }) {
  return (
    <RentalCommercialPageProvider context={context}>
      <RentalCommercialWorkspace key={context.scopeKey} section={section} />
    </RentalCommercialPageProvider>
  );
}

function RentalCommercialWorkspace({ section }: { section: RentalCommercialSection }) {
  const {
    api: rentalCoreApi,
    scope,
    currentScopeKey,
    host,
    canManage,
    isCurrentScope,
    assertManage,
  } = useRentalCommercialWorkspaceAccess(
    section === "services" ? RENTAL_COMMERCIAL_PAGES.services.permissions : RENTAL_COMMERCIAL_ACCESS,
  );
  const generations = useRef({ adjustment: 0, discount: 0, service: 0, capacity: 0 });
  const { message } = App.useApp();
  const { locale, t } = useLocale();
  const queryClient = useQueryClient();
  const canRead = (permissions: readonly { resource: string; action: string }[]) =>
    Boolean(scope) && currentScopeKey() === scope &&
    permissions.some(permission => host.canAccess(RENTAL_COMMERCIAL_CORE_ID, [permission]));
  const canReadProfile = () => canRead([
    { resource: "order", action: "view" },
    { resource: "catalog", action: "view" },
    { resource: "asset", action: "view" },
  ]);
  const canReadGroups = () => canRead([
    { resource: "catalog", action: "view" },
    { resource: "catalog", action: "manage" },
    { resource: "order", action: "view" },
    { resource: "order", action: "create" },
  ]);
  const canReadPricingGroups = () => canRead([
    { resource: "price", action: "manage" },
    { resource: "order", action: "view" },
    { resource: "order", action: "create" },
  ]);
  const canReadSettings = () => canRead([
    { resource: "rules", action: "manage" },
    { resource: "price", action: "manage" },
    { resource: "order", action: "view" },
    { resource: "order", action: "create" },
  ]);
  const canReadLocations = () => canRead([{ resource: "station", action: "view" }]);
  const canReadServices = () =>
    section === "services" && Boolean(scope) && currentScopeKey() === scope &&
    host.canAccess(RENTAL_COMMERCIAL_CORE_ID, RENTAL_COMMERCIAL_PAGES.services.permissions);
  const [adjustmentPlan, setAdjustmentPlan] = useState<RentalPricingPlanV1 | null>();
  const [adjustmentPreview, setAdjustmentPreview] = useState<RentalPriceAdjustmentPreviewRow[]>([]);
  const [createdAdjustmentId, setCreatedAdjustmentId] = useState<string>();
  const [adjustmentSource, setAdjustmentSource] = useState<{
    version: string;
    rates: RentalPricingPlanV1["rates"];
  }>();
  const { sequence } = host.params ?? {};
  const versionsOpen = host.page.definition.id === RENTAL_COMMERCIAL_PAGES.pricingVersions.id;
  const versionSequence =
    sequence && /^[1-9]\d*$/.test(sequence) && Number.isSafeInteger(Number(sequence))
      ? Number(sequence)
      : undefined;
  const versionPage = host.page.definition.id === RENTAL_COMMERCIAL_PAGES.pricingVersionDetail.id;
  const navigateTo = (pageId: string, params?: Readonly<Record<string, string>>) => {
    assertManage();
    host.navigate(resolveCorePageLocation(host.pages, { coreId: RENTAL_COMMERCIAL_CORE_ID, pageId, params }));
  };
  const setVersionsOpen = (open: boolean) =>
    navigateTo(open ? RENTAL_COMMERCIAL_PAGES.pricingVersions.id : RENTAL_COMMERCIAL_PAGES.pricing.id);
  const setVersionSequence = (value?: number) =>
    navigateTo(
      value === undefined
        ? RENTAL_COMMERCIAL_PAGES.pricingVersions.id
        : RENTAL_COMMERCIAL_PAGES.pricingVersionDetail.id,
      value === undefined ? undefined : { sequence: String(value) },
    );
  const [restoreSequence, setRestoreSequence] = useState<number>();
  const [restoreReason, setRestoreReason] = useState("");
  const [cancelAdjustmentId, setCancelAdjustmentId] = useState<string>();
  const [cancelReason, setCancelReason] = useState("");
  const [discountEditor, setDiscountEditor] = useState<RentalDiscountPlan | null>();
  const [serviceEditor, setServiceEditor] = useState<RentalValueAddedService | null>();
  const [capacityService, setCapacityService] = useState<RentalValueAddedService | null>();
  const [capacityEditor, setCapacityEditor] = useState<RentalServiceCapacity | null>();
  const [adjustmentForm] = Form.useForm<
    CreateRentalPriceAdjustmentRequest & { scheduledAtValue?: dayjs.Dayjs }
  >();
  const [discountForm] = Form.useForm<SaveRentalDiscountPlanRequest>();
  const discountType = Form.useWatch("discountType", discountForm);
  const [serviceForm] = Form.useForm<SaveRentalValueAddedServiceRequest>();
  const [capacityForm] = Form.useForm<
    SaveRentalServiceCapacityRequest & { window?: [dayjs.Dayjs, dayjs.Dayjs] }
  >();
  const adjustmentDialog = useModalDismissal(Boolean(adjustmentPlan), () => {
    setAdjustmentPlan(null);
    setAdjustmentPreview([]);
    setCreatedAdjustmentId(undefined);
    setAdjustmentSource(undefined);
    adjustmentForm.resetFields();
  });
  const cancelDialog = useModalDismissal(Boolean(cancelAdjustmentId), () => {
    setCancelAdjustmentId(undefined);
    setCancelReason("");
  });
  const restoreDialog = useModalDismissal(restoreSequence !== undefined, () => {
    setRestoreSequence(undefined);
    setRestoreReason("");
  });
  const serviceDialog = useModalDismissal(Boolean(serviceEditor), () => {
    setServiceEditor(null);
    serviceForm.resetFields();
  });
  const capacityDialog = useModalDismissal(Boolean(capacityService), () => {
    setCapacityService(null);
    setCapacityEditor(null);
    capacityForm.resetFields();
  });
  const capacityEditorDialog = useModalDismissal(Boolean(capacityEditor), () => {
    setCapacityEditor(null);
    capacityForm.resetFields();
  });
  const profile = useQuery({
    queryKey: ["rental-core", "profile", scope],
    queryFn: async ({ signal }) => {
      if (!isCurrentScope() || !canReadProfile()) throw new Error("经营资料读取受限");
      const result = await rentalCoreApi.profile({ signal });
      if (!isCurrentScope() || !canReadProfile()) throw new Error("经营资料读取受限");
      return result;
    },
    enabled: canReadProfile(),
  });
  const settings = useQuery({
    queryKey: ["rental-core", "business-settings", scope],
    queryFn: async ({ signal }) => {
      if (!isCurrentScope() || !canReadSettings()) throw new Error("业务设置读取受限");
      const result = await rentalCoreApi.businessSettings({ signal });
      if (!isCurrentScope() || !canReadSettings()) throw new Error("业务设置读取受限");
      return result;
    },
    enabled: canReadSettings(),
  });
  const visibleSettings = canReadSettings() && !settings.isError ? settings.data : undefined;
  const currency = visibleSettings?.pricing.currency;
  const money = (value: number | undefined) => {
    if (section === "services" && !Number.isFinite(value))
      return locale === "en-US" ? "Amount unavailable" : t("未提供金额");
    if (section === "services" && !currency)
      return locale === "en-US" ? "Currency unavailable" : t("未提供币种");
    return formatRentalMoney(Number(value ?? 0), currency);
  };
  const currencySymbol = section === "services" && !currency ? undefined : rentalCurrencySymbol(currency);
  const groups = useQuery({
    queryKey: ["rental-core", "groups", scope],
    queryFn: async ({ signal }) => {
      if (!isCurrentScope() || !canReadGroups()) throw new Error("商品资料读取受限");
      const result = await rentalCoreApi.itemGroups({ signal });
      if (!isCurrentScope() || !canReadGroups()) throw new Error("商品资料读取受限");
      return result;
    },
    enabled: canReadGroups(),
  });
  const pricingGroups = useQuery({
    queryKey: ["rental-core", "pricing-groups", scope],
    queryFn: async ({ signal }) => {
      if (!isCurrentScope() || !canReadPricingGroups()) throw new Error("定价分组读取受限");
      const result = await rentalCoreApi.pricingGroups({ signal });
      if (!isCurrentScope() || !canReadPricingGroups()) throw new Error("定价分组读取受限");
      return result;
    },
    enabled: canReadPricingGroups() && section !== "services",
  });
  // 三个分区各自只取自己要展示的数据：别的分区打开时不发这些请求。
  const pricing = useQuery({
    queryKey: ["rental-core", "pricing-plans", scope],
    queryFn: ({ signal }) => rentalCoreApi.pricingPlans({ signal }),
    enabled: Boolean(scope) && section === "pricing",
  });
  const discounts = useQuery({
    queryKey: ["rental-core", "discount-plans", scope],
    queryFn: ({ signal }) => rentalCoreApi.discountPlans({ signal }),
    enabled: Boolean(scope) && section === "discounts" && !DISCOUNT_PLAN_DEMO,
  });
  const locations = useQuery({
    queryKey: ["rental-core", "locations", scope],
    queryFn: async ({ signal }) => {
      if (!isCurrentScope() || !canReadLocations()) throw new Error("地点资料读取受限");
      const result = await rentalCoreApi.locations({ signal });
      if (!isCurrentScope() || !canReadLocations()) throw new Error("地点资料读取受限");
      return result;
    },
    enabled: canReadLocations(),
  });
  const services = useQuery({
    queryKey: ["rental-core", "value-added-services", scope],
    queryFn: async ({ signal }) => {
      if (!isCurrentScope() || !canReadServices()) throw new Error("服务资料读取受限");
      const result = await rentalCoreApi.valueAddedServices({ signal });
      if (!isCurrentScope() || !canReadServices()) throw new Error("服务资料读取受限");
      return result;
    },
    enabled: canReadServices(),
  });
  const capacities = useQuery({
    queryKey: ["rental-core", "service-capacities", capacityService?.id, scope],
    queryFn: async ({ signal }) => {
      if (!isCurrentScope() || !canReadServices()) throw new Error("服务容量读取受限");
      const result = await rentalCoreApi.serviceCapacities(capacityService!.id, { signal });
      if (!isCurrentScope() || !canReadServices()) throw new Error("服务容量读取受限");
      return result;
    },
    enabled: canReadServices() && Boolean(capacityService?.id),
  });
  const visibleProfile = canReadProfile() && !profile.isError ? profile.data : undefined;
  const visibleGroups = canReadGroups() && !groups.isError ? groups.data : undefined;
  const visiblePricingGroups = canReadPricingGroups() && !pricingGroups.isError ? pricingGroups.data : undefined;
  const visibleLocations = canReadLocations() && !locations.isError ? locations.data : undefined;
  const visibleServices = canReadServices() && !services.isError ? services.data : undefined;
  const visibleCapacities = canReadServices() && !capacities.isError ? capacities.data : undefined;
  const serviceReferencesAvailable = () =>
    isCurrentScope() && canReadServices() && canReadProfile() && canReadSettings() &&
    canReadGroups() && canReadLocations() && Boolean(
      queryClient.getQueryData<Awaited<ReturnType<typeof rentalCoreApi.businessSettings>>>(
        ["rental-core", "business-settings", scope],
      )?.pricing.currency,
    ) &&
    ["profile", "business-settings", "groups", "locations", "value-added-services"].every(
      key => queryClient.getQueryState(["rental-core", key, scope])?.status === "success",
    );
  const capacityReferencesAvailable = () =>
    isCurrentScope() && canReadServices() && canReadLocations() && Boolean(capacityService) &&
    queryClient.getQueryState(["rental-core", "locations", scope])?.status === "success" &&
    queryClient.getQueryState(["rental-core", "service-capacities", capacityService?.id, scope])?.status !== "error";
  async function refreshServiceReferences() {
    if (!isCurrentScope()) throw new DOMException("商业页面的会话或经营空间已变化", "AbortError");
    await Promise.all([
      ...(canReadGroups() ? [groups.refetch()] : []),
      ...(canReadLocations() ? [locations.refetch()] : []),
      ...(canReadProfile() ? [profile.refetch()] : []),
      ...(canReadSettings() ? [settings.refetch()] : []),
    ]);
  }
  async function refreshServices(throwOnError = false) {
    if (!isCurrentScope() || !canReadServices()) throw new Error(t("当前操作不可用"));
    // 附属查询分别持有错误，主服务查询及其重试保持独立。
    await Promise.all([services.refetch({ throwOnError }), refreshServiceReferences()]);
  }
  async function refreshCapacities(throwOnError = false) {
    if (!isCurrentScope() || !canReadServices()) throw new Error(t("当前操作不可用"));
    await Promise.all([
      capacities.refetch({ throwOnError }),
      ...(canReadLocations() ? [locations.refetch()] : []),
    ]);
  }
  // 价格版本与定价分组页共用同一个 hook（同一组查询键、同一个「当前版本」判据）。
  // 版本明细只有价格页需要；版本抽屉在别的分区打开时只需要列表。
  const {
    versions,
    currentVersion: currentPriceVersion,
    currentVersionDetail: currentPriceVersionDetail,
  } = usePriceVersions({
    enabled: section === "pricing" || versionsOpen,
    detailEnabled: section === "pricing",
  });
  const versionDetail = useQuery({
    queryKey: ["rental-core", "price-version", versionSequence, scope],
    queryFn: ({ signal }) => rentalCoreApi.priceVersion(versionSequence!, { signal }),
    enabled: Boolean(scope) && versionSequence !== undefined,
  });
  const previousVersion = useQuery({
    queryKey: ["rental-core", "price-version", versionSequence ? versionSequence - 1 : undefined, scope],
    queryFn: ({ signal }) => rentalCoreApi.priceVersion(versionSequence! - 1, { signal }),
    enabled: Boolean(scope) && versionSequence !== undefined && versionSequence > 1,
  });
  const adjustments = useQuery({
    queryKey: ["rental-core", "price-adjustments", scope],
    queryFn: ({ signal }) => rentalCoreApi.priceAdjustments({ signal }),
    enabled: Boolean(scope) && section === "pricing",
  });
  const createAdjustment = useMutation({
    mutationFn: (values: CreateRentalPriceAdjustmentRequest & { scheduledAtValue?: dayjs.Dayjs }) => {
      assertManage();
      const { scheduledAtValue, ...request } = values;
      return rentalCoreApi.createPriceAdjustment({
        ...request,
        scheduledAt: scheduledAtValue?.toISOString(),
      });
    },
    onSuccess: async (result) => {
      if (!isCurrentScope()) return;
      setAdjustmentPreview(result.preview);
      setCreatedAdjustmentId(result.id);
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "price-adjustments"] });
      if (!isCurrentScope()) return;
      message.success(t("调价计划草稿已创建，请核对最终价后确认"));
    },
    onError: () => {
      if (isCurrentScope()) message.error(t("创建调价计划失败，请检查时间线、范围与调价值"));
    },
  });
  const confirmAdjustment = useMutation({
    mutationFn: (id: string) => {
      assertManage();
      return rentalCoreApi.confirmPriceAdjustment(id);
    },
    onSuccess: async () => {
      if (!isCurrentScope()) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "price-adjustments"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "pricing-plans"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "price-versions"] }),
      ]);
      if (!isCurrentScope()) return;
      message.success(t("调价计划已确认"));
      if (adjustmentPlan) adjustmentDialog.dismiss();
    },
    onError: () => {
      if (isCurrentScope()) message.error(t("确认失败：请检查是否存在待生效调价或未来价格版本"));
    },
  });
  const cancelAdjustment = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => {
      assertManage();
      return rentalCoreApi.cancelPriceAdjustment(id, { reason });
    },
    onSuccess: async () => {
      if (!isCurrentScope()) return;
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "price-adjustments"] });
      if (!isCurrentScope()) return;
      cancelDialog.dismiss();
      message.success(t("调价计划已取消"));
    },
  });
  const restoreVersion = useMutation({
    mutationFn: ({ sequence, reason }: { sequence: number; reason: string }) => {
      assertManage();
      return rentalCoreApi.restorePriceVersion(sequence, { reason });
    },
    onSuccess: async (result) => {
      if (!isCurrentScope()) return;
      restoreDialog.dismiss();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "price-versions"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "pricing-plans"] }),
      ]);
      if (!isCurrentScope()) return;
      message.success(
        locale === "en-US"
          ? `Created version ${result.version} from ${result.restoredFromVersion}`
          : `已基于 ${result.restoredFromVersion} 生成新版本 ${result.version}`,
      );
    },
    onError: () => {
      if (isCurrentScope()) message.error(t("恢复失败：请检查未来版本、待生效调价或价格行结构变化"));
    },
  });
  const saveDiscount = useMutation({
    mutationFn: (values: SaveRentalDiscountPlanRequest) => {
      assertManage();
      return rentalCoreApi.saveDiscountPlan(values);
    },
    onSuccess: async () => {
      if (!isCurrentScope()) return;
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "discount-plans"],
      });
      if (!isCurrentScope()) return;
      setDiscountEditor(null);
      message.success(t("优惠方案新版本已保存"));
    },
    onError: () => {
      if (isCurrentScope()) message.error(t("保存失败，请检查优惠范围、有效期和叠加规则"));
    },
  });
  const saveService = useMutation({
    mutationFn: (values: SaveRentalValueAddedServiceRequest) => {
      assertManage();
      if (!serviceReferencesAvailable()) throw new Error(t("当前操作不可用"));
      return rentalCoreApi.saveValueAddedService(values);
    },
    onSuccess: async () => {
      if (!isCurrentScope()) return;
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "value-added-services"],
      });
      if (!isCurrentScope()) return;
      serviceDialog.dismiss();
      message.success(t("增值服务及条款版本已保存"));
    },
    onError: () => {
      if (isCurrentScope()) message.error(t("保存失败，请检查服务条款、价格和适用商品"));
    },
  });
  const saveCapacity = useMutation({
    mutationFn: (values: SaveRentalServiceCapacityRequest & { window?: [dayjs.Dayjs, dayjs.Dayjs] }) => {
      assertManage();
      if (!capacityReferencesAvailable()) throw new Error(t("当前操作不可用"));
      const { window, ...rest } = values;
      return rentalCoreApi.saveServiceCapacity({
        ...rest,
        serviceId: capacityService!.id,
        windowStart: window?.[0].toISOString() ?? rest.windowStart,
        windowEnd: window?.[1].toISOString() ?? rest.windowEnd,
      });
    },
    onSuccess: async () => {
      if (!isCurrentScope()) return;
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "service-capacities", capacityService?.id],
      });
      if (!isCurrentScope()) return;
      capacityEditorDialog.dismiss();
      message.success(t("服务容量窗口已保存"));
    },
    onError: () => {
      if (isCurrentScope()) message.error(t("保存失败，请检查时段是否重叠及容量是否小于已占用数量"));
    },
  });

  function openAdjustment() {
    const record = enabledPlans[0];
    const priceVersion = currentPriceVersionDetail.data;
    if (
      adjustmentBusy ||
      !priceMatrixReady ||
      !record ||
      !priceVersion?.rates.length ||
      !isCurrentScope() ||
      (adjustmentPlan && !adjustmentDialog.visible)
    )
      return;
    adjustmentSubmission.dismiss(() => {
      generations.current.adjustment += 1;
      setAdjustmentPreview([]);
      setCreatedAdjustmentId(undefined);
      // A query refresh must not relabel an open draft or turn untouched prices into changes.
      setAdjustmentSource({
        version: priceVersion.version,
        rates: priceVersion.rates.map((rate) => ({ ...rate })),
      });
      adjustmentForm.resetFields();
      adjustmentForm.setFieldsValue({
        code: `ADJ-${dayjs().format("YYYYMMDD-HHmm")}`,
        name: `${dayjs().format("YYYY-MM-DD")} ${t("统一调价")}`,
        changeReason: t("经营价格调整"),
        changes: priceVersion.rates.map((rate) => ({
          pricingGroupId: rate.pricingGroupId ?? rate.itemGroupId,
          itemGroupId: rate.pricingGroupId ?? rate.itemGroupId,
          unit: rate.unit,
          op: "set_base",
          value: rate.baseAmount,
        })),
      });
      adjustmentSubmission.markClean();
      setAdjustmentPlan(record);
    });
  }

  async function submitAdjustment(
    values: CreateRentalPriceAdjustmentRequest & { scheduledAtValue?: dayjs.Dayjs },
  ) {
    if (adjustmentBusy || createdAdjustmentId || !adjustmentSource || !priceMatrixReady)
      throw new Error(t("当前操作不可用"));
    const currentByKey = new Map(
      adjustmentSource.rates.map((rate) => [pricingRateKey(rate), rate.baseAmount]),
    );
    const changes = values.changes.filter((change) => {
      const key = `${change.pricingGroupId ?? change.itemGroupId}:${change.unit}`;
      return Number(change.value) !== currentByKey.get(key);
    });
    if (!changes.length) {
      message.warning(t("价格没有变化，请先填写至少一个新的价格"));
      throw new Error(t("价格没有变化，请先填写至少一个新的价格"));
    }
    return createAdjustment.mutateAsync({ ...values, changes });
  }

  function editDiscount(record?: RentalDiscountPlan) {
    if (discountUnavailable || DISCOUNT_PLAN_DEMO || saveDiscount.isPending || !isCurrentScope()) return;
    discountSubmission.dismiss(() => {
      generations.current.discount += 1;
      discountForm.resetFields();
      discountForm.setFieldsValue(
        record
          ? { ...record, changeReason: "调整优惠方案" }
          : {
              code: "",
              name: "",
              status: "draft",
              discountType: "percentage",
              discountValue: 5,
              minimumSpend: 0,
              appliesTo: "rental",
              customerScope: "all",
              applicableItemGroupIds: [],
              applicablePricingGroupIds: [],
              applicableDayTypes: [],
              priority: 100,
              stackableWithOtherPlans: false,
              stackableWithCoupon: true,
              effectiveFrom: new Date().toISOString(),
              changeReason: "新建优惠方案",
            },
      );
      discountSubmission.markClean();
      setDiscountEditor(record ?? ({} as RentalDiscountPlan));
    });
  }

  function editService(record?: RentalValueAddedService) {
    if (
      serviceUnavailable ||
      saveService.isPending ||
      !serviceReferencesAvailable() ||
      (serviceEditor && !serviceDialog.visible)
    )
      return;
    serviceSubmission.dismiss(() => {
      generations.current.service += 1;
      serviceForm.resetFields();
      serviceForm.setFieldsValue(
        record ?? {
          code: "",
          name: "",
          serviceType: "other",
          billingUnit: "per_order",
          price: 0,
          minimumQuantity: 1,
          maximumQuantity: 1,
          termsVersion: "1.0",
          terms: "",
          applicableItemGroupIds: [],
          applicableFulfillmentModes: [],
          applicableLocationIds: [],
          customerScope: "all",
          selectionMode: "optional",
          requiresCapacity: false,
          status: "enabled",
        },
      );
      serviceSubmission.markClean();
      setServiceEditor(record ?? ({} as RentalValueAddedService));
    });
  }

  function editCapacity(record?: RentalServiceCapacity) {
    if (
      capacityUnavailable ||
      saveCapacity.isPending ||
      !capacityReferencesAvailable() ||
      (capacityEditor && !capacityEditorDialog.visible)
    )
      return;
    capacitySubmission.dismiss(() => {
      generations.current.capacity += 1;
      capacityForm.resetFields();
      capacityForm.setFieldsValue(
        record
          ? { ...record, window: [dayjs(record.windowStart), dayjs(record.windowEnd)] }
          : {
              serviceId: capacityService!.id,
              locationId: visibleLocations?.[0]?.id,
              totalCapacity: 1,
              status: "enabled",
            },
      );
      capacitySubmission.markClean();
      setCapacityEditor(record ?? ({} as RentalServiceCapacity));
    });
  }

  const sectionTitle = t(
    section === "pricing" ? "价格版本与调价" : section === "discounts" ? "优惠方案" : "增值服务",
  );
  const enabledPlans = [...(pricing.data ?? [])]
    .filter((plan) => plan.status === "enabled")
    .sort((left, right) => new Date(right.effectiveFrom).getTime() - new Date(left.effectiveFrom).getTime());
  const currentPricingRows: Array<{
    group: RentalPricingGroup;
    rate?: RentalPricingPlanV1["rates"][number];
  }> = (visiblePricingGroups ?? []).flatMap(
    (group): Array<{ group: RentalPricingGroup; rate?: RentalPricingPlanV1["rates"][number] }> => {
      const rates =
        currentPriceVersionDetail.data?.rates.filter(
          (item) => (item.pricingGroupId ?? item.itemGroupId) === group.id,
        ) ?? [];
      return rates.length ? rates.map((rate) => ({ group, rate })) : [{ group, rate: undefined }];
    },
  );
  const unpricedCount = new Set(
    currentPricingRows
      .filter((row) => row.group.status === "enabled" && !row.rate)
      .map((row) => row.group.id),
  ).size;
  const discountFilter = useListFilter(discounts.data, {
    fields: (row) => [row.name, row.code],
    status: (row) => row.status,
  });
  const serviceFilter = useListFilter(visibleServices, {
    fields: (row) => [row.name, row.code],
    status: (row) => row.status,
  });
  const priceMatrixReady =
    canManage &&
    versions.isSuccess &&
    settings.isSuccess &&
    pricing.isSuccess &&
    pricingGroups.isSuccess &&
    (!currentPriceVersion || currentPriceVersionDetail.isSuccess);
  const adjustmentBusy = createAdjustment.isPending || confirmAdjustment.isPending;
  const discountUnavailable =
    !canManage ||
    !discounts.isSuccess ||
    !settings.isSuccess ||
    !pricingGroups.isSuccess ||
    !groups.isSuccess;
  const serviceUnavailable =
    !canManage ||
    !services.isSuccess ||
    !visibleSettings || !currency || !visibleGroups || !visibleLocations || !visibleProfile;
  const capacityUnavailable = !canManage || !capacityService || !visibleLocations || capacities.isError;

  const adjustmentSubmission = useOrderEditor<
    CreateRentalPriceAdjustmentRequest & { scheduledAtValue?: dayjs.Dayjs }
  >({
    form: adjustmentForm,
    identity: adjustmentPlan
      ? JSON.stringify([scope, "price-adjustment", generations.current.adjustment])
      : undefined,
    disabled: adjustmentBusy || Boolean(createdAdjustmentId) || !priceMatrixReady,
    onSave: submitAdjustment,
  });
  const discountSubmission = useOrderEditor<SaveRentalDiscountPlanRequest>({
    form: discountForm,
    identity: discountEditor
      ? JSON.stringify([scope, "discount-plan", generations.current.discount])
      : undefined,
    disabled: discountUnavailable || DISCOUNT_PLAN_DEMO,
    onSave: (values) => {
      assertManage();
      return saveDiscount.mutateAsync(values);
    },
  });
  const serviceSubmission = useOrderEditor<SaveRentalValueAddedServiceRequest>({
    form: serviceForm,
    identity: serviceEditor
      ? JSON.stringify([scope, "value-added-service", generations.current.service])
      : undefined,
    disabled: serviceUnavailable,
    onSave: (values) => {
      assertManage();
      return saveService.mutateAsync(values);
    },
  });
  const capacitySubmission = useOrderEditor<
    SaveRentalServiceCapacityRequest & { window?: [dayjs.Dayjs, dayjs.Dayjs] }
  >({
    form: capacityForm,
    identity: capacityEditor
      ? JSON.stringify([scope, "service-capacity", generations.current.capacity, capacityService?.id])
      : undefined,
    disabled: capacityUnavailable,
    onSave: (values) => {
      assertManage();
      return saveCapacity.mutateAsync(values);
    },
  });
  const boundAdjustmentForm = useMemo(
    () => ({ ...adjustmentForm, validateFields: adjustmentSubmission.validate }),
    [adjustmentForm, adjustmentSubmission.key],
  );
  const boundDiscountForm = useMemo(
    () => ({ ...discountForm, validateFields: discountSubmission.validate }),
    [discountForm, discountSubmission.key],
  );
  const boundServiceForm = useMemo(
    () => ({ ...serviceForm, validateFields: serviceSubmission.validate }),
    [serviceForm, serviceSubmission.key],
  );
  const boundCapacityForm = useMemo(
    () => ({ ...capacityForm, validateFields: capacitySubmission.validate }),
    [capacityForm, capacitySubmission.key],
  );
  const dismissAdjustment = () => {
    if (!adjustmentBusy) adjustmentSubmission.dismiss(adjustmentDialog.dismiss);
  };
  const dismissDiscount = () => discountSubmission.dismiss(() => setDiscountEditor(null));
  const dismissService = () => serviceSubmission.dismiss(serviceDialog.dismiss);
  const dismissCapacity = () => capacitySubmission.dismiss(capacityEditorDialog.dismiss);
  const dismissCapacityService = () => capacitySubmission.dismiss(capacityDialog.dismiss);
  const dismissCancel = () => {
    if (!cancelAdjustment.isPending) cancelDialog.dismiss();
  };
  const dismissRestore = () => {
    if (!restoreVersion.isPending) restoreDialog.dismiss();
  };

  function openCapacityService(record: RentalValueAddedService) {
    if (
      !canReadServices() ||
      !isCurrentScope() ||
      saveCapacity.isPending ||
      (capacityService && !capacityDialog.visible)
    )
      return;
    capacitySubmission.dismiss(() => {
      setCapacityService(record);
      setCapacityEditor(null);
      capacityForm.resetFields();
    });
  }

  function openCancellation(id: string) {
    if (
      !canManage ||
      !isCurrentScope() ||
      cancelAdjustment.isPending ||
      (cancelAdjustmentId && !cancelDialog.visible)
    )
      return;
    setCancelReason("");
    setCancelAdjustmentId(id);
  }

  function openRestoration(sequence: number) {
    if (
      !canManage ||
      !isCurrentScope() ||
      restoreVersion.isPending ||
      (restoreSequence !== undefined && !restoreDialog.visible)
    )
      return;
    setRestoreReason("");
    setRestoreSequence(sequence);
  }

  return (
    <>
      <UnsavedChangesGuard
        dirty={
          (Boolean(adjustmentPlan) && adjustmentSubmission.dirty) ||
          (Boolean(discountEditor) && discountSubmission.dirty) ||
          (Boolean(serviceEditor) && serviceSubmission.dirty) ||
          (Boolean(capacityEditor) && capacitySubmission.dirty)
        }
        busy={
          adjustmentBusy ||
          cancelAdjustment.isPending ||
          restoreVersion.isPending ||
          saveDiscount.isPending ||
          saveService.isPending ||
          saveCapacity.isPending
        }
      />
      {!versionsOpen && !versionPage && (
        <>
          <CorePage
            children={null}
            title={sectionTitle}
            description={section === "pricing" ? t("已有价格须通过调价计划变更。") : undefined}
            actions={
              section === "pricing"
                ? [
                    {
                      id: "price-versions",
                      kind: "navigate",
                      slot: "tools",
                      label: { default: t("价格版本") },
                      permissions: RENTAL_COMMERCIAL_ACCESS,
                      icon: <HistoryOutlined />,
                      to: {
                        coreId: RENTAL_COMMERCIAL_CORE_ID,
                        pageId: RENTAL_COMMERCIAL_PAGES.pricingVersions.id,
                      },
                    },
                    {
                      id: "create-price-adjustment",
                      kind: "open",
                      label: { default: t("新增调价计划") },
                      emphasis: "primary",
                      permissions: RENTAL_COMMERCIAL_ACCESS,
                      icon: <PlusOutlined />,
                      disabled:
                        adjustmentBusy || !priceMatrixReady || unpricedCount > 0 || !currentPriceVersion,
                      open: openAdjustment,
                    },
                  ]
                : [
                    {
                      id: section === "discounts" ? "create-discount-plan" : "create-service",
                      kind: "open",
                      label: { default: t(section === "discounts" ? "新增优惠方案" : "新增服务") },
                      emphasis: "primary",
                      permissions: section === "services"
                        ? RENTAL_COMMERCIAL_PAGES.services.permissions
                        : RENTAL_COMMERCIAL_ACCESS,
                      icon: <PlusOutlined />,
                      disabled:
                        section === "services"
                          ? serviceUnavailable || saveService.isPending
                          : !DISCOUNT_PLAN_DEMO && (discountUnavailable || saveDiscount.isPending),
                      open: () =>
                        section === "discounts"
                          ? DISCOUNT_PLAN_DEMO
                            ? message.info(t("演示版：多规则编辑待后端接入，未保存任何内容"))
                            : editDiscount()
                          : editService(),
                    },
                  ]
            }
          />

          {section === "pricing" && (
            <Space orientation="vertical" size={16} style={{ width: "100%" }}>
              {!versions.isLoading && !versions.error && !currentPriceVersion && (
                <Alert
                  type="warning"
                  showIcon
                  title={t("当前还没有生效的整体价格版本")}
                  description={t("请先到定价分组页面新建分组并填写基本价。")}
                />
              )}
              <ListSection
                title={t("当前整体价格版本")}
                extra={
                  currentPriceVersion && (
                    <Typography.Text type="secondary">
                      {currentPriceVersion.version} ·{" "}
                      {t("生效于 {date}", {
                        date: dayjs(currentPriceVersion.effectiveFrom).format("YYYY-MM-DD HH:mm"),
                      })}
                    </Typography.Text>
                  )
                }
              >
                <QueryState
                  loading={
                    pricing.isLoading ||
                    pricingGroups.isLoading ||
                    versions.isLoading ||
                    currentPriceVersionDetail.isLoading ||
                    settings.isLoading
                  }
                  error={
                    pricing.error ||
                    pricingGroups.error ||
                    versions.error ||
                    currentPriceVersionDetail.error ||
                    settings.error
                  }
                  onRetry={() =>
                    Promise.all([
                      pricing.refetch({ throwOnError: true }),
                      pricingGroups.refetch({ throwOnError: true }),
                      versions.refetch({ throwOnError: true }),
                      settings.refetch({ throwOnError: true }),
                      ...(currentPriceVersion
                        ? [currentPriceVersionDetail.refetch({ throwOnError: true })]
                        : []),
                    ])
                  }
                >
                  <Table<{ group: RentalPricingGroup; rate?: RentalPricingPlanV1["rates"][number] }>
                    rowKey={(row) => `${row.group.id}:${row.rate?.unit ?? "unpriced"}`}
                    onRefresh={() =>
                      Promise.all([
                        pricingGroups.refetch({ throwOnError: true }),
                        versions.refetch({ throwOnError: true }),
                        ...(currentPriceVersion
                          ? [currentPriceVersionDetail.refetch({ throwOnError: true })]
                          : []),
                      ])
                    }
                    loading={
                      pricingGroups.isLoading || versions.isLoading || currentPriceVersionDetail.isLoading
                    }
                    refreshing={
                      pricingGroups.isFetching || versions.isFetching || currentPriceVersionDetail.isFetching
                    }
                    dataSource={currentPricingRows}
                    columns={[
                      {
                        title: t("定价分组"),
                        dataIndex: ["group", "name"],
                        minWidth: ADMIN_TABLE_COLUMN_WIDTH.identity,
                        render: (_, row) => (
                          <DataTableText
                            primary={row.group.name}
                            secondary={`${row.group.code} · ${row.group.members.map((item) => item.name).join("、")}`}
                          />
                        ),
                      },
                      {
                        title: t("当前基础价"),
                        dataIndex: ["rate", "baseAmount"],
                        align: "right",
                        render: (_, row) =>
                          row.rate ? (
                            <DataTableMoney formatted={money(row.rate.baseAmount)} />
                          ) : (
                            <Tag color="warning">{t("缺少基本价")}</Tag>
                          ),
                      },
                      {
                        title: t("计价单位"),
                        dataIndex: ["rate", "unit"],
                        render: (_, row) => (row.rate ? t(unitLabels[row.rate.unit] ?? row.rate.unit) : "-"),
                      },
                    ]}
                  />
                </QueryState>
              </ListSection>
              {priceMatrixReady && unpricedCount > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  title={
                    locale === "en-US"
                      ? `${unpricedCount} legacy groups are missing base prices`
                      : `有 ${unpricedCount} 个历史分组缺少基本价`
                  }
                  description={t(
                    "本页不再负责初始化。请停用该历史分组，并在定价分组页按新流程重新建立并填写基本价。",
                  )}
                />
              )}
              <ListSection title={t("调价计划")}>
                <QueryState
                  loading={adjustments.isLoading}
                  error={adjustments.error}
                  onRetry={() => adjustments.refetch({ throwOnError: true })}
                >
                  <Table
                    rowKey="id"
                    loading={adjustments.isLoading}
                    refreshing={adjustments.isFetching}
                    onRefresh={() => adjustments.refetch()}
                    dataSource={adjustments.data ?? []}
                    columns={[
                      {
                        title: t("计划"),
                        dataIndex: "name",
                        minWidth: ADMIN_TABLE_COLUMN_WIDTH.identity,
                        render: (_, row) => <DataTableText primary={row.name} secondary={row.code} />,
                      },
                      {
                        title: t("生效时间"),
                        render: (_, row) =>
                          row.scheduledAt
                            ? dayjs(row.scheduledAt).format("YYYY-MM-DD HH:mm")
                            : t("确认后立即"),
                      },
                      {
                        title: t("调整范围"),
                        render: (_, row) =>
                          locale === "en-US"
                            ? `${row.changes.length} price items`
                            : `${row.changes.length} 个价格项`,
                      },
                      {
                        title: t("状态"),
                        dataIndex: "status",
                        render: (value) => <Tag>{t(adjustmentStatusLabels[value] ?? value)}</Tag>,
                      },
                      { title: t("原因"), dataIndex: "changeReason" },
                      {
                        title: t("操作"),
                        render: (_, row) =>
                          row.status === "draft" ? (
                            <Space size={0}>
                              <ConfirmAction
                                tone="neutral"
                                label={t("确认")}
                                prompt={t("确认后将立即生效或进入待生效，是否继续？")}
                                disabled={confirmAdjustment.isPending}
                                onConfirm={() => confirmAdjustment.mutateAsync(row.id)}
                              />
                              <Button
                                type="link"
                                danger
                                disabled={cancelAdjustment.isPending}
                                onClick={() => openCancellation(row.id)}
                              >
                                {t("取消")}
                              </Button>
                            </Space>
                          ) : row.status === "pending" ? (
                            <Button
                              type="link"
                              danger
                              disabled={cancelAdjustment.isPending}
                              onClick={() => openCancellation(row.id)}
                            >
                              {t("取消")}
                            </Button>
                          ) : (
                            <Typography.Text type="secondary">—</Typography.Text>
                          ),
                      },
                    ]}
                  />
                </QueryState>
              </ListSection>
            </Space>
          )}
          {section === "discounts" && DISCOUNT_PLAN_DEMO && <DiscountPlanShowcase money={money} />}
          {section === "discounts" && !DISCOUNT_PLAN_DEMO && (
            <ListSection
              controls={
                <ListFilters
                  filter={discountFilter}
                  placeholder="优惠名称或编码"
                  options={[
                    { value: "draft", label: "草稿" },
                    { value: "enabled", label: "已启用" },
                    { value: "disabled", label: "已停用" },
                  ]}
                />
              }
            >
              <QueryState loading={discounts.isLoading} error={discounts.error}>
                <Table<RentalDiscountPlan>
                  cardView={discountCards({
                    t,
                    money,
                    pricingGroups: visiblePricingGroups ?? [],
                    customerLabel: (key) => t(customerScopeLabels[key] ?? key),
                    edit: editDiscount,
                  })}
                  exportConfig={{
                    filename: t("优惠方案"),
                    fields: [
                      { label: t("编码"), value: (row) => row.code },
                      { label: t("名称"), value: (row) => row.name },
                      { label: t("状态"), value: (row) => row.status },
                    ],
                  }}
                  rowKey="id"
                  onRefresh={() => discounts.refetch()}
                  loading={discounts.isLoading}
                  refreshing={discounts.isFetching}
                  dataSource={discountFilter.rows}
                  pagination={discountFilter.pagination}
                  columns={[
                    {
                      title: t("方案"),
                      render: (_, row) => (
                        <>
                          <b>{row.name}</b>
                          <br />
                          <span className="muted">
                            {row.code} · v{row.version}
                          </span>
                        </>
                      ),
                    },
                    {
                      title: t("优惠规则"),
                      render: (_, row) =>
                        row.discountType === "percentage"
                          ? `${t("减免 {value}%", { value: row.discountValue })}${row.maximumDiscount !== undefined ? (locale === "en-US" ? `, ${t("最高减免")} ${money(row.maximumDiscount)}` : `，最高减 ${money(row.maximumDiscount)}`) : ""}`
                          : row.discountType === "threshold_amount"
                            ? `${t("满")} ${money(row.thresholdAmount)} ${t("减")} ${money(row.discountValue)}`
                            : `${t("减")} ${money(row.discountValue)}`,
                    },
                    {
                      title: t("适用范围"),
                      render: (_, row) => {
                        const selectedGroups = row.applicablePricingGroupIds?.length
                          ? row.applicablePricingGroupIds
                              .map(
                                (id) =>
                                  visiblePricingGroups?.find((group) => group.id === id)?.name ??
                                  t("已删除分组"),
                              )
                              .join(locale === "en-US" ? ", " : "、")
                          : t("全部定价分组");
                        return (
                          <>
                            {t(customerScopeLabels[row.customerScope] ?? row.customerScope)}
                            <br />
                            <span className="muted">{selectedGroups}</span>
                          </>
                        );
                      },
                    },
                    {
                      title: t("互斥与叠加"),
                      render: (_, row) => (
                        <>
                          {row.exclusiveGroup
                            ? locale === "en-US"
                              ? `${t("互斥组")}: ${row.exclusiveGroup}`
                              : `互斥组：${row.exclusiveGroup}`
                            : t("独立方案")}
                          <br />
                          <span className="muted">
                            {t("其他方案")}：{row.stackableWithOtherPlans ? t("可叠加") : t("不叠加")} ·{" "}
                            {t("优惠券")}：{row.stackableWithCoupon ? t("可叠加") : t("不叠加")}
                          </span>
                        </>
                      ),
                    },
                    {
                      title: t("状态"),
                      dataIndex: "status",
                      render: (value) => (
                        <Tag color={value === "enabled" ? "success" : "default"}>
                          {t(value === "enabled" ? "启用" : value === "draft" ? "草稿" : "停用")}
                        </Tag>
                      ),
                    },
                    {
                      title: t("操作"),
                      render: (_, row) => (
                        <Button type="link" icon={<EditOutlined />} onClick={() => editDiscount(row)}>
                          {t("编辑")}
                        </Button>
                      ),
                    },
                  ]}
                />
              </QueryState>
            </ListSection>
          )}
          {section === "services" && (
            <ListSection
              controls={
                <ListFilters
                  filter={serviceFilter}
                  placeholder="服务名称或编码"
                  options={[
                    { value: "enabled", label: "已启用" },
                    { value: "disabled", label: "已停用" },
                  ]}
                />
              }
            >
              {(!visibleGroups || !visibleLocations || !visibleProfile || !visibleSettings || !currency) && (
                <Alert
                  type="warning"
                  showIcon
                  title={
                    !canReadGroups() || !canReadLocations() || !canReadProfile() || !canReadSettings()
                      ? (locale === "en-US" ? "Some service setup details are restricted" : t("部分服务配置资料读取受限"))
                      : groups.isError || locations.isError || profile.isError || settings.isError
                        ? (locale === "en-US" ? "Unable to read service setup details" : t("服务配置资料读取失败"))
                        : (locale === "en-US" ? "Service setup details are incomplete" : t("服务配置资料尚未完整提供"))
                  }
                  description={locale === "en-US"
                    ? "Services remain visible. Editing requires complete products, locations, business details and currency."
                    : t("服务列表仍可查看；编辑需要完整商品、地点、经营资料和币种。")}
                  action={
                    <ActionButton
                      label={t("重试")}
                      onAction={refreshServiceReferences}
                    />
                  }
                />
              )}
              <QueryState
                loading={canReadServices() && services.isLoading}
                error={canReadServices() ? services.error : new Error(
                  locale === "en-US" ? "Service access is restricted" : t("服务资料读取受限"),
                )}
                onRetry={() => refreshServices(true)}
              >
                <Table<RentalValueAddedService>
                  cardView={serviceCards({
                    t,
                    money,
                    serviceLabel: (key) => t(serviceTypeLabels[key] ?? key),
                    billingLabel: (key) => t(billingUnitLabels[key] ?? key),
                    edit: editService,
                    capacity: openCapacityService,
                  })}
                  exportConfig={{
                    filename: t("增值服务"),
                    fields: [
                      { label: t("编码"), value: (row) => row.code },
                      { label: t("名称"), value: (row) => row.name },
                      {
                        label: t("类型"),
                        value: (row) => t(serviceTypeLabels[row.serviceType] ?? row.serviceType),
                      },
                      { label: t("状态"), value: (row) => row.status },
                    ],
                  }}
                  rowKey="id"
                  onRefresh={() => refreshServices()}
                  loading={services.isLoading}
                  refreshing={services.isFetching}
                  dataSource={serviceFilter.rows}
                  pagination={serviceFilter.pagination}
                  columns={[
                    {
                      title: t("服务"),
                      dataIndex: "name",
                      minWidth: ADMIN_TABLE_COLUMN_WIDTH.identity,
                      render: (_, row) => (
                        <DataTableText primary={row.name} secondary={`${row.code} · v${row.version}`} />
                      ),
                    },
                    {
                      title: t("类型"),
                      dataIndex: "serviceType",
                      render: (value) => <Tag>{t(serviceTypeLabels[value] ?? value)}</Tag>,
                    },
                    {
                      title: t("价格"),
                      render: (_, row) =>
                        `${money(row.price)} / ${t(billingUnitLabels[row.billingUnit] ?? row.billingUnit)}`,
                    },
                    {
                      title: t("保障额度"),
                      dataIndex: "coverageLimit",
                      render: (value) => (value === undefined ? "-" : money(value)),
                    },
                    {
                      title: t("免赔额"),
                      dataIndex: "deductible",
                      render: (value) => (value === undefined ? "-" : money(value)),
                    },
                    { title: t("条款版本"), dataIndex: "termsVersion" },
                    {
                      title: t("容量"),
                      dataIndex: "requiresCapacity",
                      render: (value) => (
                        <Tag color={value ? "processing" : "default"}>
                          {value ? t("需要预留") : t("无容量限制")}
                        </Tag>
                      ),
                    },
                    {
                      title: t("状态"),
                      dataIndex: "status",
                      render: (value) => (
                        <Tag color={value === "enabled" ? "success" : "default"}>
                          {t(value === "enabled" ? "已启用" : value === "disabled" ? "已停用" : value)}
                        </Tag>
                      ),
                    },
                    {
                      title: t("操作"),
                      render: (_, row) => (
                        <DataTableRowActions
                          primary={{
                            id: "edit",
                            label: t("编辑"),
                            icon: Pencil,
                            disabled: serviceUnavailable || saveService.isPending,
                            onSelect: () => editService(row),
                          }}
                          details={() => editService(row)}
                          detailLabel={t("编辑")}
                          menuLabel={`${row.name} · ${t("更多操作")}`}
                          actions={
                            row.requiresCapacity
                              ? [
                                  {
                                    id: "capacity",
                                    label: t("容量窗口"),
                                    icon: CalendarRange,
                                    onSelect: () => openCapacityService(row),
                                  },
                                ]
                              : []
                          }
                        />
                      ),
                    },
                  ]}
                />
              </QueryState>
            </ListSection>
          )}

          <Modal
            presentation="side"
            title={t("新增调价计划")}
            width={900}
            open={adjustmentDialog.visible}
            destroyOnHidden
            onCancel={dismissAdjustment}
            afterClose={adjustmentDialog.afterClose}
            closable={!adjustmentBusy}
            keyboard={!adjustmentBusy}
            mask={{ closable: !adjustmentBusy }}
            footer={
              <>
                <Button disabled={adjustmentBusy} onClick={dismissAdjustment}>
                  {t("关闭")}
                </Button>
                {createdAdjustmentId ? (
                  <ConfirmAction
                    tone="neutral"
                    label={t("确认计划")}
                    prompt={t("确认后将立即生效或进入待生效，是否继续？")}
                    disabled={adjustmentBusy}
                    onConfirm={() => confirmAdjustment.mutateAsync(createdAdjustmentId)}
                  />
                ) : (
                  <SaveButton
                    label={t("创建草稿并预览")}
                    form={boundAdjustmentForm}
                    disabled={!priceMatrixReady}
                    pending={createAdjustment.isPending}
                    onSave={adjustmentSubmission.submit}
                  />
                )}
              </>
            }
          >
            <Alert
              type="info"
              showIcon
              title={t("只调整需要变更的价格；确认后才会生效或进入待生效。")}
              description={
                adjustmentSource
                  ? t("依据价格版本 {version}", { version: adjustmentSource.version })
                  : undefined
              }
              style={{ marginBottom: 16 }}
            />
            <Form
              name="price-adjustment"
              form={adjustmentForm}
              layout="vertical"
              disabled={adjustmentBusy || Boolean(createdAdjustmentId) || !priceMatrixReady}
              {...adjustmentSubmission.formProps}
              onFinish={adjustmentSubmission.submit}
            >
              <Form.Item name="code" hidden>
                <Input />
              </Form.Item>
              <Row gutter={16}>
                <Col xs={24} md={14}>
                  <Form.Item
                    name="name"
                    label={t("计划名称")}
                    rules={[{ required: true, message: t("请填写计划名称") }]}
                  >
                    <Input placeholder={t("例如：国庆档统一调价")} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={10}>
                  <Form.Item
                    name="scheduledAtValue"
                    label={t("生效时间")}
                    extra={t("留空则在确认后立即生效")}
                  >
                    <DatePicker showTime needConfirm style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.List name="changes">
                {(fields) => (
                  <div>
                    {fields.map((field) => (
                      <div key={field.key} className={editorStyles.adjustmentRow}>
                        <Row gutter={[16, 12]} align="middle">
                          <Form.Item name={[field.name, "pricingGroupId"]} hidden>
                            <Input />
                          </Form.Item>
                          <Form.Item name={[field.name, "itemGroupId"]} hidden>
                            <Input />
                          </Form.Item>
                          <Form.Item name={[field.name, "unit"]} hidden>
                            <Input />
                          </Form.Item>
                          <Form.Item name={[field.name, "op"]} hidden>
                            <Input />
                          </Form.Item>
                          <Col xs={24} md={10}>
                            <DataTableText
                              primary={
                                adjustmentSource?.rates[field.name]?.pricingGroupName ??
                                adjustmentSource?.rates[field.name]?.itemGroupName
                              }
                              secondary={t(
                                unitLabels[adjustmentSource?.rates[field.name]?.unit ?? "calendar_day"],
                              )}
                            />
                          </Col>
                          <Col xs={12} md={6}>
                            <Typography.Text type="secondary">{t("原价")}</Typography.Text>
                            <br />
                            <Typography.Text>
                              {adjustmentSource?.rates[field.name]
                                ? money(adjustmentSource.rates[field.name].baseAmount)
                                : "—"}
                            </Typography.Text>
                          </Col>
                          <Col xs={12} md={8}>
                            <Form.Item
                              name={[field.name, "value"]}
                              label={t("调后价格")}
                              rules={[{ required: true, message: t("请填写调后价格") }]}
                              style={{ marginBottom: 0 }}
                            >
                              <InputNumber
                                min={0}
                                precision={2}
                                prefix={currencySymbol}
                                style={{ width: "100%" }}
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                      </div>
                    ))}
                  </div>
                )}
              </Form.List>
              <Form.Item
                name="changeReason"
                label={t("调价原因")}
                rules={[{ required: true }]}
                style={{ marginTop: 12 }}
              >
                <Input.TextArea rows={2} />
              </Form.Item>
            </Form>
            {adjustmentPreview.length > 0 && (
              <ListSection
                title={t("本次最终价预览")}
                style={{ marginTop: "var(--rental-layout-section-gap)" }}
              >
                <Table
                  rowKey={(row) => `${row.itemGroupId}:${row.unit}`}
                  pagination={false}
                  dataSource={adjustmentPreview}
                  columns={[
                    { title: t("定价分组"), dataIndex: "itemGroupCode" },
                    {
                      title: t("计价单位"),
                      dataIndex: "unit",
                      render: (value) => t(unitLabels[value as keyof typeof unitLabels] ?? value),
                    },
                    { title: t("调整前"), dataIndex: "beforeBaseAmount", render: money },
                    { title: t("调整后"), dataIndex: "afterBaseAmount", render: money },
                  ]}
                />
              </ListSection>
            )}
          </Modal>

          <Modal
            title={t("取消调价计划")}
            open={cancelDialog.visible}
            onCancel={dismissCancel}
            afterClose={cancelDialog.afterClose}
            destroyOnHidden
            closable={!cancelAdjustment.isPending}
            keyboard={!cancelAdjustment.isPending}
            mask={{ closable: !cancelAdjustment.isPending }}
            footer={
              <>
                <Button disabled={cancelAdjustment.isPending} onClick={dismissCancel}>
                  {t("返回")}
                </Button>
                <ActionButton
                  label={t("确认取消")}
                  disabled={!cancelAdjustmentId || !cancelReason.trim()}
                  pending={cancelAdjustment.isPending}
                  onAction={() =>
                    cancelAdjustmentId && cancelReason.trim()
                      ? cancelAdjustment.mutateAsync({ id: cancelAdjustmentId, reason: cancelReason.trim() })
                      : Promise.reject(new Error("Operation unavailable"))
                  }
                />
              </>
            }
          >
            <Form layout="vertical" name="cancel-price-adjustment" disabled={cancelAdjustment.isPending}>
              <Form.Item label={t("取消原因")} htmlFor="cancel-price-reason">
                <Input.TextArea
                  id="cancel-price-reason"
                  rows={3}
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  placeholder={t("请填写取消原因")}
                />
              </Form.Item>
            </Form>
          </Modal>
        </>
      )}
      {versionsOpen && (
        <RecordDetailLayout
          title={t("空间价格版本")}
          onBack={() => setVersionsOpen(false)}
          header={
            <CorePage
              children={null}
              title={t("空间价格版本")}
              actions={[
                {
                  id: "back-pricing",
                  kind: "navigate",
                  label: { default: t("返回列表") },
                  slot: "navigation",
                  permissions: RENTAL_COMMERCIAL_ACCESS,
                  icon: <ArrowLeftOutlined />,
                  to: { coreId: RENTAL_COMMERCIAL_CORE_ID, pageId: RENTAL_COMMERCIAL_PAGES.pricing.id },
                },
              ]}
            />
          }
        >
          <QueryState
            loading={versions.isLoading}
            error={versions.error}
            onRetry={() => versions.refetch({ throwOnError: true })}
          >
            <ListSection>
              <Table
                rowKey="id"
                loading={versions.isLoading}
                refreshing={versions.isFetching}
                onRefresh={() => versions.refetch()}
                dataSource={versions.data?.rows ?? []}
                columns={[
                  { title: t("版本"), dataIndex: "version" },
                  {
                    title: t("生效时间"),
                    dataIndex: "effectiveFrom",
                    render: (value) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—"),
                  },
                  {
                    title: t("价格条目"),
                    dataIndex: "rateCount",
                    render: (value) => (locale === "en-US" ? `${value} items` : `${value} 条`),
                  },
                  { title: t("变更原因"), dataIndex: "changeReason" },
                  { title: t("创建人"), dataIndex: "createdBy" },
                  {
                    title: t("操作"),
                    render: (_, row) => (
                      <DataTableRowActions
                        primary={{
                          id: "compare",
                          label: t("查看详情"),
                          icon: FileDiff,
                          onSelect: () => setVersionSequence(row.sequence),
                        }}
                        details={() => setVersionSequence(row.sequence)}
                        detailLabel={t("查看详情")}
                        menuLabel={`${row.version} · ${t("更多操作")}`}
                        actions={[
                          {
                            id: "restore",
                            label: t("恢复"),
                            icon: RotateCcw,
                            disabled: !canManage || restoreVersion.isPending,
                            onSelect: () => openRestoration(row.sequence),
                          },
                        ]}
                      />
                    ),
                  },
                ]}
              />
            </ListSection>
          </QueryState>
        </RecordDetailLayout>
      )}

      {versionPage && (
        <RecordDetailLayout
          title={t("价格版本详情") + (versionSequence ? " · v" + versionSequence : "")}
          onBack={() => setVersionSequence(undefined)}
          header={
            <CorePage
              children={null}
              title={t("价格版本详情") + (versionSequence ? " · v" + versionSequence : "")}
              actions={[
                {
                  id: "back-price-versions",
                  kind: "navigate",
                  label: { default: t("返回列表") },
                  slot: "navigation",
                  permissions: RENTAL_COMMERCIAL_ACCESS,
                  icon: <ArrowLeftOutlined />,
                  to: {
                    coreId: RENTAL_COMMERCIAL_CORE_ID,
                    pageId: RENTAL_COMMERCIAL_PAGES.pricingVersions.id,
                  },
                },
              ]}
            />
          }
          facts={
            versionDetail.data && !versionDetail.isError
              ? [
                  {
                    key: "effective",
                    label: "生效时间",
                    value: dayjs(versionDetail.data.effectiveFrom).format("YYYY-MM-DD HH:mm"),
                  },
                  { key: "created", label: "创建人", value: versionDetail.data.createdBy || "—" },
                  {
                    key: "reason",
                    label: "变更原因",
                    value: versionDetail.data.changeReason || "—",
                    wide: true,
                  },
                ]
              : undefined
          }
        >
          {!versionSequence ? (
            <Alert type="error" showIcon title={t("价格版本无效")} />
          ) : (
            <QueryState
              loading={versionDetail.isLoading || previousVersion.isLoading || settings.isLoading}
              error={versionDetail.error ?? previousVersion.error ?? settings.error}
              onRetry={() =>
                Promise.all([
                  versionDetail.refetch({ throwOnError: true }),
                  settings.refetch({ throwOnError: true }),
                  ...(versionSequence > 1 ? [previousVersion.refetch({ throwOnError: true })] : []),
                ])
              }
            >
              <ListSection title={t("价格对比")}>
                <Table
                  toolbarNote={
                    <span className="muted">
                      {versionSequence && versionSequence > 1
                        ? locale === "en-US"
                          ? `Compared with v${versionSequence - 1}`
                          : `对比 v${versionSequence - 1}`
                        : t("首个价格版本")}
                    </span>
                  }
                  rowKey={pricingRateKey}
                  loading={versionDetail.isLoading || previousVersion.isLoading}
                  refreshing={versionDetail.isFetching || previousVersion.isFetching}
                  onRefresh={() =>
                    Promise.all([
                      versionDetail.refetch({ throwOnError: true }),
                      ...(versionSequence && versionSequence > 1
                        ? [previousVersion.refetch({ throwOnError: true })]
                        : []),
                    ])
                  }
                  dataSource={versionDetail.data?.rates ?? []}
                  columns={[
                    {
                      title: t("定价分组"),
                      render: (_, row) => (
                        <DataTableText
                          primary={row.pricingGroupName ?? row.itemGroupName}
                          secondary={row.pricingGroupCode ?? row.itemGroupCode}
                        />
                      ),
                    },
                    {
                      title: t("计价单位"),
                      dataIndex: "unit",
                      render: (value) => t(unitLabels[value as keyof typeof unitLabels] ?? value),
                    },
                    {
                      title: t("上一版基础价"),
                      align: "right",
                      render: (_, row) => {
                        const before = previousVersion.data?.rates.find(
                          (item) => pricingRateKey(item) === pricingRateKey(row),
                        )?.baseAmount;
                        return before === undefined ? "—" : <DataTableMoney formatted={money(before)} />;
                      },
                    },
                    {
                      title: t("本版基础价"),
                      dataIndex: "baseAmount",
                      align: "right",
                      render: (value) => <DataTableMoney formatted={money(value)} />,
                    },
                    {
                      title: t("变化"),
                      render: (_, row) => {
                        const before = previousVersion.data?.rates.find(
                          (item) => pricingRateKey(item) === pricingRateKey(row),
                        )?.baseAmount;
                        return before === undefined
                          ? t("新增")
                          : before === row.baseAmount
                            ? t("未变")
                            : `${row.baseAmount - before > 0 ? "+" : ""}${(row.baseAmount - before).toFixed(2)}`;
                      },
                    },
                  ]}
                />
              </ListSection>
            </QueryState>
          )}
        </RecordDetailLayout>
      )}

      <Modal
        title={`${t("恢复价格版本")} v${restoreSequence ?? ""}`}
        open={restoreDialog.visible}
        onCancel={dismissRestore}
        afterClose={restoreDialog.afterClose}
        destroyOnHidden
        closable={!restoreVersion.isPending}
        keyboard={!restoreVersion.isPending}
        mask={{ closable: !restoreVersion.isPending }}
        footer={
          <>
            <Button disabled={restoreVersion.isPending} onClick={dismissRestore}>
              {t("取消")}
            </Button>
            <ActionButton
              label={t("生成恢复版本")}
              disabled={restoreSequence === undefined || !restoreReason.trim()}
              pending={restoreVersion.isPending}
              onAction={() =>
                restoreSequence !== undefined && restoreReason.trim()
                  ? restoreVersion.mutateAsync({ sequence: restoreSequence, reason: restoreReason.trim() })
                  : Promise.reject(new Error("Operation unavailable"))
              }
            />
          </>
        }
      >
        <Alert
          type="warning"
          showIcon
          title={t("不会修改或删除历史版本，而是以旧快照追加一个新的当前版本。")}
          style={{ marginBottom: 12 }}
        />
        <Form layout="vertical" name="restore-price-version" disabled={restoreVersion.isPending}>
          <Form.Item label={t("恢复原因")} htmlFor="restore-price-reason">
            <Input.TextArea
              id="restore-price-reason"
              rows={3}
              value={restoreReason}
              onChange={(event) => setRestoreReason(event.target.value)}
              placeholder={t("请填写恢复原因")}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={t(discountEditor?.id ? "编辑优惠方案" : "新增优惠方案")}
        size={680}
        open={Boolean(discountEditor)}
        destroyOnHidden
        onClose={dismissDiscount}
        keyboard={!saveDiscount.isPending}
        maskClosable={!saveDiscount.isPending}
        extra={
          <SaveButton
            label={t("保存新版本")}
            form={boundDiscountForm}
            disabled={discountUnavailable}
            pending={saveDiscount.isPending}
            onSave={discountSubmission.submit}
          />
        }
      >
        <Form<SaveRentalDiscountPlanRequest>
          name="discount-plan"
          form={discountForm}
          layout="vertical"
          disabled={discountUnavailable || saveDiscount.isPending}
          {...discountSubmission.formProps}
          onFinish={discountSubmission.submit}
        >
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="applicableItemGroupIds" hidden>
            <Select mode="multiple" />
          </Form.Item>
          <SettingsWorkspace
            sections={[
              {
                key: "profile",
                label: t("基本资料"),
                content: (
                  <FormSection title={t("方案资料")}>
                    <Row gutter={16}>
                      <Col span={24}>
                        <Form.Item name="name" label={t("方案名称")} rules={[{ required: true }]}>
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="code" label={t("方案编码")} rules={[{ required: true }]}>
                          <Input disabled={Boolean(discountEditor?.id)} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="status" label={t("状态")}>
                          <Select
                            options={[
                              { value: "draft", label: t("草稿") },
                              { value: "enabled", label: t("启用") },
                              { value: "disabled", label: t("停用") },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          name="effectiveFrom"
                          label={t("生效时间")}
                          getValueProps={(value?: string) => ({ value: value ? dayjs(value) : null })}
                          getValueFromEvent={(value: dayjs.Dayjs | null) => value?.toISOString()}
                        >
                          <DatePicker showTime needConfirm style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          name="effectiveTo"
                          label={t("失效时间")}
                          getValueProps={(value?: string) => ({ value: value ? dayjs(value) : null })}
                          getValueFromEvent={(value: dayjs.Dayjs | null) => value?.toISOString()}
                        >
                          <DatePicker
                            showTime
                            needConfirm
                            allowClear
                            placeholder={t("留空表示长期有效")}
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item name="changeReason" label={t("本次变更原因")} rules={[{ required: true }]}>
                      <Input.TextArea rows={3} />
                    </Form.Item>
                  </FormSection>
                ),
              },

              {
                key: "conditions",
                label: t("适用条件"),
                content: (
                  <FormSection title={t("适用条件")}>
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="customerScope" label={t("客户范围")}>
                          <Select
                            options={[
                              { value: "all", label: t("全部客户") },
                              { value: "personal", label: t("个人客户") },
                              { value: "corporate", label: t("企业客户") },
                              { value: "member", label: t("会员") },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="minimumSpend" label={t("最低消费")}>
                          <InputNumber
                            min={0}
                            precision={2}
                            prefix={currencySymbol}
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item
                          name="applicablePricingGroupIds"
                          label={t("适用定价分组")}
                          tooltip={t("留空表示适用于当前经营空间的全部定价分组。")}
                        >
                          <Select
                            mode="multiple"
                            allowClear
                            showSearch={{ optionFilterProp: "label" }}
                            placeholder={t("全部定价分组")}
                            options={(visiblePricingGroups ?? []).map((group) => ({
                              value: group.id,
                              label: `${group.code} · ${group.name}`,
                            }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item
                          name="applicableDayTypes"
                          label={t("适用日期类型")}
                          tooltip={t("留空表示全部日期类型。")}
                        >
                          <Select
                            mode="multiple"
                            allowClear
                            placeholder={t("全部日期类型")}
                            options={[
                              { value: "workday", label: t("工作日") },
                              { value: "weekend", label: t("周末") },
                              { value: "statutory_holiday", label: t("法定节假日") },
                              { value: "makeup_workday", label: t("调休工作日") },
                              { value: "tenant_special", label: t("租户特殊日") },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  </FormSection>
                ),
              },

              {
                key: "discount",
                label: t("优惠设置"),
                content: (
                  <FormSection title={t("优惠设置")}>
                    <Row gutter={16}>
                      <Col span={8}>
                        <Form.Item name="discountType" label={t("优惠类型")}>
                          <Select
                            options={[
                              { value: "percentage", label: t("百分比减免") },
                              { value: "fixed_amount", label: t("固定减免") },
                              { value: "threshold_amount", label: t("满额固定减免") },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          name="appliesTo"
                          label={t("作用费用")}
                          tooltip={t("押金、预授权与异常费用不可被普通优惠减免。")}
                        >
                          <Select
                            options={[
                              { value: "rental", label: t("租金与使用量") },
                              { value: "fulfillment", label: t("履约费用") },
                              { value: "service", label: t("增值服务") },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          name="discountValue"
                          label={t(discountType === "percentage" ? "减免比例（%）" : "减免金额")}
                          rules={[{ required: true }]}
                        >
                          <InputNumber
                            min={0}
                            max={discountType === "percentage" ? 100 : undefined}
                            precision={2}
                            suffix={discountType === "percentage" ? "%" : undefined}
                            prefix={discountType === "percentage" ? undefined : currencySymbol}
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                      </Col>
                      {discountType === "threshold_amount" ? (
                        <Col span={12}>
                          <Form.Item
                            name="thresholdAmount"
                            label={t("满减门槛")}
                            rules={[{ required: true }]}
                          >
                            <InputNumber
                              min={0}
                              precision={2}
                              prefix={currencySymbol}
                              style={{ width: "100%" }}
                            />
                          </Form.Item>
                        </Col>
                      ) : null}
                      {discountType === "percentage" ? (
                        <Col span={12}>
                          <Form.Item name="maximumDiscount" label={t("最高减免金额")}>
                            <InputNumber
                              min={0}
                              precision={2}
                              prefix={currencySymbol}
                              style={{ width: "100%" }}
                            />
                          </Form.Item>
                        </Col>
                      ) : null}
                    </Row>
                  </FormSection>
                ),
              },

              {
                key: "stacking",
                label: t("互斥与叠加"),
                content: (
                  <FormSection title={t("互斥与叠加")}>
                    <Row gutter={16}>
                      <Col span={8}>
                        <Form.Item
                          name="exclusiveGroup"
                          label={t("互斥组")}
                          tooltip={t("同组仅应用实际减免最大的方案；留空表示独立分组。")}
                        >
                          <Input allowClear placeholder={t("例如：会员折扣")} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="priority" label={t("同额优先级")}>
                          <InputNumber min={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="stackableWithOtherPlans" label={t("与其他方案叠加")}>
                          <Select
                            options={[
                              { value: true, label: t("允许") },
                              { value: false, label: t("不允许") },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="stackableWithCoupon" label={t("与优惠券叠加")}>
                          <Select
                            options={[
                              { value: true, label: t("允许") },
                              { value: false, label: t("不允许") },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  </FormSection>
                ),
              },
            ]}
          />
        </Form>
      </Drawer>

      <Modal
        presentation="side"
        title={t(serviceEditor?.id ? "编辑增值服务" : "新增增值服务")}
        width={680}
        open={serviceDialog.visible}
        destroyOnHidden
        onCancel={dismissService}
        afterClose={serviceDialog.afterClose}
        closable={!saveService.isPending}
        keyboard={!saveService.isPending}
        mask={{ closable: !saveService.isPending }}
        footer={
          <>
            <Button disabled={saveService.isPending} onClick={dismissService}>
              {t("取消")}
            </Button>
            <SaveButton
              label={t("保存服务")}
              form={boundServiceForm}
              disabled={serviceUnavailable}
              pending={saveService.isPending}
              onSave={serviceSubmission.submit}
            />
          </>
        }
      >
        <Form<SaveRentalValueAddedServiceRequest>
          name="value-added-service"
          form={serviceForm}
          layout="vertical"
          disabled={serviceUnavailable || saveService.isPending}
          {...serviceSubmission.formProps}
          onFinish={serviceSubmission.submit}
        >
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <SettingsWorkspace
            sections={[
              {
                key: "pricing",
                label: locale === "en-US" ? t("价格") : t("服务与计价"),
                content: (
                  <div>
                    <Row gutter={16}>
                      <Col span={24}>
                        <Form.Item
                          name="name"
                          label={t("服务名称")}
                          rules={[{ required: true, whitespace: true }]}
                        >
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          name="code"
                          label={t("服务编码")}
                          rules={[{ required: true, whitespace: true }]}
                        >
                          <Input
                            disabled={
                              Boolean(serviceEditor?.id) || serviceUnavailable || saveService.isPending
                            }
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="status" label={t("状态")} rules={[{ required: true }]}>
                          <Select
                            options={[
                              { value: "enabled", label: t("启用") },
                              { value: "disabled", label: t("停用") },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="serviceType" label={t("服务类型")} rules={[{ required: true }]}>
                          <Select
                            options={Object.entries(serviceTypeLabels).map(([value, label]) => ({
                              value,
                              label: t(label),
                            }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="billingUnit" label={t("计费方式")} rules={[{ required: true }]}>
                          <Select
                            options={[
                              { value: "per_order", label: t("每订单") },
                              { value: "per_unit", label: t("每份/每件") },
                              { value: "per_day", label: t("每自然日") },
                              { value: "per_night", label: t("每晚") },
                              { value: "per_hour", label: t("每小时") },
                              { value: "per_rental_period", label: t("每租期") },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="price" label={t("价格")} rules={[{ required: true }]}>
                          <InputNumber
                            min={0}
                            precision={2}
                            prefix={currencySymbol}
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="minimumQuantity" label={t("最小数量")} rules={[{ required: true }]}>
                          <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="maximumQuantity" label={t("最大数量")} rules={[{ required: true }]}>
                          <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </div>
                ),
              },
              {
                key: "conditions",
                label: t("适用条件"),
                content: (
                  <div>
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="customerScope" label={t("适用客户")} rules={[{ required: true }]}>
                          <Select
                            options={[
                              { value: "all", label: t("全部") },
                              { value: "personal", label: t("个人") },
                              { value: "corporate", label: t("企业") },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="selectionMode" label={t("选择方式")} rules={[{ required: true }]}>
                          <Select
                            options={[
                              { value: "optional", label: t("客户可选") },
                              { value: "recommended", label: t("系统推荐") },
                              { value: "mandatory", label: t("条件强制") },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="requiresCapacity" label={t("需要容量预留")} valuePropName="checked">
                          <Switch />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item name="applicableItemGroupIds" label={t("适用商品（空为全部）")}>
                      <Select
                        mode="multiple"
                        options={(visibleGroups ?? []).map((group) => ({
                          value: group.id,
                          label: group.name,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item name="applicableFulfillmentModes" label={t("适用履约方式（空为全部）")}>
                      <Select
                        mode="multiple"
                        options={(visibleSettings?.fulfillment.enabledModes ?? []).map((value) => ({
                          value,
                          label: t(
                            value === "delivery"
                              ? (visibleProfile?.terminology.deliveryLabel ?? fulfillmentModeLabels[value])
                              : (fulfillmentModeLabels[value] ?? value),
                          ),
                        }))}
                      />
                    </Form.Item>
                    <Form.Item name="applicableLocationIds" label={t("适用地点（空为全部）")}>
                      <Select
                        mode="multiple"
                        options={(visibleLocations ?? []).map((row) => ({ value: row.id, label: row.name }))}
                      />
                    </Form.Item>
                    <Form.Item
                      noStyle
                      shouldUpdate={(previous, current) => previous.selectionMode !== current.selectionMode}
                    >
                      {({ getFieldValue }) =>
                        getFieldValue("selectionMode") === "mandatory" ? (
                          <FormSection title={t("条件强制触发规则")}>
                            <Form.Item name={["mandatoryRule", "itemGroupIds"]} label={t("命中商品")}>
                              <Select
                                mode="multiple"
                                options={(visibleGroups ?? []).map((row) => ({
                                  value: row.id,
                                  label: row.name,
                                }))}
                              />
                            </Form.Item>
                            <Form.Item name={["mandatoryRule", "fulfillmentModes"]} label={t("命中履约方式")}>
                              <Select
                                mode="multiple"
                                options={(visibleSettings?.fulfillment.enabledModes ?? []).map((value) => ({
                                  value,
                                  label: t(
                                    value === "delivery"
                                      ? (visibleProfile?.terminology.deliveryLabel ??
                                          fulfillmentModeLabels[value])
                                      : (fulfillmentModeLabels[value] ?? value),
                                  ),
                                }))}
                              />
                            </Form.Item>
                            <Form.Item name={["mandatoryRule", "minRentalAmount"]} label={t("最低租金")}>
                              <InputNumber min={0} precision={2} style={{ width: "100%" }} />
                            </Form.Item>
                          </FormSection>
                        ) : null
                      }
                    </Form.Item>
                  </div>
                ),
              },
              {
                key: "terms",
                label: locale === "en-US" ? t("条款") : t("保障与条款"),
                content: (
                  <div>
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="coverageLimit" label={t("保障限额")}>
                          <InputNumber min={0} prefix={currencySymbol} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="deductible" label={t("免赔额")}>
                          <InputNumber min={0} prefix={currencySymbol} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item
                      noStyle
                      shouldUpdate={(previous, current) => previous.serviceType !== current.serviceType}
                    >
                      {({ getFieldValue }) =>
                        getFieldValue("serviceType") === "insurance" ? (
                          <Row gutter={12}>
                            <Col span={12}>
                              <Form.Item name="insuranceProviderStatus" label={t("保险接入状态")}>
                                <Select
                                  options={[
                                    { value: "simulated", label: t("模拟") },
                                    { value: "reserved", label: t("预留能力") },
                                  ]}
                                />
                              </Form.Item>
                            </Col>
                            <Col span={12}>
                              <Form.Item name="insuranceProviderName" label={t("服务商名称")}>
                                <Input />
                              </Form.Item>
                            </Col>
                          </Row>
                        ) : null
                      }
                    </Form.Item>
                    <Form.Item
                      name="termsVersion"
                      label={t("条款版本")}
                      rules={[{ required: true, whitespace: true }]}
                    >
                      <Input />
                    </Form.Item>
                    <Form.Item name="terms" label={t("服务/保障条款")} rules={[{ required: true }]}>
                      <Input.TextArea rows={6} />
                    </Form.Item>
                  </div>
                ),
              },
            ]}
          />
        </Form>
      </Modal>
      <Modal
        presentation="side"
        title={`${capacityService?.name ?? t("服务")} · ${t("容量窗口")}`}
        width={760}
        open={capacityDialog.visible}
        onCancel={dismissCapacityService}
        afterClose={capacityDialog.afterClose}
        destroyOnHidden
        closable={!saveCapacity.isPending}
        keyboard={!saveCapacity.isPending}
        mask={{ closable: !saveCapacity.isPending }}
        footer={
          <>
            <Button disabled={saveCapacity.isPending} onClick={dismissCapacityService}>
              {t("关闭")}
            </Button>
            <Button
              type="primary"
              disabled={capacityUnavailable || saveCapacity.isPending}
              icon={<PlusOutlined />}
              onClick={() => editCapacity()}
            >
              {t("新增容量窗口")}
            </Button>
          </>
        }
      >
        <Alert
          type="info"
          showIcon
          title={t("报价只检查容量；订单创建后预留，确认后锁定，取消或超时释放。")}
          style={{ marginBottom: 16 }}
        />
        <QueryState
          loading={capacities.isLoading}
          error={capacities.error}
          onRetry={() => refreshCapacities(true)}
        >
          <Table<RentalServiceCapacity>
            rowKey="id"
            onRefresh={() => refreshCapacities()}
            loading={capacities.isLoading}
            refreshing={capacities.isFetching}
            dataSource={visibleCapacities ?? []}
            columns={[
              {
                title: t("地点"),
                dataIndex: "locationId",
                render: (value) => (
                  <DataTableText
                    primary={visibleLocations?.find((row) => row.id === value)?.name ?? value}
                    secondary={visibleLocations?.some((row) => row.id === value)
                      ? undefined
                      : locale === "en-US"
                        ? (!canReadLocations() ? "Location access is restricted" : "Location details unavailable")
                        : t(!canReadLocations() ? "地点资料读取受限" : "未提供地点资料")}
                  />
                ),
              },
              {
                title: t("开始"),
                dataIndex: "windowStart",
                render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm"),
              },
              {
                title: t("结束"),
                dataIndex: "windowEnd",
                render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm"),
              },
              { title: t("总量"), dataIndex: "totalCapacity" },
              { title: t("已预留"), dataIndex: "reservedQuantity" },
              { title: t("已确认/使用"), dataIndex: "usedQuantity" },
              {
                title: t("状态"),
                dataIndex: "status",
                render: (value) => (
                  <Tag color={value === "enabled" ? "success" : "default"}>
                    {t(value === "enabled" ? "已启用" : value === "disabled" ? "已停用" : value)}
                  </Tag>
                ),
              },
              {
                title: t("操作"),
                render: (_, row) => (
                  <Button
                    type="link"
                    disabled={capacityUnavailable || saveCapacity.isPending}
                    onClick={() => editCapacity(row)}
                  >
                    {t("编辑")}
                  </Button>
                ),
              },
            ]}
          />
        </QueryState>
      </Modal>
      <Modal
        title={t(capacityEditor?.id ? "编辑容量窗口" : "新增容量窗口")}
        open={capacityEditorDialog.visible}
        onCancel={dismissCapacity}
        afterClose={capacityEditorDialog.afterClose}
        closable={!saveCapacity.isPending}
        keyboard={!saveCapacity.isPending}
        mask={{ closable: !saveCapacity.isPending }}
        footer={
          <>
            <Button disabled={saveCapacity.isPending} onClick={dismissCapacity}>
              {t("取消")}
            </Button>
            <SaveButton
              label={t("保存")}
              form={boundCapacityForm}
              disabled={capacityUnavailable}
              pending={saveCapacity.isPending}
              onSave={capacitySubmission.submit}
            />
          </>
        }
        destroyOnHidden
      >
        <Form
          name="service-capacity"
          form={capacityForm}
          layout="vertical"
          disabled={capacityUnavailable || saveCapacity.isPending}
          {...capacitySubmission.formProps}
          onFinish={capacitySubmission.submit}
        >
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="serviceId" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="locationId" label={t("服务地点")} rules={[{ required: true }]}>
            <Select options={(visibleLocations ?? []).map((row) => ({ value: row.id, label: row.name }))} />
          </Form.Item>
          <Form.Item name="window" label={t("可服务时段")} rules={[{ required: true }]}>
            <DatePicker.RangePicker showTime style={{ width: "100%" }} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="totalCapacity" label={t("同时服务数量")} rules={[{ required: true }]}>
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label={t("状态")} rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: "enabled", label: t("启用") },
                    { value: "disabled", label: t("停用") },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
}
