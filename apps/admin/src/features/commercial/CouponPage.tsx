import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import type { RentalCouponTemplate, RentalCustomerCoupon, SaveRentalCouponTemplateRequest } from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, Drawer, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

export function CouponPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RentalCouponTemplate>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [form] = Form.useForm<SaveRentalCouponTemplateRequest>();
  const [claimForm] = Form.useForm<{ templateId: string; customerId: string }>();
  const templates = useQuery({ queryKey: ["rental-core", "coupon-templates"], queryFn: rentalCoreApi.couponTemplates });
  const customerCoupons = useQuery({ queryKey: ["rental-core", "customer-coupons"], queryFn: () => rentalCoreApi.customerCoupons() });
  const groups = useQuery({ queryKey: ["rental-core", "groups"], queryFn: rentalCoreApi.itemGroups });
  const save = useMutation({ mutationFn: rentalCoreApi.saveCouponTemplate, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["rental-core", "coupon-templates"] }); setDrawerOpen(false); setEditing(undefined); form.resetFields(); message.success("优惠券模板已保存"); }, onError: () => message.error("保存失败，请检查编码、优惠值、发行量和有效期") });
  const claim = useMutation({ mutationFn: (values: { templateId: string; customerId: string }) => rentalCoreApi.claimCoupon(values.templateId, values.customerId), onSuccess: async () => { setClaimOpen(false); claimForm.resetFields(); await Promise.all([queryClient.invalidateQueries({ queryKey: ["rental-core", "customer-coupons"] }), queryClient.invalidateQueries({ queryKey: ["rental-core", "coupon-templates"] })]); message.success("优惠券已发放到客户账户"); }, onError: () => message.error("发放失败：模板未启用、已领完、超过限领或不在有效期") });

  function openEditor(record?: RentalCouponTemplate) {
    setEditing(record);
    form.setFieldsValue(record ?? {
      code: "", name: "", discountType: "fixed_amount", discountValue: 10, minimumSpend: 100,
      totalQuota: 1000, perCustomerLimit: 1, effectiveFrom: dayjs().startOf("day").toISOString(), effectiveTo: dayjs().add(30, "day").endOf("day").toISOString(),
      applicableItemGroupIds: [], status: "draft"
    });
    setDrawerOpen(true);
  }

  return (
    <>
      <PageHeader title="优惠券" description="管理租户优惠券模板、客户领取凭证和订单核销状态。" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>新增优惠券模板</Button>} />
      <Alert type="info" showIcon message="优惠券状态机已接入服务端报价与订单" description="发放后为 claimed；创建订单锁定为 locked；确认订单核销为 redeemed；订单取消会退回 claimed。额度与每客限领均由服务端校验。" style={{ marginBottom: 16 }} />
      <Card className="data-panel" styles={{ body: { paddingBottom: 0 } }}>
        <QueryState loading={templates.isLoading || groups.isLoading} error={templates.error || groups.error}>
          <Table<RentalCouponTemplate> rowKey="id" dataSource={templates.data ?? []} scroll={{ x: 1100 }} columns={[
            { title: "优惠券", fixed: "left", render: (_, row) => <><b>{row.name}</b><br /><span className="muted">{row.code} · v{row.version}</span></> },
            { title: "优惠", render: (_, row) => row.discountType === "fixed_amount" ? `减 ¥${row.discountValue}` : `${row.discountValue}% 折扣${row.maximumDiscount ? `，封顶 ¥${row.maximumDiscount}` : ""}` },
            { title: "使用门槛", dataIndex: "minimumSpend", render: (value) => value > 0 ? `满 ¥${value}` : "无门槛" },
            { title: "发行 / 已领", render: (_, row) => `${row.totalQuota} / ${row.claimedQuantity}` },
            { title: "每客限领", dataIndex: "perCustomerLimit" },
            { title: "适用商品", dataIndex: "applicableItemGroupIds", render: (ids) => ids.length ? `${ids.length} 个指定商品` : "全部商品" },
            { title: "有效期", render: (_, row) => `${dayjs(row.effectiveFrom).format("YYYY-MM-DD")} → ${dayjs(row.effectiveTo).format("YYYY-MM-DD")}` },
            { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "enabled" ? "success" : value === "draft" ? "gold" : "default"}>{value === "enabled" ? "启用" : value === "draft" ? "草稿" : "停用"}</Tag> },
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
            { title: "有效期", render: (_, row) => `${dayjs(row.effectiveFrom).format("YYYY-MM-DD")} → ${dayjs(row.effectiveTo).format("YYYY-MM-DD")}` }
          ]} />
        </QueryState>
      </Card>

      <Drawer title={editing ? "编辑优惠券模板" : "新增优惠券模板"} width={640} open={drawerOpen} destroyOnHidden onClose={() => setDrawerOpen(false)} extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>保存</Button>}>
        <Form<SaveRentalCouponTemplateRequest> form={form} layout="vertical" onFinish={(values) => save.mutate({ ...values, id: editing?.id })}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="code" label="模板编码" rules={[{ required: true }]}><Input disabled={Boolean(editing)} /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label="模板名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="discountType" label="优惠类型" rules={[{ required: true }]}><Select options={[{ value: "fixed_amount", label: "固定减免" }, { value: "percentage", label: "百分比折扣" }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="discountValue" label="优惠值" rules={[{ required: true }]}><InputNumber min={0.01} precision={2} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="minimumSpend" label="最低消费"><InputNumber min={0} precision={2} prefix="¥" style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="maximumDiscount" label="最高减免"><InputNumber min={0} precision={2} prefix="¥" style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="totalQuota" label="发行总量" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="perCustomerLimit" label="每客限领" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="effectiveFrom" label="生效时间" rules={[{ required: true }]}><Input placeholder="ISO 8601 / YYYY-MM-DD" /></Form.Item></Col>
            <Col span={12}><Form.Item name="effectiveTo" label="失效时间" rules={[{ required: true }]}><Input placeholder="ISO 8601 / YYYY-MM-DD" /></Form.Item></Col>
          </Row>
          <Form.Item name="applicableItemGroupIds" label="适用商品（留空为全部）"><Select mode="multiple" showSearch optionFilterProp="label" options={(groups.data ?? []).map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: "draft", label: "草稿" }, { value: "enabled", label: "启用" }, { value: "disabled", label: "停用" }]} /></Form.Item>
        </Form>
      </Drawer>
      <Modal title="向客户发放优惠券" open={claimOpen} onCancel={() => setClaimOpen(false)} onOk={() => claimForm.submit()} confirmLoading={claim.isPending} destroyOnHidden>
        <Form form={claimForm} layout="vertical" onFinish={(values) => claim.mutate(values)}>
          <Form.Item name="customerId" label="客户 ID" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="templateId" label="优惠券模板" rules={[{ required: true }]}><Select options={(templates.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
