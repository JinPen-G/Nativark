import { ActionButton, App, Button, DataTableRowActions, DataTableStatus, Drawer, EmptyScene, Form, InfoPopover, Input, ListFilters, ListSection, SaveButton, Segmented, Select, Table, Upload, downloadCsv, useListFilter } from "@/components/ui";
import type { PaymentStatementBatchSummary, PaymentStatementLineSummary } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { CheckCheck, Download, FileSpreadsheet, Info, SearchCheck, UploadCloud } from "lucide-react";
import type { UploadFile } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import { RecordDetailLayout } from "@/components/RecordDetailLayout";
import { useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import styles from "./PaymentReconciliation.module.css";

const providerLabels: Record<string, string> = { alipay: "支付宝", wechat_pay: "微信支付" };
const batchStatusLabels: Record<string, string> = { matched: "全部匹配", needs_review: "待处理差异", reviewed: "差异已处理" };
const differenceLabels: Record<string, string> = {
  invalid_occurred_at: "交易时间无效", duplicate_statement_key: "账单记录重复", local_record_missing: "未找到本地记录",
  unsupported_status: "平台状态未识别", amount_mismatch: "金额不一致", currency_mismatch: "币种不一致",
  provider_mismatch: "支付平台不一致", status_mismatch: "交易状态不一致", external_id_mismatch: "平台流水号不一致",
  local_external_id_missing: "本地缺少平台流水号",
};
const batchTone = (status: string) => status === "matched" ? "success" : status === "reviewed" ? "info" : status === "needs_review" ? "warning" : "neutral";
const reviewTone = (status: string) => status === "acknowledged" ? "success" : status === "open" ? "warning" : status === "query_pending" ? "info" : "neutral";
const reviewStatusLabels: Record<string, string> = { not_required: "无需处理", open: "待处理", query_pending: "待向平台核对", acknowledged: "已确认" };

function formatDate(value: string | undefined, locale: "zh-CN" | "en-US") {
  return value ? new Date(value).toLocaleString(locale, { hour12: false }) : "—";
}

function errorCopy(error: Error, fallback: string) {
  const data = isAxiosError<{ message?: string | string[]; error?: { message?: string } }>(error) ? error.response?.data : undefined;
  const detail = data?.message ?? data?.error?.message;
  return Array.isArray(detail) ? detail.join(" · ") : detail || error.message || fallback;
}

export function PaymentReconciliationPage() {
  const { message } = App.useApp();
  const { locale, t } = useLocale();
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
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
  const lineFilter = useListFilter(detail.data?.lines, { fields: row => [row.merchantOrderNo, ...row.differenceCodes, ...row.differenceCodes.map(code => t(differenceLabels[code] ?? code))], status: row => row.reviewStatus });
  const importStatement = useMutation({
    mutationFn: () => {
      const file = fileList[0]?.originFileObj;
      if (!file) throw new Error(t("请选择 CSV 对账文件"));
      return rentalCoreApi.importPaymentStatement(provider, file);
    },
    onSuccess: (result) => {
      setFileList([]);
      setImportOpen(false);
      setSelectedBatchId(result.id);
      void queryClient.invalidateQueries({ queryKey: ["rental-core", "payment-statement-batches"] });
      message.success(t("对账文件已导入，支付事实未被自动改写"));
    }
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
    }
  });

  const openReview = (line: PaymentStatementLineSummary, decision: "acknowledge" | "query_provider") => {
    reviewLine.reset();
    setReviewTarget({ line, decision });
    reviewForm.setFieldsValue({ reason: decision === "query_provider" ? t("已登记，待向支付平台核对") : "" });
  };

  return <>
    {!selectedBatchId && <>
    <PageHeader title={t("支付对账")} note={{ title: "对账说明", description: "对账不会自动修改收退款记录；差异须逐条核实。" }}
      extra={<Button type="primary" icon={<UploadCloud size={16} aria-hidden="true" />} onClick={() => { importStatement.reset(); setImportOpen(true); }}>{t("导入对账文件")}</Button>} />
    <ListSection controls={<><Segmented value={batchFilter.status} onChange={value => batchFilter.setStatus(String(value))}
      options={[{ value: "", label: t("全部") }, ...Object.entries(batchStatusLabels).map(([value, label]) => ({ value, label: t(label) }))]} />
      <ListFilters filter={batchFilter} placeholder="文件名或支付平台" /></>}>
      <QueryState loading={batches.isLoading} error={batches.error} onRetry={() => batches.refetch({ throwOnError: true })}>
        <Table<PaymentStatementBatchSummary>
          rowKey="id"
          onRefresh={() => batches.refetch()} loading={batches.isLoading} refreshing={batches.isFetching} dataSource={batchFilter.rows}
          pagination={batchFilter.pagination}
          scroll={{ x: 1026 }}
          locale={{ emptyText: <EmptyScene scene={batchFilter.keyword || batchFilter.status ? "search" : "empty"} compact
            title={t(batchFilter.keyword || batchFilter.status ? "没有匹配的对账批次" : "还没有对账文件")}
            action={batchFilter.keyword || batchFilter.status ? <Button onClick={batchFilter.clear}>{t("清除筛选")}</Button> : undefined} /> }}
          columns={[
            { title: t("账单文件"), dataIndex: "fileName", width: 300, render: (_, row) => <div className={styles.fileIdentity}>
              <FileSpreadsheet className={styles.fileIcon} size={20} aria-hidden="true" /><div className={styles.fileCopy}>
                <strong title={row.fileName}>{row.fileName}</strong><span>{t(providerLabels[row.provider] ?? row.provider)}</span>
              </div></div> },
            { title: t("导入时间"), dataIndex: "importedAt", width: 190, render: (value: string) => formatDate(value, locale) },
            { title: t("行数"), dataIndex: "totalRows", width: 96, align: "right" },
            { title: t("核对结果"), width: 150, render: (_, row) => <div className={styles.result}>
              <span>{t("匹配")} <b>{row.matchedRows}</b></span><span data-attention={row.status === "needs_review" || undefined}>{t("差异")} <b>{row.differenceRows}</b></span>
            </div> },
            { title: t("状态"), dataIndex: "status", width: 140, render: (value: string) => <DataTableStatus variant="soft" tone={batchTone(value)}>{t(batchStatusLabels[value] ?? value)}</DataTableStatus> },
            { title: t("操作"), fixed: "right", width: 150, render: (_, row) => <DataTableRowActions actions={[]} details={() => setSelectedBatchId(row.id)} detailLabel={t("查看明细")} menuLabel={`${row.fileName} · ${t("更多操作")}`} /> }
          ]}
        />
      </QueryState>
    </ListSection>
    </>}
    {selectedBatchId && <RecordDetailLayout title={detail.data?.fileName ?? t("对账批次详情")} onBack={() => setSelectedBatchId(undefined)}
      status={detail.data && <><DataTableStatus variant="soft" tone={batchTone(detail.data.status)}>{t(batchStatusLabels[detail.data.status] ?? detail.data.status)}</DataTableStatus><span>{t(providerLabels[detail.data.provider] ?? detail.data.provider)}</span></>}
      facts={detail.data ? [
        { key: "total", label: "行数", value: detail.data.totalRows },
        { key: "difference", label: "差异", value: detail.data.differenceRows },
        { key: "matched", label: "匹配", value: detail.data.matchedRows },
        { key: "reviewed", label: "已确认差异", value: detail.data.acknowledgedRows }
      ] : undefined}>
      <p className={styles.detailNote}><Info size={14} aria-hidden="true" />{t("这里只记录处理结论，不会修改支付、退款或资金事实。")}</p>
      <QueryState loading={detail.isLoading} error={detail.error} onRetry={() => detail.refetch({ throwOnError: true })}>
        {detail.data && <ListSection title={t("对账明细")} controls={<ListFilters filter={lineFilter} placeholder="商户单号或差异" options={Object.entries(reviewStatusLabels).map(([value, label]) => ({ value, label }))} />}>
          <Table<PaymentStatementLineSummary>
            rowKey="id"
            size="small"
            onRefresh={() => detail.refetch()} loading={detail.isLoading} refreshing={detail.isFetching} dataSource={lineFilter.rows}
            pagination={lineFilter.pagination}
            scroll={{ x: 1086 }}
            columns={[
              { title: t("行"), dataIndex: "rowNumber", width: 80 },
              { title: t("类型"), dataIndex: "kind", width: 96, render: (value: string) => value === "refund" ? t("退款") : t("支付") },
              { title: t("商户单号"), dataIndex: "merchantOrderNo", width: 230, ellipsis: true },
              { title: t("金额"), align: "right", width: 140, render: (_, row) => <span className={styles.money}><small>{row.currency}</small>{row.amount.toFixed(2)}</span> },
              { title: t("差异"), dataIndex: "differenceCodes", width: 200, render: (value: string[]) => value.length ? <span className={styles.differences} title={value.join(", ")}>{value.map(code => t(differenceLabels[code] ?? code)).join(" / ")}</span> : "—" },
              { title: t("处理状态"), dataIndex: "reviewStatus", width: 170, render: (value: string, row) => <div className={styles.reviewState}><DataTableStatus variant="soft" tone={reviewTone(value)}>{t(reviewStatusLabels[value] ?? value)}</DataTableStatus>{row.reviewReason && <span className={styles.reviewReason} title={row.reviewReason}>{row.reviewReason}</span>}</div> },
              { title: t("操作"), fixed: "right", width: 170, render: (_, row) => row.reviewStatus === "open" || row.reviewStatus === "query_pending" ? <DataTableRowActions primary={{ id: "acknowledge", label: t("确认差异"), icon: CheckCheck, onSelect: () => openReview(row, "acknowledge") }} details={() => openReview(row, "acknowledge")} detailLabel={t("确认差异")} menuLabel={`${row.rowNumber} · ${t("更多操作")}`} actions={[
                { id: "query", label: t("标记待核对"), icon: SearchCheck, onSelect: () => openReview(row, "query_provider") }
              ]} /> : "—" }
            ]}
          />
        </ListSection>}
      </QueryState>
    </RecordDetailLayout>}
    <Drawer presentation="bottom" destroyOnHidden title={t("导入对账文件")} size={520} open={importOpen}
      onClose={() => { if (!importStatement.isPending) setImportOpen(false); }} keyboard={!importStatement.isPending} maskClosable={!importStatement.isPending}
      extra={<ActionButton label={t("导入并核对")} pendingLabel={t("导入中")} disabled={!fileList.length} pending={importStatement.isPending} onAction={() => importStatement.mutateAsync()} />}>
      <Form layout="vertical" className={styles.importForm}>
        <Form.Item label={t("支付平台")} style={{ marginBottom: 0 }}><Select aria-label={t("支付平台")} value={provider} disabled={importStatement.isPending} onChange={setProvider} options={Object.entries(providerLabels).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item>
        <div className={styles.uploadLabel}><span>{t("CSV 对账文件")}</span><span className="text-meta">{t("单文件 ≤ 10MB · 最多 10,000 行")}</span></div>
        <Upload accept=".csv,text/csv" maxCount={1} disabled={importStatement.isPending}
          beforeUpload={file => { if (!/\.csv$/i.test(file.name) || file.size === 0 || file.size > 10 * 1024 * 1024) { message.error(t("请选择 10MB 以内的非空 CSV 文件")); return Upload.LIST_IGNORE; } return false; }}
          fileList={fileList} onChange={({ fileList: next }) => setFileList(next.slice(-1))} onRemove={() => { setFileList([]); return true; }} />
        <div className={styles.importTools}>
          <Button icon={<Download size={16} aria-hidden="true" />} disabled={importStatement.isPending} onClick={() => downloadCsv(t("对账文件模板"), [["kind", "status", "amount", "currency", "merchant_order_no", "merchant_refund_no", "external_id", "occurred_at"]])}>{t("下载模板")}</Button>
          <InfoPopover title={t("文件要求")} content={<div className={styles.fileRequirements}><p>{t("仅支持支付宝和微信支付的 CSV 文件，Stripe 暂不支持。")}</p><p>{t("单个文件不超过 10MB、最多 10,000 行；文件应包含 kind、status、amount、currency 和商户订单号列，退款行还需商户退款单号。")}</p></div>}><Button type="text" icon={<Info size={16} aria-hidden="true" />}>{t("文件要求")}</Button></InfoPopover>
        </div>
        {importStatement.error && <p className={styles.operationError} role="alert">{errorCopy(importStatement.error, t("对账文件导入失败"))}</p>}
        <p className={styles.detailNote}><Info size={14} aria-hidden="true" />{t("导入仅生成核对记录，不修改支付或退款事实。")}</p>
      </Form>
    </Drawer>
    <Drawer presentation="dialog" destroyOnHidden title={reviewTarget?.decision === "query_provider" ? t("标记待向平台核对") : t("确认对账差异")} size={520} open={Boolean(reviewTarget)} keyboard={!reviewLine.isPending} maskClosable={!reviewLine.isPending} onClose={() => { if (!reviewLine.isPending) setReviewTarget(undefined); }} extra={<SaveButton label={t("保存")} form={reviewForm} pending={reviewLine.isPending} onSave={(values) => reviewLine.mutateAsync(values)} />}>
      <Form form={reviewForm} layout="vertical" onFinish={(values) => reviewLine.mutate(values)}>
        <div className={styles.reviewContext}>
          <strong>{t("第")} {reviewTarget?.line.rowNumber} {t("行")} · {reviewTarget?.line.merchantOrderNo}</strong>
          <span className={styles.money}><small>{reviewTarget?.line.currency}</small>{reviewTarget?.line.amount.toFixed(2)}</span>
          <span>{reviewTarget?.line.differenceCodes.map(code => t(differenceLabels[code] ?? code)).join(" / ")}</span>
          <p className={styles.detailNote}><Info size={14} aria-hidden="true" />{t("这里只记录处理结论，不会修改支付、退款或资金事实。")}</p>
        </div>
        <Form.Item name="reason" label={t("处理原因")} rules={[{ required: true, whitespace: true, message: t("请填写处理原因") }, { max: 500, message: t("处理原因不能超过 500 个字符") }]}>
          <Input.TextArea rows={5} placeholder={t("填写核对依据、平台查询结果或后续处理说明")} />
        </Form.Item>
        {reviewLine.error && <p className={styles.operationError} role="alert">{errorCopy(reviewLine.error, t("差异处理失败"))}</p>}
      </Form>
    </Drawer>
  </>;
}
