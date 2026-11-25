import {
  ADMIN_TABLE_COLUMN_WIDTH,
  App,
  Button,
  DataTableText,
  DatePicker,
  EditOutlined,
  Form,
  Input,
  ListFilters,
  ListSection,
  Modal,
  PlusOutlined,
  SaveButton,
  Select,
  Table,
  Tabs,
  useListFilter,
  useModalDismissal,
} from "@rental-os/platform-admin/ui";
import { couponCards } from "./couponCards";

import type {
  RentalCouponTemplate,
  RentalCustomerCoupon,
  SaveRentalCouponTemplateRequest,
} from "@rental-os/rental-core";
import { formatRentalMoney, rentalCurrencySymbol } from "@rental-os/rental-core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Col, InputNumber, Row, Tag, Typography } from "antd";

import dayjs from "dayjs";
import { useMemo, useRef, useState } from "react";
import {
  RentalCommercialPageProvider,
  useRentalCommercialWorkspaceAccess,
  type RentalCommercialPageContext,
} from "./page-context";
import { RENTAL_COMMERCIAL_ACCESS, RENTAL_COMMERCIAL_CORE_ID } from "./pages";
import { useOrderEditor } from "../orders/useOrderEditor";
import { useLocale } from "@rental-os/platform-admin/locale";
import { CorePage, UnsavedChangesGuard } from "@rental-os/platform-admin/core";
import { QueryState } from "@rental-os/platform-admin/core";
import { SettingsWorkspace } from "@rental-os/platform-admin/shell";



const dateFieldBinding = {
  getValueProps: (value?: string) => ({ value: value ? dayjs(value) : null }),
  getValueFromEvent: (value: dayjs.Dayjs | null) => value?.toISOString(),
};

/** 优惠券模板、发放和作废复用原台账请求，表单归属当前范围和打开代次。 */
export function CouponPage(context: RentalCommercialPageContext) {
  return (
    <RentalCommercialPageProvider context={context}>
      <CouponWorkspace key={context.scopeKey} />
    </RentalCommercialPageProvider>
  );
}

function CouponWorkspace() {
  const {
    api: rentalCoreApi,
    scope,
    currentScopeKey,
    host,
    canManage,
    isCurrentScope,
    assertManage,
  } = useRentalCommercialWorkspaceAccess();
  const generations = useRef({ template: 0, claim: 0, void: 0 });
  const { message } = App.useApp();
  const { locale, t } = useLocale();
  const queryClient = useQueryClient();
  const canReadGroups = () =>
    Boolean(scope) && currentScopeKey() === scope && (
      host.canAccess(RENTAL_COMMERCIAL_CORE_ID, [{ resource: "catalog", action: "view" }]) ||
      host.canAccess(RENTAL_COMMERCIAL_CORE_ID, [{ resource: "catalog", action: "manage" }]) ||
      host.canAccess(RENTAL_COMMERCIAL_CORE_ID, [{ resource: "order", action: "view" }]) ||
      host.canAccess(RENTAL_COMMERCIAL_CORE_ID, [{ resource: "order", action: "create" }])
    );
  const [editing, setEditing] = useState<RentalCouponTemplate>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [voiding, setVoiding] = useState<RentalCustomerCoupon>();
  const [view, setView] = useState("templates");
  const [form] = Form.useForm<SaveRentalCouponTemplateRequest>();
  const discountType = Form.useWatch("discountType", form);
  const [claimForm] = Form.useForm<{ templateId: string; customerId: string }>();
  const [voidForm] = Form.useForm<{ reason: string }>();
  const editor = useModalDismissal(drawerOpen, () => {
    setDrawerOpen(false);
    setEditing(undefined);
    form.resetFields();
  });
  const claimDialog = useModalDismissal(claimOpen, () => {
    setClaimOpen(false);
    claimForm.resetFields();
  });
  const voidDialog = useModalDismissal(Boolean(voiding), () => {
    setVoiding(undefined);
    voidForm.resetFields();
  });
  const templates = useQuery({
    queryKey: ["rental-core", "coupon-templates", scope],
    enabled: Boolean(scope),
    queryFn: ({ signal }) => rentalCoreApi.couponTemplates({ signal }),
  });
  const couponFilter = useListFilter(templates.data, {
    fields: (row) => [row.name, row.code],
    status: (row) => row.status,
  });
  const customerCoupons = useQuery({
    queryKey: ["rental-core", "customer-coupons", scope],
    enabled: Boolean(scope),
    queryFn: ({ signal }) => rentalCoreApi.customerCoupons(undefined, { signal }),
  });
  const customerCouponFilter = useListFilter(customerCoupons.data, {
    fields: (row) => [
      row.templateName,
      row.templateCode,
      row.customerId,
      row.redeemedOrderId,
      row.lockedOrderId,
    ],
    status: (row) => row.status,
  });
  const groups = useQuery({
    queryKey: ["rental-core", "groups", scope],
    enabled: canReadGroups(),
    queryFn: async ({ signal }) => {
      if (!isCurrentScope() || !canReadGroups()) throw new Error("商品资料读取受限");
      const result = await rentalCoreApi.itemGroups({ signal });
      if (!isCurrentScope() || !canReadGroups()) throw new Error("商品资料读取受限");
      return result;
    },
  });
  const settings = useQuery({
    queryKey: ["rental-core", "business-settings", scope],
    enabled: Boolean(scope),
    queryFn: ({ signal }) => rentalCoreApi.businessSettings({ signal }),
  });
  const currency = settings.data?.pricing.currency ?? "CNY";
  const money = (value: number) => formatRentalMoney(Number(value), currency);
  const visibleGroups = canReadGroups() && !groups.isError ? groups.data : undefined;
  const groupsUnavailableText = !canReadGroups()
    ? (locale === "en-US" ? "Product access is restricted" : "商品资料读取受限")
    : groups.isError
      ? (locale === "en-US" ? "Unable to read product details" : "未能读取商品资料")
      : (locale === "en-US" ? "Reading product details" : "正在读取商品资料");
  const referencesAvailable = () =>
    isCurrentScope() && canReadGroups() &&
    ["groups", "coupon-templates"].every(
      key => queryClient.getQueryState(["rental-core", key, scope])?.status === "success",
    );
  async function refreshTemplates(throwOnError = false) {
    if (!isCurrentScope()) throw new DOMException("商业页面的会话或经营空间已变化", "AbortError");
    await Promise.all([
      templates.refetch({ throwOnError }),
      // 附属错误留在引用状态中，刷新仍复验当前权限，避免阻断已获权的模板。
      ...(canReadGroups() ? [groups.refetch()] : []),
    ]);
  }
  const save = useMutation({
    mutationFn: (values: SaveRentalCouponTemplateRequest) => {
      assertManage();
      if (!referencesAvailable()) throw new Error(t("当前操作不可用"));
      return rentalCoreApi.saveCouponTemplate(values);
    },
    onSuccess: async () => {
      if (!isCurrentScope()) return;
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "coupon-templates"] });
      if (!isCurrentScope()) return;
      editor.dismiss();
      message.success(t("优惠券模板已保存"));
    },
    onError: () => {
      if (isCurrentScope()) message.error(t("保存失败，请检查编码、优惠值、发行量和有效期"));
    },
  });
  const claim = useMutation({
    mutationFn: (values: { templateId: string; customerId: string }) => {
      assertManage();
      return rentalCoreApi.claimCoupon(values.templateId, values.customerId);
    },
    onSuccess: async () => {
      if (!isCurrentScope()) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "customer-coupons"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "coupon-templates"] }),
      ]);
      if (!isCurrentScope()) return;
      claimDialog.dismiss();
      message.success(t("优惠券已发放到客户账户"));
    },
    onError: () => {
      if (isCurrentScope()) message.error(t("发放失败：模板未启用、已领完、超过限领或不在有效期"));
    },
  });
  const voidCoupon = useMutation({
    mutationFn: (values: { reason: string }) => {
      assertManage();
      if (!voiding) throw new Error(t("当前操作不可用"));
      return rentalCoreApi.voidCustomerCoupon(voiding.id, values.reason);
    },
    onSuccess: async () => {
      if (!isCurrentScope()) return;
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "customer-coupons"] });
      if (!isCurrentScope()) return;
      voidDialog.dismiss();
      message.success(t("客户优惠券已作废"));
    },
    onError: () => {
      if (isCurrentScope()) message.error(t("作废失败：请确认优惠券未被订单锁定，并填写原因"));
    },
  });
  const editorUnavailable =
    !canManage || !visibleGroups || templates.isPending || templates.isError;
  const templateSubmission = useOrderEditor<SaveRentalCouponTemplateRequest>({
    form,
    identity: drawerOpen
      ? JSON.stringify([scope, "coupon-template", generations.current.template])
      : undefined,
    disabled: editorUnavailable,
    onSave: (values) => {
      assertManage();
      return save.mutateAsync({ ...values, id: editing?.id });
    },
  });
  const claimSubmission = useOrderEditor<{ templateId: string; customerId: string }>({
    form: claimForm,
    identity: claimOpen ? JSON.stringify([scope, "coupon-claim", generations.current.claim]) : undefined,
    disabled: !canManage || !templates.isSuccess,
    onSave: (values) => {
      assertManage();
      return claim.mutateAsync(values);
    },
  });
  const voidSubmission = useOrderEditor<{ reason: string }>({
    form: voidForm,
    identity: voiding
      ? JSON.stringify([scope, "coupon-void", generations.current.void, voiding.id])
      : undefined,
    disabled: !canManage || customerCoupons.isError,
    onSave: (values) => {
      assertManage();
      return voidCoupon.mutateAsync(values);
    },
  });
  const templateForm = useMemo(
    () => ({ ...form, validateFields: templateSubmission.validate }),
    [form, templateSubmission.key],
  );
  const boundClaimForm = useMemo(
    () => ({ ...claimForm, validateFields: claimSubmission.validate }),
    [claimForm, claimSubmission.key],
  );
  const boundVoidForm = useMemo(
    () => ({ ...voidForm, validateFields: voidSubmission.validate }),
    [voidForm, voidSubmission.key],
  );
  const dismissTemplate = () => templateSubmission.dismiss(editor.dismiss);
  const dismissClaim = () => claimSubmission.dismiss(claimDialog.dismiss);
  const dismissVoid = () => voidSubmission.dismiss(voidDialog.dismiss);

  function openClaim() {
    if (!canManage || !isCurrentScope() || claim.isPending || (claimOpen && !claimDialog.visible)) return;
    claimSubmission.dismiss(() => {
      generations.current.claim += 1;
      claimForm.resetFields();
      claimSubmission.markClean();
      setClaimOpen(true);
    });
  }

  function openVoid(record: RentalCustomerCoupon) {
    if (!canManage || !isCurrentScope() || voidCoupon.isPending || (voiding && !voidDialog.visible)) return;
    voidSubmission.dismiss(() => {
      generations.current.void += 1;
      voidForm.resetFields();
      voidSubmission.markClean();
      setVoiding(record);
    });
  }

  function openEditor(record?: RentalCouponTemplate) {
    if (editorUnavailable || save.isPending || !referencesAvailable() || (drawerOpen && !editor.visible)) return;
    templateSubmission.dismiss(() => {
      generations.current.template += 1;
      setEditing(record);
      form.resetFields();
      form.setFieldsValue(
        record ?? {
          code: "",
          name: "",
          discountType: "fixed_amount",
          discountValue: 10,
          minimumSpend: 100,
          appliesTo: "rental",
          stackableWithDiscountPlans: true,
          totalQuota: 1000,
          perCustomerLimit: 1,
          perCustomerUseLimit: 1,
          claimFrom: dayjs().startOf("day").toISOString(),
          claimTo: dayjs().add(30, "day").endOf("day").toISOString(),
          effectiveFrom: dayjs().startOf("day").toISOString(),
          effectiveTo: dayjs().add(30, "day").endOf("day").toISOString(),
          applicableItemGroupIds: [],
          status: "draft",
        },
      );
      templateSubmission.markClean();
      setDrawerOpen(true);
    });
  }

  return (
    <>
      <UnsavedChangesGuard
        dirty={
          (drawerOpen && templateSubmission.dirty) ||
          (claimOpen && claimSubmission.dirty) ||
          (Boolean(voiding) && voidSubmission.dirty)
        }
        busy={save.isPending || claim.isPending || voidCoupon.isPending}
      />
      <CorePage
        children={null}
        title={t("优惠券")}
        note={{
          title: t("优惠券与预算按订单事务流转"),
          description: t(
            "报价只计算；创建订单同时锁券和预算；订单确认转为核销预算；取消释放后按有效期恢复或过期。",
          ),
        }}
        actions={
          view === "templates"
            ? [
                {
                  id: "create-coupon-template",
                  kind: "open",
                  label: { default: t("新增优惠券模板") },
                  emphasis: "primary",
                  permissions: RENTAL_COMMERCIAL_ACCESS,
                  icon: <PlusOutlined />,
                  disabled: editorUnavailable || save.isPending,
                  open: () => openEditor(),
                },
              ]
            : [
                {
                  id: "claim-coupon",
                  kind: "open",
                  label: { default: t("发放优惠券") },
                  emphasis: "primary",
                  permissions: RENTAL_COMMERCIAL_ACCESS,
                  icon: <PlusOutlined />,
                  disabled: !canManage || claim.isPending,
                  open: openClaim,
                },
              ]
        }
      />
      <Tabs
        activeKey={view}
        onChange={setView}
        aria-label={t("优惠券")}
        items={[
          {
            key: "templates",
            label: t("优惠券模板"),
            children: (
              <ListSection
                controls={
                  <ListFilters
                    filter={couponFilter}
                    placeholder="优惠券名称或编码"
                    options={[
                      { value: "draft", label: "草稿" },
                      { value: "scheduled", label: "待开始" },
                      { value: "active", label: "进行中" },
                      { value: "paused", label: "已暂停" },
                      { value: "ended", label: "已结束" },
                      { value: "void", label: "已作废" },
                    ]}
                  />
                }
              >
                <QueryState
                  loading={templates.isLoading}
                  error={templates.error}
                  onRetry={() => refreshTemplates(true)}
                >
                  <Table<RentalCouponTemplate>
                    cardView={{
                      ...couponCards({
                        t, money, groups: visibleGroups, groupsUnavailableText,
                        canEdit: !editorUnavailable, edit: openEditor,
                      }),
                      defaultView: "cards",
                    }}
                    exportConfig={{
                      filename: t("优惠券"),
                      fields: [
                        { label: t("编码"), value: (row) => row.code },
                        { label: t("名称"), value: (row) => row.name },
                        { label: t("版本"), value: (row) => row.version },
                        { label: t("状态"), value: (row) => row.status },
                        { label: t("优惠"), value: (row) => row.discountValue },
                      ],
                    }}
                    rowKey="id"
                    onRefresh={() => refreshTemplates()}
                    loading={templates.isLoading}
                    refreshing={templates.isFetching}
                    dataSource={couponFilter.rows}
                    pagination={couponFilter.pagination}
                    scroll={{ x: 1100 }}
                    columns={[
                      {
                        title: t("优惠券"),
                        dataIndex: "name",
                        minWidth: ADMIN_TABLE_COLUMN_WIDTH.identity,
                        fixed: "left",
                        render: (_, row) => (
                          <DataTableText primary={row.name} secondary={`${row.code} · v${row.version}`} />
                        ),
                      },
                      {
                        title: t("优惠"),
                        render: (_, row) =>
                          row.discountType === "fixed_amount"
                            ? locale === "en-US"
                              ? `${t("减免")} ${money(row.discountValue)}`
                              : `减 ${money(row.discountValue)}`
                            : `${t("减免 {value}%", { value: row.discountValue })}${row.maximumDiscount !== undefined ? (locale === "en-US" ? `, ${t("最高减免")} ${money(row.maximumDiscount)}` : `，封顶 ${money(row.maximumDiscount)}`) : ""}`,
                      },
                      {
                        title: t("使用门槛"),
                        dataIndex: "minimumSpend",
                        render: (value) =>
                          value > 0
                            ? locale === "en-US"
                              ? `${t("满")} ${money(value)}`
                              : `满 ${money(value)}`
                            : t("无门槛"),
                      },
                      {
                        title: t("发行 / 已领"),
                        render: (_, row) => `${row.totalQuota} / ${row.claimedQuantity}`,
                      },
                      {
                        title: t("每客限领 / 使用"),
                        render: (_, row) => `${row.perCustomerLimit} / ${row.perCustomerUseLimit}`,
                      },
                      {
                        title: t("预算"),
                        render: (_, row) =>
                          row.totalBudget === undefined
                            ? t("不限")
                            : `${money(row.lockedBudget + row.redeemedBudget)} / ${money(row.totalBudget)}`,
                      },
                      {
                        title: t("适用商品"),
                        dataIndex: "applicableItemGroupIds",
                        render: (ids) => {
                          const label = ids.length
                            ? locale === "en-US"
                              ? `${ids.length} ${t("个指定商品")}`
                              : `${ids.length} 个指定商品`
                            : t("全部商品");
                          return ids.length && !visibleGroups
                            ? <DataTableText primary={label} secondary={groupsUnavailableText} />
                            : label;
                        },
                      },
                      {
                        title: t("有效期"),
                        render: (_, row) => (
                          <DataTableText
                            primary={dayjs(row.effectiveFrom).format("YYYY-MM-DD")}
                            secondary={`→ ${dayjs(row.effectiveTo).format("YYYY-MM-DD")}`}
                          />
                        ),
                      },
                      {
                        title: t("状态"),
                        dataIndex: "status",
                        render: (value) => (
                          <Tag
                            color={
                              value === "active"
                                ? "success"
                                : value === "draft" || value === "scheduled"
                                  ? "gold"
                                  : "default"
                            }
                          >
                            {
                              {
                                draft: t("草稿"),
                                scheduled: t("待开始"),
                                active: t("进行中"),
                                paused: t("已暂停"),
                                ended: t("已结束"),
                                void: t("已作废"),
                              }[value as RentalCouponTemplate["status"]]
                            }
                          </Tag>
                        ),
                      },
                      {
                        title: t("操作"),
                        fixed: "right",
                        render: (_, row) => (
                          <Button type="link" icon={<EditOutlined />} disabled={editorUnavailable} onClick={() => openEditor(row)}>
                            {t("编辑")}
                          </Button>
                        ),
                      },
                    ]}
                  />
                </QueryState>
              </ListSection>
            ),
          },
          {
            key: "issued",
            label: t("客户优惠券"),
            children: (
              <ListSection
                controls={
                  <ListFilters
                    filter={customerCouponFilter}
                    placeholder="优惠券、客户编号或订单"
                    options={[
                      { value: "claimed", label: "已领取" },
                      { value: "locked", label: "已锁定" },
                      { value: "redeemed", label: "已核销" },
                      { value: "expired", label: "已过期" },
                      { value: "void", label: "已作废" },
                    ]}
                  />
                }
              >
                <QueryState
                  loading={customerCoupons.isLoading}
                  error={customerCoupons.error}
                  onRetry={() => customerCoupons.refetch({ throwOnError: true })}
                >
                  <Table<RentalCustomerCoupon>
                    exportConfig={{
                      filename: t("客户优惠券"),
                      fields: [
                        { label: t("优惠券"), value: (row) => row.templateName },
                        { label: t("编码"), value: (row) => row.templateCode },
                        { label: t("状态"), value: (row) => row.status },
                      ],
                    }}
                    rowKey="id"
                    onRefresh={() => customerCoupons.refetch()}
                    loading={customerCoupons.isLoading}
                    refreshing={customerCoupons.isFetching}
                    dataSource={customerCouponFilter.rows}
                    pagination={customerCouponFilter.pagination}
                    columns={[
                      {
                        title: t("优惠券"),
                        dataIndex: "templateName",
                        minWidth: ADMIN_TABLE_COLUMN_WIDTH.identity,
                        render: (_, row) => (
                          <DataTableText primary={row.templateName} secondary={row.templateCode} />
                        ),
                      },
                      {
                        title: t("客户"),
                        dataIndex: "customerId",
                        minWidth: ADMIN_TABLE_COLUMN_WIDTH.identifier,
                      },
                      {
                        title: t("状态"),
                        dataIndex: "status",
                        render: (value) => (
                          <Tag
                            color={
                              value === "claimed"
                                ? "blue"
                                : value === "locked"
                                  ? "gold"
                                  : value === "redeemed"
                                    ? "success"
                                    : "default"
                            }
                          >
                            {t(
                              {
                                claimed: "已领取",
                                locked: "已锁定",
                                redeemed: "已核销",
                                void: "已作废",
                                expired: "已过期",
                              }[value as string] ?? value,
                            )}
                          </Tag>
                        ),
                      },
                      {
                        title: t("领取时间"),
                        dataIndex: "claimedAt",
                        render: (value) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—"),
                      },
                      {
                        title: t("关联订单"),
                        render: (_, row) => row.redeemedOrderId ?? row.lockedOrderId ?? "-",
                      },
                      {
                        title: t("有效期"),
                        render: (_, row) => (
                          <div>
                            <span>{dayjs(row.effectiveFrom).format("YYYY-MM-DD")}</span>
                            <br />
                            <span className="muted">→ {dayjs(row.effectiveTo).format("YYYY-MM-DD")}</span>
                          </div>
                        ),
                      },
                      {
                        title: t("操作"),
                        render: (_, row) =>
                          row.status === "claimed" ? (
                            <Button
                              danger
                              type="link"
                              disabled={voidCoupon.isPending}
                              onClick={() => openVoid(row)}
                            >
                              {t("作废")}
                            </Button>
                          ) : (
                            "-"
                          ),
                      },
                    ]}
                  />
                </QueryState>
              </ListSection>
            ),
          },
        ]}
      />

      <Modal
        presentation="side"
        title={t(editing ? "编辑优惠券模板" : "新增优惠券模板")}
        width={640}
        open={editor.visible}
        destroyOnHidden
        onCancel={dismissTemplate}
        afterClose={editor.afterClose}
        closable={!save.isPending}
        keyboard={!save.isPending}
        mask={{ closable: !save.isPending }}
        footer={
          <>
            <Button disabled={save.isPending} onClick={dismissTemplate}>
              {t("取消")}
            </Button>
            <SaveButton
              label={t("保存")}
              form={templateForm}
              disabled={editorUnavailable}
              pending={save.isPending}
              onSave={templateSubmission.submit}
            />
          </>
        }
      >
        <Form<SaveRentalCouponTemplateRequest>
          name="coupon-template"
          form={form}
          layout="vertical"
          disabled={editorUnavailable || save.isPending}
          {...templateSubmission.formProps}
          onFinish={templateSubmission.submit}
        >
          <SettingsWorkspace
            sections={[
              {
                key: "profile",
                label: locale === "en-US" ? t("详情") : t("基本资料"),
                content: (
                  <div>
                    <Row gutter={16}>
                      <Col span={24}>
                        <Form.Item name="name" label={t("模板名称")} rules={[{ required: true }]}>
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="code" label={t("模板编码")} rules={[{ required: true }]}>
                          <Input disabled={Boolean(editing) || editorUnavailable || save.isPending} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="status" label={t("状态")} rules={[{ required: true }]}>
                          <Select
                            options={[
                              { value: "draft", label: t("草稿") },
                              { value: "scheduled", label: t("待开始") },
                              { value: "active", label: t("进行中") },
                              { value: "paused", label: t("已暂停") },
                              { value: "ended", label: t("已结束") },
                              { value: "void", label: t("已作废") },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  </div>
                ),
              },
              {
                key: "discount",
                label: t("优惠设置"),
                content: (
                  <div>
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="discountType" label={t("优惠类型")} rules={[{ required: true }]}>
                          <Select
                            options={[
                              { value: "fixed_amount", label: t("固定减免") },
                              { value: "percentage", label: t("百分比减免") },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          name="discountValue"
                          label={t(discountType === "percentage" ? "减免比例（%）" : "减免金额")}
                          rules={[{ required: true }]}
                        >
                          <InputNumber
                            min={0.01}
                            max={discountType === "percentage" ? 100 : undefined}
                            precision={2}
                            prefix={
                              discountType === "percentage" ? undefined : rentalCurrencySymbol(currency)
                            }
                            suffix={discountType === "percentage" ? "%" : undefined}
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="minimumSpend" label={t("最低消费")}>
                          <InputNumber
                            min={0}
                            precision={2}
                            prefix={rentalCurrencySymbol(currency)}
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="maximumDiscount" label={t("最高减免")}>
                          <InputNumber
                            min={0}
                            precision={2}
                            prefix={rentalCurrencySymbol(currency)}
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="appliesTo" label={t("作用费用")} rules={[{ required: true }]}>
                          <Select
                            options={[
                              { value: "rental", label: t("商品租金与使用量") },
                              { value: "fulfillment", label: t("履约费") },
                              { value: "service", label: t("增值服务费") },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          name="stackableWithDiscountPlans"
                          label={t("与自动优惠叠加")}
                          rules={[{ required: true }]}
                        >
                          <Select
                            options={[
                              { value: true, label: t("允许") },
                              { value: false, label: t("不允许") },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item name="applicableItemGroupIds" label={t("适用商品（留空为全部）")}>
                      <Select
                        mode="multiple"
                        showSearch={{ optionFilterProp: "label" }}
                        options={(visibleGroups ?? []).map((item) => ({
                          value: item.id,
                          label: `${item.code} · ${item.name}`,
                        }))}
                      />
                    </Form.Item>
                  </div>
                ),
              },
              {
                key: "schedule",
                label: locale === "en-US" ? t("日期") : t("领取与使用"),
                content: (
                  <div>
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item
                          {...dateFieldBinding}
                          name="claimFrom"
                          label={t("开始领取时间")}
                          rules={[{ required: true }]}
                        >
                          <DatePicker showTime needConfirm style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          {...dateFieldBinding}
                          name="claimTo"
                          label={t("停止领取时间")}
                          rules={[{ required: true }]}
                        >
                          <DatePicker showTime needConfirm style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          {...dateFieldBinding}
                          name="effectiveFrom"
                          label={t("开始使用时间")}
                          rules={[{ required: true }]}
                        >
                          <DatePicker showTime needConfirm style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          {...dateFieldBinding}
                          name="effectiveTo"
                          label={t("停止使用时间")}
                          rules={[{ required: true }]}
                        >
                          <DatePicker showTime needConfirm style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          {...dateFieldBinding}
                          name="applicableRentalFrom"
                          label={t("适用租期开始（可选）")}
                        >
                          <DatePicker showTime needConfirm allowClear style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          {...dateFieldBinding}
                          name="applicableRentalTo"
                          label={t("适用租期结束（可选）")}
                        >
                          <DatePicker showTime needConfirm allowClear style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </div>
                ),
              },
              {
                key: "quota",
                label: locale === "en-US" ? t("发行限制") : t("发行与预算"),
                content: (
                  <div>
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="totalQuota" label={t("发行总量")} rules={[{ required: true }]}>
                          <InputNumber min={0} precision={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="perCustomerLimit" label={t("每客限领")} rules={[{ required: true }]}>
                          <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          name="perCustomerUseLimit"
                          label={t("每客限用")}
                          rules={[{ required: true }]}
                        >
                          <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="totalBudget" label={t("优惠总预算（留空不限）")}>
                          <InputNumber
                            min={0}
                            precision={2}
                            prefix={rentalCurrencySymbol(currency)}
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  </div>
                ),
              },
            ]}
          />
        </Form>
      </Modal>
      <Modal
        presentation="dialog"
        title={t("向客户发放优惠券")}
        open={claimDialog.visible}
        onCancel={dismissClaim}
        afterClose={claimDialog.afterClose}
        destroyOnHidden
        closable={!claim.isPending}
        keyboard={!claim.isPending}
        mask={{ closable: !claim.isPending }}
        footer={
          <>
            <Button disabled={claim.isPending} onClick={dismissClaim}>
              {t("取消")}
            </Button>
            <SaveButton
              label={t("确认发放")}
              form={boundClaimForm}
              disabled={!canManage || !templates.isSuccess}
              pending={claim.isPending}
              onSave={claimSubmission.submit}
            />
          </>
        }
      >
        <QueryState
          loading={templates.isLoading}
          error={templates.error}
          onRetry={() => templates.refetch({ throwOnError: true })}
        >
          <Form
            name="coupon-claim"
            form={claimForm}
            layout="vertical"
            disabled={!canManage || !templates.isSuccess || claim.isPending}
            {...claimSubmission.formProps}
            onFinish={claimSubmission.submit}
          >
            <Form.Item name="customerId" label={t("客户 ID")} rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="templateId" label={t("优惠券模板")} rules={[{ required: true }]}>
              <Select
                options={(templates.data ?? [])
                  .filter((item) => item.status === "active")
                  .map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))}
              />
            </Form.Item>
          </Form>
        </QueryState>
      </Modal>
      <Modal
        presentation="dialog"
        title={t("作废客户优惠券")}
        open={voidDialog.visible}
        onCancel={dismissVoid}
        afterClose={voidDialog.afterClose}
        destroyOnHidden
        closable={!voidCoupon.isPending}
        keyboard={!voidCoupon.isPending}
        mask={{ closable: !voidCoupon.isPending }}
        footer={
          <>
            <Button disabled={voidCoupon.isPending} onClick={dismissVoid}>
              {t("取消")}
            </Button>
            <SaveButton
              label={t("确认作废")}
              form={boundVoidForm}
              disabled={!canManage || !voiding || customerCoupons.isError}
              pending={voidCoupon.isPending}
              onSave={voidSubmission.submit}
            />
          </>
        }
      >
        <Form
          name="coupon-void"
          form={voidForm}
          layout="vertical"
          disabled={!canManage || voidCoupon.isPending || customerCoupons.isError}
          {...voidSubmission.formProps}
          onFinish={voidSubmission.submit}
        >
          <Typography.Paragraph>
            {locale === "en-US" ? (
              `This will void “${voiding?.templateName}”. A locked coupon must first be detached from its order; order amounts cannot be bypassed.`
            ) : (
              <>将作废“{voiding?.templateName}”。已锁定券必须先取消关联订单，不能绕过订单金额处理。</>
            )}
          </Typography.Paragraph>
          <Form.Item name="reason" label={t("作废原因")} rules={[{ required: true, whitespace: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
