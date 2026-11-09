import { ListFilters, useListFilter } from "@/components/ui";
import { couponCards } from "./couponCards";
import { DataTableText, DatePicker, ListSection, SaveButton, Tabs } from "@/components/ui";
import { EditOutlined, PlusOutlined } from "@/components/ui/icons";
import type { RentalCouponTemplate, RentalCustomerCoupon, SaveRentalCouponTemplateRequest } from "@rental-os/shared";
import { formatRentalMoney, rentalCurrencySymbol } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Col, InputNumber, Row, Tag, Typography } from "antd";
import { App, Modal } from "@/components/ui";
import { Form } from "@/components/ui";
import { Table } from "@/components/ui";
import { Input } from "@/components/ui";
import { Button, Select } from "@/components/ui";
import dayjs from "dayjs";
import { useState } from "react";
import { rentalCoreApi, useSettlementCurrency } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { ADMIN_TABLE_COLUMN_WIDTH } from "@/app/designTokens";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { useModalDismissal } from "@/components/ui/useModalDismissal";

const dateFieldBinding = {
  getValueProps: (value?: string) => ({ value: value ? dayjs(value) : null }),
  getValueFromEvent: (value: dayjs.Dayjs | null) => value?.toISOString(),
};

export function CouponPage() {
  const scope = useListQueryIdentity();
  return <CouponWorkspace key={scope} scope={scope} />;
}

function CouponWorkspace({ scope }: { scope: string }) {
  const { message } = App.useApp();
  const { locale, t } = useLocale();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RentalCouponTemplate>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [voiding, setVoiding] = useState<RentalCustomerCoupon>();
  const [view, setView] = useState("templates");
  const [form] = Form.useForm<SaveRentalCouponTemplateRequest>();
  const discountType = Form.useWatch("discountType", form);
  const [claimForm] = Form.useForm<{ templateId: string; customerId: string }>();
  const [voidForm] = Form.useForm<{ reason: string }>();
  const editor = useModalDismissal(drawerOpen, () => { setDrawerOpen(false); setEditing(undefined); form.resetFields(); });
  const claimDialog = useModalDismissal(claimOpen, () => { setClaimOpen(false); claimForm.resetFields(); });
  const voidDialog = useModalDismissal(Boolean(voiding), () => { setVoiding(undefined); voidForm.resetFields(); });
  const templates = useQuery({ queryKey: ["rental-core", "coupon-templates", scope], queryFn: rentalCoreApi.couponTemplates });
  const couponFilter = useListFilter(templates.data, { fields: row => [row.name, row.code], status: row => row.status });
  const customerCoupons = useQuery({ queryKey: ["rental-core", "customer-coupons", scope], queryFn: () => rentalCoreApi.customerCoupons() });
  const customerCouponFilter = useListFilter(customerCoupons.data, { fields: row => [row.templateName, row.templateCode, row.customerId, row.redeemedOrderId, row.lockedOrderId], status: row => row.status });
  const groups = useQuery({ queryKey: ["rental-core", "groups", scope], queryFn: rentalCoreApi.itemGroups });
  const currency = useSettlementCurrency();
  const money = (value: number) => formatRentalMoney(Number(value), currency);
  const save = useMutation({ mutationFn: rentalCoreApi.saveCouponTemplate, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["rental-core", "coupon-templates"] }); editor.dismiss(); message.success(t("优惠券模板已保存")); }, onError: () => message.error(t("保存失败，请检查编码、优惠值、发行量和有效期")) });
  const claim = useMutation({ mutationFn: (values: { templateId: string; customerId: string }) => rentalCoreApi.claimCoupon(values.templateId, values.customerId), onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["rental-core", "customer-coupons"] }), queryClient.invalidateQueries({ queryKey: ["rental-core", "coupon-templates"] })]); claimDialog.dismiss(); message.success(t("优惠券已发放到客户账户")); }, onError: () => message.error(t("发放失败：模板未启用、已领完、超过限领或不在有效期")) });
  const voidCoupon = useMutation({ mutationFn: (values: { reason: string }) => rentalCoreApi.voidCustomerCoupon(voiding!.id, values.reason), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["rental-core", "customer-coupons"] }); voidDialog.dismiss(); message.success(t("客户优惠券已作废")); }, onError: () => message.error(t("作废失败：请确认优惠券未被订单锁定，并填写原因")) });
  const editorUnavailable = templates.isPending || groups.isPending || templates.isError || groups.isError;

  function openEditor(record?: RentalCouponTemplate) {
    if (editorUnavailable || save.isPending) return;
    setEditing(record);
    form.resetFields();
    form.setFieldsValue(record ?? {
      code: "", name: "", discountType: "fixed_amount", discountValue: 10, minimumSpend: 100,
      appliesTo: "rental", stackableWithDiscountPlans: true, totalQuota: 1000, perCustomerLimit: 1, perCustomerUseLimit: 1,
      claimFrom: dayjs().startOf("day").toISOString(), claimTo: dayjs().add(30, "day").endOf("day").toISOString(),
      effectiveFrom: dayjs().startOf("day").toISOString(), effectiveTo: dayjs().add(30, "day").endOf("day").toISOString(),
      applicableItemGroupIds: [], status: "draft"
    });
    setDrawerOpen(true);
  }

  return (
    <>
      <PageHeader title={t("优惠券")} note={{ title: t("优惠券与预算按订单事务流转"), description: t("报价只计算；创建订单同时锁券和预算；订单确认转为核销预算；取消释放后按有效期恢复或过期。") }} extra={view === "templates"
        ? <Button type="primary" icon={<PlusOutlined />} disabled={editorUnavailable || save.isPending} onClick={() => openEditor()}>{t("新增优惠券模板")}</Button>
        : <Button type="primary" icon={<PlusOutlined />} disabled={claim.isPending} onClick={() => { claimForm.resetFields(); setClaimOpen(true); }}>{t("发放优惠券")}</Button>} />
      <Tabs activeKey={view} onChange={setView} aria-label={t("优惠券")} items={[
        { key: "templates", label: t("优惠券模板"), children:
      <ListSection controls={<ListFilters filter={couponFilter} placeholder="优惠券名称或编码" options={[{ value: "draft", label: "草稿" }, { value: "scheduled", label: "待开始" }, { value: "active", label: "进行中" }, { value: "paused", label: "已暂停" }, { value: "ended", label: "已结束" }, { value: "void", label: "已作废" }]} />}>
        <QueryState loading={templates.isLoading || groups.isLoading} error={templates.error || groups.error} onRetry={() => Promise.all([templates.refetch({ throwOnError: true }), groups.refetch({ throwOnError: true })])}>
          <Table<RentalCouponTemplate> cardView={{ ...couponCards({ t, money, groups: groups.data ?? [], edit: openEditor }), defaultView: "cards" }} exportConfig={{ filename: t("优惠券"), fields: [{ label: t("编码"), value: row => row.code }, { label: t("名称"), value: row => row.name }, { label: t("版本"), value: row => row.version }, { label: t("状态"), value: row => row.status }, { label: t("优惠"), value: row => row.discountValue }] }} rowKey="id" onRefresh={() => templates.refetch()} loading={templates.isLoading} refreshing={templates.isFetching} dataSource={couponFilter.rows} pagination={couponFilter.pagination} scroll={{ x: 1100 }} columns={[
            { title: t("优惠券"), dataIndex: "name", minWidth: ADMIN_TABLE_COLUMN_WIDTH.identity, fixed: "left", render: (_, row) => <DataTableText primary={row.name} secondary={`${row.code} · v${row.version}`} /> },
            { title: t("优惠"), render: (_, row) => row.discountType === "fixed_amount" ? (locale === "en-US" ? `${t("减免")} ${money(row.discountValue)}` : `减 ${money(row.discountValue)}`) : `${t("减免 {value}%", { value: row.discountValue })}${row.maximumDiscount !== undefined ? (locale === "en-US" ? `, ${t("最高减免")} ${money(row.maximumDiscount)}` : `，封顶 ${money(row.maximumDiscount)}`) : ""}` },
            { title: t("使用门槛"), dataIndex: "minimumSpend", render: (value) => value > 0 ? (locale === "en-US" ? `${t("满")} ${money(value)}` : `满 ${money(value)}`) : t("无门槛") },
            { title: t("发行 / 已领"), render: (_, row) => `${row.totalQuota} / ${row.claimedQuantity}` },
            { title: t("每客限领 / 使用"), render: (_, row) => `${row.perCustomerLimit} / ${row.perCustomerUseLimit}` },
            { title: t("预算"), render: (_, row) => row.totalBudget === undefined ? t("不限") : `${money(row.lockedBudget + row.redeemedBudget)} / ${money(row.totalBudget)}` },
            { title: t("适用商品"), dataIndex: "applicableItemGroupIds", render: (ids) => ids.length ? (locale === "en-US" ? `${ids.length} ${t("个指定商品")}` : `${ids.length} 个指定商品`) : t("全部商品") },
            { title: t("有效期"), render: (_, row) => <DataTableText primary={dayjs(row.effectiveFrom).format("YYYY-MM-DD")} secondary={`→ ${dayjs(row.effectiveTo).format("YYYY-MM-DD")}`} /> },
            { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={value === "active" ? "success" : value === "draft" || value === "scheduled" ? "gold" : "default"}>{{ draft: t("草稿"), scheduled: t("待开始"), active: t("进行中"), paused: t("已暂停"), ended: t("已结束"), void: t("已作废") }[value as RentalCouponTemplate["status"]]}</Tag> },
            { title: t("操作"), fixed: "right", render: (_, row) => <Button type="link" icon={<EditOutlined />} onClick={() => openEditor(row)}>{t("编辑")}</Button> }
          ]} />
        </QueryState>
      </ListSection> },
        { key: "issued", label: t("客户优惠券"), children:
      <ListSection controls={<ListFilters filter={customerCouponFilter} placeholder="优惠券、客户编号或订单" options={[{ value: "claimed", label: "已领取" }, { value: "locked", label: "已锁定" }, { value: "redeemed", label: "已核销" }, { value: "expired", label: "已过期" }, { value: "void", label: "已作废" }]} />}>

        <QueryState loading={customerCoupons.isLoading} error={customerCoupons.error} onRetry={() => customerCoupons.refetch({ throwOnError: true })}>
          <Table<RentalCustomerCoupon> exportConfig={{ filename: t("客户优惠券"), fields: [{ label: t("优惠券"), value: row => row.templateName }, { label: t("编码"), value: row => row.templateCode }, { label: t("状态"), value: row => row.status }] }} rowKey="id" onRefresh={() => customerCoupons.refetch()} loading={customerCoupons.isLoading} refreshing={customerCoupons.isFetching} dataSource={customerCouponFilter.rows} pagination={customerCouponFilter.pagination} columns={[
            { title: t("优惠券"), dataIndex: "templateName", minWidth: ADMIN_TABLE_COLUMN_WIDTH.identity, render: (_, row) => <DataTableText primary={row.templateName} secondary={row.templateCode} /> },
            { title: t("客户"), dataIndex: "customerId", minWidth: ADMIN_TABLE_COLUMN_WIDTH.identifier },
            { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={value === "claimed" ? "blue" : value === "locked" ? "gold" : value === "redeemed" ? "success" : "default"}>{t({ claimed: "已领取", locked: "已锁定", redeemed: "已核销", void: "已作废", expired: "已过期" }[value as string] ?? value)}</Tag> },
            { title: t("领取时间"), dataIndex: "claimedAt", render: (value) => value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—" },
            { title: t("关联订单"), render: (_, row) => row.redeemedOrderId ?? row.lockedOrderId ?? "-" },
            { title: t("有效期"), render: (_, row) => <div><span>{dayjs(row.effectiveFrom).format("YYYY-MM-DD")}</span><br /><span className="muted">→ {dayjs(row.effectiveTo).format("YYYY-MM-DD")}</span></div> },
            { title: t("操作"), render: (_, row) => row.status === "claimed" ? <Button danger type="link" disabled={voidCoupon.isPending} onClick={() => { voidForm.resetFields(); setVoiding(row); }}>{t("作废")}</Button> : "-" }
          ]} />
        </QueryState>
      </ListSection> }
      ]} />

      <Modal presentation="side" title={t(editing ? "编辑优惠券模板" : "新增优惠券模板")} width={640} open={editor.visible} destroyOnHidden onCancel={editor.dismiss} afterClose={editor.afterClose}
        closable={!save.isPending} keyboard={!save.isPending} maskClosable={!save.isPending}
        footer={<><Button disabled={save.isPending} onClick={editor.dismiss}>{t("取消")}</Button><SaveButton label={t("保存")} form={form} disabled={editorUnavailable} pending={save.isPending} onSave={(values) => editorUnavailable || save.isPending ? Promise.reject(new Error("Operation unavailable")) : save.mutateAsync({ ...values, id: editing?.id })} /></>}>
        <Form<SaveRentalCouponTemplateRequest> name="coupon-template" form={form} layout="vertical" disabled={editorUnavailable || save.isPending} onFinish={(values) => { if (!editorUnavailable && !save.isPending) save.mutate({ ...values, id: editing?.id }); }}>
          <SettingsWorkspace sections={[
          { key: "profile", label: locale === "en-US" ? t("详情") : t("基本资料"), content: <div>
          <Row gutter={16}>
            <Col span={24}><Form.Item name="name" label={t("模板名称")} rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="code" label={t("模板编码")} rules={[{ required: true }]}><Input disabled={Boolean(editing) || editorUnavailable || save.isPending} /></Form.Item></Col>
            <Col span={12}><Form.Item name="status" label={t("状态")} rules={[{ required: true }]}><Select options={[{ value: "draft", label: t("草稿") }, { value: "scheduled", label: t("待开始") }, { value: "active", label: t("进行中") }, { value: "paused", label: t("已暂停") }, { value: "ended", label: t("已结束") }, { value: "void", label: t("已作废") }]} /></Form.Item></Col>
          </Row>
          </div> },
          { key: "discount", label: t("优惠设置"), content: <div>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="discountType" label={t("优惠类型")} rules={[{ required: true }]}><Select options={[{ value: "fixed_amount", label: t("固定减免") }, { value: "percentage", label: t("百分比减免") }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="discountValue" label={t(discountType === "percentage" ? "减免比例（%）" : "减免金额")} rules={[{ required: true }]}><InputNumber min={0.01} max={discountType === "percentage" ? 100 : undefined} precision={2} prefix={discountType === "percentage" ? undefined : rentalCurrencySymbol(currency)} suffix={discountType === "percentage" ? "%" : undefined} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="minimumSpend" label={t("最低消费")}><InputNumber min={0} precision={2} prefix={rentalCurrencySymbol(currency)} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="maximumDiscount" label={t("最高减免")}><InputNumber min={0} precision={2} prefix={rentalCurrencySymbol(currency)} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="appliesTo" label={t("作用费用")} rules={[{ required: true }]}><Select options={[{ value: "rental", label: t("商品租金与使用量") }, { value: "fulfillment", label: t("履约费") }, { value: "service", label: t("增值服务费") }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="stackableWithDiscountPlans" label={t("与自动优惠叠加")} rules={[{ required: true }]}><Select options={[{ value: true, label: t("允许") }, { value: false, label: t("不允许") }]} /></Form.Item></Col>
          </Row>
          <Form.Item name="applicableItemGroupIds" label={t("适用商品（留空为全部）")}><Select mode="multiple" showSearch={{ optionFilterProp: "label" }} options={(groups.data ?? []).map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item>
          </div> },
          { key: "schedule", label: locale === "en-US" ? t("日期") : t("领取与使用"), content: <div>
          <Row gutter={16}>
            <Col span={12}><Form.Item {...dateFieldBinding} name="claimFrom" label={t("开始领取时间")} rules={[{ required: true }]}><DatePicker showTime needConfirm style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item {...dateFieldBinding} name="claimTo" label={t("停止领取时间")} rules={[{ required: true }]}><DatePicker showTime needConfirm style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item {...dateFieldBinding} name="effectiveFrom" label={t("开始使用时间")} rules={[{ required: true }]}><DatePicker showTime needConfirm style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item {...dateFieldBinding} name="effectiveTo" label={t("停止使用时间")} rules={[{ required: true }]}><DatePicker showTime needConfirm style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item {...dateFieldBinding} name="applicableRentalFrom" label={t("适用租期开始（可选）")}><DatePicker showTime needConfirm allowClear style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item {...dateFieldBinding} name="applicableRentalTo" label={t("适用租期结束（可选）")}><DatePicker showTime needConfirm allowClear style={{ width: "100%" }} /></Form.Item></Col>
          </Row>
          </div> },
          { key: "quota", label: locale === "en-US" ? t("发行限制") : t("发行与预算"), content: <div>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="totalQuota" label={t("发行总量")} rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="perCustomerLimit" label={t("每客限领")} rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="perCustomerUseLimit" label={t("每客限用")} rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="totalBudget" label={t("优惠总预算（留空不限）")}><InputNumber min={0} precision={2} prefix={rentalCurrencySymbol(currency)} style={{ width: "100%" }} /></Form.Item></Col>
          </Row>
          </div> }
          ]} />
        </Form>
      </Modal>
      <Modal presentation="dialog" title={t("向客户发放优惠券")} open={claimDialog.visible} onCancel={claimDialog.dismiss} afterClose={claimDialog.afterClose} destroyOnHidden
        closable={!claim.isPending} keyboard={!claim.isPending} maskClosable={!claim.isPending}
        footer={<><Button disabled={claim.isPending} onClick={claimDialog.dismiss}>{t("取消")}</Button><SaveButton label={t("确认发放")} form={claimForm} disabled={!templates.isSuccess} pending={claim.isPending} onSave={values => !templates.isSuccess || claim.isPending ? Promise.reject(new Error("Operation unavailable")) : claim.mutateAsync(values)} /></>}>
        <QueryState loading={templates.isLoading} error={templates.error} onRetry={() => templates.refetch({ throwOnError: true })}>
        <Form name="coupon-claim" form={claimForm} layout="vertical" disabled={!templates.isSuccess || claim.isPending} onFinish={(values) => { if (templates.isSuccess && !claim.isPending) claim.mutate(values); }}>
          <Form.Item name="customerId" label={t("客户 ID")} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="templateId" label={t("优惠券模板")} rules={[{ required: true }]}><Select options={(templates.data ?? []).filter((item) => item.status === "active").map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item>
        </Form>
        </QueryState>
      </Modal>
      <Modal presentation="dialog" title={t("作废客户优惠券")} open={voidDialog.visible} onCancel={voidDialog.dismiss} afterClose={voidDialog.afterClose} destroyOnHidden
        closable={!voidCoupon.isPending} keyboard={!voidCoupon.isPending} maskClosable={!voidCoupon.isPending}
        footer={<><Button disabled={voidCoupon.isPending} onClick={voidDialog.dismiss}>{t("取消")}</Button><SaveButton label={t("确认作废")} form={voidForm} disabled={!voiding || customerCoupons.isError} pending={voidCoupon.isPending} onSave={values => !voiding || customerCoupons.isError || voidCoupon.isPending ? Promise.reject(new Error("Operation unavailable")) : voidCoupon.mutateAsync(values)} /></>}>
        <Form name="coupon-void" form={voidForm} layout="vertical" disabled={voidCoupon.isPending || customerCoupons.isError} onFinish={(values) => { if (voiding && !customerCoupons.isError && !voidCoupon.isPending) voidCoupon.mutate(values); }}>
          <Typography.Paragraph>{locale === "en-US" ? `This will void “${voiding?.templateName}”. A locked coupon must first be detached from its order; order amounts cannot be bypassed.` : <>将作废“{voiding?.templateName}”。已锁定券必须先取消关联订单，不能绕过订单金额处理。</>}</Typography.Paragraph>
          <Form.Item name="reason" label={t("作废原因")} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
