/** Reviews one signed customer source in the current merchant order workspace.
 * Explicit execution and original Core results retain the same customer D. */
import { useEffect, useRef, useState } from "react";
import { Descriptions, Space } from "antd";
import type { EnterpriseMerchantOrderDelegationResult, EnterpriseOrderDelegationView } from "@rental-os/shared";
import { ActionButton, Alert, Checkbox, Form, Input } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { useMerchantOrderDelegationSource } from "./enterprise-merchant-order-delegation";

export function EnterpriseMerchantOrderDelegationPanel({ active }: { active: boolean }) {
  const { locale } = useLocale(), english = locale === "en-US";
  const operation = useMerchantOrderDelegationSource(active);
  const [key, setKey] = useState("");
  const [record, setRecord] = useState<{ identity: string; value: EnterpriseOrderDelegationView }>();
  const [failure, setFailure] = useState<{ identity: string; message: string }>();
  const [confirmed, setConfirmed] = useState(false);
  const [coreResult, setCoreResult] = useState<{ identity: string; value: EnterpriseMerchantOrderDelegationResult }>();
  const confirmation = useRef(confirmed); confirmation.current = confirmed;
  const selectedKey = useRef(key); selectedKey.current = key;
  const latest = useRef(operation.identity); latest.current = operation.identity;
  const mounted = useRef(true), generation = useRef(0);
  useEffect(() => {
    mounted.current = true; generation.current++;
    setKey(operation.savedKey ?? ""); setRecord(undefined); setFailure(undefined); setConfirmed(false); setCoreResult(undefined);
    return () => { mounted.current = false; generation.current++; };
  }, [operation.actorIdentity]);
  useEffect(() => { generation.current++; setRecord(undefined); setFailure(undefined); setConfirmed(false); setCoreResult(undefined); }, [active]);

  const read = async () => {
    operation.current();
    const delegationKey = selectedKey.current.trim(), observation = ++generation.current;
    setRecord(undefined); setFailure(undefined); setConfirmed(false);
    try {
      const value = await operation.read(delegationKey);
      operation.current();
      if (!mounted.current || observation !== generation.current || selectedKey.current.trim() !== delegationKey) {
        throw new Error("原委托选择已变化 / Original delegation selection changed");
      }
      setRecord({ identity: operation.identity, value });
    } catch (error) {
      if (mounted.current && observation === generation.current && latest.current === operation.identity) {
        setFailure({ identity: operation.identity, message: error instanceof Error ? error.message : "原委托读取失败" });
      }
      throw error;
    }
  };
  const source = record?.identity === operation.identity ? record.value : undefined;
  const original = coreResult?.identity === operation.identity && coreResult.value.delegationKey === key.trim() ? coreResult.value : undefined;
  const readCore = async () => {
    operation.current();
    const delegationKey = selectedKey.current.trim(), observation = ++generation.current;
    setFailure(undefined); setConfirmed(false);
    try {
      const value = await operation.readOriginal(delegationKey);
      operation.current();
      if (!mounted.current || observation !== generation.current || selectedKey.current.trim() !== delegationKey) throw new Error("原委托选择已变化 / Original delegation selection changed");
      setCoreResult({ identity: operation.identity, value });
    } catch (error) {
      if (mounted.current && observation === generation.current && latest.current === operation.identity) setFailure({ identity: operation.identity, message: error instanceof Error ? error.message : "原 Core 结果读取失败" });
      throw error;
    }
  };
  const execute = async () => {
    if (!source) throw new Error("须先读取原委托 / Read the original delegation first");
    const delegationKey = source.delegationKey, observation = ++generation.current;
    const reviewed = () => {
      operation.current();
      if (!mounted.current || observation !== generation.current || selectedKey.current.trim() !== delegationKey || !confirmation.current) throw new Error("须核对本条原委托后明确确认 / Confirm this original delegation after review");
    };
    reviewed(); setFailure(undefined);
    try {
      const value = await operation.execute(source, reviewed);
      reviewed(); setCoreResult({ identity: operation.identity, value }); setConfirmed(false);
    } catch (error) {
      if (mounted.current && observation === generation.current && latest.current === operation.identity) setFailure({ identity: operation.identity, message: error instanceof Error ? error.message : "原委托提交结果待核对" });
      throw error;
    }
  };
  const missing = english ? "Original reference unavailable" : "原引用未提供";
  const labels = english
    ? { issued: "Issued", expired: "Expired", revoked: "Revoked", consumed: "Consumed" }
    : { issued: "已签发", expired: "已到期", revoked: "已撤销", consumed: "已消费" };
  const time = (value: string) => new Date(value).toLocaleString(english ? "en-US" : "zh-CN", { timeZoneName: "short" });

  return <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
    <Alert type="info" title={english ? "Signed customer submission source" : "客户已签本次提交来源"}
      description={english ? "Read the customer's original D in this workspace. The original customer, enterprise and quote references come from the signed source." : "在当前空间读取客户原 D，本人、企业和报价引用沿已签原来源。"} />
    <Form layout="vertical">
      <Form.Item label={english ? "Original delegation D" : "原委托 D"}>
        <Input value={key} maxLength={128} disabled={!operation.permitted || operation.busy}
          aria-label={english ? "Original delegation D" : "原委托 D"}
          onChange={event => { selectedKey.current = event.target.value; generation.current++; setKey(event.target.value); setRecord(undefined); setFailure(undefined); setConfirmed(false); setCoreResult(undefined); }} />
      </Form.Item>
      <ActionButton intent="review" disabled={!operation.permitted || operation.busy || Boolean(operation.storageError) || !key.trim()}
        label={english ? "Read original source" : "读取原来源"} onAction={read} />
    </Form>
    {!operation.permitted && <Alert type="warning" title={english ? "Current merchant order and enterprise authority is required" : "需要当前商户订单及企业权限"} />}
    {operation.storageError && <Alert type="error" title={operation.storageError} />}
    {failure?.identity === operation.identity && <Alert type="error" title={failure.message} />}
    {source && <Descriptions size="small" column={{ xs: 1, md: 2 }} colon={false} items={[
      { key: "key", label: english ? "Original D / Core K" : "原 D／Core K", children: source.delegationKey },
      { key: "state", label: english ? "Source state" : "来源状态", children: labels[source.state] },
      { key: "person", label: english ? "Original personal customer" : "原本人引用", children: source.personalCustomerId ?? missing },
      { key: "enterprise", label: english ? "Original enterprise" : "原企业引用", children: source.corporateCustomerId ?? missing },
      { key: "quote", label: english ? "Original quote" : "原报价引用", children: source.quoteId ?? missing },
      { key: "workspace", label: english ? "Original workspace" : "原空间引用", children: source.workspaceId ?? missing },
      { key: "reference", label: english ? "Original request reference" : "原请求引用", children: "approvalId" in source.requestReference ? source.requestReference.approvalId : source.requestReference.quoteId },
      { key: "confirmation", label: english ? "Customer confirmed" : "本人确认时间", children: time(source.confirmedAt) },
      { key: "expiry", label: english ? "Original source expires" : "原来源有效期", children: time(source.expiresAt) },
      { key: "revision", label: english ? "Current source revision" : "当前来源修订", children: source.revision },
      ...(source.original.state === "consumed" ? [{ key: "order", label: english ? "Linked original order" : "关联原订单", children: source.original.orderId }] : []),
    ]} />}
    {source && (!source.personalCustomerId || !source.corporateCustomerId || !source.quoteId || !source.workspaceId) &&
      <Alert type="warning" title={english ? "Original subject references are unavailable" : "原请求主体引用不可用"} />}
    {operation.savedState === "unknown" && <Alert type="warning" title={english ? "Original submission outcome requires verification" : "原提交结果待核对"}
      description={english ? "Read the same D and Core result to continue." : "读取同一 D 的 Core 原结果后继续。"} />}
    {original && <Alert type={original.state === "observed" ? "success" : "warning"}
      title={original.state === "observed" ? english ? "Original Core order observed" : "已读取 Core 原订单" : english ? "Original Core result remains unknown" : "Core 原结果仍待核对"}
      description={original.state === "observed" ? original.orderId : english ? "Keep this original D for further verification." : "保留本条原 D 继续核对。"} />}
    {source?.state === "issued" && operation.savedState === "source" && <Checkbox checked={confirmed} disabled={!operation.permitted || operation.busy}
      onChange={event => setConfirmed(event.target.checked)}>{english ? "I reviewed this customer's original delegation and request" : "我已核对客户本条原委托和原请求"}</Checkbox>}
    <Space wrap>
      <ActionButton intent="create" disabled={!operation.permitted || operation.busy || !confirmed || operation.savedState !== "source" || source?.state !== "issued"
        || !source.personalCustomerId || !source.corporateCustomerId || !source.quoteId || !source.workspaceId}
        label={english ? "Explicitly execute this original delegation" : "明确执行本条原委托"} onAction={execute} />
      <ActionButton intent="review" disabled={!operation.permitted || operation.busy || Boolean(operation.storageError) || !key.trim()}
        label={english ? "Read original Core result" : "读取 Core 原结果"} onAction={readCore} />
    </Space>
  </Space>;
}
