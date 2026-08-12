import { EnvironmentOutlined, PlusOutlined } from "@ant-design/icons";
import type { StoreStationHierarchyNode, StoreStationSummary } from "@store-rental/shared";
import { Alert, App, Button, Card, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Switch, Table, Tag, Tree, type TreeDataNode } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/api/rental";
import { listStationHierarchy } from "@/api/operations";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

function toTreeData(nodes: StoreStationHierarchyNode[]): TreeDataNode[] {
  return nodes.map((node) => ({ key: node.id, title: `${node.label} (${node.stationCount})`, children: node.children ? toTreeData(node.children) : undefined }));
}

export function LocationPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<StoreStationSummary>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form] = Form.useForm<StoreStationSummary>();
  const query = useQuery({ queryKey: ["locations"], queryFn: () => api.locations({ page: 1, pageSize: 200 }) });
  const hierarchy = useQuery({ queryKey: ["location-hierarchy"], queryFn: listStationHierarchy });
  const save = useMutation({ mutationFn: api.saveLocation, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["locations"] }); setDrawerOpen(false); setEditing(undefined); form.resetFields(); message.success("履约网点已保存"); }, onError: () => message.error("网点保存失败，请检查编码、容量和联系方式") });

  function openEditor(record?: StoreStationSummary) {
    setEditing(record);
    form.setFieldsValue(record ?? {
      id: "",
      name: "",
      parentStoreName: "",
      stationType: "fulfillment_location",
      serviceCapabilities: ["pickup", "return"],
      parkingTotal: 0,
      parkingAvailable: 0,
      status: "enabled",
      serviceStatus: "normal",
      address: "",
      contactName: "",
      contactPhone: "",
      storeRentalEnabled: true,
      storeSelfServiceEnabled: false
    });
    setDrawerOpen(true);
  }

  return (
    <>
      <PageHeader title="履约网点" description="管理领取、归还、仓储和交接能力。当前网点数据由门市/站点 API 兼容投影。" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>新增履约网点</Button>} />
      <Card className="data-panel" title="组织与网点层级" style={{ marginBottom: 16 }}>
        <QueryState loading={hierarchy.isLoading} error={hierarchy.error}>
          <Tree treeData={toTreeData(hierarchy.data ?? [])} defaultExpandAll showLine />
        </QueryState>
      </Card>
      <Card className="data-panel" styles={{ body: { paddingBottom: 0 } }}>
        <QueryState loading={query.isLoading} error={query.error}>
          <Table rowKey="id" dataSource={query.data?.rows ?? []} scroll={{ x: 1180 }} columns={[
            { title: "网点", dataIndex: "name", fixed: "left", render: (value, record) => <Space><EnvironmentOutlined className="primary-icon" /><span><b>{value}</b><br /><span className="muted">{record.stationCode || record.storeCode || "未编码"}</span></span></Space> },
            { title: "所属组织", dataIndex: "parentStoreName" },
            { title: "履约能力", dataIndex: "serviceCapabilities", render: (value: string[]) => value?.map((item) => <Tag key={item}>{item}</Tag>) },
            { title: "容量", render: (_, record) => `${record.parkingAvailable ?? 0} / ${record.parkingTotal ?? 0}` },
            { title: "地址", dataIndex: "address", ellipsis: true },
            { title: "状态", dataIndex: "status", render: (value: string, record) => <Space><Tag color={value === "enabled" ? "success" : "default"}>{value === "enabled" ? "启用" : "停用"}</Tag><Tag color={record.serviceStatus === "normal" ? "blue" : "orange"}>{record.serviceStatus === "normal" ? "可履约" : "暂停履约"}</Tag></Space> },
            { title: "操作", fixed: "right", render: (_, record) => <Button type="link" onClick={() => openEditor(record)}>编辑</Button> }
          ]} />
        </QueryState>
      </Card>

      <Drawer title={editing ? "编辑履约网点" : "新增履约网点"} width={620} open={drawerOpen} destroyOnHidden onClose={() => setDrawerOpen(false)} extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>保存</Button>}>
        <Alert type="info" showIcon message="位置模型仍兼容门市/站点" description="新通用内核需要补充寄送、上门取送、智能柜、仓库等履约方式；当前表单只维护现有门市领取/归还能力。" style={{ marginBottom: 20 }} />
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate({ ...editing, ...values })}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="name" label="网点名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="parentStoreName" label="所属门店 / 组织" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="storeCode" label="门店编码"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="stationCode" label="网点编码"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="stationType" label="网点类型" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="serviceStatus" label="履约状态" rules={[{ required: true }]}><Select options={[{ value: "normal", label: "正常" }, { value: "paused", label: "暂停" }, { value: "maintenance", label: "维护中" }]} /></Form.Item></Col>
          </Row>
          <Form.Item name="serviceCapabilities" label="履约能力" rules={[{ required: true }]}><Select mode="tags" tokenSeparators={[",", "，"]} options={[{ value: "pickup", label: "领取" }, { value: "return", label: "归还" }, { value: "inspection", label: "交接检查" }, { value: "storage", label: "仓储" }]} /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="parkingTotal" label="总容量（兼容车位）" rules={[{ required: true }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="parkingAvailable" label="可用容量" rules={[{ required: true }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
          </Row>
          <Form.Item name="address" label="地址" rules={[{ required: true }]}><Input /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="contactName" label="联系人" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="contactPhone" label="联系电话" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="businessHours" label="营业时间"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="email" label="邮箱"><Input /></Form.Item></Col>
          </Row>
          <Form.Item name="description" label="说明"><Input.TextArea rows={3} /></Form.Item>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="status" label="启用" getValueFromEvent={(checked) => checked ? "enabled" : "disabled"} getValueProps={(value) => ({ checked: value === "enabled" })}><Switch /></Form.Item></Col>
            <Col span={8}><Form.Item name="storeRentalEnabled" label="门店租赁" valuePropName="checked"><Switch /></Form.Item></Col>
            <Col span={8}><Form.Item name="storeSelfServiceEnabled" label="自助履约" valuePropName="checked"><Switch /></Form.Item></Col>
          </Row>
        </Form>
      </Drawer>
    </>
  );
}
