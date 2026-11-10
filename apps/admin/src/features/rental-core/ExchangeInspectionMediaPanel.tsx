/** Merchant photo-source consumer. File selection never dispatches; original recovery
 * stays available independently of new preparation. No photo acceptance or fulfillment. */
import { useEffect, useRef, useState } from "react";
import type { RentalExchangeInspectionMediaRequirements, RentalExchangeInspectionMediaSource, RentalExchangeInspectionRequirementsRequest } from "@rental-os/shared";
import { ActionButton, Alert, FileUpload, Form, ListSection, Select, type FileUploadItem } from "@/components/ui";
import { ContentTransition } from "@/components/workspace/ContentTransition";
import { useLocale } from "@/app/locale";
import { useOriginalExchangeInspectionMedia } from "./original-exchange-inspection-media";
import styles from "./OrderDetail.module.css";

type Props = { orderId: string; orderRevision: string; operationToken?: string; request?: RentalExchangeInspectionRequirementsRequest; unavailable: boolean; newDisabled: boolean };
export function ExchangeInspectionMediaPanel({ orderId, orderRevision, operationToken, request, unavailable, newDisabled }: Props) {
  const { t } = useLocale(), operation = useOriginalExchangeInspectionMedia(orderId, operationToken, JSON.stringify([orderRevision, request, unavailable]));
  const owner = operation.identity, latest = useRef(owner); latest.current = owner;
  const mounted = useRef(true), sequence = useRef(0);
  const [requirements, setRequirements] = useState<{ owner: string; value: RentalExchangeInspectionMediaRequirements }>();
  const [selection, setSelection] = useState(""), [files, setFiles] = useState<FileUploadItem[]>([]), [reading, setReading] = useState(false);
  const [records, setRecords] = useState<{ owner: string; values: RentalExchangeInspectionMediaSource[] }>();
  const [failure, setFailure] = useState<{ owner: string; message: string }>();
  const ready = operation.permitted && !unavailable;
  const unresolved = operation.references.some(row => row.phase !== "completed"), blocked = !ready || newDisabled || reading || operation.busy || unresolved || Boolean(operation.storageError);
  const gate = useRef({ blocked, request }); gate.current = { blocked, request };
  useEffect(() => {
    mounted.current = true; sequence.current++; setRequirements(undefined); setSelection(""); setFiles([]); setRecords(undefined); setFailure(undefined); setReading(false);
    return () => { mounted.current = false; sequence.current++; };
  }, [owner]);
  const current = () => { operation.current(); if (!mounted.current || latest.current !== owner) throw new Error(t("原影像选择或页面已变化")); };
  const active = requirements?.owner === owner ? requirements.value : undefined;
  const fields = active?.templates.flatMap(row => row.template.fields.filter(field => field.type === "photo").map(field => ({ row, field, key: JSON.stringify([row.side, row.template.id, row.template.version, field.code]) }))) ?? [];
  const chosen = fields.find(field => field.key === selection);
  const record = (value: RentalExchangeInspectionMediaSource) => setRecords(previous => ({ owner, values: [...(previous?.owner === owner ? previous.values.filter(row => row.operationKey !== value.operationKey) : []), value] }));
  const report = (message: string) => { if (mounted.current && latest.current === owner) setFailure({ owner, message: t(message) }); };
  const read = async () => {
    current(); if (gate.current.blocked || !gate.current.request) throw new Error(t("请先核对原整行、替换商品与当前可用资产"));
    const input = structuredClone(gate.current.request), number = ++sequence.current; setReading(true); setRequirements(undefined); setSelection(""); setFiles([]); setFailure(undefined);
    try {
      const value = await operation.requirements(input); current(); if (number !== sequence.current) return;
      const expected = input.exchange, actual = value?.exchange;
      if (!value || value.orderId !== orderId || value.workspaceId !== operation.workspaceId || value.expectedOrderUpdatedAt !== orderRevision || !actual
        || actual.orderLineId !== expected.orderLineId || actual.allocationId !== expected.allocationId || actual.replacementItemGroupId !== expected.replacementItemGroupId
        || actual.replacementAssetId !== expected.replacementAssetId || actual.priceBasis !== expected.priceBasis || actual.originalDisposition !== expected.originalDisposition
        || expected.replacementPricingGroupId && actual.replacementPricingGroupId !== expected.replacementPricingGroupId
        || !/^[a-f0-9]{64}$/u.test(value.requirementsHash) || value.media !== "dedicated_source_only" || value.reservation !== "not_reserved"
        || !Array.isArray(value.templates) || !value.templates.length || value.templates.length > 40
        || value.templates.some(row => !["original_return", "replacement_pickup"].includes(row.side) || !row.template?.id || !row.template.version || !Array.isArray(row.template.fields))) throw new Error("requirements mismatch");
      const photoKeys = value.templates.flatMap(row => row.template.fields.filter(field => field.type === "photo").map(field => JSON.stringify([row.side, row.template.id, row.template.version, field.code])));
      if (new Set(photoKeys).size !== photoKeys.length) throw new Error("duplicate fields");
      setRequirements({ owner, value });
    } catch (error) { report("影像要求读取失败或与本单选择不匹配"); throw error; }
    finally { if (mounted.current && latest.current === owner) setReading(false); }
  };
  const upload = async () => {
    current(); if (gate.current.blocked || !active || !chosen || files.length !== 1 || files[0].error) throw new Error(t("请先选择原照片字段与有效文件"));
    const file = files[0].file;
    if (!["image/jpeg", "image/png"].includes(file.type) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 20 * 1024 * 1024) throw new Error(t("仅支持 JPEG/PNG，大小为 1 字节至 20 MiB"));
    try {
      const value = await operation.run({ expectedOrderUpdatedAt: active.expectedOrderUpdatedAt, exchange: active.exchange, requirementsHash: active.requirementsHash,
        side: chosen.row.side, templateId: chosen.row.template.id, templateVersion: chosen.row.template.version, fieldCode: chosen.field.code,
        fileName: file.name.trim(), mimeType: file.type as "image/jpeg" | "image/png", sizeBytes: file.size }, file); current(); record(value); setFiles([]); setFailure(undefined);
    } catch (error) { if (mounted.current && latest.current === owner) setFiles([]); report("原影像结果待核对，不能重新上传或完成"); throw error; }
  };
  const recover = async (key: string) => {
    try { current(); const value = await operation.recover(key); current(); record(value); setFailure(undefined); }
    catch (error) { report("原影像来源不可核对，保留原引用且不重发"); throw error; }
  };
  return <ListSection title={t("换货检查专用影像")}>
    <Alert type="info" title={t("影像核验不等于检查准备完成")} description={t("仅为原照片字段建立影像来源；尚未用于检查准备、本人检查同意或换货执行。上传结果未知只核对原来源，不重传、不重新完成。")}/>
    {!ready && <Alert type="warning" title={t("当前订单或检查权限不可用")}/>}
    {operation.storageError && <Alert type="error" title={t(operation.storageError)}/>}
    {failure?.owner === owner && <Alert type="error" title={failure.message}/>}
    {ready && operation.references.map(reference => <div key={reference.key} className={styles.actions}>
      <span className={styles.note}>{t(reference.phase === "completed" ? "原影像已核验，引用保留" : "原影像结果待核对")} · {reference.key}</span>
      <ActionButton intent="review" label={t("核对原影像来源")} disabled={operation.busy} onAction={() => recover(reference.key)}/>
    </div>)}
    {ready && request && <ActionButton intent="review" label={t("读取本次影像要求")} disabled={blocked} onAction={read}/>}
    <ContentTransition value={`${owner}:${active?.requirementsHash ?? "unread"}`}>
      {ready && active && <div className={styles.stack}>
        {!fields.length ? <p className={styles.note}>{t("本次模板没有照片字段")}</p> : <>
          <Form layout="vertical" disabled={blocked}>
            <Form.Item label={t("原检查照片字段")}><Select value={selection || undefined} options={fields.map(item => ({ value: item.key, label: `${t(item.row.side === "original_return" ? "原商品归还检查" : "替换商品领取检查")} · ${item.row.template.name} · ${item.row.template.version} · ${item.field.label}` }))}
              onChange={value => { current(); if (blocked) return; setSelection(value); setFiles([]); }}/></Form.Item>
          </Form>
          <FileUpload label={t("选择检查影像")} description={t("仅支持 JPEG/PNG，大小为 1 字节至 20 MiB；选择文件不会自动上传。")} accept="image/jpeg,image/png" multiple={false} maxSize={20 * 1024 * 1024}
            disabled={blocked || !chosen} value={files} onChange={value => { current(); if (!blocked) setFiles(value); }}/>
          <ActionButton intent="upload" label={t("上传并核验本条影像")} disabled={blocked || !chosen || files.length !== 1 || Boolean(files[0]?.error)} onAction={upload}/>
        </>}
      </div>}
    </ContentTransition>
    {ready && records?.owner === owner && records.values.map(value => <div key={value.operationKey} className={styles.snapshot}>
      <p>{t(value.state === "completed" ? "影像来源已核验，尚未用于检查准备" : "原影像结果待核对，不能重新上传或完成")}</p>
      <dl className={styles.facts}><div><dt>{t("原记录")}</dt><dd>{value.id}</dd></div><div><dt>{t("原订单修订")}</dt><dd>{value.expectedOrderUpdatedAt}</dd></div>
        <div><dt>{t("原检查照片字段")}</dt><dd>{value.fieldCode} · {value.templateVersion}</dd></div><div><dt>{t("文件")}</dt><dd>{value.fileName} · {value.sizeBytes} B</dd></div>
        {value.completion && <><div><dt>{t("影像尺寸")}</dt><dd>{value.completion.width} × {value.completion.height}</dd></div><div><dt>{t("核验时间")}</dt><dd>{new Date(value.completion.completedAt).toLocaleString()}</dd></div></>}</dl>
    </div>)}
  </ListSection>;
}
