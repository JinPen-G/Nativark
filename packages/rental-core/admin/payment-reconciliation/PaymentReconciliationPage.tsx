/** 原对账列表、批次事实和差异表单通过当前 Core 宿主消费同一业务实现。 */
import { ActionButton, App, ArrowLeftOutlined, Button, DataTableRowActions, DataTableStatus, Drawer, EmptyScene, Form, InfoPopover, Input, ListFilters, ListSection, RecordDetailLayout, SaveButton, Select, Table, Upload, downloadCsv, useListFilter } from "@rental-os/platform-admin/ui";
import type { PaymentStatementBatchDetail, PaymentStatementBatchSummary, PaymentStatementLineSummary, ReviewPaymentStatementLineRequest } from "@rental-os/rental-core";
import { corePageKey, resolveCorePageLocation } from "@rental-os/core-contracts";
import { CorePage, QueryState, useCorePageHost } from "@rental-os/platform-admin/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { CheckCheck, Download, FileSpreadsheet, Info, SearchCheck, UploadCloud } from "lucide-react";
import type { UploadFile } from "antd";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocale } from "@rental-os/platform-admin/locale";
import { useOrderEditor } from "../orders/useOrderEditor";
import { useRentalPaymentReconciliationContext } from "./page-context";
import { rentalPaymentReconciliationLocation } from "./pages";
import styles from "./PaymentReconciliation.module.css";

interface StatementImportSubmission {
  provider: string;
  file: File;
  lifetimeKey: string;
}
interface StatementReviewSubmission {
  batchId: string;
  lineId: string;
  data: ReviewPaymentStatementLineRequest;
  lifetimeKey: string;
  editorKey: string;
}

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
  const context = useRentalPaymentReconciliationContext();
  const host = useCorePageHost();
  const { api, queryScope } = context;
  const { message } = App.useApp();
  const { locale, t } = useLocale();
  const queryClient = useQueryClient();
  const selectedBatchId = host.params?.batchId;
  const lifetimeKey = JSON.stringify([host.lifetimeKey, host.page.key, selectedBatchId]);
  const lifetime = useRef({ key: lifetimeKey, active: true });
  lifetime.current.key = lifetimeKey;
  useLayoutEffect(() => {
    lifetime.current.active = true;
    return () => { lifetime.current.active = false; };
  }, []);
  const isCurrent = (expected = lifetimeKey) => lifetime.current.active
    && lifetime.current.key === expected && context.isCurrent();
  const assertCurrent = (expected = lifetimeKey) => {
    if (!isCurrent(expected)) throw new DOMException("对账页面或当前批次已变化", "AbortError");
  };
  const setSelectedBatchId = (batchId?: string) => {
    assertCurrent();
    const location = rentalPaymentReconciliationLocation(batchId);
    const target = host.pages.get(corePageKey(location.coreId, location.pageId));
    if (!target || !host.canAccess(target.coreId, target.definition.permissions))
      throw new Error(t("当前页面不可用"));
    host.navigate(resolveCorePageLocation(host.pages, location));
  };
  const [importOpen, setImportOpen] = useState(false);
  const [provider, setProvider] = useState("alipay");
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const importRequest = useRef<Promise<PaymentStatementBatchDetail> | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{
    line: PaymentStatementLineSummary;
    decision: "acknowledge" | "query_provider";
    sequence: number;
  }>();
  const reviewSequence = useRef(0);
  const [reviewForm] = Form.useForm<{ reason: string }>();
  useEffect(() => { setReviewTarget(undefined); }, [selectedBatchId]);
  const batchesKey = ["rental-core", "payment-statement-batches", queryScope];
  const detailKey = ["rental-core", "payment-statement-batch", queryScope, selectedBatchId];
  const batches = useQuery({
    queryKey: batchesKey,
    queryFn: ({ signal }) => api.paymentStatementBatches(50, signal),
    enabled: context.isCurrent(),
  });
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: ({ signal }) => api.paymentStatementBatch(selectedBatchId!, signal),
    enabled: Boolean(selectedBatchId) && context.isCurrent(),
  });
  const batchFilter = useListFilter(batches.data, { fields: row => [row.fileName, t(providerLabels[row.provider] ?? row.provider)], status: row => row.status });
  const lineFilter = useListFilter(detail.data?.lines, { fields: row => [row.merchantOrderNo, ...row.differenceCodes, ...row.differenceCodes.map(code => t(differenceLabels[code] ?? code))], status: row => row.reviewStatus });
  const importStatement = useMutation({
    mutationFn: async (submission: StatementImportSubmission) => {
      assertCurrent(submission.lifetimeKey);
      const result = await api.importPaymentStatement(submission.provider, submission.file);
      assertCurrent(submission.lifetimeKey);
      return result;
    },
    onSuccess: (result, submission) => {
      if (!isCurrent(submission.lifetimeKey)) return;
      setFileList([]);
      setImportOpen(false);
      setSelectedBatchId(result.id);
      void queryClient.invalidateQueries({ queryKey: batchesKey });
      message.success(t("对账文件已导入，支付事实未被自动改写"));
    },
  });
  const runImport = (): Promise<PaymentStatementBatchDetail> => {
    assertCurrent();
    if (importRequest.current) return importRequest.current;
    const file = fileList[0]?.originFileObj;
    if (!file) throw new Error(t("请选择 CSV 对账文件"));
    // 在第一次调用时固定文件和支付平台，关闭与其他入口共用同一在途请求。
    const request = importStatement.mutateAsync({ provider, file, lifetimeKey });
    importRequest.current = request;
    void request.finally(() => {
      if (importRequest.current === request) importRequest.current = null;
    }).catch(() => undefined);
    return request;
  };
  const reviewLine = useMutation({
    mutationFn: async (submission: StatementReviewSubmission): Promise<PaymentStatementBatchDetail> => {
      assertCurrent(submission.lifetimeKey);
      const result = await api.reviewPaymentStatementLine(submission.batchId, submission.lineId, submission.data);
      assertCurrent(submission.lifetimeKey);
      return result;
    },
    onSuccess: (result, submission): void => {
      if (!isCurrent(submission.lifetimeKey) || !reviewEditor.isCurrent(submission.editorKey)) return;
      setReviewTarget(undefined);
      setSelectedBatchId(result.id);
      void Promise.all([
        detail.refetch(),
        queryClient.invalidateQueries({ queryKey: batchesKey }),
      ]);
      message.success(t("差异处理记录已保存"));
    },
  });
  const reviewEditor = useOrderEditor<{ reason: string }>({
    form: reviewForm,
    identity: reviewTarget && selectedBatchId
      ? JSON.stringify([lifetimeKey, selectedBatchId, reviewTarget.line.id, reviewTarget.decision, reviewTarget.sequence])
      : undefined,
    disabled: !context.isCurrent(),
    onSave: (values): Promise<unknown> => {
      assertCurrent();
      if (!reviewTarget || !selectedBatchId) throw new Error(t("请选择要处理的差异"));
      return reviewLine.mutateAsync({
        batchId: selectedBatchId,
        lineId: reviewTarget.line.id,
        data: { decision: reviewTarget.decision, reason: values.reason },
        lifetimeKey,
        editorKey: reviewEditor.key,
      });
    },
  });
  const reviewPending = reviewEditor.busy || reviewLine.isPending;
  const openReview = (line: PaymentStatementLineSummary, decision: "acknowledge" | "query_provider") => {
    assertCurrent();
    reviewEditor.dismiss(() => {
      reviewLine.reset();
      reviewForm.resetFields();
      reviewSequence.current += 1;
      setReviewTarget({ line, decision, sequence: reviewSequence.current });
      reviewForm.setFieldsValue({ reason: decision === "query_provider" ? t("已登记，待向支付平台核对") : "" });
    });
  };

  return <>
    {!selectedBatchId && <>
    <CorePage note={{ title: "对账说明", description: "对账不会自动修改收退款记录；差异须逐条核实。" }} actions={[{
      id: "import-statement", kind: "open", emphasis: "primary",
      label: { default: "导入对账文件", translations: { "en-US": "Import statement" } },
      icon: <UploadCloud size={16} aria-hidden="true" />,
      open: () => { if (!importRequest.current) { importStatement.reset(); setImportOpen(true); } },
    }]}>{null}</CorePage>
    <ListSection controls={<ListFilters filter={batchFilter} placeholder="文件名或支付平台" statusLabel="对账状态" options={Object.entries(batchStatusLabels).map(([value, label]) => ({ value, label }))} />}>
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
      header={<CorePage title={detail.data?.fileName ?? t("对账批次详情")} actions={[{
        id: "return-to-list", kind: "navigate", slot: "navigation",
        label: { default: "返回列表", translations: { "en-US": "Back to list" } },
        icon: <ArrowLeftOutlined aria-hidden />,
        to: rentalPaymentReconciliationLocation(),
      }]}>{null}</CorePage>}
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
      onClose={() => { if (!importRequest.current && !importStatement.isPending) setImportOpen(false); }} closable={!importStatement.isPending} keyboard={!importStatement.isPending} maskClosable={!importStatement.isPending}
      extra={<ActionButton label={t("导入并核对")} pendingLabel={t("导入中")} disabled={!fileList.length} pending={importStatement.isPending} onAction={runImport} />}>
      <Form layout="vertical" className={styles.importForm}>
        <Form.Item label={t("支付平台")} style={{ marginBottom: 0 }}><Select aria-label={t("支付平台")} value={provider} disabled={importStatement.isPending} onChange={value => { if (!importRequest.current && isCurrent()) setProvider(value); }} options={Object.entries(providerLabels).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item>
        <div className={styles.uploadLabel}><span>{t("CSV 对账文件")}</span><span className="text-meta">{t("单文件 ≤ 10MB · 最多 10,000 行")}</span></div>
        <Upload accept=".csv,text/csv" maxCount={1} disabled={importStatement.isPending}
          beforeUpload={file => { if (importRequest.current || !isCurrent()) return Upload.LIST_IGNORE; if (!/\.csv$/i.test(file.name) || file.size === 0 || file.size > 10 * 1024 * 1024) { message.error(t("请选择 10MB 以内的非空 CSV 文件")); return Upload.LIST_IGNORE; } return false; }}
          fileList={fileList} onChange={({ fileList: next }) => { if (!importRequest.current && isCurrent()) setFileList(next.slice(-1)); }} onRemove={() => { if (importRequest.current || !isCurrent()) return false; setFileList([]); return true; }} />
        <div className={styles.importTools}>
          <Button icon={<Download size={16} aria-hidden="true" />} disabled={importStatement.isPending} onClick={() => downloadCsv(t("对账文件模板"), [["kind", "status", "amount", "currency", "merchant_order_no", "merchant_refund_no", "external_id", "occurred_at"]])}>{t("下载模板")}</Button>
          <InfoPopover title={t("文件要求")} content={<div className={styles.fileRequirements}><p>{t("仅支持支付宝和微信支付的 CSV 文件，Stripe 暂不支持。")}</p><p>{t("单个文件不超过 10MB、最多 10,000 行；文件应包含 kind、status、amount、currency 和商户订单号列，退款行还需商户退款单号。")}</p></div>}><Button type="text" icon={<Info size={16} aria-hidden="true" />}>{t("文件要求")}</Button></InfoPopover>
        </div>
        {importStatement.error && importStatement.variables?.lifetimeKey === lifetimeKey && <p className={styles.operationError} role="alert">{errorCopy(importStatement.error, t("对账文件导入失败"))}</p>}
        <p className={styles.detailNote}><Info size={14} aria-hidden="true" />{t("导入仅生成核对记录，不修改支付或退款事实。")}</p>
      </Form>
    </Drawer>
    <Drawer presentation="dialog" destroyOnHidden title={reviewTarget?.decision === "query_provider" ? t("标记待向平台核对") : t("确认对账差异")} size={520} open={Boolean(reviewTarget)}
      closable={!reviewPending} keyboard={!reviewPending} maskClosable={!reviewPending}
      onClose={() => reviewEditor.dismiss(() => setReviewTarget(undefined))}
      extra={<SaveButton label={t("保存")} form={{ ...reviewForm, validateFields: reviewEditor.validate }}
        disabled={!reviewTarget} pending={reviewPending} onSave={reviewEditor.submit} />}>
      <Form form={reviewForm} layout="vertical" disabled={reviewPending} {...reviewEditor.formProps}>
        <div className={styles.reviewContext}>
          <strong>{t("第")} {reviewTarget?.line.rowNumber} {t("行")} · {reviewTarget?.line.merchantOrderNo}</strong>
          <span className={styles.money}><small>{reviewTarget?.line.currency}</small>{reviewTarget?.line.amount.toFixed(2)}</span>
          <span>{reviewTarget?.line.differenceCodes.map(code => t(differenceLabels[code] ?? code)).join(" / ")}</span>
          <p className={styles.detailNote}><Info size={14} aria-hidden="true" />{t("这里只记录处理结论，不会修改支付、退款或资金事实。")}</p>
        </div>
        <Form.Item name="reason" label={t("处理原因")} rules={[{ required: true, whitespace: true, message: t("请填写处理原因") }, { max: 500, message: t("处理原因不能超过 500 个字符") }]}>
          <Input.TextArea rows={5} placeholder={t("填写核对依据、平台查询结果或后续处理说明")} />
        </Form.Item>
        {reviewLine.error && reviewLine.variables?.editorKey === reviewEditor.key && <p className={styles.operationError} role="alert">{errorCopy(reviewLine.error, t("差异处理失败"))}</p>}
      </Form>
    </Drawer>
  </>;
}
