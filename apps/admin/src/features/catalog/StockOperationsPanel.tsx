import { HistoryOutlined, PlusOutlined } from "@ant-design/icons";
import type {
  RentalCategoryTerminology,
  RentalFulfillmentLocation,
  RentalItemGroup,
  RentalStockLedgerEntry,
  RentalStockOperationRequest,
  RentalStockOperationType
} from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";

const OPERATION_OPTIONS: Array<{ value: RentalStockOperationType; label: string; description: string }> = [
  { value: "receive", label: "入库", description: "增加某个履约地点的在手数量。" },
  { value: "count_adjustment", label: "盘点差异", description: "按实际盘点数调整在手数量，已预占和维修隔离数量不能被抹掉。" },
  { value: "transfer", label: "地点调拨", description: "在两个支持仓储的履约地点之间转移数量。" },
  { value: "consume", label: "耗材领用", description: "登记一次性耗材的人工领用；订单领取会自动记录同类消耗。" },
  { value: "scrap", label: "报损", description: "将无法继续经营的数量从在手账中报损。" },
  { value: "retire", label: "退出", description: "将不再经营的数量从在手账中退出。" }
];

function operationLabel(value: string) {
  return OPERATION_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

function deltaLabel(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function StockOperationsPanel({
  groups,
  locations,
  terminology,
  canManage
}: {
  groups: RentalItemGroup[];
  locations: RentalFulfillmentLocation[];
  terminology?: RentalCategoryTerminology;
  canManage: boolean;
}) {
  const { message } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [operationType, setOperationType] = useState<RentalStockOperationType>("receive");
  const [operationKey, setOperationKey] = useState(() => crypto.randomUUID());
  const [form] = Form.useForm<RentalStockOperationRequest>();
  const ledger = useQuery({ queryKey: ["rental-core", "stock-ledger"], queryFn: () => rentalCoreApi.stockLedger({ limit: 100 }) });
  const quantityGroups = groups.filter((group) => ["quantity", "consumable"].includes(group.inventoryMode) && group.status === "enabled");
  const storageLocations = locations.filter((location) => location.status === "enabled" && location.capabilities.includes("storage"));
  const apply = useMutation({
    mutationFn: rentalCoreApi.applyStockOperation,
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "stocks"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "stock-ledger"] })
      ]);
      setOpen(false);
      form.resetFields();
      message.success(result.idempotent ? t("库存作业已按原记录幂等回放") : t("库存作业已记录，余额和流水已更新"));
    },
    onError: (error: Error) => message.error(error.message || t("库存作业失败"))
  });

  function openEditor() {
    const firstGroup = quantityGroups[0]?.id;
    const firstLocation = storageLocations[0]?.id;
    const nextKey = crypto.randomUUID();
    setOperationKey(nextKey);
    setOperationType("receive");
    form.setFieldsValue({ type: "receive", itemGroupId: firstGroup, locationId: firstLocation, quantity: 1, reason: "", idempotencyKey: nextKey });
    setOpen(true);
  }

  const currentDescription = t(OPERATION_OPTIONS.find((item) => item.value === operationType)?.description ?? "");
  const itemLabel = t(terminology?.itemGroupLabel ?? "商品");
  return <>
    <Card
      title={t("数量与耗材库存日常作业")}
      extra={<Space><Typography.Text type="secondary">{t("余额变化必须有来源流水")}</Typography.Text>{canManage && <Button type="primary" icon={<PlusOutlined />} onClick={openEditor}>{t("新增库存作业")}</Button>}</Space>}
      style={{ marginTop: 16 }}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {t("入库、盘点差异、地点调拨、报损和退出都会保留操作人、原因、前后余额及幂等记录；已预占或维修隔离的数量不能被直接抹掉。")}
      </Typography.Paragraph>
    </Card>
    <Card title={<Space><HistoryOutlined />{t("库存流水")}</Space>} style={{ marginTop: 16 }}>
      <Table<RentalStockLedgerEntry>
        rowKey="id"
        loading={ledger.isLoading}
        dataSource={ledger.data ?? []}
        pagination={{ pageSize: 8 }}
        scroll={{ x: 1200 }}
        locale={{ emptyText: t("暂无库存作业流水") }}
        columns={[
          { title: t("时间"), dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() },
          { title: t("作业"), render: (_: unknown, row) => <Tag color={row.entryKind === "out" ? "orange" : row.entryKind === "in" ? "green" : "blue"}>{t(operationLabel(row.operationType))}</Tag> },
          { title: itemLabel, render: (_: unknown, row) => <><b>{row.itemGroupName}</b><br /><Typography.Text type="secondary">{row.itemGroupCode}</Typography.Text></> },
          { title: t(terminology?.fulfillmentLabel ?? "履约地点"), dataIndex: "locationName" },
          { title: t("变化"), dataIndex: "quantityDelta", align: "right", render: (value: number) => <b>{deltaLabel(value)}</b> },
          { title: t("前 → 后"), render: (_: unknown, row) => `${row.onHandBefore} → ${row.onHandAfter}` },
          { title: t("批次/单据"), render: (_: unknown, row) => <>{row.batchNo && <div>{t("批次")}：{row.batchNo}</div>}{row.sourceDocumentNo && <Typography.Text type="secondary">{t("单据")}：{row.sourceDocumentNo}</Typography.Text>}{!row.batchNo && !row.sourceDocumentNo && <Typography.Text type="secondary">{t("未填写")}</Typography.Text>}</> },
          { title: t("原因/来源"), dataIndex: "reason", ellipsis: true },
          { title: t("操作人"), dataIndex: "operator" }
        ]}
      />
    </Card>
    <Drawer
      title={t("新增数量/耗材库存作业")}
      size={560}
      open={open}
      destroyOnHidden
      onClose={() => setOpen(false)}
      extra={<Button type="primary" loading={apply.isPending} onClick={() => form.submit()}>{t("保存作业")}</Button>}
    >
      <Form<RentalStockOperationRequest>
        form={form}
        layout="vertical"
        onFinish={(values) => apply.mutate({ ...values, type: operationType, idempotencyKey: operationKey })}
      >
        <Form.Item label={t("作业类型")} name="type" rules={[{ required: true }]}>
          <Select options={OPERATION_OPTIONS.map((item) => ({ value: item.value, label: t(item.label) }))} onChange={(value: RentalStockOperationType) => { setOperationType(value); form.setFieldValue("type", value); }} />
        </Form.Item>
        <Typography.Paragraph type="secondary">{currentDescription}</Typography.Paragraph>
        <Form.Item label={itemLabel} name="itemGroupId" rules={[{ required: true }]}>
          <Select showSearch={{ optionFilterProp: "label" }} options={quantityGroups.map((group) => ({ value: group.id, label: `${group.code} · ${group.name}${group.inventoryMode === "consumable" ? `（${t("一次性耗材")}）` : ""}` }))} />
        </Form.Item>
        {operationType === "transfer" ? <Row gutter={12}>
          <Col span={12}><Form.Item label={t("调出地点")} name="fromLocationId" rules={[{ required: true }]}><Select options={storageLocations.map((location) => ({ value: location.id, label: location.name }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label={t("调入地点")} name="toLocationId" rules={[{ required: true }]}><Select options={storageLocations.map((location) => ({ value: location.id, label: location.name }))} /></Form.Item></Col>
        </Row> : <Form.Item label={t(terminology?.fulfillmentLabel ?? "履约地点")} name="locationId" rules={[{ required: true }]}>
          <Select options={storageLocations.map((location) => ({ value: location.id, label: location.name }))} />
        </Form.Item>}
        {operationType === "count_adjustment" ? <Form.Item label={t("盘点实数")} name="actualOnHandQuantity" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item> : <Form.Item label={t("数量")} name="quantity" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item>}
        <Row gutter={12}>
          <Col span={12}><Form.Item label={t("批次号")} name="batchNo" rules={[{ max: 100 }]}><Input placeholder={t("可填外部批次或本次作业批次")} /></Form.Item></Col>
          <Col span={12}><Form.Item label={t("来源/审批单号")} name="sourceDocumentNo" rules={[{ max: 100 }]}><Input placeholder={t("可填入库单、盘点单或审批单号")} /></Form.Item></Col>
        </Row>
        <Form.Item label={t("原因或来源说明")} name="reason" rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea rows={4} placeholder={t("例如：采购入库单、月末盘点差异、报损审批单号或退出原因")} /></Form.Item>
        <Form.Item name="idempotencyKey" hidden><Input /></Form.Item>
        <Typography.Text type="secondary">{t("当前作业会使用一次性幂等键；网络异常后在本窗口重试，不会重复增加或扣减库存。")}</Typography.Text>
      </Form>
    </Drawer>
  </>;
}
