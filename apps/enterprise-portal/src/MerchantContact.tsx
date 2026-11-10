/** Public merchant contact configuration, read only after an explicit action.
 * A telephone link is not a business handoff request, delivery receipt or authority. */
import { useEffect, useRef, useState } from "react";
import type { ClientChannelBootstrapResponse } from "@rental-os/shared";
import { ActionButton, Alert } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";

type MerchantContact = { name: string; phone: string; href: string; hours?: string };
const plainText = (value: unknown, max: number): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= max
  && !/[\u0000-\u001f\u007f<>]|:\/\/|(?:javascript|data):/iu.test(value);
/** White-list the original bootstrap fields. Do not follow provider/model URLs or
 * invent a country code, extension, opening schedule or fallback phone number. */
export function merchantContactFromBootstrap(value: unknown, tenantCode: string): MerchantContact {
  const row = value as Partial<ClientChannelBootstrapResponse> | null;
  if (!row || row.apiVersion !== "v1" || row.client !== "web" || row.tenantCode !== tenantCode || !tenantCode.trim()
    || !row.merchant || !plainText(row.merchant.name, 191)) throw new Error("商户联系配置与当前入口不一致 / Merchant contact binding unavailable");
  const phone = row.merchant.servicePhone;
  if (typeof phone !== "string" || phone.length > 32 || !/^\+?[0-9 ()-]+$/u.test(phone.trim())) throw new Error("商户尚未提供可拨号联系电话 / Merchant phone unavailable");
  const dial = phone.trim().replace(/[ ()-]/gu, "");
  if (!/^\+?[0-9]{3,20}$/u.test(dial)) throw new Error("商户联系电话不可安全拨号 / Merchant phone unavailable");
  const hours = row.merchant.serviceHours;
  if (hours !== undefined && hours !== null && hours !== "" && !plainText(hours, 64)) throw new Error("商户服务时段配置不可读取 / Merchant hours unavailable");
  return { name: row.merchant.name.trim(), phone: phone.trim(), href: `tel:${dial}`, ...(typeof hours === "string" && hours.trim() ? { hours: hours.trim() } : {}) };
}

export function EnterpriseMerchantContact({ english }: { english: boolean }) {
  const context = useEnterprise(), owner = useRef(context); owner.current = context;
  const mounted = useRef(true), sequence = useRef(0), active = useRef<AbortController | undefined>(undefined);
  const [contact, setContact] = useState<{ identity: string; tenantCode: string; sequence: number; value: MerchantContact }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; active.current?.abort(); active.current = undefined; }; }, []);
  useEffect(() => {
    sequence.current++; active.current?.abort(); active.current = undefined;
    setContact(undefined); setError(""); setBusy(false);
  }, [context.identity]);
  const readable = Boolean(context.session && context.tenantCode && !context.loading && !context.signal.aborted);
  const visible = readable && !busy && !error && contact?.identity === context.identity ? contact : undefined;
  const current = useRef({ visible, readable, busy }); current.current = { visible, readable, busy };
  const unavailable = english ? "Merchant contact could not be read or is not configured. Read it again; no handoff was submitted." : "商户联系方式读取失败或未配置；可重新读取，未提交业务交接。";
  const readContact = async () => {
    const original = owner.current, identity = original.identity, tenantCode = original.tenantCode, signal = original.signal;
    if (!mounted.current || !current.current.readable || !original.session || original.loading || signal.aborted || active.current) throw new Error(unavailable);
    const token = ++sequence.current, controller = new AbortController(); active.current = controller;
    setContact(undefined); setError(""); setBusy(true);
    const isCurrent = () => mounted.current && owner.current.identity === identity && owner.current.tenantCode === tenantCode && sequence.current === token
      && !signal.aborted && !owner.current.signal.aborted && !controller.signal.aborted;
    try {
      const result = await original.read<ClientChannelBootstrapResponse>(`/public/bootstrap?tenantCode=${encodeURIComponent(tenantCode)}&client=web`, AbortSignal.any([signal, controller.signal]));
      if (!isCurrent()) throw new Error(unavailable);
      const value = merchantContactFromBootstrap(result, tenantCode);
      setContact({ identity, tenantCode, sequence: token, value });
    } catch {
      if (isCurrent()) { setContact(undefined); setError(unavailable); }
      throw new Error(unavailable);
    } finally {
      if (isCurrent()) setBusy(false);
      if (active.current === controller) active.current = undefined;
    }
  };
  return <section aria-label={english ? "Current merchant contact" : "当前商户联系"}>
    <ActionButton intent="review" disabled={!readable || busy} label={english ? "Read merchant contact" : "读取商户联系方式"} onAction={readContact}/>
    {visible && <dl><dt>{english ? "Merchant" : "商户"}</dt><dd>{visible.value.name}</dd>
      <dt>{english ? "Service phone" : "客服电话"}</dt><dd><a href={visible.value.href} aria-label={english ? "Call this merchant" : "拨打当前商户电话"} onClick={event => {
        // A retained DOM/event closure cannot dial an old merchant after a reread,
        // identity change or unmount. The browser owns the user-initiated call.
        if (!mounted.current || owner.current.identity !== visible.identity || owner.current.tenantCode !== visible.tenantCode
          || sequence.current !== visible.sequence || active.current || !owner.current.session || owner.current.loading || !current.current.readable || current.current.busy
          || current.current.visible !== visible || owner.current.signal.aborted) event.preventDefault();
      }}>{visible.value.phone}</a></dd>
      <dt>{english ? "Configured service hours" : "配置的服务时间"}</dt><dd>{visible.value.hours ?? (english ? "Not configured" : "未配置")}</dd></dl>}
    {error && <Alert type="warning" title={error}/>}
    <p>{english ? "Calling is your choice. This does not submit a handoff, confirm merchant acceptance, or change original orders or funding responsibilities." : "是否拨号由本人选择；不提交交接单、不表示商户已受理，不改变原订单或资金责任。"}</p>
  </section>;
}
