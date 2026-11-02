import { DownloadOutlined, FileTextOutlined, PrinterOutlined } from "@/components/ui/icons";
import type { RentalCategoryTerminology, RentalFundingBalance, RentalInspectionRecord, RentalInspectionTemplate, RentalOrder, RentalDocumentType } from "@rental-os/shared";
import { Space, Typography } from "antd";
import { ListSection, Modal, Alert, Button, Select, App } from "@/components/ui";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { rentalCoreApi } from "@/api/rentalCore";
import { QueryState } from "@/components/QueryState";
import { useLocale } from "@/app/locale";

const DOCUMENT_TYPES: Array<{ value: RentalDocumentType; label: string }> = [
  { value: "quote", label: "报价单" }, { value: "delivery", label: "交付清单" },
  { value: "return", label: "归还检查单" }, { value: "settlement", label: "结算对账单" }
];

/** The server renderer escapes business values. Still constrain archived HTML
 * at the display boundary: no scripts, links, media, handlers or external CSS. */
export function safeVoucherHtml(html: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const allowed = new Set(["H1", "H2", "P", "DIV", "SPAN", "STRONG", "B", "BR", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD"]);
  for (const element of Array.from(parsed.body.querySelectorAll("*"))) {
    if (!allowed.has(element.tagName)) { element.remove(); continue; }
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name !== "colspan" || !/^\d{1,2}$/u.test(attribute.value)) element.removeAttribute(attribute.name);
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font-family:Arial,sans-serif;padding:24px;line-height:1.6;color:#222}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:8px;text-align:left}@media print{body{padding:0}}</style></head><body>${parsed.body.innerHTML}</body></html>`;
}

export function OrderDocumentsPanel({ order }: {
  order: RentalOrder;
  inspections: RentalInspectionRecord[];
  templates: RentalInspectionTemplate[];
  funding?: RentalFundingBalance;
  terminology?: RentalCategoryTerminology;
  money: (value: number | undefined) => string;
}) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const [selection, setSelection] = useState<{ type: RentalDocumentType; snapshotId?: string }>();
  const type = selection?.type ?? "quote";
  const document = useQuery({ queryKey: ["rental-core", "order", order.id, "document", type, selection?.snapshotId],
    queryFn: () => selection?.snapshotId ? rentalCoreApi.orderDocumentVersion(order.id, type, selection.snapshotId)
      : rentalCoreApi.orderDocument(order.id, type), enabled: Boolean(selection), refetchInterval: false, refetchOnWindowFocus: false });
  useEffect(() => {
    if (selection && !selection.snapshotId && document.data?.snapshotId && document.data.documentType === selection.type) {
      setSelection({ type: selection.type, snapshotId: document.data.snapshotId });
    }
  }, [selection, document.data]);
  const versions = useQuery({ queryKey: ["rental-core", "order", order.id, "document-versions", type, document.data?.snapshotId],
    queryFn: () => rentalCoreApi.orderDocumentVersions(order.id, type), enabled: Boolean(selection && document.data?.snapshotId) });
  const ready = document.data?.snapshotId && document.data.documentType === type && !document.isFetching && !document.error;
  const html = ready ? safeVoucherHtml(document.data!.html) : undefined;
  const download = () => {
    if (!html || !document.data?.snapshotId) return;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${document.data.documentNo}-${document.data.snapshotId}.html`.replace(/[^\p{L}\p{N}._-]/gu, "_");
    anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const print = () => {
    if (!html) return;
    const popup = window.open("", "_blank");
    if (!popup) { message.error(t("浏览器阻止了打印窗口，请允许后重试")); return; }
    popup.opener = null; popup.document.write(html); popup.document.close(); popup.focus(); popup.print();
  };
  return <>
    <ListSection title={t("客户业务凭证")}>
      <Space wrap>{DOCUMENT_TYPES.map(item => <Button key={item.value} icon={<FileTextOutlined />} onClick={() => setSelection({ type: item.value })}>{t(item.label)}</Button>)}</Space>
      <Typography.Text type="secondary">{t("读取服务端不可变凭证版本后查看、下载或打印；不构成法定票据")}</Typography.Text>
    </ListSection>
    <Modal title={`${t(DOCUMENT_TYPES.find(item => item.value === type)!.label)} · ${order.orderNo}`} open={Boolean(selection)} width={900}
      onCancel={() => setSelection(undefined)} destroyOnHidden footer={<Space>
        <Button onClick={() => setSelection(undefined)}>{t("关闭")}</Button>
        <Button disabled={!html} icon={<DownloadOutlined />} onClick={download}>{t("下载 HTML")}</Button>
        <Button disabled={!html} type="primary" icon={<PrinterOutlined />} onClick={print}>{t("打印")}</Button>
      </Space>}>
      <QueryState loading={document.isFetching} error={document.error}>
        {document.data && !document.data.snapshotId && <Alert type="warning" title={t("凭证尚未归档，不能打印或下载")} />}
        {ready && <>
          <Select value={document.data!.snapshotId} options={(versions.data ?? []).map(row => ({ value: row.snapshotId, label: `${row.documentNo} · ${row.snapshotAt}` }))}
            onChange={snapshotId => setSelection({ type, snapshotId })} />
          <Typography.Paragraph>{t("凭证版本")} {document.data!.snapshotId} · {t("快照时间")} {document.data!.snapshotAt}</Typography.Paragraph>
          <iframe title={t("服务端凭证预览")} sandbox="" srcDoc={html} style={{ width: "100%", height: "60vh", border: 0 }} />
        </>}
      </QueryState>
    </Modal>
  </>;
}
