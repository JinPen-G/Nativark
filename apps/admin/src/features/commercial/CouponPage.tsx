import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import type { RentalCouponTemplate, RentalCustomerCoupon, SaveRentalCouponTemplateRequest } from "@store-rental/shared";
import { formatRentalMoney, rentalCurrencySymbol } from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Col, Drawer, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { rentalCoreApi, useSettlementCurrency } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

export function CouponPage() {
  const { message } = App.useApp();
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
  const save = useMutation({ mutationFn: rentalCoreApi.saveCouponTemplate, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["rental-core", "coupon-templates"] }); setDrawerOpen(false); setEditing(undefined); form.resetFields(); message.success("优惠券模板已保存"); }, onError: () => message.error("保存失败，请检查编码、优惠值、发行量和有效期") });
  const claim = useMutation({ mutationFn: (values: { templateId: string; customerId: string }) => rentalCoreApi.claimCoupon(values.templateId, values.customerId), onSuccess: async () => { setClaimOpen(false); claimForm.resetFields(); await Promise.all([queryClient.invalidateQueries({ queryKey: ["rental-core", "customer-coupons"] }), queryClient.invalidateQueries({ queryKey: ["rental-core", "coupon-templates"] })]); message.success("优惠券已发放到客户账户"); }, onError: () => message.error("发放失败：模板未启用、已领完、超过限领或不在有效期") });
  const voidCoupon = useMutation({ mutationFn: (values: { reason: string }) => rentalCoreApi.voidCustomerCoupon(voiding!.id, values.reason), onSuccess: async () => { setVoiding(undefined); voidForm.resetFields(); await queryClient.invalidateQueries({ queryKey: ["rental-core", "customer-coupons"] }); message.success("客户优惠券已作废"); }, onError: () => message.error("作废失败：请确认优惠券未被订单锁定，并填写原因") });

  function openEditor(record?: RentalCouponTemplate) {
    setEditing(record);
    form.setFieldsValue(record ?? {
      code: "", name: "", discountType: "fixed_amount", discountValue: 10, minimumSpend: 100,
      appliesTo: "rental", stackableWithDiscountPlans: true, totalQuota: 1000, perCustomerLimit: 1, perCustomerUseLimit: 1,
      effectiveFrom: dayjs().startOf("day").toISOString(), effectiveTo: dayjs().add(30, "day").endOf("day").toISOString(),
      applicableItemGroupIds: [], status: "draft"
    });
    setDrawerOpen(true);
  }

  return (
    <>
      <PageHeader title="优惠券" description="管理租户优惠券模板、客户领取凭证和订单核销状态。" note={{ title: "优惠券与预算按订单事务流转", description: "报价只计算；创建订单同时锁券和预算；订单确认转为核销预算；取消释放后按有效期恢复或过期。" }} extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>新增优惠券模板</Button>} />
      <Card className="data-panel" styles={{ body: { paddingBottom: 0 } }}>
        <QueryState loading={templates.isLoading || groups.isLoading} error={templates.error || groups.error}>
          <Table<RentalCouponTemplate> rowKey="id" dataSource={templates.data ?? []} scroll={{ x: 1100 }} columns={[
            { title: "优惠券", fixed: "left", render: (_, row) => <><b>{row.name}</b><br /><span className="muted">{row.code} · v{row.version}</span></> },
            { title: "优惠", render: (_, row) => row.discountType === "fixed_amount" ? `减 ${money(row.discountValue)}` : `${row.discountValue}% 折扣${row.maximumDiscount ? `，封顶 ${money(row.maximumDiscount)}` : ""}` },
            { title: "使用门槛", dataIndex: "minimumSpend", render: (value) => value > 0 ? `满 ${money(value)}` : "无门槛" },
            { title: "发行 / 已领", render: (_, row) => `${row.totalQuota} / ${row.claimedQuantity}` },
            { title: "每客限领 / 使用", render: (_, row) => `${row.perCustomerLimit} / ${row.perCustomerUseLimit}` },
            { title: "预算", render: (_, row) => row.totalBudget === undefined ? "不限" : `${money(row.lockedBudget + row.redeemedBudget)} / ${money(row.totalBudget)}` },
            { title: "适用商品", dataIndex: "applicableItemGroupIds", render: (ids) => ids.length ? `${ids.length} 个指定商品` : "全部商品" },
            { title: "有效期", render: (_, row) => `${dayjs(row.effectiveFrom).format("YYYY-MM-DD")} → ${dayjs(row.effectiveTo).format("YYYY-MM-DD")}` },
            { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "active" ? "success" : value === "draft" || value === "scheduled" ? "gold" : "default"}>{{ draft: "草稿", scheduled: "待开始", active: "进行中", paused: "已暂停", ended: "已结束", void: "已作废" }[value as RentalCouponTemplate["status"]]}</Tag> },
            { title: "操作", fixed: "right", render: (_, row) => <Button type="link" icon={<EditOutlined />} onClick={() => openEditor(row)}>编辑</Button> }
          ]} />
        </QueryState>
      </Card>

      <Card className="data-panel" title={<Space><span>客户优惠券</span><Tag>{customerCoupons.data?.length ?? 0}</Tag></Space>} extra={<Button onClick={() => setClaimOpen(true)}>发放优惠券</Button>} style={{ marginTop: 16 }}>
        <Typography.Paragraph type="secondary">客户券是可交易凭证，不与模板发行配置混为一张表。</Typography.Paragraph>
        <QueryState loading={customerCoupons.isLoading} error={customerCoupons.error}>
          <Table<RentalCustomerCoupon> rowKey="id" dataSource={customerCoupons.data ?? []} columns={[
            { title: "客户", dataIndex: "customerId" },
            { title: "优惠券", render: (_, row) => <><b>{row.templateName}</b><br /><span className="muted">{row.templateCode}</span></> },
            { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "claimed" ? "blue" : value === "locked" ? "gold" : value === "redeemed" ? "success" : "default"}>{value}</Tag> },
            { title: "领取时间", dataIndex: "claimedAt" },
            { title: "关联订单", render: (_, row) => row.redeemedOrderId ?? row.lockedOrderId ?? "-" },
            { title: "有效期", render: (_, row) => `${dayjs(row.effectiveFrom).format("YYYY-MM-DD")} → ${dayjs(row.effectiveTo).format("YYYY-MM-DD")}` },
            { title: "操作", render: (_, row) => row.status === "claimed" ? <Button danger type="link" onClick={() => setVoiding(row)}>作废</Button> : "-" }
          ]} />
        </QueryState>
      </Card>

      <Drawer title={editing ? "编辑优惠券模板" : "新增优惠券模板"} size={640} open={drawerOpen} destroyOnHidden onClose={() => setDrawerOpen(false)} extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>保存</Button>}>
        <Form<SaveRentalCouponTemplateRequest> form={form} layout="vertical" onFinish={(values) => save.mutate({ ...values, id: editing?.id })}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="code" label="模板编码" rules={[{ required: true }]}><Input disabled={Boolean(editing)} /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label="模板名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="discountType" label="优惠类型" rules={[{ required: true }]}><Select options={[{ value: "fixed_amount", label: "固定减免" }, { value: "percentage", label: "百分比折扣" }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="discountValue" label="优惠值" rules={[{ required: true }]}><InputNumber min={0.01} precision={2} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="minimumSpend" label="最低消费"><InputNumber min={0} precision={2} prefix={rentalCurrencySymbol(currency)} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="maximumDiscount" label="最高减免"><InputNumber min={0} precision={2} prefix={rentalCurrencySymbol(currency)} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="totalQuota" label="发行总量" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="perCustomerLimit" label="每客限领" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="perCustomerUseLimit" label="每客限用" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="totalBudget" label="优惠总预算（留空不限）"><InputNumber min={0} precision={2} prefix={rentalCurrencySymbol(currency)} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="appliesTo" label="作用费用" rules={[{ required: true }]}><Select options={[{ value: "rental", label: "商品租金与使用量" }, { value: "fulfillment", label: "履约费" }, { value: "service", label: "增值服务费" }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="stackableWithDiscountPlans" label="与自动优惠叠加" rules={[{ required: true }]}><Select options={[{ value: true, label: "允许" }, { value: false, label: "不允许" }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="effectiveFrom" label="生效时间" rules={[{ required: true }]}><Input placeholder="ISO 8601 / YYYY-MM-DD" /></Form.Item></Col>
            <Col span={12}><Form.Item name="effectiveTo" label="失效时间" rules={[{ required: true }]}><Input placeholder="ISO 8601 / YYYY-MM-DD" /></Form.Item></Col>
          </Row>
          <Form.Item name="applicableItemGroupIds" label="适用商品（留空为全部）"><Select mode="multiple" showSearch optionFilterProp="label" options={(groups.data ?? []).map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: "draft", label: "草稿" }, { value: "scheduled", label: "待开始" }, { value: "active", label: "进行中" }, { value: "paused", label: "已暂停" }, { value: "ended", label: "已结束" }, { value: "void", label: "已作废" }]} /></Form.Item>
        </Form>
      </Drawer>
      <Modal title="向客户发放优惠券" open={claimOpen} onCancel={() => setClaimOpen(false)} onOk={() => claimForm.submit()} confirmLoading={claim.isPending} destroyOnHidden>
        <Form form={claimForm} layout="vertical" onFinish={(values) => claim.mutate(values)}>
          <Form.Item name="customerId" label="客户 ID" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="templateId" label="优惠券模板" rules={[{ required: true }]}><Select options={(templates.data ?? []).filter((item) => item.status === "active").map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item>
        </Form>
      </Modal>
      <Modal title="作废客户优惠券" open={Boolean(voiding)} onCancel={() => setVoiding(undefined)} onOk={() => voidForm.submit()} confirmLoading={voidCoupon.isPending} destroyOnHidden>
        <Form form={voidForm} layout="vertical" onFinish={(values) => voidCoupon.mutate(values)}>
          <Typography.Paragraph>将作废“{voiding?.templateName}”。已锁定券必须先取消关联订单，不能绕过订单金额处理。</Typography.Paragraph>
          <Form.Item name="reason" label="作废原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
