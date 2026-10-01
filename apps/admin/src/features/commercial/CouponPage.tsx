import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import type { RentalCouponTemplate, RentalCustomerCoupon, SaveRentalCouponTemplateRequest } from "@rental-os/shared";
import { formatRentalMoney, rentalCurrencySymbol } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Card, Col, InputNumber, Modal, Row, Space, Tag, Typography } from "antd";
import { Form } from "@/components/ui";
import { Table } from "@/components/ui";
import { Input } from "@/components/ui";
import { Button, Drawer, Select } from "@/components/ui";
import dayjs from "dayjs";
import { useState } from "react";
import { rentalCoreApi, useSettlementCurrency } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

export function CouponPage() {
  const { message } = App.useApp();
  const { locale, t } = useLocale();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RentalCouponTemplate>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [voiding, setVoiding] = useState<RentalCustomerCoupon>();
  const [form] = Form.useForm<SaveRentalCouponTemplateRequest>();
  const [claimForm] = Form.useForm<{ templateId: string; customerId: string }>();
  const [voidForm] = Form.useForm<{ reason: string }>();
  const templates = useQuery({ queryKey: ["rental-core", "coupon-templates"], queryFn: rentalCoreApi.couponTemplates });
  const customerCoupons = useQuery({ queryKey: ["rental-core", "customer-coupons"], queryFn: () => rentalCoreApi.customerCoupons() });
  const groups = useQuery({ queryKey: ["rental-core", "groups"], queryFn: rentalCoreApi.itemGroups });
  const currency = useSettlementCurrency();
  const money = (value: number) => formatRentalMoney(Number(value), currency);
  const save = useMutation({ mutationFn: rentalCoreApi.saveCouponTemplate, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["rental-core", "coupon-templates"] }); setDrawerOpen(false); setEditing(undefined); form.resetFields(); message.success(t("优惠券模板已保存")); }, onError: () => message.error(t("保存失败，请检查编码、优惠值、发行量和有效期")) });
  const claim = useMutation({ mutationFn: (values: { templateId: string; customerId: string }) => rentalCoreApi.claimCoupon(values.templateId, values.customerId), onSuccess: async () => { setClaimOpen(false); claimForm.resetFields(); await Promise.all([queryClient.invalidateQueries({ queryKey: ["rental-core", "customer-coupons"] }), queryClient.invalidateQueries({ queryKey: ["rental-core", "coupon-templates"] })]); message.success(t("优惠券已发放到客户账户")); }, onError: () => message.error(t("发放失败：模板未启用、已领完、超过限领或不在有效期")) });
  const voidCoupon = useMutation({ mutationFn: (values: { reason: string }) => rentalCoreApi.voidCustomerCoupon(voiding!.id, values.reason), onSuccess: async () => { setVoiding(undefined); voidForm.resetFields(); await queryClient.invalidateQueries({ queryKey: ["rental-core", "customer-coupons"] }); message.success(t("客户优惠券已作废")); }, onError: () => message.error(t("作废失败：请确认优惠券未被订单锁定，并填写原因")) });

  function openEditor(record?: RentalCouponTemplate) {
    setEditing(record);
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
      <PageHeader title={t("优惠券")} description={t("管理租户优惠券模板、客户领取凭证和订单核销状态。")} note={{ title: t("优惠券与预算按订单事务流转"), description: t("报价只计算；创建订单同时锁券和预算；订单确认转为核销预算；取消释放后按有效期恢复或过期。") }} extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>{t("新增优惠券模板")}</Button>} />
      <Card className="data-panel" styles={{ body: { paddingBottom: 0 } }}>
        <QueryState loading={templates.isLoading || groups.isLoading} error={templates.error || groups.error}>
          <Table<RentalCouponTemplate> rowKey="id" dataSource={templates.data ?? []} scroll={{ x: 1100 }} columns={[
            { title: t("优惠券"), fixed: "left", render: (_, row) => <><b>{row.name}</b><br /><span className="muted">{row.code} · v{row.version}</span></> },
            { title: t("优惠"), render: (_, row) => row.discountType === "fixed_amount" ? (locale === "en-US" ? `${t("减免")} ${money(row.discountValue)}` : `减 ${money(row.discountValue)}`) : `${row.discountValue}% ${t("折扣")}${row.maximumDiscount ? (locale === "en-US" ? `, ${t("最高减免")} ${money(row.maximumDiscount)}` : `，封顶 ${money(row.maximumDiscount)}`) : ""}` },
            { title: t("使用门槛"), dataIndex: "minimumSpend", render: (value) => value > 0 ? (locale === "en-US" ? `${t("满")} ${money(value)}` : `满 ${money(value)}`) : t("无门槛") },
            { title: t("发行 / 已领"), render: (_, row) => `${row.totalQuota} / ${row.claimedQuantity}` },
            { title: t("每客限领 / 使用"), render: (_, row) => `${row.perCustomerLimit} / ${row.perCustomerUseLimit}` },
            { title: t("预算"), render: (_, row) => row.totalBudget === undefined ? t("不限") : `${money(row.lockedBudget + row.redeemedBudget)} / ${money(row.totalBudget)}` },
            { title: t("适用商品"), dataIndex: "applicableItemGroupIds", render: (ids) => ids.length ? (locale === "en-US" ? `${ids.length} ${t("个指定商品")}` : `${ids.length} 个指定商品`) : t("全部商品") },
            { title: t("有效期"), render: (_, row) => `${dayjs(row.effectiveFrom).format("YYYY-MM-DD")} → ${dayjs(row.effectiveTo).format("YYYY-MM-DD")}` },
            { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={value === "active" ? "success" : value === "draft" || value === "scheduled" ? "gold" : "default"}>{{ draft: t("草稿"), scheduled: t("待开始"), active: t("进行中"), paused: t("已暂停"), ended: t("已结束"), void: t("已作废") }[value as RentalCouponTemplate["status"]]}</Tag> },
            { title: t("操作"), fixed: "right", render: (_, row) => <Button type="link" icon={<EditOutlined />} onClick={() => openEditor(row)}>{t("编辑")}</Button> }
          ]} />
        </QueryState>
      </Card>

      <Card className="data-panel" title={<Space><span>{t("客户优惠券")}</span><Tag>{customerCoupons.data?.length ?? 0}</Tag></Space>} extra={<Button onClick={() => setClaimOpen(true)}>{t("发放优惠券")}</Button>} style={{ marginTop: 16 }}>
        <Typography.Paragraph type="secondary">{t("客户券是可交易凭证，不与模板发行配置混为一张表。")}</Typography.Paragraph>
        <QueryState loading={customerCoupons.isLoading} error={customerCoupons.error}>
          <Table<RentalCustomerCoupon> rowKey="id" dataSource={customerCoupons.data ?? []} columns={[
            { title: t("客户"), dataIndex: "customerId" },
            { title: t("优惠券"), render: (_, row) => <><b>{row.templateName}</b><br /><span className="muted">{row.templateCode}</span></> },
            { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={value === "claimed" ? "blue" : value === "locked" ? "gold" : value === "redeemed" ? "success" : "default"}>{t({ claimed: "已领取", locked: "已锁定", redeemed: "已核销", void: "已作废", expired: "已过期" }[value as string] ?? value)}</Tag> },
            { title: t("领取时间"), dataIndex: "claimedAt" },
            { title: t("关联订单"), render: (_, row) => row.redeemedOrderId ?? row.lockedOrderId ?? "-" },
            { title: t("有效期"), render: (_, row) => `${dayjs(row.effectiveFrom).format("YYYY-MM-DD")} → ${dayjs(row.effectiveTo).format("YYYY-MM-DD")}` },
            { title: t("操作"), render: (_, row) => row.status === "claimed" ? <Button danger type="link" onClick={() => setVoiding(row)}>{t("作废")}</Button> : "-" }
          ]} />
        </QueryState>
      </Card>

      <Drawer title={t(editing ? "编辑优惠券模板" : "新增优惠券模板")} size={640} open={drawerOpen} destroyOnHidden onClose={() => setDrawerOpen(false)} extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>{t("保存")}</Button>}>
        <Form<SaveRentalCouponTemplateRequest> form={form} layout="vertical" onFinish={(values) => save.mutate({ ...values, id: editing?.id })}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="code" label={t("模板编码")} rules={[{ required: true }]}><Input disabled={Boolean(editing)} /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label={t("模板名称")} rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="discountType" label={t("优惠类型")} rules={[{ required: true }]}><Select options={[{ value: "fixed_amount", label: t("固定减免") }, { value: "percentage", label: t("百分比折扣") }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="discountValue" label={t("优惠值")} rules={[{ required: true }]}><InputNumber min={0.01} precision={2} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="minimumSpend" label={t("最低消费")}><InputNumber min={0} precision={2} prefix={rentalCurrencySymbol(currency)} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="maximumDiscount" label={t("最高减免")}><InputNumber min={0} precision={2} prefix={rentalCurrencySymbol(currency)} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="totalQuota" label={t("发行总量")} rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="perCustomerLimit" label={t("每客限领")} rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="perCustomerUseLimit" label={t("每客限用")} rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="totalBudget" label={t("优惠总预算（留空不限）")}><InputNumber min={0} precision={2} prefix={rentalCurrencySymbol(currency)} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="appliesTo" label={t("作用费用")} rules={[{ required: true }]}><Select options={[{ value: "rental", label: t("商品租金与使用量") }, { value: "fulfillment", label: t("履约费") }, { value: "service", label: t("增值服务费") }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="stackableWithDiscountPlans" label={t("与自动优惠叠加")} rules={[{ required: true }]}><Select options={[{ value: true, label: t("允许") }, { value: false, label: t("不允许") }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="claimFrom" label={t("开始领取时间")} rules={[{ required: true }]}><Input placeholder="ISO 8601 / YYYY-MM-DD" /></Form.Item></Col>
            <Col span={12}><Form.Item name="claimTo" label={t("停止领取时间")} rules={[{ required: true }]}><Input placeholder="ISO 8601 / YYYY-MM-DD" /></Form.Item></Col>
            <Col span={12}><Form.Item name="effectiveFrom" label={t("开始使用时间")} rules={[{ required: true }]}><Input placeholder="ISO 8601 / YYYY-MM-DD" /></Form.Item></Col>
            <Col span={12}><Form.Item name="effectiveTo" label={t("停止使用时间")} rules={[{ required: true }]}><Input placeholder="ISO 8601 / YYYY-MM-DD" /></Form.Item></Col>
            <Col span={12}><Form.Item name="applicableRentalFrom" label={t("适用租期开始（可选）")}><Input placeholder="ISO 8601 / YYYY-MM-DD" /></Form.Item></Col>
            <Col span={12}><Form.Item name="applicableRentalTo" label={t("适用租期结束（可选）")}><Input placeholder="ISO 8601 / YYYY-MM-DD" /></Form.Item></Col>
          </Row>
          <Form.Item name="applicableItemGroupIds" label={t("适用商品（留空为全部）")}><Select mode="multiple" showSearch={{ optionFilterProp: "label" }} options={(groups.data ?? []).map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item>
          <Form.Item name="status" label={t("状态")} rules={[{ required: true }]}><Select options={[{ value: "draft", label: t("草稿") }, { value: "scheduled", label: t("待开始") }, { value: "active", label: t("进行中") }, { value: "paused", label: t("已暂停") }, { value: "ended", label: t("已结束") }, { value: "void", label: t("已作废") }]} /></Form.Item>
        </Form>
      </Drawer>
      <Modal title={t("向客户发放优惠券")} open={claimOpen} onCancel={() => setClaimOpen(false)} onOk={() => claimForm.submit()} confirmLoading={claim.isPending} destroyOnHidden>
        <Form form={claimForm} layout="vertical" onFinish={(values) => claim.mutate(values)}>
          <Form.Item name="customerId" label={t("客户 ID")} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="templateId" label={t("优惠券模板")} rules={[{ required: true }]}><Select options={(templates.data ?? []).filter((item) => item.status === "active").map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item>
        </Form>
      </Modal>
      <Modal title={t("作废客户优惠券")} open={Boolean(voiding)} onCancel={() => setVoiding(undefined)} onOk={() => voidForm.submit()} confirmLoading={voidCoupon.isPending} destroyOnHidden>
        <Form form={voidForm} layout="vertical" onFinish={(values) => voidCoupon.mutate(values)}>
          <Typography.Paragraph>{locale === "en-US" ? `This will void “${voiding?.templateName}”. A locked coupon must first be detached from its order; order amounts cannot be bypassed.` : <>将作废“{voiding?.templateName}”。已锁定券必须先取消关联订单，不能绕过订单金额处理。</>}</Typography.Paragraph>
          <Form.Item name="reason" label={t("作废原因")} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
