/** Merchant pre-execution facts only. Preparation is never inspection consent,
 * enterprise delegation or physical exchange; unknown writes keep the original key. */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { InputNumber } from "antd";
import type { PrepareRentalExchangeInspectionRequest, RentalExchangeInspectionIntent, RentalExchangeInspectionPreparation, RentalExchangeInspectionRequirements, RentalOrder } from "@rental-os/shared";
import { ActionButton, Alert, Button, Form, Input, ListSection, SaveButton, Select } from "@/components/ui";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { useOriginalExchangeInspection } from "./original-exchange-inspection";
import { ExchangeInspectionMediaPanel } from "./ExchangeInspectionMediaPanel";
import styles from "./OrderDetail.module.css";

type Selection = { allocationId: string; replacementId: string; assetId?: string; pricingId?: string; priceBasis: RentalExchangeInspectionIntent["priceBasis"]; disposition: RentalExchangeInspectionIntent["originalDisposition"] };
const initial: Selection = { allocationId: "", replacementId: "", priceBasis: "original_order_price", disposition: "return_to_warehouse" };
export function ExchangeInspectionPreparationPanel({ order, operationToken, unavailable = false }: { order: RentalOrder; operationToken?: string; unavailable?: boolean }) {
  const { t } = useLocale(), operation = useOriginalExchangeInspection(order.id, operationToken, JSON.stringify([order.updatedAt, unavailable]));
  const [open, setOpen] = useState(false), [selection, setSelection] = useState<Selection>(initial);
  const [requirements, setRequirements] = useState<{ identity: string; value: RentalExchangeInspectionRequirements }>();
  const [record, setRecord] = useState<{ identity: string; value: RentalExchangeInspectionPreparation }>();
  const [failure, setFailure] = useState<{ identity: string; message: string }>(), [reading, setReading] = useState(false);
  const sequence = useRef(0), owner = JSON.stringify([operation.identity, order.updatedAt]), latest = useRef(owner); latest.current = owner;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; sequence.current++; setOpen(false); setSelection(initial); setRequirements(undefined); setRecord(undefined); setFailure(undefined); setReading(false);
    return () => { mounted.current = false; sequence.current++; };
  }, [owner]);
  const ready = !unavailable && operation.permitted, eligible = order.status === "renting" && order.fulfillmentMode !== "carrier_shipping";
  const blocked = !ready || reading || operation.busy || Boolean(operation.pending || operation.storageError);
  const current = () => { operation.current(); if (!mounted.current || latest.current !== owner) throw new Error(t("原订单修订或页面已变化")); };
  const groups = useQuery({ queryKey: ["exchange-inspection-groups", operation.identity], queryFn: rentalCoreApi.itemGroups, enabled: ready && eligible && open,
    retry: false, refetchInterval: false, refetchOnWindowFocus: false });
  const pricing = useQuery({ queryKey: ["exchange-inspection-pricing", operation.identity], queryFn: rentalCoreApi.pricingGroups, enabled: ready && eligible && open,
    retry: false, refetchInterval: false, refetchOnWindowFocus: false });
  const allocations = order.allocations.filter(row => {
    const line = order.lines.find(line => line.id === row.orderLineId);
    return row.status === "picked_up" && line && ["serialized", "quantity"].includes(line.inventoryMode) && row.quantity === line.quantity - (line.cancelledQuantity ?? 0);
  });
  const allocation = allocations.find(row => row.id === selection.allocationId), line = order.lines.find(row => row.id === allocation?.orderLineId);
  const replacement = groups.data?.find(row => row.id === selection.replacementId);
  const candidates = useQuery({ queryKey: ["exchange-inspection-candidates", owner, line?.id, selection.replacementId],
    queryFn: () => rentalCoreApi.allocationCandidates(order.id, { exchangeOrderLineId: line!.id, replacementItemGroupId: selection.replacementId }),
    enabled: ready && eligible && open && Boolean(line && replacement?.inventoryMode === "serialized"), retry: false, refetchInterval: false, refetchOnWindowFocus: false });
  const assets = candidates.data?.reservations.find(row => row.orderLineId === line?.id)?.candidates.filter(row => row.available) ?? [];
  const sourceFailed = Boolean(groups.error || pricing.error || replacement?.inventoryMode === "serialized" && candidates.error);
  const sourceBusy = groups.isFetching || pricing.isFetching || replacement?.inventoryMode === "serialized" && candidates.isFetching;
  const change = (patch: Partial<Selection>) => { if (blocked) return; sequence.current++; setRequirements(undefined); setFailure(undefined); setSelection(value => ({ ...value, ...patch })); };
  const read = async () => {
    current(); if (blocked || sourceFailed || sourceBusy || !eligible || !allocation || !line || !replacement
      || replacement.inventoryMode === "serialized" && !assets.some(row => row.assetId === selection.assetId)) throw new Error(t("请先核对原整行、替换商品与当前可用资产"));
    const number = ++sequence.current; setReading(true); setRequirements(undefined); setFailure(undefined);
    try {
      const exchange: RentalExchangeInspectionIntent = { orderLineId: line.id, allocationId: allocation.id, replacementItemGroupId: replacement.id,
        priceBasis: selection.priceBasis, originalDisposition: selection.disposition, ...(selection.assetId ? { replacementAssetId: selection.assetId } : {}), ...(selection.pricingId ? { replacementPricingGroupId: selection.pricingId } : {}) };
      const value = await operation.requirements({ expectedOrderUpdatedAt: order.updatedAt, exchange }); current();
      if (number !== sequence.current) return;
      if (value.orderId !== order.id || value.workspaceId !== operation.workspaceId || value.expectedOrderUpdatedAt !== order.updatedAt || value.exchange.allocationId !== allocation.id
        || value.exchange.orderLineId !== line.id || value.exchange.replacementItemGroupId !== replacement.id || value.exchange.replacementAssetId !== exchange.replacementAssetId
        || value.exchange.priceBasis !== exchange.priceBasis || value.exchange.originalDisposition !== exchange.originalDisposition
        || exchange.replacementPricingGroupId && value.exchange.replacementPricingGroupId !== exchange.replacementPricingGroupId
        || !/^[a-f0-9]{64}$/u.test(value.requirementsHash) || value.media !== "unavailable" || value.reservation !== "not_reserved" || !value.templates.length) throw new Error(t("检查要求与本单选择不匹配"));
      setRequirements({ identity: owner, value });
    } catch (error) { if (mounted.current && latest.current === owner) setFailure({ identity: owner, message: error instanceof Error ? error.message : t("检查要求读取失败") }); throw error; }
    finally { if (mounted.current && latest.current === owner) setReading(false); }
  };
  const save = async (input: Omit<PrepareRentalExchangeInspectionRequest, "operationKey">) => {
    try {
      current(); if (blocked || requirements?.identity !== owner || requirements.value.requirementsHash !== input.requirementsHash) throw new Error(t("须重新审阅本单检查要求"));
      const value = await operation.run(input); current(); setRecord({ identity: owner, value }); setRequirements(undefined); setFailure(undefined); setOpen(false);
    } catch (error) { if (mounted.current && latest.current === owner) setFailure({ identity: owner, message: error instanceof Error ? error.message : t("检查准备结果待核对") }); throw error; }
  };
  const recover = async () => {
    try { current(); const value = await operation.recover(); current(); if (!value) throw new Error(t("没有可核对的原检查引用")); setRecord({ identity: owner, value }); setRequirements(undefined); setOpen(false); setFailure(undefined); }
    catch (error) { if (mounted.current && latest.current === owner) setFailure({ identity: owner, message: error instanceof Error ? error.message : t("原检查结果不可核对") }); throw error; }
  };
  const active = requirements?.identity === owner ? requirements.value : undefined, recorded = record?.identity === owner ? record.value : undefined;
  // Photo requirements remain independent: ordinary preparation may reject required images.
  const mediaRequest = open && eligible && !sourceFailed && !sourceBusy && allocation && line && replacement
    && (replacement.inventoryMode !== "serialized" || assets.some(row => row.assetId === selection.assetId))
    ? { expectedOrderUpdatedAt: order.updatedAt, exchange: { orderLineId: line.id, allocationId: allocation.id, replacementItemGroupId: replacement.id,
      priceBasis: selection.priceBasis, originalDisposition: selection.disposition, ...(selection.assetId ? { replacementAssetId: selection.assetId } : {}), ...(selection.pricingId ? { replacementPricingGroupId: selection.pricingId } : {}) } } : undefined;
  return <ListSection title={t("换货生效前检查准备")}>
    <Alert type="info" title={t("保存准备不执行换货")} description={t("只记录原模板检查事实。照片用于检查准备、本人检查同意、企业委托与换货执行仍须另行接通；不占库存、不收付款。必需影像或承运检查缺支持时不能保存。")}/>
    {!ready && <Alert type="warning" title={t("当前订单或检查权限不可用")}/>}
    {operation.storageError && <Alert type="error" title={operation.storageError}/>}
    {failure?.identity === owner && <Alert type="error" title={failure.message}/>}
    {operation.pending && ready && <ActionButton intent="review" label={t("核对原检查准备结果")} disabled={operation.busy} onAction={recover}/>}
    {recorded && <div className={styles.snapshot}><p>{t("原检查准备已保存，未获本人检查同意、未执行换货")}</p><dl className={styles.facts}>
      <div><dt>{t("原记录")}</dt><dd>{recorded.id}</dd></div><div><dt>{t("原订单修订")}</dt><dd>{recorded.expectedOrderUpdatedAt}</dd></div>
      <div><dt>{t("记录时间")}</dt><dd>{new Date(recorded.createdAt).toLocaleString()}</dd></div></dl>
      {recorded.inspections.map(row => <dl key={`${row.side}:${row.templateId}`} className={styles.facts}>{Object.entries(row.results).map(([key, value]) => <div key={key}><dt>{recorded.templates.find(template => template.side === row.side && template.template.id === row.templateId)?.template.fields.find(field => field.code === key)?.label ?? key}</dt><dd>{typeof value === "boolean" ? t(value ? "是" : "否") : String(value)}</dd></div>)}</dl>)}
    </div>}
    {ready && eligible && !open && <Button disabled={blocked} onClick={() => { current(); setSelection(initial); setRequirements(undefined); setOpen(true); }}>{t("填写换货检查准备")}</Button>}
    {open && ready && eligible && <div className={styles.stack}>
      {sourceFailed && <Alert type="error" title={t("替换候选读取失败，不能保存检查")}/>}
      <Form layout="vertical" disabled={blocked || Boolean(sourceBusy)}>
        <Form.Item label={t("已领取整行")}><Select value={selection.allocationId || undefined} options={allocations.map(row => ({ value: row.id, label: `${order.lines.find(line => line.id === row.orderLineId)?.itemGroupName} · ${row.assetNo ?? row.quantity}` }))} onChange={value => change({ allocationId: value, replacementId: "", assetId: undefined, pricingId: undefined })}/></Form.Item>
        <Form.Item label={t("替换商品")}><Select value={selection.replacementId || undefined} options={!groups.error ? (groups.data ?? []).filter(row => row.status === "enabled" && row.inventoryMode === line?.inventoryMode && row.id !== line?.itemGroupId).map(row => ({ value: row.id, label: row.name })) : []} onChange={value => change({ replacementId: value, assetId: undefined, pricingId: undefined })}/></Form.Item>
        {replacement?.inventoryMode === "serialized" && <Form.Item label={t("当前可用资产")}><Select value={selection.assetId} options={!candidates.error ? assets.map(row => ({ value: row.assetId, label: row.assetNo })) : []} onChange={value => change({ assetId: value })}/></Form.Item>}
        <Form.Item label={t("计费规格")}><Select allowClear value={selection.pricingId} options={!pricing.error ? (pricing.data ?? []).filter(row => row.status === "enabled" && row.memberItemGroupIds.includes(selection.replacementId)).map(row => ({ value: row.id, label: row.name })) : []} onChange={value => change({ pricingId: value })}/></Form.Item>
        <Form.Item label={t("价格依据")}><Select value={selection.priceBasis} options={[{ value: "original_order_price", label: t("原订单价格") }, { value: "replacement_current_price", label: t("替换商品当前价格") }]} onChange={value => change({ priceBasis: value })}/></Form.Item>
        <Form.Item label={t("原物处置")}><Select value={selection.disposition} options={[{ value: "return_to_warehouse", label: t("返回仓库") }, { value: "off_shelf", label: t("下架") }]} onChange={value => change({ disposition: value })}/></Form.Item>
      </Form>
      <div className={styles.actions}><ActionButton intent="review" label={t("读取本次检查要求")} disabled={blocked || Boolean(sourceBusy) || sourceFailed || !line || !replacement} onAction={read}/><Button disabled={operation.busy || reading} onClick={() => { sequence.current++; setOpen(false); setRequirements(undefined); setSelection(initial); }}>{t("取消填写")}</Button></div>
      {active && <InspectionPreparationEditor key={`${owner}:${active.requirementsHash}`} requirements={active} disabled={blocked || Boolean(sourceBusy) || sourceFailed} onSave={save}/>}
    </div>}
    <ExchangeInspectionMediaPanel orderId={order.id} orderRevision={order.updatedAt} operationToken={operationToken} request={mediaRequest} unavailable={unavailable} newDisabled={blocked}/>
  </ListSection>;
}
export function InspectionPreparationEditor({ requirements, disabled, onSave }: { requirements: RentalExchangeInspectionRequirements; disabled: boolean; onSave: (input: Omit<PrepareRentalExchangeInspectionRequest, "operationKey">) => Promise<void> }) {
  const { t } = useLocale(); const [form] = Form.useForm<{ inspections: Array<{ results: Record<string, string | number | boolean> }>; reason: string; exceptionCode?: string; exceptionDescription?: string }>();
  return <Form form={form} layout="vertical" disabled={disabled}>
    {requirements.templates.map((row, index) => <ListSection key={`${row.side}:${row.template.id}`} title={`${t(row.side === "original_return" ? "原商品归还检查" : "替换商品领取检查")} · ${row.template.name}`}>
      <p className={styles.note}>{t("原模板版本")} {row.template.version}</p>
      {row.template.fields.map(field => <Form.Item key={field.code} name={["inspections", index, "results", field.code]} label={field.label} rules={[{ required: field.required, message: t("请填写本项检查事实") }]}>
        {field.type === "number" ? <InputNumber min={field.usageMetric ? 0 : undefined} suffix={field.unit} style={{ width: "100%" }}/> : field.type === "boolean" ? <Select options={[{ value: true, label: t("是 / 正常") }, { value: false, label: t("否 / 异常") }]}/> : field.type === "select" ? <Select options={(field.options ?? []).map(value => ({ value, label: value }))}/> : field.type === "photo" ? <Input disabled placeholder={t("照片尚未接入检查准备")}/> : <Input maxLength={1000}/>}
      </Form.Item>)}
    </ListSection>)}
    <Form.Item name="exceptionCode" label={t("异常编码（可选）")}><Input maxLength={128}/></Form.Item>
    <Form.Item name="exceptionDescription" label={t("原商品异常事实（可选）")}><Input.TextArea maxLength={500}/></Form.Item>
    <Form.Item name="reason" label={t("检查记录原因")} rules={[{ required: true, whitespace: true, message: t("请填写检查记录原因") }]}><Input.TextArea maxLength={500}/></Form.Item>
    <SaveButton form={form} disabled={disabled} label={t("保存检查准备")} onSave={async values => {
      if (Boolean(values.exceptionCode?.trim()) !== Boolean(values.exceptionDescription?.trim())) throw new Error(t("异常编码和事实须同时填写"));
      const inspections = requirements.templates.map((row, index) => ({ side: row.side, templateId: row.template.id, templateVersion: row.template.version, results: values.inspections?.[index]?.results ?? {} }));
      await onSave({ expectedRevision: 0, reason: values.reason.trim(), expectedOrderUpdatedAt: requirements.expectedOrderUpdatedAt, exchange: requirements.exchange, requirementsHash: requirements.requirementsHash, inspections,
        ...(values.exceptionDescription?.trim() ? { exceptions: [{ code: values.exceptionCode!.trim(), description: values.exceptionDescription.trim(), allocationId: requirements.exchange.allocationId }] } : {}) });
    }}/>
  </Form>;
}
