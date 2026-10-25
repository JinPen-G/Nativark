import { ListFilters, ListSection, SaveButton, useListFilter } from "@/components/ui";
import { SearchOutlined, UploadOutlined } from "@/components/ui/icons";
import type { PaymentStatementBatchSummary, PaymentStatementLineSummary } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Space, Tag, Typography } from "antd";
import { App, Empty } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, Table, Upload } from "@/components/ui";
import { Input } from "@/components/ui";
import { Select } from "@/components/ui";
import { CheckCheck, Download, SearchCheck } from "lucide-react";
import { Button, DataTableRowActions, DataTableStatus, Drawer, downloadCsv } from "@/components/ui";
import type { UploadFile } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import { RecordDetailLayout } from "@/components/RecordDetailLayout";
import { useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

const providerLabels: Record<string, string> = { alipay: "支付宝", wechat_pay: "微信支付" };
const batchStatusLabels: Record<string, string> = { matched: "全部匹配", needs_review: "待处理差异", reviewed: "差异已处理" };
const reviewStatusLabels: Record<string, string> = { not_required: "无需处理", open: "待处理", query_pending: "待向平台核对", acknowledged: "已确认" };

function formatDate(value: string | undefined, locale: "zh-CN" | "en-US") {
  return value ? new Date(value).toLocaleString(locale, { hour12: false }) : "—";
}

export function PaymentReconciliationPage() {
  const { message } = App.useApp();
  const { locale, t } = useLocale();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState("alipay");
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const navigate = useNavigate();
  const { batchId: selectedBatchId } = useParams<{ batchId: string }>();
  const setSelectedBatchId = (id?: string) => navigate(id ? `/rental/payment-reconciliation/${encodeURIComponent(id)}` : "/rental/payment-reconciliation");
  const [reviewTarget, setReviewTarget] = useState<{ line: PaymentStatementLineSummary; decision: "acknowledge" | "query_provider" }>();
  const [reviewForm] = Form.useForm<{ reason: string }>();
  const batches = useQuery({ queryKey: ["rental-core", "payment-statement-batches"], queryFn: () => rentalCoreApi.paymentStatementBatches() });
  const detail = useQuery({
    queryKey: ["rental-core", "payment-statement-batch", selectedBatchId],
    queryFn: () => rentalCoreApi.paymentStatementBatch(selectedBatchId!),
    enabled: Boolean(selectedBatchId)
  });
  const batchFilter = useListFilter(batches.data, { fields: row => [row.fileName, t(providerLabels[row.provider] ?? row.provider)], status: row => row.status });
  const lineFilter = useListFilter(detail.data?.lines, { fields: row => [row.merchantOrderNo, ...row.differenceCodes], status: row => row.reviewStatus });
  const importStatement = useMutation({
    mutationFn: () => {
      const file = fileList[0]?.originFileObj;
      if (!file) throw new Error(t("请选择 CSV 对账文件"));
      return rentalCoreApi.importPaymentStatement(provider, file);
    },
    onSuccess: (result) => {
      setFileList([]);
      setSelectedBatchId(result.id);
      void queryClient.invalidateQueries({ queryKey: ["rental-core", "payment-statement-batches"] });
      message.success(t("对账文件已导入，支付事实未被自动改写"));
    },
    onError: (error: Error) => message.error(error.message || t("对账文件导入失败"))
  });
  const reviewLine = useMutation({
    mutationFn: (values: { reason: string }) => {
      if (!reviewTarget || !selectedBatchId) throw new Error(t("请选择要处理的差异"));
      return rentalCoreApi.reviewPaymentStatementLine(selectedBatchId, reviewTarget.line.id, { decision: reviewTarget.decision, reason: values.reason });
    },
    onSuccess: (result) => {
      setReviewTarget(undefined);
      setSelectedBatchId(result.id);
      void Promise.all([
        detail.refetch(),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "payment-statement-batches"] })
      ]);
      message.success(t("差异处理记录已保存"));
    },
    onError: (error: Error) => message.error(error.message || t("差异处理失败"))
  });

  const openReview = (line: PaymentStatementLineSummary, decision: "acknowledge" | "query_provider") => {
    setReviewTarget({ line, decision });
    reviewForm.setFieldsValue({ reason: decision === "query_provider" ? t("已登记，待向支付平台核对") : "" });
  };

  return <>
    {!selectedBatchId && <>
    <PageHeader title={t("支付对账")} description={t("对账不会自动修改收退款记录；差异须逐条核实。")} />
    <Card title={t("导入对账文件")} style={{ marginBottom: 16 }}>
      <Alert
        type="warning"
        showIcon
        title={t("当前仅支持支付宝和微信支付的 CSV 对账文件；Stripe 文件导入尚未开放。")}
        style={{ marginBottom: 12 }}
      />
      <Space wrap align="end">
        <div>
          <Typography.Text type="secondary" style={{ display: "block", marginBottom: 6 }}>{t("支付平台")}</Typography.Text>
          <Select value={provider} onChange={setProvider} style={{ width: "var(--rental-control-width-select)" }} options={Object.entries(providerLabels).map(([value, label]) => ({ value, label: t(label) }))} />
        </div>
        <Upload
          accept=".csv,text/csv"
          maxCount={1}
          beforeUpload={() => false}
          fileList={fileList}
          onChange={({ fileList: next }) => setFileList(next.slice(-1))}
          onRemove={() => { setFileList([]); return true; }}
        >
          <Button icon={<UploadOutlined />}>{t("选择 CSV 文件")}</Button>
        </Upload>
        <Button icon={<Download size={16} aria-hidden="true" />} disabled={importStatement.isPending} onClick={() => downloadCsv(t("对账文件模板"), [["kind", "status", "amount", "currency", "merchant_order_no", "merchant_refund_no", "external_id", "occurred_at"]])}>{t("下载模板")}</Button>
        <Button type="primary" loading={importStatement.isPending} disabled={!fileList.length} onClick={() => importStatement.mutate()}>{t("导入并核对")}</Button>
      </Space>
      <Typography.Paragraph type="secondary" style={{ margin: "12px 0 0" }}>
        {t("单个文件不超过 10MB、最多 10,000 行；文件应包含 kind、status、amount、currency 和商户订单号列，退款行还需商户退款单号。")}
      </Typography.Paragraph>
    </Card>
    <ListSection title={t("对账批次")} controls={<ListFilters filter={batchFilter} placeholder="文件名或支付平台" options={Object.entries(batchStatusLabels).map(([value, label]) => ({ value, label }))} />}>
      <QueryState loading={batches.isLoading} error={batches.error} onRetry={() => batches.refetch({ throwOnError: true })}>
        <Table<PaymentStatementBatchSummary>
          rowKey="id"
          onRefresh={() => batches.refetch()} loading={batches.isFetching} dataSource={batchFilter.rows}
          pagination={batchFilter.pagination}
          locale={{ emptyText: <Empty description={t("当前经营空间还没有导入对账文件")} /> }}
          columns={[
            { title: t("平台"), dataIndex: "provider", render: (value: string) => t(providerLabels[value] ?? value) },
            { title: t("文件"), dataIndex: "fileName", ellipsis: true },
            { title: t("导入时间"), dataIndex: "importedAt", render: (value: string) => formatDate(value, locale) },
            { title: t("行数"), dataIndex: "totalRows", align: "right" },
            { title: t("匹配 / 差异"), render: (_, row) => `${row.matchedRows} / ${row.differenceRows}` },
            { title: t("状态"), dataIndex: "status", render: (value: string) => <Tag color={value === "matched" ? "green" : value === "reviewed" ? "blue" : "orange"}>{t(batchStatusLabels[value] ?? value)}</Tag> },
            { title: t("操作"), align: "right", render: (_, row) => <Button type="link" icon={<SearchOutlined />} onClick={() => setSelectedBatchId(row.id)}>{t("查看差异")}</Button> }
          ]}
        />
      </QueryState>
    </ListSection>
    </>}
    {selectedBatchId && <RecordDetailLayout title={detail.data?.fileName ?? t("对账批次详情")} onBack={() => setSelectedBatchId(undefined)}
      status={detail.data && <><DataTableStatus variant="soft" tone={detail.data.status === "matched" ? "success" : "warning"}>{t(batchStatusLabels[detail.data.status] ?? detail.data.status)}</DataTableStatus><span>{t(providerLabels[detail.data.provider] ?? detail.data.provider)}</span></>}
      facts={detail.data ? [
        { key: "total", label: "行数", value: detail.data.totalRows },
        { key: "difference", label: "差异", value: detail.data.differenceRows },
        { key: "matched", label: "匹配", value: detail.data.matchedRows },
        { key: "reviewed", label: "已处理", value: detail.data.acknowledgedRows }
      ] : undefined}>
      <Alert type="warning" showIcon title={t("这里只记录处理结论，不会修改支付、退款或资金事实。")} />
      <QueryState loading={detail.isLoading} error={detail.error} onRetry={() => detail.refetch({ throwOnError: true })}>
        {detail.data && <ListSection title={t("对账明细")} controls={<ListFilters filter={lineFilter} placeholder="商户单号或差异编码" options={Object.entries(reviewStatusLabels).map(([value, label]) => ({ value, label }))} />}>
          <Table<PaymentStatementLineSummary>
            rowKey="id"
            size="small"
            onRefresh={() => detail.refetch()} loading={detail.isFetching} dataSource={lineFilter.rows}
            pagination={lineFilter.pagination}
            scroll={{ x: 980 }}
            columns={[
              { title: t("行"), dataIndex: "rowNumber", width: 56 },
              { title: t("类型"), dataIndex: "kind", width: 72, render: (value: string) => value === "refund" ? t("退款") : t("支付") },
              { title: t("商户单号"), dataIndex: "merchantOrderNo", ellipsis: true },
              { title: t("金额"), render: (_, row) => `${row.amount.toFixed(2)} ${row.currency}` },
              { title: t("差异"), dataIndex: "differenceCodes", render: (value: string[]) => value.length ? <Space wrap>{value.map((code) => <Tag color="orange" key={code}>{code}</Tag>)}</Space> : "—" },
              { title: t("处理状态"), dataIndex: "reviewStatus", render: (value: string) => <Tag color={value === "acknowledged" || value === "not_required" ? "green" : "orange"}>{t(reviewStatusLabels[value] ?? value)}</Tag> },
              { title: t("操作"), fixed: "right", render: (_, row) => row.reviewStatus === "open" || row.reviewStatus === "query_pending" ? <DataTableRowActions primary={{ id: "acknowledge", label: t("确认差异"), icon: CheckCheck, onSelect: () => openReview(row, "acknowledge") }} details={() => openReview(row, "acknowledge")} detailLabel={t("确认差异")} menuLabel={`${row.rowNumber} · ${t("更多操作")}`} actions={[
                { id: "query", label: t("标记待核对"), icon: SearchCheck, onSelect: () => openReview(row, "query_provider") }
              ]} /> : "—" }
            ]}
          />
        </ListSection>}
      </QueryState>
    </RecordDetailLayout>}
    <Drawer title={reviewTarget?.decision === "query_provider" ? t("标记待向平台核对") : t("确认对账差异")} size={520} open={Boolean(reviewTarget)} onClose={() => setReviewTarget(undefined)} extra={<SaveButton  label={t("保存")} form={reviewForm} pending={reviewLine.isPending} onSave={(values) => reviewLine.mutateAsync(values)} />}>
      <Form form={reviewForm} layout="vertical" onFinish={(values) => reviewLine.mutate(values)}>
        <Alert type="warning" showIcon title={t("这里只记录处理结论，不会修改支付、退款或资金事实。")} style={{ marginBottom: 16 }} />
        <Typography.Paragraph>{t("第")} {reviewTarget?.line.rowNumber} {t("行")} · {reviewTarget?.line.merchantOrderNo}</Typography.Paragraph>
        <Form.Item name="reason" label={t("处理原因")} rules={[{ required: true, whitespace: true, message: t("请填写处理原因") }, { max: 500, message: t("处理原因不能超过 500 个字符") }]}>
          <Input.TextArea rows={5} placeholder={t("填写核对依据、平台查询结果或后续处理说明")} />
        </Form.Item>
      </Form>
    </Drawer>
  </>;
}
