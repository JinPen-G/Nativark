/** Merchant approval-bound exchange action in the original order inspection view.
 * Core supplies the applied result and original receipts own recovery. */
import { useRef, useState } from "react";
import { InputNumber } from "antd";
import type { ExecuteApprovedRentalExchangeRequest, RentalApprovedExchangeReceipt, RentalOrder } from "@rental-os/shared";
import { ActionButton, Alert, ConfirmAction, Form, Input, ListSection } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { useOriginalApprovedEnterpriseExchange } from "./original-approved-enterprise-exchange";
import styles from "./OrderDetail.module.css";

type Values = Omit<ExecuteApprovedRentalExchangeRequest, "operationKey" | "expectedOrderUpdatedAt" | "confirm">;
type Confirmation = { identity: string; orderUpdatedAt: string; values: Values; key: string };
const valuesKey = (values: Values) => JSON.stringify([values.approvalId, values.expectedApprovalRevision, values.preparationId,
  values.preparationHash, values.consentId, values.consentOperationKey, values.reason]);
export function ApprovedEnterpriseExchangePanel({ order, operationToken, unavailable = false, onApplied }: {
  order: RentalOrder; operationToken?: string; unavailable?: boolean; onApplied: (receipt: RentalApprovedExchangeReceipt) => Promise<void>;
}) {
  const { t } = useLocale(), operation = useOriginalApprovedEnterpriseExchange(order.id, operationToken);
  const [form] = Form.useForm<Values>();
  const confirmation = useRef<Confirmation | undefined>(undefined);
  const [observed, setObserved] = useState<{ identity: string; value: RentalApprovedExchangeReceipt }>();
  const [failure, setFailure] = useState<{ identity: string; message: string }>();
  const eligible = order.status === "renting" && Boolean(order.membershipSnapshot?.enterpriseContractAndPayer);
  const blocked = !operation.permitted || unavailable || !eligible || operation.busy || Boolean(operation.pending || operation.storageError);
  const gate = useRef({ order, unavailable }); gate.current = { order, unavailable };
  const display = observed?.identity === operation.identity ? observed.value : undefined;
  const afterRead = async (value: RentalApprovedExchangeReceipt) => {
    operation.current(); await onApplied(value); operation.current();
    setObserved({ identity: operation.identity, value }); setFailure(undefined);
  };
  const report = (error: unknown) => {
    try { operation.current(); setFailure({ identity: operation.identity, message: error instanceof Error ? error.message : t("原换货结果待核对") }); } catch { /* The old owner retains only its durable reference. */ }
  };
  const execute = async () => {
    const original = confirmation.current;
    try {
      if (!original) throw new Error(t("请重新核对原换货执行引用"));
      return await operation.run(async () => {
        operation.current();
        const values = await form.validateFields(); operation.current();
        const latest = gate.current;
        if (confirmation.current !== original || latest.unavailable || latest.order.id !== order.id || latest.order.updatedAt !== original.orderUpdatedAt || original.identity !== operation.identity
          || latest.order.status !== "renting" || !latest.order.membershipSnapshot?.enterpriseContractAndPayer
          || valuesKey(values) !== original.key || valuesKey(form.getFieldsValue(true)) !== original.key) throw new Error(t("原换货执行材料已变化"));
        return { ...structuredClone(original.values), expectedOrderUpdatedAt: original.orderUpdatedAt, confirm: true };
      }, afterRead);
    } catch (error) { report(error); throw error; }
  };
  const recover = async () => { try { await operation.recover(afterRead); } catch (error) { report(error); throw error; } };
  return <ListSection title={t("原批准换货执行")}>
    <Alert type="info" title={t("核对原批准与两份确认")} description={t("费用批准、本人费用确认和具体检查同意须对应本单。执行结果按原商户收据及原变更核对。")}/>
    {!operation.permitted && <Alert type="warning" title={t("当前商户企业或订单执行权限不可用")}/>}
    {operation.storageError && <Alert type="error" title={t(operation.storageError)}/>}
    {failure?.identity === operation.identity && <Alert type="error" title={t(failure.message)}/>}
    {operation.pending && operation.permitted && <ActionButton intent="review" label={t("核对原换货执行收据")} disabled={operation.busy} onAction={recover}/>}
    {eligible && operation.permitted && <Form form={form} layout="vertical" disabled={blocked} onValuesChange={() => { confirmation.current = undefined; }}>
      <Form.Item name="approvalId" label={t("原费用批准引用")} rules={[{ required: true, pattern: /^[A-Za-z0-9._:-]{1,191}$/u }]}><Input maxLength={191}/></Form.Item>
      <Form.Item name="expectedApprovalRevision" label={t("已确认费用的批准修订")} rules={[{ required: true, type: "integer", min: 3 }]}><InputNumber min={3} precision={0}/></Form.Item>
      <Form.Item name="preparationId" label={t("原检查准备引用")} rules={[{ required: true, pattern: /^[A-Za-z0-9._:-]{1,191}$/u }]}><Input maxLength={191}/></Form.Item>
      <Form.Item name="preparationHash" label={t("原准备哈希")} rules={[{ required: true, pattern: /^[a-f0-9]{64}$/u }]}><Input maxLength={64}/></Form.Item>
      <Form.Item name="consentId" label={t("本人具体检查同意引用")} rules={[{ required: true, pattern: /^[A-Za-z0-9._:-]{1,191}$/u }]}><Input maxLength={191}/></Form.Item>
      <Form.Item name="consentOperationKey" label={t("原具体检查确认键")} rules={[{ required: true, pattern: /^[A-Za-z0-9_-]{1,128}$/u }]}><Input maxLength={128}/></Form.Item>
      <Form.Item name="reason" label={t("换货执行原因")} rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea maxLength={500}/></Form.Item>
      <ConfirmAction label={t("执行本次原批准换货")} prompt={t("按本单原批准、费用确认及具体检查同意执行？")} disabled={blocked}
        onStateChange={state => {
          if (state === "confirming") {
            const values = structuredClone(form.getFieldsValue(true));
            confirmation.current = { identity: operation.identity, orderUpdatedAt: order.updatedAt, values, key: valuesKey(values) };
          } else if (state === "idle" || state === "done") confirmation.current = undefined;
        }} onConfirm={execute}/>
    </Form>}
    {display && <dl className={styles.facts}>
      <div><dt>{t("原执行键")}</dt><dd>{display.operationKey}</dd></div><div><dt>{t("原换货变更")}</dt><dd>{display.changeId}</dd></div>
      <div><dt>{t("原费用批准")}</dt><dd>{display.approvalId}</dd></div><div><dt>{t("原具体检查同意")}</dt><dd>{display.consentId}</dd></div>
      <div><dt>{t("原生效时间")}</dt><dd>{new Date(display.appliedAt).toLocaleString()}</dd></div>
    </dl>}
  </ListSection>;
}
