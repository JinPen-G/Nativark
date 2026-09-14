import { SearchOutlined, UploadOutlined } from "@ant-design/icons";
import type { PaymentStatementBatchSummary, PaymentStatementLineSummary } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Drawer, Empty, Form, Input, Select, Space, Table, Tag, Typography, Upload } from "antd";
import type { UploadFile } from "antd";
import { useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

const providerLabels: Record<string, string> = { alipay: "支付宝", wechat_pay: "微信支付" };
const batchStatusLabels: Record<string, string> = { matched: "全部匹配", needs_review: "待处理差异", reviewed: "差异已处理" };
const reviewStatusLabels: Record<string, string> = { not_required: "无需处理", open: "待处理", query_pending: "待向平台核对", acknowledged: "已确认" };

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

export function PaymentReconciliationPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState("alipay");
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>();
  const [reviewTarget, setReviewTarget] = useState<{ line: PaymentStatementLineSummary; decision: "acknowledge" | "query_provider" }>();
  const [reviewForm] = Form.useForm<{ reason: string }>();
  const batches = useQuery({ queryKey: ["rental-core", "payment-statement-batches"], queryFn: () => rentalCoreApi.paymentStatementBatches() });
  const detail = useQuery({
    queryKey: ["rental-core", "payment-statement-batch", selectedBatchId],
    queryFn: () => rentalCoreApi.paymentStatementBatch(selectedBatchId!),
    enabled: Boolean(selectedBatchId)
  });
  const importStatement = useMutation({
    mutationFn: () => {
      const file = fileList[0]?.originFileObj;
      if (!file) throw new Error("请选择 CSV 对账文件");
      return rentalCoreApi.importPaymentStatement(provider, file);
    },
    onSuccess: (result) => {
      setFileList([]);
      setSelectedBatchId(result.id);
      void queryClient.invalidateQueries({ queryKey: ["rental-core", "payment-statement-batches"] });
      message.success("对账文件已导入，支付事实未被自动改写");
    },
    onError: (error: Error) => message.error(error.message || "对账文件导入失败")
  });
  const reviewLine = useMutation({
    mutationFn: (values: { reason: string }) => {
      if (!reviewTarget || !selectedBatchId) throw new Error("请选择要处理的差异");
      return rentalCoreApi.reviewPaymentStatementLine(selectedBatchId, reviewTarget.line.id, { decision: reviewTarget.decision, reason: values.reason });
    },
    onSuccess: (result) => {
      setReviewTarget(undefined);
      setSelectedBatchId(result.id);
      void Promise.all([
        detail.refetch(),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "payment-statement-batches"] })
      ]);
      message.success("差异处理记录已保存");
    },
    onError: (error: Error) => message.error(error.message || "差异处理失败")
  });

  const openReview = (line: PaymentStatementLineSummary, decision: "acknowledge" | "query_provider") => {
    setReviewTarget({ line, decision });
    reviewForm.setFieldsValue({ reason: decision === "query_provider" ? "已登记，待向支付平台核对" : "" });
  };

  return <>
    <PageHeader title="支付对账" description="导入当前经营空间的支付平台对账文件，核对差异并保留人工处理记录。" />
    <Alert
      type="info"
      showIcon
      title="对账只产生证据，不会自动改写支付或退款事实"
      description="重复导入同一经营空间、平台和文件会直接返回原批次。金额、币种、状态、第三方流水号或本地记录不一致时，必须由授权人员逐条确认或标记待向平台核对。"
      style={{ marginBottom: 16 }}
    />
    <Card title="导入对账文件" style={{ marginBottom: 16 }}>
      <Space wrap align="end">
        <div>
          <Typography.Text type="secondary" style={{ display: "block", marginBottom: 6 }}>支付平台</Typography.Text>
          <Select value={provider} onChange={setProvider} style={{ width: 180 }} options={Object.entries(providerLabels).map(([value, label]) => ({ value, label }))} />
        </div>
        <Upload
          accept=".csv,text/csv"
          maxCount={1}
          beforeUpload={() => false}
          fileList={fileList}
          onChange={({ fileList: next }) => setFileList(next.slice(-1))}
          onRemove={() => { setFileList([]); return true; }}
        >
          <Button icon={<UploadOutlined />}>选择 CSV 文件</Button>
        </Upload>
        <Button type="primary" loading={importStatement.isPending} disabled={!fileList.length} onClick={() => importStatement.mutate()}>导入并核对</Button>
      </Space>
      <Typography.Paragraph type="secondary" style={{ margin: "12px 0 0" }}>
        单个文件不超过 10MB、最多 10,000 行；文件应包含 kind、status、amount、currency 和商户订单号列，退款行还需商户退款单号。
      </Typography.Paragraph>
    </Card>
    <Card title={<Space>对账批次 <Tag>{batches.data?.length ?? 0}</Tag></Space>}>
      <QueryState loading={batches.isLoading} error={batches.error}>
        <Table<PaymentStatementBatchSummary>
          rowKey="id"
          dataSource={batches.data ?? []}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: <Empty description="当前经营空间还没有导入对账文件" /> }}
          columns={[
            { title: "平台", dataIndex: "provider", render: (value: string) => providerLabels[value] ?? value },
            { title: "文件", dataIndex: "fileName", ellipsis: true },
            { title: "导入时间", dataIndex: "importedAt", render: formatDate },
            { title: "行数", dataIndex: "totalRows", align: "right" },
            { title: "匹配 / 差异", render: (_, row) => `${row.matchedRows} / ${row.differenceRows}` },
            { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={value === "matched" ? "green" : value === "reviewed" ? "blue" : "orange"}>{batchStatusLabels[value] ?? value}</Tag> },
            { title: "操作", align: "right", render: (_, row) => <Button type="link" icon={<SearchOutlined />} onClick={() => setSelectedBatchId(row.id)}>查看差异</Button> }
          ]}
        />
      </QueryState>
    </Card>
    <Drawer title={detail.data ? `${providerLabels[detail.data.provider] ?? detail.data.provider} · ${detail.data.fileName}` : "对账批次详情"} size={1080} open={Boolean(selectedBatchId)} onClose={() => setSelectedBatchId(undefined)}>
      <QueryState loading={detail.isLoading} error={detail.error}>
        {detail.data && <>
          <Space wrap style={{ marginBottom: 16 }}>
            <Tag color={detail.data.status === "matched" ? "green" : detail.data.status === "reviewed" ? "blue" : "orange"}>{batchStatusLabels[detail.data.status] ?? detail.data.status}</Tag>
            <Typography.Text type="secondary">共 {detail.data.totalRows} 行，匹配 {detail.data.matchedRows} 行，差异 {detail.data.differenceRows} 行，已处理 {detail.data.acknowledgedRows} 行</Typography.Text>
          </Space>
          <Table<PaymentStatementLineSummary>
            rowKey="id"
            size="small"
            dataSource={detail.data.lines}
            pagination={{ pageSize: 8 }}
            scroll={{ x: 980 }}
            columns={[
              { title: "行", dataIndex: "rowNumber", width: 56 },
              { title: "类型", dataIndex: "kind", width: 72, render: (value: string) => value === "refund" ? "退款" : "支付" },
              { title: "商户单号", dataIndex: "merchantOrderNo", ellipsis: true },
              { title: "金额", render: (_, row) => `${row.amount.toFixed(2)} ${row.currency}` },
              { title: "差异", dataIndex: "differenceCodes", render: (value: string[]) => value.length ? <Space wrap>{value.map((code) => <Tag color="orange" key={code}>{code}</Tag>)}</Space> : "—" },
              { title: "处理状态", dataIndex: "reviewStatus", render: (value: string) => <Tag color={value === "acknowledged" || value === "not_required" ? "green" : "orange"}>{reviewStatusLabels[value] ?? value}</Tag> },
              { title: "操作", fixed: "right", width: 220, render: (_, row) => row.reviewStatus === "open" || row.reviewStatus === "query_pending" ? <Space><Button type="link" onClick={() => openReview(row, "query_provider")}>标记待核对</Button><Button type="link" onClick={() => openReview(row, "acknowledge")}>确认差异</Button></Space> : "—" }
            ]}
          />
        </>}
      </QueryState>
    </Drawer>
    <Drawer title={reviewTarget?.decision === "query_provider" ? "标记待向平台核对" : "确认对账差异"} size={520} open={Boolean(reviewTarget)} onClose={() => setReviewTarget(undefined)} extra={<Button type="primary" loading={reviewLine.isPending} onClick={() => reviewForm.submit()}>保存</Button>}>
      <Form form={reviewForm} layout="vertical" onFinish={(values) => reviewLine.mutate(values)}>
        <Alert type="warning" showIcon title="这里只记录处理结论，不会修改支付、退款或资金事实。" style={{ marginBottom: 16 }} />
        <Typography.Paragraph>第 {reviewTarget?.line.rowNumber} 行 · {reviewTarget?.line.merchantOrderNo}</Typography.Paragraph>
        <Form.Item name="reason" label="处理原因" rules={[{ required: true, whitespace: true, message: "请填写处理原因" }, { max: 500, message: "处理原因不能超过 500 个字符" }]}>
          <Input.TextArea rows={5} placeholder="填写核对依据、平台查询结果或后续处理说明" />
        </Form.Item>
      </Form>
    </Drawer>
  </>;
}
