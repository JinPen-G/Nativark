import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { VehicleGroupMaster } from "@store-rental/shared";
import { Alert, App, Button, Card, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Table, Tag } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/api/rental";
import { deleteVehicleGroup } from "@/api/operations";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

export function CatalogPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<VehicleGroupMaster>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form] = Form.useForm<VehicleGroupMaster>();
  const query = useQuery({ queryKey: ["item-groups"], queryFn: api.itemGroups });
  const save = useMutation({ mutationFn: api.saveItemGroup, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["item-groups"] }); setDrawerOpen(false); setEditing(undefined); form.resetFields(); message.success("标的分组已保存"); }, onError: () => message.error("保存失败，请检查分组编码和兼容字段") });
  const remove = useMutation({ mutationFn: deleteVehicleGroup, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["item-groups"] }); message.success("标的分组已删除"); }, onError: () => message.error("分组仍被资产或订单引用，不能删除") });
  const rows = useMemo(() => (query.data ?? []).filter((item) => `${item.storeProductGroupName}${item.brand}${item.model}`.toLowerCase().includes(keyword.toLowerCase())), [query.data, keyword]);

  function openEditor(record?: VehicleGroupMaster) {
    setEditing(record);
    form.setFieldsValue(record ?? {
      id: "",
      vehicleType: "equipment",
      brand: "",
      model: "",
      year: String(new Date().getFullYear()),
      originType: "self_owned",
      seats: 0,
      displacement: "N/A",
      trunkCapacity: "N/A",
      features: [],
      storeProductGroupName: "",
      dailyPrice: 0,
      freeKm: 0,
      pricePerKm: 0,
      status: "enabled",
      vehicleCount: 0,
      reservedOrderCount: 0,
      isSpecial: false
    });
    setDrawerOpen(true);
  }

  return (
    <>
      <PageHeader title="标的分组" description="管理可预约的商品组、套装和定价基础。当前数据由原车型组 API 兼容投影。" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>新增标的分组</Button>} />
      <Card className="data-panel" styles={{ body: { paddingBottom: 0 } }}>
        <Space style={{ marginBottom: 16 }}><Input allowClear prefix={<SearchOutlined />} placeholder="搜索标的名称、品牌或型号" value={keyword} onChange={(event) => setKeyword(event.target.value)} style={{ width: 300 }} /></Space>
        <QueryState loading={query.isLoading} error={query.error}>
          <Table rowKey="id" dataSource={rows} scroll={{ x: 1000 }} columns={[
            { title: "标的分组", dataIndex: "storeProductGroupName", fixed: "left", render: (value) => <b>{value}</b> },
            { title: "品牌 / 型号", render: (_, record) => `${record.brand || "-"} ${record.model || ""}` },
            { title: "规格摘要", render: (_, record) => record.features?.slice(0, 2).join(" · ") || "待配置" },
            { title: "基础租金", dataIndex: "dailyPrice", align: "right", render: (value) => `¥${Number(value).toLocaleString()}/天` },
            { title: "可用资产", dataIndex: "vehicleCount", align: "right", render: (value) => value ?? 0 },
            { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{value === "enabled" ? "启用" : "停用"}</Tag> },
            { title: "操作", fixed: "right", render: (_, record) => <Space size={0}><Button type="link" onClick={() => openEditor(record)}>编辑</Button><Button type="link" danger onClick={() => modal.confirm({ title: `删除 ${record.storeProductGroupName}？`, content: "只有未被资产、定价或订单引用的分组才能删除。", okButtonProps: { danger: true }, onOk: () => remove.mutateAsync(record.id) })}>删除</Button></Space> }
          ]} />
        </QueryState>
      </Card>
      <Drawer title={editing ? "编辑标的分组" : "新增标的分组"} width={600} open={drawerOpen} destroyOnHidden onClose={() => setDrawerOpen(false)} extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>保存</Button>}>
        <Alert type="warning" showIcon message="当前仍写入 VehicleGroup 兼容模型" description="车辆类型、座位数、排量、免费里程等字段尚未被品类 schema 替代；非车辆租户正式启用前必须迁移到 RentalItemGroup。" style={{ marginBottom: 20 }} />
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate({ ...editing, ...values })}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Form.Item name="storeProductGroupName" label="标的分组名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="brand" label="品牌" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="model" label="型号" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="vehicleType" label="兼容类型" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="year" label="年份 / 版本" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="originType" label="资产来源" rules={[{ required: true }]}><Select options={[{ value: "self_owned", label: "自有" }, { value: "leased", label: "租入" }, { value: "partner", label: "合作方" }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: "enabled", label: "启用" }, { value: "disabled", label: "停用" }]} /></Form.Item></Col>
          </Row>
          <Form.Item name="features" label="规格 / 特性"><Select mode="tags" tokenSeparators={[",", "，"]} /></Form.Item>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="dailyPrice" label="日租金" rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="freeKm" label="免费用量（兼容公里）" rules={[{ required: true }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="pricePerKm" label="超量单价" rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="seats" label="容量（兼容座位）" rules={[{ required: true }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="displacement" label="规格（兼容排量）" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={8}><Form.Item name="trunkCapacity" label="收纳规格（兼容后备箱）" rules={[{ required: true }]}><Input /></Form.Item></Col>
          </Row>
        </Form>
      </Drawer>
    </>
  );
}
