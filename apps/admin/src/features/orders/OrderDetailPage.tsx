import { ArrowLeftOutlined, CheckCircleOutlined, FileTextOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Divider, Drawer, Form, Input, InputNumber, Row, Select, Space, Statistic, Steps, Switch, Tag, Timeline, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/api/rental";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

type ActionFormValues = {
  reason?: string;
  plateNo?: string;
  identityMatched?: boolean;
  identityPhotoUploaded?: boolean;
  licensePhotoUploaded?: boolean;
  licenseValidUntil?: Dayjs;
  preAuthMode?: string;
  preAuthStatus?: string;
  monthlyBillingConfirmed?: boolean;
  contractSigned?: boolean;
  mileage?: number;
  returnMileage?: number;
  fuelLevelPercent?: number;
  batteryLevelPercent?: number;
  photoCount?: number;
  customerSigned?: boolean;
  cleanliness?: string;
  actualReturnAt?: Dayjs;
  returnStationName?: string;
  damageFound?: boolean;
  damageDescription?: string;
  missingItems?: string;
  overtimeFeeAmount?: number;
  extraMileageFeeAmount?: number;
  damageFeeAmount?: number;
  cleaningFeeAmount?: number;
  discountAmount?: number;
  finalReceivableAmount?: number;
  returnTransactionTotal?: number;
  monthlyBillingPosted?: boolean;
  newReturnAt?: Dayjs;
  settlementMode?: string;
  targetStoreName?: string;
  targetStationName?: string;
  targetOrderId?: string;
  description?: string;
  estimatedCostAmount?: number;
  responsibility?: string;
};

const actionLabels: Record<string, string> = {
  "payment-success": "确认支付 / 预授权",
  "start-pickup": "开始办理领取",
  "pickup-inspection": "完成领取检查",
  "extend-rental": "办理续租",
  "redirect-order": "转移订单",
  "change-return-store": "变更归还门店",
  "change-return-station": "变更归还网点",
  "return-inspection": "完成归还检查",
  "confirm-settlement": "确认结算",
  "register-accident": "登记资产事故 / 异常",
  "release-operation-lock": "释放操作锁",
  "mark-no-show": "标记爽约",
  "reject-order": "拒绝履约",
  "close-order": "关闭订单",
  cancel: "取消订单"
};

const simpleActions = new Set(["payment-success", "start-pickup"]);
const destructiveActions = new Set(["mark-no-show", "reject-order", "close-order", "cancel"]);
const primaryActionCandidates = new Set(["payment-success", "start-pickup", "pickup-inspection", "return-inspection", "confirm-settlement"]);

export function OrderDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const operator = useAuthStore((state) => state.user?.displayName ?? "门店营运");
  const canOperate = useAuthStore((state) => state.hasPermission("store-rental:order:operate"));
  const [action, setAction] = useState<string>();
  const [form] = Form.useForm<ActionFormValues>();
  const query = useQuery({ queryKey: ["order", id], queryFn: () => api.order(id), enabled: Boolean(id) });
  const order = query.data;
  const primaryAction = order?.availableActions?.find((item) => primaryActionCandidates.has(item));
  const stage = order ? ["pending_payment", "reserved", "inspecting", "renting", "settlement_pending", "completed"].indexOf(order.mainStatus) : 0;
  const mutation = useMutation({
    mutationFn: ({ nextAction, payload }: { nextAction: string; payload: Record<string, unknown> }) => api.runOrderAction(id, nextAction, payload),
    onSuccess: async (result) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["order", id] }), queryClient.invalidateQueries({ queryKey: ["orders"] })]);
      setAction(undefined);
      form.resetFields();
      message.success(result.message || `订单已更新为 ${result.nextStatus}`);
    },
    onError: () => message.error("订单动作执行失败，请检查必填信息、状态和操作锁")
  });

  function basePayload() {
    return { operator, idempotencyKey: `react-${id}-${action ?? "action"}-${Date.now()}` };
  }

  function openAction(nextAction: string) {
    if (!order) return;
    if (simpleActions.has(nextAction)) {
      modal.confirm({
        title: `${actionLabels[nextAction]}？`,
        content: "操作将提交到后端订单状态机并写入时间线与幂等记录。",
        okText: "确认执行",
        onOk: () => mutation.mutateAsync({ nextAction, payload: { ...basePayload(), idempotencyKey: `react-${id}-${nextAction}-${Date.now()}` } })
      });
      return;
    }
    setAction(nextAction);
    form.setFieldsValue({
      reason: "",
      plateNo: order.plateNo,
      identityMatched: true,
      identityPhotoUploaded: true,
      licensePhotoUploaded: true,
      licenseValidUntil: dayjs().add(1, "year"),
      preAuthMode: "performance_guarantee",
      preAuthStatus: "frozen",
      monthlyBillingConfirmed: order.billingMode === "monthly",
      contractSigned: order.contracts.some((item) => item.status === "signed"),
      mileage: order.inspectionRecords.find((item) => item.stage === "pickup")?.mileage ?? 0,
      returnMileage: order.inspectionRecords.find((item) => item.stage === "pickup")?.mileage ?? 0,
      fuelLevelPercent: 100,
      photoCount: 9,
      customerSigned: true,
      cleanliness: "clean",
      actualReturnAt: dayjs(),
      returnStationName: order.returnStationName,
      damageFound: false,
      overtimeFeeAmount: order.settlementSummary.overtimeFeeAmount,
      extraMileageFeeAmount: order.settlementSummary.extraMileageFeeAmount,
      damageFeeAmount: order.settlementSummary.damageFeeAmount,
      cleaningFeeAmount: order.settlementSummary.cleaningFeeAmount,
      discountAmount: order.settlementSummary.discountAmount,
      finalReceivableAmount: order.settlementSummary.finalReceivableAmount || order.totalAmount,
      returnTransactionTotal: order.settlementSummary.returnTransactionTotal || (order.billingMode === "monthly" ? 0 : order.settlementSummary.finalReceivableAmount || order.totalAmount),
      monthlyBillingPosted: order.billingMode === "monthly",
      newReturnAt: dayjs(order.returnAt).add(1, "day"),
      settlementMode: order.billingMode === "monthly" ? "post_to_monthly_bill" : "pay_now",
      targetStoreName: order.returnStoreName,
      targetStationName: order.returnStationName,
      responsibility: "pending"
    });
  }

  function submitAction(values: ActionFormValues) {
    if (!action) return;
    const payload: Record<string, unknown> = {
      ...values,
      ...basePayload(),
      licenseValidUntil: values.licenseValidUntil?.toISOString(),
      actualReturnAt: values.actualReturnAt?.toISOString(),
      newReturnAt: values.newReturnAt?.toISOString(),
      communicationConfirmed: true
    };
    mutation.mutate({ nextAction: action, payload });
  }

  return (
    <>
      <PageHeader title={order ? `订单 ${order.orderNo}` : "订单详情"} description="订单快照、履约记录、费用、合同和状态动作。" extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/rental/orders")}>返回订单</Button>} />
      <QueryState loading={query.isLoading} error={query.error}>
        {order && <>
          <Alert showIcon type="info" style={{ marginBottom: 16 }} message="当前订单详情来自旧车辆订单 API。新通用内核接入后将支持订单行、数量库存、资产分配和检查模板版本。" />
          <Card className="data-panel" style={{ marginBottom: 16 }}><Steps size="small" current={Math.max(0, stage)} items={["待支付", "已预订", "领取检查", "履约中", "归还结算", "已完成"].map((title) => ({ title }))} /></Card>
          {canOperate && (order.availableActions?.length ?? 0) > 0 && <Card className="data-panel" title="可执行动作" style={{ marginBottom: 16 }}><Space wrap>{order.availableActions?.map((item) => <Button key={item} type={item === primaryAction ? "primary" : "default"} danger={destructiveActions.has(item)} icon={<ThunderboltOutlined />} onClick={() => openAction(item)}>{actionLabels[item] ?? item}</Button>)}</Space></Card>}
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={16}>
              <Card className="data-panel" title="订单概要"><Descriptions column={{ xs: 1, md: 2 }} items={[
                { key: "customer", label: "客户", children: order.customerName },
                { key: "asset", label: "租赁标的", children: `${order.vehicleGroupName}${order.plateNo ? ` / ${order.plateNo}` : ""}` },
                { key: "time", label: "租期", children: `${order.pickupAt} 至 ${order.returnAt}` },
                { key: "location", label: "履约网点", children: `${order.pickupStoreName} → ${order.returnStoreName}` },
                { key: "billing", label: "结算方式", children: order.billingMode === "monthly" ? "企业月结" : "客户支付" },
                { key: "status", label: "状态", children: <Tag color="blue">{order.mainStatus}</Tag> }
              ]} /></Card>
              <Card className="data-panel" title="费用明细" style={{ marginTop: 16 }}><Space direction="vertical" style={{ width: "100%" }} size={12}>{order.feeLedgerItems.map((fee) => <div key={fee.id} style={{ display: "flex", justifyContent: "space-between" }}><span>{fee.name}<Typography.Text type="secondary"> · {fee.stage}</Typography.Text></span><b>¥{fee.amount.toLocaleString()}</b></div>)}</Space></Card>
              <Card className="data-panel" title="履约与检查" style={{ marginTop: 16 }}><Space direction="vertical" style={{ width: "100%" }}>{order.inspectionRecords.length ? order.inspectionRecords.map((record, index) => <div key={`${record.stage}-${index}`}><Tag icon={<CheckCircleOutlined />} color={record.damageFound ? "orange" : "success"}>{record.stage === "pickup" ? "领取检查" : "归还检查"}</Tag><Typography.Text> 操作人：{record.operator}；照片 {record.photoCount} 张{record.damageFound ? `；异常：${record.damageDescription ?? "待确认"}` : ""}</Typography.Text></div>) : <Typography.Text type="secondary">尚无检查记录</Typography.Text>}</Space></Card>
            </Col>
            <Col xs={24} xl={8}>
              <Card className="data-panel"><Statistic title="订单应付金额" prefix="¥" value={order.totalAmount} precision={2} /><Divider /><Space direction="vertical" style={{ width: "100%" }}><Tag color={order.paymentStatus === "paid" ? "success" : "orange"}>{order.paymentStatus}</Tag><Button block icon={<FileTextOutlined />} onClick={() => navigate(`/rental/contracts?orderId=${order.id}`)}>生成合同 / 单据</Button></Space></Card>
              <Card className="data-panel" title="订单时间线" style={{ marginTop: 16 }}><Timeline className="order-timeline" items={order.timeline.map((event) => ({ children: <><b>{event.action}</b><br /><span className="muted">{event.at} · {event.actor}</span></> }))} /></Card>
            </Col>
          </Row>
        </>}
      </QueryState>

      <Drawer title={action ? actionLabels[action] ?? action : "订单动作"} width={620} open={Boolean(action)} destroyOnHidden onClose={() => setAction(undefined)} extra={<Button type="primary" danger={Boolean(action && destructiveActions.has(action))} loading={mutation.isPending} onClick={() => form.submit()}>确认提交</Button>}>
        <Alert type={action && destructiveActions.has(action) ? "warning" : "info"} showIcon message="动作由后端状态机校验" description="提交会写入订单时间线和幂等记录；状态、操作锁、资金和必填资料不满足时，后端会拒绝请求。" style={{ marginBottom: 20 }} />
        <Form<ActionFormValues> form={form} layout="vertical" onFinish={submitAction}>
          {action === "pickup-inspection" && <>
            <Row gutter={12}><Col span={12}><Form.Item name="plateNo" label="实际资产编号（兼容车牌）" rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={12}><Form.Item name="licenseValidUntil" label="资质有效期" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item></Col></Row>
            <Space wrap size="large"><Form.Item name="identityMatched" label="人证一致" valuePropName="checked"><Switch /></Form.Item><Form.Item name="identityPhotoUploaded" label="身份材料已上传" valuePropName="checked"><Switch /></Form.Item><Form.Item name="licensePhotoUploaded" label="资质材料已上传" valuePropName="checked"><Switch /></Form.Item><Form.Item name="contractSigned" label="合同已签署" valuePropName="checked"><Switch /></Form.Item><Form.Item name="customerSigned" label="客户已签字" valuePropName="checked"><Switch /></Form.Item></Space>
            {order?.billingMode === "monthly" ? <Form.Item name="monthlyBillingConfirmed" label="企业月结已确认" valuePropName="checked"><Switch /></Form.Item> : <Row gutter={12}><Col span={12}><Form.Item name="preAuthMode" label="预授权用途"><Select options={[{ value: "performance_guarantee", label: "履约担保" }, { value: "rent_offset", label: "转租金" }]} /></Form.Item></Col><Col span={12}><Form.Item name="preAuthStatus" label="预授权状态"><Select options={[{ value: "frozen", label: "已冻结" }, { value: "captured", label: "已扣款" }, { value: "released", label: "已释放" }]} /></Form.Item></Col></Row>}
            <InspectionFields mode="pickup" />
          </>}
          {action === "return-inspection" && <>
            <Row gutter={12}><Col span={12}><Form.Item name="actualReturnAt" label="实际归还时间" rules={[{ required: true }]}><DatePicker showTime style={{ width: "100%" }} /></Form.Item></Col><Col span={12}><Form.Item name="returnStationName" label="归还网点" rules={[{ required: true }]}><Input /></Form.Item></Col></Row>
            <InspectionFields mode="return" />
            <Form.Item name="missingItems" label="缺失部件"><Input /></Form.Item>
            <FeeFields />
          </>}
          {action === "confirm-settlement" && <>
            <FeeFields />
            <Row gutter={12}><Col span={12}><Form.Item name="finalReceivableAmount" label="最终应收" rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item></Col><Col span={12}><Form.Item name="returnTransactionTotal" label="已收 / 已退合计"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item></Col></Row>
            {order?.billingMode === "monthly" && <Form.Item name="monthlyBillingPosted" label="月结已挂账" valuePropName="checked"><Switch /></Form.Item>}
          </>}
          {action === "extend-rental" && <Row gutter={12}><Col span={12}><Form.Item name="newReturnAt" label="新的归还时间" rules={[{ required: true }]}><DatePicker showTime style={{ width: "100%" }} /></Form.Item></Col><Col span={12}><Form.Item name="settlementMode" label="续租结算方式" rules={[{ required: true }]}><Select options={[{ value: "pay_now", label: "立即支付" }, { value: "settle_on_return", label: "归还结算" }, { value: "post_to_monthly_bill", label: "企业月结" }]} /></Form.Item></Col></Row>}
          {["redirect-order", "change-return-store", "change-return-station"].includes(action ?? "") && <><Form.Item name="targetOrderId" label="目标订单 ID"><Input /></Form.Item><Row gutter={12}><Col span={12}><Form.Item name="targetStoreName" label="目标门店"><Input /></Form.Item></Col><Col span={12}><Form.Item name="targetStationName" label="目标网点"><Input /></Form.Item></Col></Row><Form.Item name="reason" label="变更原因" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item></>}
          {action === "register-accident" && <><Form.Item name="description" label="异常说明" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item><Row gutter={12}><Col span={12}><Form.Item name="estimatedCostAmount" label="预估费用"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item></Col><Col span={12}><Form.Item name="responsibility" label="责任归属"><Select options={[{ value: "pending", label: "待认定" }, { value: "customer", label: "客户" }, { value: "company", label: "平台" }, { value: "third_party", label: "第三方" }]} /></Form.Item></Col></Row></>}
          {["release-operation-lock", "mark-no-show", "reject-order", "close-order", "cancel"].includes(action ?? "") && <Form.Item name="reason" label="操作原因" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item>}
        </Form>
      </Drawer>
    </>
  );
}

function InspectionFields({ mode }: { mode: "pickup" | "return" }) {
  return <>
    <Row gutter={12}>
      <Col span={8}><Form.Item name={mode === "pickup" ? "mileage" : "returnMileage"} label={mode === "pickup" ? "领取使用量（里程）" : "归还使用量（里程）"} rules={[{ required: true }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
      <Col span={8}><Form.Item name="fuelLevelPercent" label="油量 %"><InputNumber min={0} max={100} style={{ width: "100%" }} /></Form.Item></Col>
      <Col span={8}><Form.Item name="batteryLevelPercent" label="电量 %"><InputNumber min={0} max={100} style={{ width: "100%" }} /></Form.Item></Col>
      <Col span={8}><Form.Item name="photoCount" label="检查照片数" rules={[{ required: true }]}><InputNumber min={9} style={{ width: "100%" }} /></Form.Item></Col>
      <Col span={8}><Form.Item name="cleanliness" label="清洁状态"><Select options={[{ value: "clean", label: "清洁" }, { value: "normal", label: "一般" }, { value: "dirty", label: "需清洁" }]} /></Form.Item></Col>
    </Row>
    <Space size="large"><Form.Item name="customerSigned" label="客户已签字" valuePropName="checked"><Switch /></Form.Item><Form.Item name="damageFound" label="发现损坏" valuePropName="checked"><Switch /></Form.Item></Space>
    <Form.Item noStyle shouldUpdate={(before, after) => before.damageFound !== after.damageFound}>{({ getFieldValue }) => getFieldValue("damageFound") ? <Form.Item name="damageDescription" label="损坏说明" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item> : null}</Form.Item>
  </>;
}

function FeeFields() {
  return <Row gutter={12}>
    <Col span={8}><Form.Item name="overtimeFeeAmount" label="超期费"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item></Col>
    <Col span={8}><Form.Item name="extraMileageFeeAmount" label="超量费"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item></Col>
    <Col span={8}><Form.Item name="damageFeeAmount" label="损坏费"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item></Col>
    <Col span={8}><Form.Item name="cleaningFeeAmount" label="清洁费"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item></Col>
    <Col span={8}><Form.Item name="discountAmount" label="减免"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item></Col>
  </Row>;
}
