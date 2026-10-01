import { EditOutlined, HistoryOutlined, PlusOutlined } from "@ant-design/icons";
import { RENTAL_PRICING_UNIT_LABELS, formatRentalMoney, rentalCurrencySymbol } from "@rental-os/shared";
import type { CreateRentalPriceAdjustmentRequest, RentalDiscountPlan, RentalPriceAdjustmentPreviewRow, RentalPricingGroup, RentalPricingPlanV1, RentalServiceCapacity, RentalValueAddedService, SaveRentalDiscountPlanRequest, SaveRentalServiceCapacityRequest, SaveRentalValueAddedServiceRequest } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Card, Col, InputNumber, Modal, Popconfirm, Row, Space, Tag, Typography } from "antd";
import { Form } from "@/components/ui";
import { Alert, DatePicker, Table } from "@/components/ui";
import { Switch } from "@/components/ui";
import { Input } from "@/components/ui";
import { Button, Drawer, Select } from "@/components/ui";
import dayjs from "dayjs";
import { useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { usePriceVersions } from "./usePriceVersions";

export type RentalCommercialSection = "pricing" | "discounts" | "services";

const unitLabels = RENTAL_PRICING_UNIT_LABELS;
const pricingRateKey = (rate: { pricingGroupId?: string; itemGroupId: string; unit: string }) => `${rate.pricingGroupId ?? rate.itemGroupId}:${rate.unit}`;
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

export function RentalCommercialPage({ section }: { section: RentalCommercialSection }) {
  const { message } = App.useApp();
  const { locale, t } = useLocale();
  const queryClient = useQueryClient();
  const [adjustmentPlan, setAdjustmentPlan] = useState<RentalPricingPlanV1 | null>();
  const [adjustmentPreview, setAdjustmentPreview] = useState<RentalPriceAdjustmentPreviewRow[]>([]);
  const [createdAdjustmentId, setCreatedAdjustmentId] = useState<string>();
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionSequence, setVersionSequence] = useState<number>();
  const [restoreSequence, setRestoreSequence] = useState<number>();
  const [restoreReason, setRestoreReason] = useState("");
  const [cancelAdjustmentId, setCancelAdjustmentId] = useState<string>();
  const [cancelReason, setCancelReason] = useState("");
  const [discountEditor, setDiscountEditor] = useState<RentalDiscountPlan | null>();
  const [serviceEditor, setServiceEditor] = useState<RentalValueAddedService | null>();
  const [capacityService, setCapacityService] = useState<RentalValueAddedService | null>();
  const [capacityEditor, setCapacityEditor] = useState<RentalServiceCapacity | null>();
  const [adjustmentForm] = Form.useForm<CreateRentalPriceAdjustmentRequest & { scheduledAtValue?: dayjs.Dayjs }>();
  const [discountForm] = Form.useForm<SaveRentalDiscountPlanRequest>();
  const discountType = Form.useWatch("discountType", discountForm);
  const [serviceForm] = Form.useForm<SaveRentalValueAddedServiceRequest>();
  const [capacityForm] = Form.useForm<SaveRentalServiceCapacityRequest & { window?: [dayjs.Dayjs, dayjs.Dayjs] }>();
  const profile = useQuery({
    queryKey: ["rental-core", "profile"],
    queryFn: rentalCoreApi.profile,
  });
  const settings = useQuery({
    queryKey: ["rental-core", "business-settings"],
    queryFn: rentalCoreApi.businessSettings,
  });
  const currency = settings.data?.pricing.currency;
  const money = (value: number | undefined) => formatRentalMoney(Number(value ?? 0), currency);
  const currencySymbol = rentalCurrencySymbol(currency);
  const groups = useQuery({
    queryKey: ["rental-core", "groups"],
    queryFn: rentalCoreApi.itemGroups,
  });
  const pricingGroups = useQuery({
    queryKey: ["rental-core", "pricing-groups"],
    queryFn: rentalCoreApi.pricingGroups,
  });
  // 三个分区各自只取自己要展示的数据：别的分区打开时不发这些请求。
  const pricing = useQuery({
    queryKey: ["rental-core", "pricing-plans"],
    queryFn: rentalCoreApi.pricingPlans,
    enabled: section === "pricing",
  });
  const discounts = useQuery({
    queryKey: ["rental-core", "discount-plans"],
    queryFn: rentalCoreApi.discountPlans,
    enabled: section === "discounts",
  });
  const locations = useQuery({
    queryKey: ["rental-core", "locations"],
    queryFn: rentalCoreApi.locations,
  });
  const services = useQuery({
    queryKey: ["rental-core", "value-added-services"],
    queryFn: rentalCoreApi.valueAddedServices,
    enabled: section === "services",
  });
  const capacities = useQuery({
    queryKey: ["rental-core", "service-capacities", capacityService?.id],
    queryFn: () => rentalCoreApi.serviceCapacities(capacityService!.id),
    enabled: Boolean(capacityService?.id),
  });
  // 价格版本与定价分组页共用同一个 hook（同一组查询键、同一个「当前版本」判据）。
  // 版本明细只有价格页需要；版本抽屉在别的分区打开时只需要列表。
  const { versions, currentVersion: currentPriceVersion, currentVersionDetail: currentPriceVersionDetail } = usePriceVersions({
    enabled: section === "pricing" || versionsOpen,
    detailEnabled: section === "pricing",
  });
  const versionDetail = useQuery({
    queryKey: ["rental-core", "price-version", versionSequence],
    queryFn: () => rentalCoreApi.priceVersion(versionSequence!),
    enabled: versionSequence !== undefined,
  });
  const previousVersion = useQuery({
    queryKey: ["rental-core", "price-version", versionSequence ? versionSequence - 1 : undefined],
    queryFn: () => rentalCoreApi.priceVersion(versionSequence! - 1),
    enabled: versionSequence !== undefined && versionSequence > 1,
  });
  const adjustments = useQuery({
    queryKey: ["rental-core", "price-adjustments"],
    queryFn: rentalCoreApi.priceAdjustments,
    enabled: section === "pricing",
  });
  const createAdjustment = useMutation({
    mutationFn: (values: CreateRentalPriceAdjustmentRequest & { scheduledAtValue?: dayjs.Dayjs }) => {
      const { scheduledAtValue, ...request } = values;
      return rentalCoreApi.createPriceAdjustment({
        ...request,
        scheduledAt: scheduledAtValue?.toISOString(),
      });
    },
    onSuccess: async (result) => {
      setAdjustmentPreview(result.preview);
      setCreatedAdjustmentId(result.id);
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "price-adjustments"] });
      message.success(t("调价计划草稿已创建，请核对最终价后确认"));
    },
    onError: () => message.error(t("创建调价计划失败，请检查时间线、范围与调价值")),
  });
  const confirmAdjustment = useMutation({
    mutationFn: (id: string) => rentalCoreApi.confirmPriceAdjustment(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "price-adjustments"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "pricing-plans"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "price-versions"] }),
      ]);
      message.success(t("调价计划已确认"));
      setAdjustmentPlan(null);
      setAdjustmentPreview([]);
      setCreatedAdjustmentId(undefined);
    },
    onError: () => message.error(t("确认失败：请检查是否存在待生效调价或未来价格版本")),
  });
  const cancelAdjustment = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rentalCoreApi.cancelPriceAdjustment(id, { reason }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "price-adjustments"] });
      setCancelAdjustmentId(undefined);
      setCancelReason("");
      message.success(t("调价计划已取消"));
    },
  });
  const restoreVersion = useMutation({
    mutationFn: ({ sequence, reason }: { sequence: number; reason: string }) => rentalCoreApi.restorePriceVersion(sequence, { reason }),
    onSuccess: async (result) => {
      setRestoreSequence(undefined);
      setRestoreReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "price-versions"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "pricing-plans"] }),
      ]);
      message.success(locale === "en-US" ? `Created version ${result.version} from ${result.restoredFromVersion}` : `已基于 ${result.restoredFromVersion} 生成新版本 ${result.version}`);
    },
    onError: () => message.error(t("恢复失败：请检查未来版本、待生效调价或价格行结构变化")),
  });
  const saveDiscount = useMutation({
    mutationFn: rentalCoreApi.saveDiscountPlan,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "discount-plans"],
      });
      setDiscountEditor(null);
      discountForm.resetFields();
      message.success(t("优惠方案新版本已保存"));
    },
    onError: () => message.error(t("保存失败，请检查优惠范围、有效期和叠加规则")),
  });
  const saveService = useMutation({
    mutationFn: rentalCoreApi.saveValueAddedService,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "value-added-services"],
      });
      setServiceEditor(null);
      serviceForm.resetFields();
      message.success(t("增值服务及条款版本已保存"));
    },
    onError: () => message.error(t("保存失败，请检查服务条款、价格和适用商品")),
  });
  const saveCapacity = useMutation({
    mutationFn: (values: SaveRentalServiceCapacityRequest & { window?: [dayjs.Dayjs, dayjs.Dayjs] }) => {
      const { window, ...rest } = values;
      return rentalCoreApi.saveServiceCapacity({
        ...rest,
        serviceId: capacityService!.id,
        windowStart: window?.[0].toISOString() ?? rest.windowStart,
        windowEnd: window?.[1].toISOString() ?? rest.windowEnd,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "service-capacities", capacityService?.id] });
      setCapacityEditor(null);
      capacityForm.resetFields();
      message.success(t("服务容量窗口已保存"));
    },
    onError: () => message.error(t("保存失败，请检查时段是否重叠及容量是否小于已占用数量")),
  });

  function openAdjustment() {
    const record = enabledPlans[0];
    if (!record || !currentPriceVersionDetail.data?.rates.length) return;
    setAdjustmentPreview([]);
    setCreatedAdjustmentId(undefined);
    adjustmentForm.setFieldsValue({
      code: `ADJ-${dayjs().format("YYYYMMDD-HHmm")}`,
      name: `${dayjs().format("YYYY-MM-DD")} 统一调价`,
      changeReason: "经营价格调整",
      changes: currentPriceVersionDetail.data.rates.map((rate) => ({
        pricingGroupId: rate.pricingGroupId ?? rate.itemGroupId,
        itemGroupId: rate.pricingGroupId ?? rate.itemGroupId,
        unit: rate.unit,
        op: "set_base",
        value: rate.baseAmount
      })),
    });
    setAdjustmentPlan(record);
  }

  function submitAdjustment(values: CreateRentalPriceAdjustmentRequest & { scheduledAtValue?: dayjs.Dayjs }) {
    const currentByKey = new Map((currentPriceVersionDetail.data?.rates ?? []).map((rate) => [pricingRateKey(rate), rate.baseAmount]));
    const changes = values.changes.filter((change) => {
      const key = `${change.pricingGroupId ?? change.itemGroupId}:${change.unit}`;
      return Number(change.value) !== currentByKey.get(key);
    });
    if (!changes.length) {
      message.warning(t("价格没有变化，请先填写至少一个新的价格"));
      return;
    }
    createAdjustment.mutate({ ...values, changes });
  }

  function editDiscount(record?: RentalDiscountPlan) {
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
    setDiscountEditor(record ?? ({} as RentalDiscountPlan));
  }

  function editService(record?: RentalValueAddedService) {
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
    setServiceEditor(record ?? ({} as RentalValueAddedService));
  }

  function editCapacity(record?: RentalServiceCapacity) {
    capacityForm.setFieldsValue(record
      ? { ...record, window: [dayjs(record.windowStart), dayjs(record.windowEnd)] }
      : {
          serviceId: capacityService!.id,
          locationId: locations.data?.[0]?.id,
          totalCapacity: 1,
          status: "enabled",
        });
    setCapacityEditor(record ?? ({} as RentalServiceCapacity));
  }

  const sectionTitle = t(section === "pricing" ? "价格版本与调价" : section === "discounts" ? "优惠方案" : "增值服务");
  const sectionDescription = t(section === "pricing" ? "查看当前经营空间整体价格版本与各定价分组的当前基础价；已有价格只能通过调价计划变更。" : section === "discounts" ? "在基础价格之上配置自动优惠、客户范围、日期范围与优惠券叠加规则。" : "维护配送、保险、损坏免赔等可选服务，并对保障条款进行版本化。");
  const enabledPlans = [...(pricing.data ?? [])].filter((plan) => plan.status === "enabled").sort((left, right) => new Date(right.effectiveFrom).getTime() - new Date(left.effectiveFrom).getTime());
  const currentPricingRows: Array<{ group: RentalPricingGroup; rate?: RentalPricingPlanV1["rates"][number] }> = (pricingGroups.data ?? []).flatMap((group): Array<{ group: RentalPricingGroup; rate?: RentalPricingPlanV1["rates"][number] }> => {
    const rates = currentPriceVersionDetail.data?.rates.filter((item) => (item.pricingGroupId ?? item.itemGroupId) === group.id) ?? [];
    return rates.length ? rates.map((rate) => ({ group, rate })) : [{ group, rate: undefined }];
  });
  const unpricedCount = new Set(currentPricingRows.filter((row) => row.group.status === "enabled" && !row.rate).map((row) => row.group.id)).size;
  const priceMatrixReady = !versions.isLoading && (!currentPriceVersion || currentPriceVersionDetail.isSuccess);

  return (
    <>
      <PageHeader
        title={sectionTitle}
        description={sectionDescription}
        extra={
          <Space>
            {section === "pricing" && <Button icon={<HistoryOutlined />} onClick={() => setVersionsOpen(true)}>{t("价格版本")}</Button>}
            {section === "pricing" ? (
              <Button type="primary" icon={<PlusOutlined />} disabled={!priceMatrixReady || unpricedCount > 0 || !currentPriceVersion} onClick={openAdjustment}>{t("新增调价计划")}</Button>
            ) : <Button type="primary" icon={<PlusOutlined />} onClick={() => section === "discounts" ? editDiscount() : editService()}>{locale === "en-US" ? `Add ${sectionTitle}` : `新增${sectionTitle}`}</Button>}
          </Space>
        }
      />
      <div className="context-note">
        <span>
          {locale === "en-US" ? `${t(profile.data?.terminology.itemLabel ?? "商品")} pricing groups` : `${profile.data?.terminology.itemLabel ?? "商品"}定价分组`} · {profile.data?.categoryCode ?? "-"}
        </span>
        <span>{t("订单只能引用服务端报价快照，前端不能直接决定成交单价。")}</span>
      </div>
      {section === "pricing" && (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Alert type="info" showIcon title={t("新增型号价格请在「定价分组」内录入；本页只查看空间整体价格版本并创建调价计划。")} />
          <Alert
            type="info"
            showIcon
            title={versions.isLoading ? t("正在读取当前整体价格版本") : currentPriceVersion ? (locale === "en-US" ? `Current overall price version: ${currentPriceVersion.version}` : `当前整体价格版本：${currentPriceVersion.version}`) : t("当前还没有生效的整体价格版本")}
            description={versions.isLoading ? "" : currentPriceVersion ? (locale === "en-US" ? `Effective ${dayjs(currentPriceVersion.effectiveFrom).format("YYYY-MM-DD HH:mm")}; ${currentPriceVersion.rateCount} rates cover all active pricing groups in this workspace. New orders store this version snapshot; historical orders do not change.` : `生效于 ${dayjs(currentPriceVersion.effectiveFrom).format("YYYY-MM-DD HH:mm")}，包含当前经营空间全部有效定价分组价格，共 ${currentPriceVersion.rateCount} 条；新订单保存此整体版本快照，历史订单不随调价变化。`) : t("请先到定价分组页面新建分组并填写基本价。")}
            action={<Button type="link" onClick={() => setVersionsOpen(true)}>{t("查看历史版本")}</Button>}
          />
          <Card
          className="data-panel"
          title={
            <Space>
              <span>{t("当前基础价格")}</span>
              <Tag>{currentPricingRows.length}</Tag>
            </Space>
          }
        >
          <QueryState loading={pricing.isLoading || pricingGroups.isLoading || versions.isLoading || currentPriceVersionDetail.isLoading} error={pricing.error || pricingGroups.error || versions.error || currentPriceVersionDetail.error}>
            <Table<{ group: RentalPricingGroup; rate?: RentalPricingPlanV1["rates"][number] }>
              rowKey={(row) => `${row.group.id}:${row.rate?.unit ?? "unpriced"}`}
              dataSource={currentPricingRows}
              columns={[
                {
                  title: t("定价分组"),
                  render: (_, row) => (
                    <>
                      <b>{row.group.name}</b>
                      <br />
                      <span className="muted">{row.group.code} · {row.group.members.map((item) => item.name).join("、")}</span>
                    </>
                  ),
                },
                {
                  title: t("当前基础价"),
                  render: (_, row) => row.rate ? <b>{money(row.rate.baseAmount)}</b> : <Tag color="warning">{t("缺少基本价")}</Tag>,
                },
                {
                  title: t("计价单位"),
                  render: (_, row) => row.rate ? t(unitLabels[row.rate.unit] ?? row.rate.unit) : "-",
                },
              ]}
            />
          </QueryState>
          </Card>
          {unpricedCount > 0 && <Alert type="warning" showIcon title={locale === "en-US" ? `${unpricedCount} legacy groups are missing base prices` : `有 ${unpricedCount} 个历史分组缺少基本价`} description={t("本页不再负责初始化。请停用该历史分组，并在定价分组页按新流程重新建立并填写基本价。")} />}
          <Card title={t("调价计划")} className="data-panel" extra={<Button type="primary" ghost icon={<PlusOutlined />} disabled={unpricedCount > 0 || !currentPriceVersion} onClick={openAdjustment}>{t("新增计划")}</Button>}>
            <Table rowKey="id" loading={adjustments.isLoading} dataSource={adjustments.data ?? []} columns={[
              { title: t("计划"), render: (_, row) => <><b>{row.name}</b><br/><Typography.Text type="secondary">{row.code}</Typography.Text></> },
              { title: t("生效时间"), render: (_, row) => row.scheduledAt ? dayjs(row.scheduledAt).format("YYYY-MM-DD HH:mm") : t("确认后立即") },
              { title: t("调整范围"), render: (_, row) => locale === "en-US" ? `${row.changes.length} price items` : `${row.changes.length} 个价格项` },
              { title: t("状态"), dataIndex: "status", render: (value) => <Tag>{t(adjustmentStatusLabels[value] ?? value)}</Tag> },
              { title: t("原因"), dataIndex: "changeReason" },
              { title: t("操作"), render: (_, row) => row.status === "draft" ? <Space size={0}><Popconfirm title={t("确认后将立即生效或进入待生效，是否继续？")} onConfirm={() => confirmAdjustment.mutate(row.id)}><Button type="link">{t("确认")}</Button></Popconfirm><Button type="link" danger onClick={() => setCancelAdjustmentId(row.id)}>{t("取消")}</Button></Space> : row.status === "pending" ? <Button type="link" danger onClick={() => setCancelAdjustmentId(row.id)}>{t("取消")}</Button> : <Typography.Text type="secondary">—</Typography.Text> },
            ]} />
          </Card>
        </Space>
      )}
      {section === "discounts" && (
        <Card
          className="data-panel"
          title={
            <Space>
              <span>{t("自动优惠方案")}</span>
              <Tag>{discounts.data?.length ?? 0}</Tag>
            </Space>
          }
        >
          <QueryState loading={discounts.isLoading} error={discounts.error}>
            <Table<RentalDiscountPlan>
              rowKey="id"
              dataSource={discounts.data ?? []}
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
                  render: (_, row) => row.discountType === "percentage"
                    ? `${row.discountValue}% ${t("折扣")}${row.maximumDiscount ? (locale === "en-US" ? `, ${t("最高减免")} ${money(row.maximumDiscount)}` : `，最高减 ${money(row.maximumDiscount)}`) : ""}`
                    : row.discountType === "threshold_amount"
                      ? `${t("满")} ${money(row.thresholdAmount)} ${t("减")} ${money(row.discountValue)}`
                      : `${t("减")} ${money(row.discountValue)}`,
                },
                {
                  title: t("适用范围"),
                  render: (_, row) => {
                    const selectedGroups = row.applicablePricingGroupIds?.length
                      ? row.applicablePricingGroupIds.map((id) => pricingGroups.data?.find((group) => group.id === id)?.name ?? t("已删除分组")).join(locale === "en-US" ? ", " : "、")
                      : t("全部定价分组");
                    return <>{t(customerScopeLabels[row.customerScope] ?? row.customerScope)}<br /><span className="muted">{selectedGroups}</span></>;
                  },
                },
                {
                  title: t("互斥与叠加"),
                  render: (_, row) => <>{row.exclusiveGroup ? (locale === "en-US" ? `${t("互斥组")}: ${row.exclusiveGroup}` : `互斥组：${row.exclusiveGroup}`) : t("独立方案")}<br /><span className="muted">{t("其他方案")}：{row.stackableWithOtherPlans ? t("可叠加") : t("不叠加")} · {t("优惠券")}：{row.stackableWithCoupon ? t("可叠加") : t("不叠加")}</span></>,
                },
                {
                  title: t("状态"),
                  dataIndex: "status",
                  render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{t(value === "enabled" ? "启用" : value === "draft" ? "草稿" : "停用")}</Tag>,
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
        </Card>
      )}
      {section === "services" && (
        <Card
          className="data-panel"
          title={
            <Space>
              <span>{t("增值服务及保障")}</span>
              <Tag>{services.data?.length ?? 0}</Tag>
            </Space>
          }
        >
          <QueryState loading={services.isLoading} error={services.error}>
            <Table<RentalValueAddedService>
              rowKey="id"
              dataSource={services.data ?? []}
              columns={[
                {
                  title: t("服务"),
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
                  title: t("类型"),
                  dataIndex: "serviceType",
                  render: (value) => <Tag>{t(serviceTypeLabels[value] ?? value)}</Tag>,
                },
                {
                  title: t("价格"),
                  render: (_, row) => `${money(row.price)} / ${t(billingUnitLabels[row.billingUnit] ?? row.billingUnit)}`,
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
                  render: (value) => <Tag color={value ? "processing" : "default"}>{value ? t("需要预留") : t("无容量限制")}</Tag>,
                },
                {
                  title: t("状态"),
                  dataIndex: "status",
                  render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{t(value)}</Tag>,
                },
                {
                  title: t("操作"),
                  render: (_, row) => (
                    <Space>
                      {row.requiresCapacity && <Button type="link" onClick={() => setCapacityService(row)}>{t("容量窗口")}</Button>}
                      <Button type="link" icon={<EditOutlined />} onClick={() => editService(row)}>
                        {t("编辑")}
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
          </QueryState>
        </Card>
      )}

      <Drawer
        title={t("新增统一调价计划")}
        size={900}
        open={Boolean(adjustmentPlan)}
        destroyOnHidden
        onClose={() => { setAdjustmentPlan(null); setAdjustmentPreview([]); setCreatedAdjustmentId(undefined); adjustmentForm.resetFields(); }}
      >
        <Alert
          type="info"
          showIcon
          title={t("一次计划统一调整当前整体价格")}
          description={t("只修改需要调整的价格，保持不变的项目无需改动。创建后先预览，确认时才会立即生效或进入待生效。")}
          style={{ marginBottom: 16 }}
        />
        <Form form={adjustmentForm} layout="vertical" onFinish={submitAdjustment}>
          <Form.Item name="code" hidden><Input /></Form.Item>
          <Row gutter={12}>
            <Col span={14}><Form.Item name="name" label={t("计划名称")} rules={[{ required: true, message: t("请填写计划名称") }]}><Input placeholder={t("例如：国庆档统一调价")} /></Form.Item></Col>
            <Col span={10}><Form.Item name="scheduledAtValue" label={t("生效时间（留空则确认后立即生效）")}><DatePicker showTime style={{ width: "100%" }} /></Form.Item></Col>
          </Row>
          <Form.List name="changes">
            {(fields) => (
              <Space orientation="vertical" style={{ width: "100%" }}>
                {fields.map((field) => (
                  <Card size="small" key={field.key}>
                    <Row gutter={12} align="middle">
                      <Form.Item name={[field.name, "pricingGroupId"]} hidden><Input /></Form.Item>
                      <Form.Item name={[field.name, "itemGroupId"]} hidden><Input /></Form.Item>
                      <Form.Item name={[field.name, "unit"]} hidden><Input /></Form.Item>
                      <Form.Item name={[field.name, "op"]} hidden><Input /></Form.Item>
                      <Col span={10}><b>{currentPriceVersionDetail.data?.rates[field.name]?.pricingGroupName ?? currentPriceVersionDetail.data?.rates[field.name]?.itemGroupName}</b><br/><Typography.Text type="secondary">{t(unitLabels[currentPriceVersionDetail.data?.rates[field.name]?.unit ?? "calendar_day"])}</Typography.Text></Col>
                      <Col span={6}><Typography.Text type="secondary">{t("当前价")}</Typography.Text><br/><b>{money(currentPriceVersionDetail.data?.rates[field.name]?.baseAmount)}</b></Col>
                      <Col span={8}><Form.Item name={[field.name, "value"]} label={t("调后价格")} rules={[{ required: true, message: t("请填写调后价格") }]} style={{ marginBottom: 0 }}><InputNumber min={0} precision={2} prefix={currencySymbol} style={{ width: "100%" }} /></Form.Item></Col>
                    </Row>
                  </Card>
                ))}
              </Space>
            )}
          </Form.List>
          <Form.Item name="changeReason" label={t("调价原因")} rules={[{ required: true }]} style={{ marginTop: 12 }}><Input.TextArea rows={2} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={createAdjustment.isPending}>{t("创建草稿并预览")}</Button>
        </Form>
        {adjustmentPreview.length > 0 && (
          <Card title={t("本次最终价预览")} size="small" style={{ marginTop: 16 }} extra={createdAdjustmentId && <Popconfirm title={t("确认后将立即生效或进入待生效，是否继续？")} onConfirm={() => confirmAdjustment.mutate(createdAdjustmentId)}><Button type="primary" loading={confirmAdjustment.isPending}>{t("确认计划")}</Button></Popconfirm>}>
            <Table rowKey={(row) => `${row.itemGroupId}:${row.unit}`} pagination={false} dataSource={adjustmentPreview} columns={[
              { title: t("定价分组"), dataIndex: "itemGroupCode" },
              { title: t("计价单位"), dataIndex: "unit", render: (value) => t(unitLabels[value as keyof typeof unitLabels] ?? value) },
              { title: t("调整前"), dataIndex: "beforeBaseAmount", render: money },
              { title: t("调整后"), dataIndex: "afterBaseAmount", render: money },
            ]} />
          </Card>
        )}
      </Drawer>

      <Modal
        title={t("取消调价计划")}
        open={Boolean(cancelAdjustmentId)}
        okText={t("确认取消")}
        okButtonProps={{ danger: true, disabled: !cancelReason.trim(), loading: cancelAdjustment.isPending }}
        onCancel={() => { setCancelAdjustmentId(undefined); setCancelReason(""); }}
        onOk={() => cancelAdjustmentId && cancelAdjustment.mutate({ id: cancelAdjustmentId, reason: cancelReason.trim() })}
      >
        <Input.TextArea rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder={t("请填写取消原因")} />
      </Modal>

      <Drawer title={t("空间价格版本")} size={760} open={versionsOpen} destroyOnHidden onClose={() => setVersionsOpen(false)}>
        <Alert type="info" showIcon title={t("每一版都是该经营空间全部有效商品价格的完整不可变快照")} style={{ marginBottom: 16 }} />
        <Table rowKey="id" loading={versions.isLoading} dataSource={versions.data?.rows ?? []} columns={[
          { title: t("版本"), dataIndex: "version" },
          { title: t("生效时间"), dataIndex: "effectiveFrom" },
          { title: t("价格条目"), dataIndex: "rateCount", render: (value) => locale === "en-US" ? `${value} items` : `${value} 条` },
          { title: t("变更原因"), dataIndex: "changeReason" },
          { title: t("创建人"), dataIndex: "createdBy" },
          { title: t("操作"), render: (_, row) => <Space size={0}><Button type="link" onClick={() => setVersionSequence(row.sequence)}>{t("查看 / 对比")}</Button><Button type="link" onClick={() => setRestoreSequence(row.sequence)}>{t("恢复")}</Button></Space> },
        ]} />
      </Drawer>

      <Drawer title={`${t("价格版本详情")} · v${versionSequence ?? ""}`} size={820} open={versionSequence !== undefined} destroyOnHidden onClose={() => setVersionSequence(undefined)}>
        <Alert type="info" showIcon title={versionSequence && versionSequence > 1 ? (locale === "en-US" ? `Comparing with v${versionSequence - 1}` : `以下价格与 v${versionSequence - 1} 对比`) : t("首个价格版本")} style={{ marginBottom: 16 }} />
        <Table
          rowKey={pricingRateKey}
          loading={versionDetail.isLoading || previousVersion.isLoading}
          dataSource={versionDetail.data?.rates ?? []}
          columns={[
            { title: t("定价分组"), render: (_, row) => `${row.pricingGroupCode ?? row.itemGroupCode} · ${row.pricingGroupName ?? row.itemGroupName}` },
            { title: t("计价单位"), dataIndex: "unit", render: (value) => t(unitLabels[value as keyof typeof unitLabels] ?? value) },
            { title: t("上一版基础价"), render: (_, row) => money(previousVersion.data?.rates.find((item) => pricingRateKey(item) === pricingRateKey(row))?.baseAmount) },
            { title: t("本版基础价"), dataIndex: "baseAmount", render: money },
            { title: t("变化"), render: (_, row) => {
              const before = previousVersion.data?.rates.find((item) => pricingRateKey(item) === pricingRateKey(row))?.baseAmount;
              return before === undefined ? t("新增") : before === row.baseAmount ? t("未变") : `${row.baseAmount - before > 0 ? "+" : ""}${(row.baseAmount - before).toFixed(2)}`;
            } },
          ]}
        />
      </Drawer>

      <Modal
        title={`${t("恢复价格版本")} v${restoreSequence ?? ""}`}
        open={restoreSequence !== undefined}
        okText={t("生成恢复版本")}
        okButtonProps={{ disabled: !restoreReason.trim(), loading: restoreVersion.isPending }}
        onCancel={() => { setRestoreSequence(undefined); setRestoreReason(""); }}
        onOk={() => restoreSequence !== undefined && restoreVersion.mutate({ sequence: restoreSequence, reason: restoreReason.trim() })}
      >
        <Alert type="warning" showIcon title={t("不会修改或删除历史版本，而是以旧快照追加一个新的当前版本。")} style={{ marginBottom: 12 }} />
        <Input.TextArea rows={3} value={restoreReason} onChange={(event) => setRestoreReason(event.target.value)} placeholder={t("请填写恢复原因")} />
      </Modal>

      <Drawer
        title={t(discountForm.getFieldValue("id") ? "编辑优惠方案" : "新增优惠方案")}
        size={680}
        open={Boolean(discountEditor)}
        destroyOnHidden
        onClose={() => setDiscountEditor(null)}
        extra={
          <Button type="primary" loading={saveDiscount.isPending} onClick={() => discountForm.submit()}>
            {t("保存新版本")}
          </Button>
        }
      >
        <Form<SaveRentalDiscountPlanRequest> form={discountForm} layout="vertical" onFinish={(values) => saveDiscount.mutate(values)}>
          <Alert type="info" showIcon title={t("按四个业务区完成配置；第一阶段一个方案对应一条优惠规则。")} style={{ marginBottom: 16 }} />
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Form.Item name="applicableItemGroupIds" hidden><Select mode="multiple" /></Form.Item>
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Card size="small" title={t("1. 基本信息")}>
              <Row gutter={12}>
                <Col span={8}><Form.Item name="code" label={t("方案编码")} rules={[{ required: true }]}><Input disabled={Boolean(discountForm.getFieldValue("id"))} /></Form.Item></Col>
                <Col span={10}><Form.Item name="name" label={t("方案名称")} rules={[{ required: true }]}><Input /></Form.Item></Col>
                <Col span={6}><Form.Item name="status" label={t("状态")}><Select options={[{ value: "draft", label: t("草稿") }, { value: "enabled", label: t("启用") }, { value: "disabled", label: t("停用") }]} /></Form.Item></Col>
                <Col span={12}><Form.Item name="effectiveFrom" label={t("生效时间")}><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="effectiveTo" label={t("失效时间")}><Input placeholder={t("留空表示长期有效")} /></Form.Item></Col>
              </Row>
            </Card>

            <Card size="small" title={t("2. 适用条件")}>
              <Row gutter={12}>
                <Col span={12}><Form.Item name="customerScope" label={t("客户范围")}><Select options={[{ value: "all", label: t("全部客户") }, { value: "personal", label: t("个人客户") }, { value: "corporate", label: t("企业客户") }, { value: "member", label: t("会员") }]} /></Form.Item></Col>
                <Col span={12}><Form.Item name="minimumSpend" label={t("最低消费")}><InputNumber min={0} precision={2} prefix={currencySymbol} style={{ width: "100%" }} /></Form.Item></Col>
                <Col span={24}>
                  <Form.Item name="applicablePricingGroupIds" label={t("适用定价分组")} tooltip={t("留空表示适用于当前经营空间的全部定价分组。")}>
                    <Select mode="multiple" allowClear showSearch={{ optionFilterProp: "label" }} placeholder={t("全部定价分组")} options={(pricingGroups.data ?? []).map((group) => ({ value: group.id, label: `${group.code} · ${group.name}` }))} />
                  </Form.Item>
                </Col>
                <Col span={24}><Form.Item name="applicableDayTypes" label={t("适用日期类型")} tooltip={t("留空表示全部日期类型。")}><Select mode="multiple" allowClear placeholder={t("全部日期类型")} options={[{ value: "workday", label: t("工作日") }, { value: "weekend", label: t("周末") }, { value: "statutory_holiday", label: t("法定节假日") }, { value: "makeup_workday", label: t("调休工作日") }, { value: "tenant_special", label: t("租户特殊日") }]} /></Form.Item></Col>
              </Row>
            </Card>

            <Card size="small" title={t("3. 优惠动作")}>
              <Row gutter={12}>
                <Col span={8}><Form.Item name="discountType" label={t("优惠类型")}><Select options={[{ value: "percentage", label: t("百分比减免") }, { value: "fixed_amount", label: t("固定减免") }, { value: "threshold_amount", label: t("满额固定减免") }]} /></Form.Item></Col>
                <Col span={8}><Form.Item name="appliesTo" label={t("作用费用")} tooltip={t("押金、预授权与异常费用不可被普通优惠减免。")}><Select options={[{ value: "rental", label: t("租金与使用量") }, { value: "fulfillment", label: t("履约费用") }, { value: "service", label: t("增值服务") }]} /></Form.Item></Col>
                <Col span={8}><Form.Item name="discountValue" label={t(discountType === "percentage" ? "减免比例（%）" : "减免金额")} rules={[{ required: true }]}><InputNumber min={0} max={discountType === "percentage" ? 100 : undefined} precision={2} suffix={discountType === "percentage" ? "%" : undefined} prefix={discountType === "percentage" ? undefined : currencySymbol} style={{ width: "100%" }} /></Form.Item></Col>
                {discountType === "threshold_amount" ? <Col span={12}><Form.Item name="thresholdAmount" label={t("满减门槛")} rules={[{ required: true }]}><InputNumber min={0} precision={2} prefix={currencySymbol} style={{ width: "100%" }} /></Form.Item></Col> : null}
                {discountType === "percentage" ? <Col span={12}><Form.Item name="maximumDiscount" label={t("最高减免金额")}><InputNumber min={0} precision={2} prefix={currencySymbol} style={{ width: "100%" }} /></Form.Item></Col> : null}
              </Row>
            </Card>

            <Card size="small" title={t("4. 互斥与叠加")}>
              <Row gutter={12}>
                <Col span={8}><Form.Item name="exclusiveGroup" label={t("互斥组")} tooltip={t("同组仅应用实际减免最大的方案；留空表示独立分组。")}><Input allowClear placeholder={t("例如：会员折扣")} /></Form.Item></Col>
                <Col span={8}><Form.Item name="priority" label={t("同额优先级")}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                <Col span={8}><Form.Item name="stackableWithOtherPlans" label={t("与其他方案叠加")}><Select options={[{ value: true, label: t("允许") }, { value: false, label: t("不允许") }]} /></Form.Item></Col>
                <Col span={8}><Form.Item name="stackableWithCoupon" label={t("与优惠券叠加")}><Select options={[{ value: true, label: t("允许") }, { value: false, label: t("不允许") }]} /></Form.Item></Col>
              </Row>
            </Card>

            <Form.Item name="changeReason" label={t("本次变更原因")} rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
          </Space>
        </Form>
      </Drawer>

      <Drawer
        title={t(serviceForm.getFieldValue("id") ? "编辑增值服务" : "新增增值服务")}
        size={680}
        open={Boolean(serviceEditor)}
        destroyOnHidden
        onClose={() => setServiceEditor(null)}
        extra={
          <Button type="primary" loading={saveService.isPending} onClick={() => serviceForm.submit()}>
            {t("保存服务")}
          </Button>
        }
      >
        <Form<SaveRentalValueAddedServiceRequest> form={serviceForm} layout="vertical" onFinish={(values) => saveService.mutate(values)}>
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="code" label={t("服务编码")}>
                <Input disabled={Boolean(serviceForm.getFieldValue("id"))} />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="name" label={t("服务名称")}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="status" label={t("状态")}>
                <Select
                  options={[
                    { value: "enabled", label: t("启用") },
                    { value: "disabled", label: t("停用") },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="serviceType" label={t("服务类型")}>
                <Select options={Object.entries(serviceTypeLabels).map(([value, label]) => ({ value, label: t(label) }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="billingUnit" label={t("计费方式")}>
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
              <Form.Item name="price" label={t("价格")}>
                <InputNumber min={0} precision={2} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="minimumQuantity" label={t("最小数量")}>
                <InputNumber min={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="maximumQuantity" label={t("最大数量")}>
                <InputNumber min={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="coverageLimit" label={t("保障限额")}>
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="deductible" label={t("免赔额")}>
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="customerScope" label={t("适用客户")}>
                <Select options={[{ value: "all", label: t("全部") }, { value: "personal", label: t("个人") }, { value: "corporate", label: t("企业") }]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="selectionMode" label={t("选择方式")}>
                <Select options={[{ value: "optional", label: t("客户可选") }, { value: "recommended", label: t("系统推荐") }, { value: "mandatory", label: t("条件强制") }]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="requiresCapacity" label={t("需要容量预留")} valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="applicableItemGroupIds" label={t("适用商品（空为全部）")}>
            <Select
              mode="multiple"
              options={(groups.data ?? []).map((group) => ({
                value: group.id,
                label: group.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="applicableFulfillmentModes" label={t("适用履约方式（空为全部）")}>
            <Select mode="multiple" options={(settings.data?.fulfillment.enabledModes ?? []).map((value) => ({ value, label: t(value) }))} />
          </Form.Item>
          <Form.Item name="applicableLocationIds" label={t("适用地点（空为全部）")}>
            <Select mode="multiple" options={(locations.data ?? []).map((row) => ({ value: row.id, label: row.name }))} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.selectionMode !== current.selectionMode}>
            {({ getFieldValue }) => getFieldValue("selectionMode") === "mandatory" ? (
              <Card size="small" title={t("条件强制触发规则")}>
                <Form.Item name={["mandatoryRule", "itemGroupIds"]} label={t("命中商品")}>
                  <Select mode="multiple" options={(groups.data ?? []).map((row) => ({ value: row.id, label: row.name }))} />
                </Form.Item>
                <Form.Item name={["mandatoryRule", "fulfillmentModes"]} label={t("命中履约方式")}>
                  <Select mode="multiple" options={(settings.data?.fulfillment.enabledModes ?? []).map((value) => ({ value, label: t(value) }))} />
                </Form.Item>
                <Form.Item name={["mandatoryRule", "minRentalAmount"]} label={t("最低租金")}>
                  <InputNumber min={0} precision={2} style={{ width: "100%" }} />
                </Form.Item>
              </Card>
            ) : null}
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.serviceType !== current.serviceType}>
            {({ getFieldValue }) => getFieldValue("serviceType") === "insurance" ? (
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="insuranceProviderStatus" label={t("保险接入状态")}>
                    <Select options={[{ value: "simulated", label: t("模拟") }, { value: "reserved", label: t("预留能力") }]} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="insuranceProviderName" label={t("服务商名称")}>
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
            ) : null}
          </Form.Item>
          <Form.Item name="termsVersion" label={t("条款版本")}>
            <Input />
          </Form.Item>
          <Form.Item name="terms" label={t("服务/保障条款")} rules={[{ required: true }]}>
            <Input.TextArea rows={6} />
          </Form.Item>
        </Form>
      </Drawer>
      <Drawer
        title={`${capacityService?.name ?? t("服务")} · ${t("容量窗口")}`}
        size={760}
        open={Boolean(capacityService)}
        onClose={() => { setCapacityService(null); setCapacityEditor(null); }}
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => editCapacity()}>{t("新增容量窗口")}</Button>}
      >
        <Alert
          type="info"
          showIcon
          title={t("报价只检查容量；订单创建后预留，确认后锁定，取消或超时释放。")}
          style={{ marginBottom: 16 }}
        />
        <QueryState loading={capacities.isLoading} error={capacities.error}>
          <Table<RentalServiceCapacity>
            rowKey="id"
            dataSource={capacities.data ?? []}
            columns={[
              { title: t("地点"), dataIndex: "locationId", render: (value) => locations.data?.find((row) => row.id === value)?.name ?? value },
              { title: t("开始"), dataIndex: "windowStart", render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm") },
              { title: t("结束"), dataIndex: "windowEnd", render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm") },
              { title: t("总量"), dataIndex: "totalCapacity" },
              { title: t("已预留"), dataIndex: "reservedQuantity" },
              { title: t("已确认/使用"), dataIndex: "usedQuantity" },
              { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{t(value)}</Tag> },
              { title: t("操作"), render: (_, row) => <Button type="link" onClick={() => editCapacity(row)}>{t("编辑")}</Button> },
            ]}
          />
        </QueryState>
      </Drawer>
      <Modal
        title={t(capacityEditor?.id ? "编辑容量窗口" : "新增容量窗口")}
        open={Boolean(capacityEditor)}
        confirmLoading={saveCapacity.isPending}
        onCancel={() => setCapacityEditor(null)}
        onOk={() => capacityForm.submit()}
        destroyOnHidden
      >
        <Form form={capacityForm} layout="vertical" onFinish={(values) => saveCapacity.mutate(values)}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Form.Item name="serviceId" hidden><Input /></Form.Item>
          <Form.Item name="locationId" label={t("服务地点")} rules={[{ required: true }]}>
            <Select options={(locations.data ?? []).map((row) => ({ value: row.id, label: row.name }))} />
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
                <Select options={[{ value: "enabled", label: t("启用") }, { value: "disabled", label: t("停用") }]} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
}
