import { CheckOutlined, CloseOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import type { FinanceDocumentRow, FinanceManualAdjustmentRow, FinancePreAuthorizationRow, SaveFinanceDocumentRequest, SaveFinanceManualAdjustmentRequest, SaveFinancePreAuthorizationRequest } from "@store-rental/shared";
import { App, Button, Card, Col, DatePicker, Drawer, Form, Input, InputNumber, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";
import { api } from "@/api/rental";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

type FinanceEditor = "document" | "preauth" | "adjustment" | undefined;
type PreAuthFormValues = Omit<SaveFinancePreAuthorizationRequest, "expiresAt" | "frozenAt" | "capturedAt" | "releasedAt"> & { expiresAt?: Dayjs; frozenAt?: Dayjs; capturedAt?: Dayjs; releasedAt?: Dayjs };

const money = (value: number | undefined) => `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function FinancePage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const operator = useAuthStore((state) => state.user?.displayName ?? "财务人员");
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const canManage = hasPermission("store-rental:finance:manage");
  const canAdjust = hasPermission("store-rental:finance:adjust");
  const canInvoice = hasPermission("store-rental:finance:invoice") || canManage;
  const [editor, setEditor] = useState<FinanceEditor>();
  const [editingDocument, setEditingDocument] = useState<FinanceDocumentRow>();
  const [editingPreAuth, setEditingPreAuth] = useState<FinancePreAuthorizationRow>();
  const [documentForm] = Form.useForm<SaveFinanceDocumentRequest>();
  const [preAuthForm] = Form.useForm<PreAuthFormValues>();
  const [adjustmentForm] = Form.useForm<SaveFinanceManualAdjustmentRequest>();

  const overview = useQuery({ queryKey: ["finance-overview"], queryFn: api.financeOverview });
  const transactions = useQuery({ queryKey: ["finance-transactions"], queryFn: api.financeTransactions });
  const documents = useQuery({ queryKey: ["finance-documents"], queryFn: api.financeDocuments });
  const preAuth = useQuery({ queryKey: ["finance-preauth"], queryFn: api.financePreAuth });
  const adjustments = useQuery({ queryKey: ["finance-adjustments"], queryFn: api.financeAdjustments });
  const reconciliation = useQuery({ queryKey: ["finance-reconciliation"], queryFn: api.financeReconciliation });
  const orders = useQuery({ queryKey: ["orders", "finance"], queryFn: api.orders });
  const loading = overview.isLoading || transactions.isLoading || documents.isLoading || preAuth.isLoading || adjustments.isLoading || reconciliation.isLoading;
  const error = overview.error ?? transactions.error ?? documents.error ?? preAuth.error ?? adjustments.error ?? reconciliation.error;
  const adjustmentRows = adjustments.data ? (Array.isArray(adjustments.data) ? adjustments.data : [adjustments.data]) : [];

  const refresh = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["finance-overview"] }), queryClient.invalidateQueries({ queryKey: ["finance-transactions"] }),
    queryClient.invalidateQueries({ queryKey: ["finance-documents"] }), queryClient.invalidateQueries({ queryKey: ["finance-preauth"] }),
    queryClient.invalidateQueries({ queryKey: ["finance-adjustments"] }), queryClient.invalidateQueries({ queryKey: ["finance-reconciliation"] })
  ]);
  const saveDocument = useMutation({ mutationFn: api.saveFinanceDocument, onSuccess: async () => { await refresh(); closeEditor(); message.success("财务单据已保存"); }, onError: () => message.error("财务单据保存失败") });
  const savePreAuth = useMutation({ mutationFn: api.saveFinancePreAuth, onSuccess: async () => { await refresh(); closeEditor(); message.success("预授权记录已保存"); }, onError: () => message.error("预授权记录保存失败") });
  const createAdjustment = useMutation({ mutationFn: api.createFinanceAdjustment, onSuccess: async () => { await refresh(); closeEditor(); message.success("调账申请已提交"); }, onError: () => message.error("调账申请提交失败") });
  const processAdjustment = useMutation({ mutationFn: ({ record, action, remark }: { record: FinanceManualAdjustmentRow; action: "approve" | "reject"; remark?: string }) => api.processFinanceAdjustment(record.id, { action, operator, remark }), onSuccess: async () => { await refresh(); message.success("调账审核已处理"); }, onError: () => message.error("调账审核处理失败") });

  function closeEditor() {
    setEditor(undefined); setEditingDocument(undefined); setEditingPreAuth(undefined);
    documentForm.resetFields(); preAuthForm.resetFields(); adjustmentForm.resetFields();
  }

  function openDocument(record?: FinanceDocumentRow) {
    setEditingDocument(record);
    documentForm.setFieldsValue(record ? { ...record } : { type: "invoice", status: "draft", customerName: "", title: "租赁服务费", amount: 0, issueSource: "manual", relatedFeeIds: [], createdBy: operator });
    setEditor("document");
  }

  function openPreAuth(record?: FinancePreAuthorizationRow) {
    setEditingPreAuth(record);
    preAuthForm.setFieldsValue(record ? { ...record, expiresAt: record.expiresAt ? dayjs(record.expiresAt) : undefined, frozenAt: record.frozenAt ? dayjs(record.frozenAt) : undefined, capturedAt: record.capturedAt ? dayjs(record.capturedAt) : undefined, releasedAt: record.releasedAt ? dayjs(record.releasedAt) : undefined } : { status: "pending", channel: "offline", provider: "manual", authorizedAmount: 0, capturedAmount: 0, releasedAmount: 0, currency: "HKD", operator });
    setEditor("preauth");
  }

  function openAdjustment() {
    adjustmentForm.setFieldsValue({ category: "费用补录", direction: "charge", targetBillingMode: "customer_pay" as SaveFinanceManualAdjustmentRequest["targetBillingMode"], amount: 0, reason: "", operator });
    setEditor("adjustment");
  }

  function bindOrder(form: typeof documentForm | typeof preAuthForm | typeof adjustmentForm, orderId?: string) {
    const order = orders.data?.find((item) => item.id === orderId);
    if (!order) return;
    form.setFieldsValue({ orderId: order.id, orderNo: order.orderNo, customerName: order.customerName, corporateShortName: order.corporateShortName } as never);
  }

  function reviewAdjustment(record: FinanceManualAdjustmentRow, action: "approve" | "reject") {
    let remark = "";
    modal.confirm({ title: `${action === "approve" ? "通过" : "驳回"}调账 ${record.adjustmentNo}？`, content: <Input.TextArea placeholder="审核说明（可选）" onChange={(event) => { remark = event.target.value; }} />, okText: action === "approve" ? "确认通过" : "确认驳回", okButtonProps: { danger: action === "reject" }, onOk: () => processAdjustment.mutateAsync({ record, action, remark }) });
  }

  return (
    <>
      <PageHeader title="财务结算" description="管理收退款、押金预授权、发票收据、手工调账与对账异常。" />
      <QueryState loading={loading} error={error}>
        {overview.data && <>
          <Row className="page-metrics" gutter={[16, 16]}>
            {[
              { label: "客户实收", value: overview.data.customerReceivedAmount }, { label: "冻结押金", value: overview.data.preAuthFrozenAmount },
              { label: "退款金额", value: overview.data.refundAmount }, { label: "待处理调账", value: overview.data.pendingAdjustmentAmount },
              { label: "企业月结", value: overview.data.monthlyBillingAmount }, { label: "对账异常", value: overview.data.exceptionCount, money: false }
            ].map((item) => <Col xs={12} lg={8} xl={4} key={item.label}><Card className="data-panel"><Statistic title={item.label} prefix={item.money === false ? undefined : "¥"} value={item.value} precision={item.money === false ? 0 : 2} /></Card></Col>)}
          </Row>
          <Card className="tabbed-workspace">
            <Tabs className="standalone-tabs" items={[
              { key: "transactions", label: "资金流水", children: <Table rowKey="id" dataSource={transactions.data ?? []} scroll={{ x: 1050 }} columns={[
                { title: "时间", dataIndex: "at" }, { title: "订单", dataIndex: "orderNo", render: (value) => value ?? "—" }, { title: "客户", dataIndex: "customerName", render: (value) => value ?? "—" },
                { title: "类型", dataIndex: "type", render: (value) => <Tag>{value}</Tag> }, { title: "渠道", dataIndex: "channel" }, { title: "金额", dataIndex: "amount", align: "right", render: money },
                { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "success" ? "success" : value === "failed" ? "error" : "warning"}>{value}</Tag> }, { title: "操作人", dataIndex: "operator" }
              ]} /> },
              { key: "preauth", label: "押金预授权", children: <><div className="table-toolbar"><Typography.Text type="secondary">记录冻结、扣款、释放和到期状态；真实渠道回调尚未接入时需人工核验。</Typography.Text>{canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => openPreAuth()}>新增预授权</Button>}</div><Table<FinancePreAuthorizationRow> rowKey="id" dataSource={preAuth.data ?? []} scroll={{ x: 1120 }} columns={[
                { title: "预授权单号", dataIndex: "preAuthNo", render: (value) => <b>{value}</b> }, { title: "订单", dataIndex: "orderNo", render: (value) => value ?? "—" }, { title: "客户", dataIndex: "customerName", render: (value) => value ?? "—" },
                { title: "授权金额", dataIndex: "authorizedAmount", align: "right", render: money }, { title: "已扣 / 已释", render: (_, record) => `${money(record.capturedAmount)} / ${money(record.releasedAmount)}` }, { title: "剩余", dataIndex: "remainingAmount", align: "right", render: money },
                { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "frozen" ? "blue" : value === "failed" || value === "expired" ? "error" : "default"}>{value}</Tag> }, { title: "到期时间", dataIndex: "expiresAt", render: (value) => value ?? "—" },
                ...(canManage ? [{ title: "操作", fixed: "right" as const, render: (_: unknown, record: FinancePreAuthorizationRow) => <Button type="link" icon={<EditOutlined />} onClick={() => openPreAuth(record)}>编辑</Button> }] : [])
              ]} /></> },
              { key: "documents", label: "发票与收据", children: <><div className="table-toolbar"><Typography.Text type="secondary">单据状态和审计轨迹由后端保存，作废或重开需填写原因。</Typography.Text>{canInvoice && <Button type="primary" icon={<PlusOutlined />} onClick={() => openDocument()}>新增单据</Button>}</div><Table<FinanceDocumentRow> rowKey="id" dataSource={documents.data ?? []} scroll={{ x: 1120 }} columns={[
                { title: "单据号", dataIndex: "documentNo", render: (value, record) => <><b>{value}</b><br /><span className="muted">{record.title}</span></> }, { title: "类型", dataIndex: "type", render: (value) => <Tag>{value}</Tag> },
                { title: "客户", dataIndex: "customerName" }, { title: "订单", dataIndex: "orderNo", render: (value) => value ?? "—" }, { title: "金额", dataIndex: "amount", align: "right", render: money },
                { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "issued" || value === "sent" ? "success" : value === "voided" ? "error" : "default"}>{value}</Tag> }, { title: "创建时间", dataIndex: "createdAt" },
                ...(canInvoice ? [{ title: "操作", fixed: "right" as const, render: (_: unknown, record: FinanceDocumentRow) => <Button type="link" icon={<EditOutlined />} onClick={() => openDocument(record)}>编辑</Button> }] : [])
              ]} /></> },
              { key: "adjustments", label: `手工调账 (${adjustmentRows.filter((item) => item.status === "pending").length})`, children: <><div className="table-toolbar"><Typography.Text type="secondary">调账采用提交、审核、入账留痕，不能直接改写订单金额。</Typography.Text>{canAdjust && <Button type="primary" icon={<PlusOutlined />} onClick={openAdjustment}>发起调账</Button>}</div><Table<FinanceManualAdjustmentRow> rowKey="id" dataSource={adjustmentRows} scroll={{ x: 1100 }} columns={[
                { title: "调账单", dataIndex: "adjustmentNo", render: (value, record) => <><b>{value}</b><br /><span className="muted">{record.category}</span></> }, { title: "订单", dataIndex: "orderNo", render: (value) => value ?? "—" },
                { title: "客户", dataIndex: "customerName", render: (value) => value ?? "—" }, { title: "方向", dataIndex: "direction", render: (value) => <Tag color={value === "charge" ? "orange" : value === "refund" ? "blue" : "purple"}>{value}</Tag> },
                { title: "金额", dataIndex: "amount", align: "right", render: money }, { title: "原因", dataIndex: "reason" }, { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "approved" || value === "posted" ? "success" : value === "rejected" ? "error" : "warning"}>{value}</Tag> },
                { title: "操作", fixed: "right", render: (_, record) => canAdjust && record.status === "pending" ? <Space size={0}><Button type="link" icon={<CheckOutlined />} loading={processAdjustment.isPending} onClick={() => reviewAdjustment(record, "approve")}>通过</Button><Button type="link" danger icon={<CloseOutlined />} onClick={() => reviewAdjustment(record, "reject")}>驳回</Button></Space> : "—" }
              ]} /></> },
              { key: "reconciliation", label: `对账 (${reconciliation.data?.filter((item) => item.status !== "matched").length ?? 0})`, children: <Table rowKey="id" dataSource={reconciliation.data ?? []} columns={[
                { title: "来源", render: (_, record) => <><b>{record.sourceNo}</b><br /><span className="muted">{record.sourceType}</span></> }, { title: "发生时间", dataIndex: "occurredAt" }, { title: "对方", dataIndex: "counterparty" },
                { title: "金额", dataIndex: "amount", align: "right", render: money }, { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "matched" ? "success" : value === "exception" ? "error" : "warning"}>{value}</Tag> }, { title: "问题 / 建议", render: (_, record) => <>{record.issue ?? "—"}<br /><span className="muted">{record.suggestedAction ?? ""}</span></> }
              ]} /> }
            ]} />
          </Card>
        </>}
      </QueryState>

      <Drawer title={editingDocument ? "编辑财务单据" : "新增财务单据"} open={editor === "document"} size={560} destroyOnHidden onClose={closeEditor} extra={<Button type="primary" loading={saveDocument.isPending} onClick={() => documentForm.submit()}>保存</Button>}>
        <Form form={documentForm} layout="vertical" onFinish={(values) => saveDocument.mutate({ ...editingDocument, ...values, id: editingDocument?.id, createdBy: editingDocument?.createdBy ?? operator })}>
          <Form.Item name="orderId" label="关联订单"><Select allowClear showSearch optionFilterProp="label" onChange={(value) => bindOrder(documentForm, value)} options={(orders.data ?? []).map((item) => ({ value: item.id, label: `${item.orderNo} · ${item.customerName}` }))} /></Form.Item><Form.Item name="orderNo" hidden><Input /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="type" label="单据类型" rules={[{ required: true }]}><Select options={[{ value: "invoice", label: "发票" }, { value: "receipt", label: "收据" }]} /></Form.Item></Col><Col span={12}><Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: "draft", label: "草稿" }, { value: "issued", label: "已开具" }, { value: "sent", label: "已发送" }, { value: "voided", label: "已作废" }]} /></Form.Item></Col></Row>
          <Form.Item name="customerName" label="客户名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="title" label="抬头 / 单据标题" rules={[{ required: true }]}><Input /></Form.Item><Row gutter={12}><Col span={12}><Form.Item name="taxNo" label="税号"><Input /></Form.Item></Col><Col span={12}><Form.Item name="email" label="接收邮箱"><Input /></Form.Item></Col></Row><Form.Item name="amount" label="金额" rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item><Form.Item name="remark" label="备注 / 作废原因"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Drawer>

      <Drawer title={editingPreAuth ? "编辑预授权" : "新增预授权"} open={editor === "preauth"} size={580} destroyOnHidden onClose={closeEditor} extra={<Button type="primary" loading={savePreAuth.isPending} onClick={() => preAuthForm.submit()}>保存</Button>}>
        <Form<PreAuthFormValues> form={preAuthForm} layout="vertical" onFinish={(values) => savePreAuth.mutate({ ...editingPreAuth, ...values, id: editingPreAuth?.id, expiresAt: values.expiresAt?.toISOString(), frozenAt: values.frozenAt?.toISOString(), capturedAt: values.capturedAt?.toISOString(), releasedAt: values.releasedAt?.toISOString(), operator })}>
          <Form.Item name="orderId" label="关联订单"><Select allowClear showSearch optionFilterProp="label" onChange={(value) => bindOrder(preAuthForm, value)} options={(orders.data ?? []).map((item) => ({ value: item.id, label: `${item.orderNo} · ${item.customerName}` }))} /></Form.Item><Form.Item name="orderNo" hidden><Input /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={["pending", "frozen", "partially_captured", "captured", "released", "expired", "failed"].map((value) => ({ value, label: value }))} /></Form.Item></Col><Col span={12}><Form.Item name="channel" label="渠道" rules={[{ required: true }]}><Select options={[{ value: "online", label: "线上" }, { value: "offline", label: "线下" }, { value: "internal", label: "内部" }]} /></Form.Item></Col><Col span={12}><Form.Item name="provider" label="提供方"><Input /></Form.Item></Col><Col span={12}><Form.Item name="currency" label="币种"><Input /></Form.Item></Col></Row>
          <Row gutter={12}><Col span={8}><Form.Item name="authorizedAmount" label="授权金额" rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item></Col><Col span={8}><Form.Item name="capturedAmount" label="已扣金额"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item></Col><Col span={8}><Form.Item name="releasedAmount" label="已释金额"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item></Col></Row>
          <Row gutter={12}><Col span={12}><Form.Item name="authCode" label="授权码"><Input /></Form.Item></Col><Col span={12}><Form.Item name="channelReferenceNo" label="渠道流水号"><Input /></Form.Item></Col><Col span={12}><Form.Item name="expiresAt" label="到期时间"><DatePicker showTime style={{ width: "100%" }} /></Form.Item></Col><Col span={12}><Form.Item name="frozenAt" label="冻结时间"><DatePicker showTime style={{ width: "100%" }} /></Form.Item></Col></Row><Form.Item name="remark" label="备注"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Drawer>

      <Drawer title="发起手工调账" open={editor === "adjustment"} size={520} destroyOnHidden onClose={closeEditor} extra={<Button type="primary" loading={createAdjustment.isPending} onClick={() => adjustmentForm.submit()}>提交审核</Button>}>
        <Form form={adjustmentForm} layout="vertical" onFinish={(values) => createAdjustment.mutate({ ...values, operator })}>
          <Form.Item name="orderId" label="关联订单"><Select allowClear showSearch optionFilterProp="label" onChange={(value) => bindOrder(adjustmentForm, value)} options={(orders.data ?? []).map((item) => ({ value: item.id, label: `${item.orderNo} · ${item.customerName}` }))} /></Form.Item><Form.Item name="orderNo" hidden><Input /></Form.Item><Form.Item name="customerName" hidden><Input /></Form.Item><Form.Item name="corporateShortName" hidden><Input /></Form.Item>
          <Form.Item name="category" label="调账分类" rules={[{ required: true }]}><Input /></Form.Item><Row gutter={12}><Col span={12}><Form.Item name="direction" label="方向" rules={[{ required: true }]}><Select options={[{ value: "charge", label: "补收" }, { value: "refund", label: "退款" }, { value: "waiver", label: "减免" }]} /></Form.Item></Col><Col span={12}><Form.Item name="targetBillingMode" label="结算主体" rules={[{ required: true }]}><Select options={[{ value: "customer_pay", label: "客户支付" }, { value: "monthly", label: "企业月结" }]} /></Form.Item></Col></Row><Form.Item name="amount" label="调账金额" rules={[{ required: true }]}><InputNumber min={0.01} precision={2} style={{ width: "100%" }} /></Form.Item><Form.Item name="reason" label="调账原因" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
