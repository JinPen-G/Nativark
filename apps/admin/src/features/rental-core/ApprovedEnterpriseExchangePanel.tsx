/** Merchant approval-bound exchange action in the original order inspection view.
 * Core supplies the applied result and original receipts own recovery. */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatRentalMoney, type EnterpriseMerchantExchangeChoices, type EnterpriseMerchantExchangePreparation, type RentalApprovedExchangeReceipt, type RentalOrder } from "@rental-os/shared";
import { ActionButton, Alert, ConfirmAction, Form, Input, ListSection, Select } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { useOriginalApprovedEnterpriseExchange } from "./original-approved-enterprise-exchange";
import styles from "./OrderDetail.module.css";

type Values = { approvalId: string; preparationId: string; reason: string };
type Confirmation = { owner: string; values: Values; materialKey: string; binding: NonNullable<EnterpriseMerchantExchangePreparation["binding"]> };
const valuesKey = (values: Values) => JSON.stringify([values.approvalId, values.preparationId, values.reason]);
const materialKey = (approval: EnterpriseMerchantExchangeChoices["approvals"][number], preparation: EnterpriseMerchantExchangePreparation) => JSON.stringify([approval.approval, preparation]);
const stateLabels = {
  pending: "待费用审批", expired: "换货申请已失效", consumed: "已消费原批准", rejected: "费用申请已拒绝", withdrawn: "费用申请已撤回",
  waiting_expense: "待本人确认费用", waiting_inspection: "待匹配检查准备", waiting_consent: "待本人检查同意", consent_unavailable: "本人检查同意未完整捕获", ready: "材料可核对"
} as const;
export function ApprovedEnterpriseExchangePanel({ order, operationToken, unavailable = false, onApplied }: {
  order: RentalOrder; operationToken?: string; unavailable?: boolean; onApplied: (receipt: RentalApprovedExchangeReceipt) => Promise<void>;
}) {
  const { t, locale } = useLocale(), operation = useOriginalApprovedEnterpriseExchange(order.id, operationToken);
  const unavailableLabel = locale === "en-US" ? "Exchange execution is unavailable" : "换货执行暂不可用";
  const [form] = Form.useForm<Values>(), approvalId = Form.useWatch("approvalId", form), preparationId = Form.useWatch("preparationId", form);
  const owner = JSON.stringify([operation.identity, order.updatedAt]), latestOwner = useRef(owner); latestOwner.current = owner;
  const confirmation = useRef<Confirmation | undefined>(undefined);
  const [observed, setObserved] = useState<{ identity: string; value: RentalApprovedExchangeReceipt }>();
  const [failure, setFailure] = useState<{ owner: string; message: string }>();
  const eligible = order.status === "renting" && Boolean(order.membershipSnapshot?.enterpriseContractAndPayer);
  const blocked = !operation.permitted || unavailable || !eligible || operation.busy || Boolean(operation.pending || operation.storageError);
  const choices = useQuery({ queryKey: ["enterprise-exchange-execution-choices", owner], queryFn: ({ signal }) => operation.readChoices(order, signal),
    enabled: !blocked, retry: false, refetchInterval: false, refetchOnWindowFocus: false });
  const source = choices.error ? undefined : choices.data;
  const approval = source?.approvals.find(entry => entry.approval.id === approvalId), preparation = approval?.preparations.find(entry => entry.preparationId === preparationId);
  const materialReady = operation.permitted && !unavailable && eligible && !choices.isFetching && approval?.state === "ready" && preparation?.state === "ready" && Boolean(preparation.binding)
    && approval.approval.execution !== "original_merchant_execution_not_connected" && Date.parse(approval.approval.expiresAt) > Date.now();
  const executable = !blocked && materialReady;
  const gate = useRef({ order, unavailable, materialReady, approval, preparation }); gate.current = { order, unavailable, materialReady, approval, preparation };
  useEffect(() => { confirmation.current = undefined; form.resetFields(); setFailure(undefined); }, [owner, form]);
  const display = observed?.identity === operation.identity ? observed.value : undefined;
  const afterRead = async (value: RentalApprovedExchangeReceipt) => {
    operation.current(); await onApplied(value); operation.current();
    setObserved({ identity: operation.identity, value }); setFailure(undefined);
  };
  const report = (error: unknown) => {
    try { operation.current(); if (latestOwner.current === owner) setFailure({ owner, message: error instanceof Error ? error.message : t("原换货结果待核对") }); }
    catch { /* The old owner retains only its durable reference. */ }
  };
  const execute = async () => {
    const original = confirmation.current;
    try {
      if (!original) throw new Error(t("请重新核对原换货执行引用"));
      return await operation.run(async () => {
        operation.current();
        const values = await form.validateFields(); operation.current();
        const validate = () => {
          operation.current(); const latest = gate.current;
          if (confirmation.current !== original || latestOwner.current !== original.owner || latest.unavailable || !latest.materialReady
            || latest.order.id !== order.id || latest.order.updatedAt !== original.binding.expectedOrderUpdatedAt
            || !latest.approval || !latest.preparation || Date.parse(latest.approval.approval.expiresAt) <= Date.now()
            || materialKey(latest.approval, latest.preparation) !== original.materialKey
            || valuesKey(values) !== valuesKey(original.values) || valuesKey(form.getFieldsValue(true)) !== valuesKey(original.values)) throw new Error(t("原换货执行材料已变化"));
        };
        validate();
        const current = await operation.readChoices(gate.current.order);
        validate();
        const currentApproval = current.approvals.find(entry => entry.approval.id === original.values.approvalId);
        const currentPreparation = currentApproval?.preparations.find(entry => entry.preparationId === original.values.preparationId);
        if (!currentApproval || currentApproval.state !== "ready" || !currentPreparation || currentPreparation.state !== "ready"
          || currentApproval.approval.execution === "original_merchant_execution_not_connected"
          || materialKey(currentApproval, currentPreparation) !== original.materialKey) throw new Error(t("原换货执行材料已变化"));
        return { ...structuredClone(original.binding), reason: original.values.reason, confirm: true };
      }, afterRead);
    } catch (error) { report(error); throw error; }
  };
  const recover = async () => { try { await operation.recover(afterRead); } catch (error) { report(error); throw error; } };
  return <ListSection title={t("原批准换货执行")}>
    <Alert type="info" title={t("核对原批准与两份确认")} description={t("费用批准、本人费用确认和具体检查同意须对应本单。执行结果按原商户收据及原变更核对。")}/>
    {!operation.permitted && <Alert type="warning" title={t("当前商户企业或订单执行权限不可用")}/>}
    {operation.storageError && <Alert type="error" title={t(operation.storageError)}/>}
    {failure?.owner === owner && <Alert type="error" title={t(failure.message)}/>}
    {operation.pending && operation.permitted && <ActionButton intent="review" label={t("核对原换货执行收据")} disabled={operation.busy} onAction={recover}/>}
    {eligible && operation.permitted && <>
      <ActionButton intent="review" label={t("刷新本单换货材料")} disabled={blocked || choices.isFetching}
        onAction={() => { confirmation.current = undefined; return choices.refetch({ throwOnError: true }); }}/>
      {choices.isFetching && <Alert type="info" title={t("正在读取本单换货材料")}/>}
      {choices.error && <Alert type="error" title={t("本单换货材料读取失败")}/>}
      {source?.coverage.state === "limited" && <Alert type="warning" title={t("材料读取已达上限")}
        description={t("每类最多读取20条，尚未确认更早材料的覆盖范围。须读到原检查同意后才能执行。")}/>}
      {source && source.approvals.length === 0 && <Alert type="info" title={t("本单尚无换货费用申请")}/>}
      {source && source.approvals.length > 0 && <Form form={form} name="approved-enterprise-exchange" layout="vertical" disabled={blocked || choices.isFetching}
        onValuesChange={changed => { confirmation.current = undefined; if (Object.hasOwn(changed, "approvalId")) form.setFieldsValue({ preparationId: undefined }); }}>
        <Form.Item name="approvalId" label={t("本单费用批准")} rules={[{ required: true }]}>
          <Select options={source.approvals.map(entry => {
            const statusLabel = entry.approval.state === "approved" && entry.approval.execution === "original_merchant_execution_not_connected"
              ? unavailableLabel : t(stateLabels[entry.state]);
            return { value: entry.approval.id,
              label: `${entry.approval.preview.originalItemGroupName} → ${entry.approval.preview.replacementItemGroupName} · ${formatRentalMoney(entry.approval.preview.additionalAmount, entry.approval.preview.currency)} · ${statusLabel}` };
          })}/>
        </Form.Item>
        {approval?.approval.state === "approved" && approval.approval.execution === "original_merchant_execution_not_connected" && <Alert type="warning"
          title={unavailableLabel} description={locale === "en-US" ? "This expense change requires a supported execution and funding path. Review the original request before proceeding." : "本次费用变更需要受支持的执行和资金来源，请核对原申请。"} />}
        {approval && <dl className={styles.facts}>
          <div><dt>{t("原商品")}</dt><dd>{approval.approval.preview.originalItemGroupName}</dd></div>
          <div><dt>{t("替换商品")}</dt><dd>{approval.approval.preview.replacementItemGroupName}</dd></div>
          <div><dt>{t("原商品金额")}</dt><dd>{formatRentalMoney(approval.approval.preview.originalAmount, approval.approval.preview.currency)}</dd></div>
          <div><dt>{t("替换商品金额")}</dt><dd>{formatRentalMoney(approval.approval.preview.replacementAmount, approval.approval.preview.currency)}</dd></div>
          <div><dt>{t("本次新增支出")}</dt><dd>{formatRentalMoney(approval.approval.preview.additionalAmount, approval.approval.preview.currency)}</dd></div>
          <div><dt>{t("退款金额")}</dt><dd>{formatRentalMoney(approval.approval.preview.refundAmount, approval.approval.preview.currency)}</dd></div>
          <div><dt>{t("押金差额")}</dt><dd>{formatRentalMoney(approval.approval.preview.depositDelta, approval.approval.preview.currency)}</dd></div>
          <div><dt>{t("预授权差额")}</dt><dd>{formatRentalMoney(approval.approval.preview.preAuthDelta, approval.approval.preview.currency)}</dd></div>
          <div><dt>{t("申请原因")}</dt><dd>{approval.approval.reason}</dd></div>
          <div><dt>{t("本人费用确认")}</dt><dd>{approval.approval.employeeConfirmation ? new Date(approval.approval.employeeConfirmation.confirmedAt).toLocaleString() : t("待本人确认费用")}</dd></div>
        </dl>}
        <Form.Item name="preparationId" label={t("本单检查材料")} rules={[{ required: true }]}>
          <Select options={(approval?.preparations ?? []).map(material => ({ value: material.preparationId,
            label: `${new Date(material.createdAt).toLocaleString()} · ${t(stateLabels[material.state])}` }))}/>
        </Form.Item>
        {preparation && <>
          <dl className={styles.facts}><div><dt>{t("本人检查同意")}</dt><dd>{preparation.consentConfirmedAt ? new Date(preparation.consentConfirmedAt).toLocaleString() : t(stateLabels[preparation.state])}</dd></div>
            <div><dt>{t("原物处置")}</dt><dd>{t(preparation.inspection.exchange.originalDisposition === "off_shelf" ? "下架" : "归还仓库")}</dd></div></dl>
          {preparation.inspection.templates.map(template => {
            const inspection = preparation.inspection.inspections.find(result => result.side === template.side && result.templateId === template.templateId);
            return <div key={`${template.side}:${template.templateId}`}>
              <strong>{t(template.side === "original_return" ? "原物归还检查" : "替换物交付检查")} · {template.name}</strong>
              <dl className={styles.facts}>{template.fields.map(field => <div key={field.code}><dt>{field.label}</dt>
                <dd>{inspection?.results[field.code] === undefined ? t("未提供") : field.type === "photo" ? t("已核验照片") : String(inspection.results[field.code])}</dd></div>)}</dl>
            </div>;
          })}
          {preparation.inspection.exceptions.map((exception, index) => <p key={`${exception.code}:${index}`}>{exception.description}</p>)}
        </>}
        <Form.Item name="reason" label={t("换货执行原因")} rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea maxLength={500}/></Form.Item>
        <ConfirmAction label={t("执行本次原批准换货")} prompt={t("按本单原批准、费用确认及具体检查同意执行？")} disabled={!executable}
          onStateChange={state => {
            if (state === "confirming" && executable && approval && preparation?.binding) confirmation.current = {
              owner, values: structuredClone(form.getFieldsValue(true)), materialKey: materialKey(approval, preparation), binding: structuredClone(preparation.binding)
            };
            else if (state === "idle" || state === "done") confirmation.current = undefined;
          }} onConfirm={execute}/>
      </Form>}
    </>}
    {display && <dl className={styles.facts}>
      <div><dt>{t("原执行键")}</dt><dd>{display.operationKey}</dd></div><div><dt>{t("原换货变更")}</dt><dd>{display.changeId}</dd></div>
      <div><dt>{t("原费用批准")}</dt><dd>{display.approvalId}</dd></div><div><dt>{t("原具体检查同意")}</dt><dd>{display.consentId}</dd></div>
      <div><dt>{t("原生效时间")}</dt><dd>{new Date(display.appliedAt).toLocaleString()}</dd></div>
    </dl>}
  </ListSection>;
}
