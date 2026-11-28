/** MCP人工同意、字段绑定与原账回读；没有自动批准、写重试或模型调用。
 * 会话范围变化重挂局部状态；只保留原引用和已发送标记，code/token不进存储或页面文本。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { infer as ZodInfer } from "zod";
import { TICKETS_MCP_HTTP, TICKETS_MCP_RESPONSES, TICKETS_MCP_READ_NAMES, type TicketsMcpAction } from "@rental-os/example-tickets-core/mcp-http";
import { Alert, CorePage, Form, Input, ListSection, QueryState, Select, useCoreRequest, useLocale } from "@rental-os/platform-admin/core";
import { ActionButton, ConfirmAction } from "@rental-os/platform-admin/ui";
import type { createBrowserAdminSession } from "@rental-os/platform-admin/runtime";
import { ticketAiReasons } from "./tickets-ai";

type Consent = ZodInfer<typeof TICKETS_MCP_RESPONSES.prepareConsent>;
type Grant = NonNullable<ZodInfer<typeof TICKETS_MCP_RESPONSES.grant>["grant"]>;
/** 只在当前标签的一次登录期间保留固定人工页入口；不保存凭据或从URL决定身份/任意跳转。 */
export function createTicketsMcpLoginBridge(session: Pick<ReturnType<typeof createBrowserAdminSession>, "getSnapshot" | "subscribe">) {
  const path = "/cores/example-tickets/mcp-authorization", current = new URL(window.location.href);
  let initial: { pathname: string; hash: string } | undefined;
  if (current.pathname === path && current.hash.length <= 32768) {
    try {
      const authorization = new URL(new URLSearchParams(current.hash.slice(1)).get("authorization") ?? "");
      if (authorization.protocol === "https:" && authorization.origin === current.origin && authorization.pathname === "/oauth/authorize"
        && !authorization.username && !authorization.password && !authorization.hash) initial = { pathname: path, hash: current.hash };
    } catch { /* 原页面/服务端仍负责拒绝无效授权请求。 */ }
  }
  return function TicketsMcpLoginBridge() {
    const pending = useRef(initial), location = useLocation(), navigate = useNavigate();
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    useEffect(() => {
      if (!pending.current || !state.ready || !state.sessionVerified || !state.user || state.user.mustChangePassword) return;
      if (location.pathname === path) { pending.current = undefined; return; }
      // 原登录先完成自己的成功导航，再回到这一固定页面；不与登录表单的回调争用路由。
      if (location.pathname === "/login" || location.pathname.startsWith("/login/")) return;
      navigate(pending.current, { replace: true });
    }, [location.pathname, navigate, state]);
    return null;
  };
}
function McpAuthorization() {
  const { request, queryKey } = useCoreRequest(), { locale } = useLocale(), en = locale === "en-US";
  const text = (zh: string, english: string) => en ? english : zh;
  const [initial] = useState(() => new URLSearchParams(window.location.hash.slice(1)));
  const authorizationUrl = initial.get("authorization") ?? "";
  const [consentId] = useState(() => {
    const saved = initial.get("consent"); if (saved) return saved;
    const id = crypto.randomUUID();
    if (authorizationUrl) { const fragment = new URLSearchParams(initial); fragment.set("consent", id); window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${fragment}`); }
    return id;
  });
  const storageKey = `zelo:tickets-mcp:${JSON.stringify(queryKey)}:${consentId}`;
  const [sent, setSent] = useState<string[]>(() => {
    try { const value: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]"); return Array.isArray(value) ? value.filter(item => typeof item === "string") : []; }
    catch { return ["prepare", "decide", "complete"]; }
  });
  const mark = (action: string) => {
    const next = [...new Set([...sent, action])];
    // 保存失败时不发送可能失去原键的写入。
    sessionStorage.setItem(storageKey, JSON.stringify(next)); setSent(next);
  };
  const busy = useRef(false);
  const [consent, setConsent] = useState<Consent>(), [grantId, setGrantId] = useState(initial.get("grant") ?? ""), [grant, setGrant] = useState<Grant>();
  const [tool, setTool] = useState<string>(TICKETS_MCP_READ_NAMES.get), [targetId, setTargetId] = useState("");
  const [preview, setPreview] = useState<ZodInfer<typeof TICKETS_MCP_RESPONSES.preview>>();
  const [original, setOriginal] = useState<ZodInfer<typeof TICKETS_MCP_RESPONSES.original>>();
  const [available, setAvailable] = useState<ZodInfer<typeof TICKETS_MCP_RESPONSES.status>>();
  const [bound, setBound] = useState(false), [uncertain, setUncertain] = useState(false);
  const bindingSent = useRef(false);
  async function call<A extends TicketsMcpAction>(action: A, body: unknown) {
    const route = TICKETS_MCP_HTTP[action];
    return TICKETS_MCP_RESPONSES[action].parse(await request(`/${route.path}`, { method: "post", data: route.body.parse(body), retryAuthentication: false })) as ZodInfer<typeof TICKETS_MCP_RESPONSES[A]>;
  }
  const once = async (action: string, work: () => Promise<void>) => {
    if (busy.current || sent.includes(action)) throw new Error(text("该操作已发送，请核对原结果", "This operation was sent. Read its original result."));
    mark(action); busy.current = true;
    try { await work(); } catch (error) { setUncertain(true); throw error; } finally { busy.current = false; }
  };
  const config = useQuery({ queryKey: [...queryKey, "mcp-configuration"], queryFn: () => call("configuration", {}), retry: false, meta: { liveRefresh: false } });
  const adopt = (value: Consent) => { setConsent(value); if (value.grantId) setGrantId(value.grantId); };
  const reloadConsent = async () => { const result = await call("consent", { consentId }); if (!result.consent)
    throw new Error(text("尚未读到原记录，不能推断未提交", "No original record was observed. This does not prove no commit.")); adopt(result.consent); };
  const loadGrant = async () => { const result = await call("grant", { grantId }); setGrant(result.grant ?? undefined); setOriginal(await call("original", { grantId })); };
  const readInput = () => tool === TICKETS_MCP_READ_NAMES.get ? { ticketId: targetId } : { operationId: targetId };
  const readPreview = async () => { setPreview(undefined); setAvailable(undefined); setBound(false);
    setPreview(await call("preview", { grantId, tool, input: readInput() })); };
  return <CorePage summary={text("外部客户端只读取你确认的工单摘要，模型费用由客户端承担。", "External clients read the ticket summaries you approve. Their model costs are paid by the client.")}>
    <QueryState loading={config.isPending} error={config.error} onRetry={() => config.refetch()}>
      {config.data && <Alert type={config.data.enabled ? "info" : "warning"}
        title={text(config.data.enabled ? "MCP 读取入口已配置" : "MCP 读取入口当前不可用", config.data.enabled ? "MCP reads configured" : "MCP reads unavailable")}
        description={`${config.data.resource} · ${text("仅工单读取与原收据，不授予写入", "Ticket reads and original receipts only; no write permission")}`} />}
    </QueryState>
    {uncertain && <Alert type="warning" title={text("结果待核对", "Result needs reconciliation")}
      description={text("保留原编号并读取原结果。请勿重新发起授权或用新编号重做。", "Keep the original references and read the recorded result. Do not repeat authorization with new references.")} />}
    <ListSection title={text("客户端授权请求", "Client authorization request")}>
      {!authorizationUrl ? <Alert type="info" title={text("请从外部客户端发起连接", "Start the connection in your external client")}
        description={text("已有授权可在下方按原编号读取。", "Read an existing grant below using its original reference.")} /> : <>
        <p>{text("授权记录", "Consent reference")}: {consentId}</p>
        <ActionButton label={text("核对授权范围", "Review requested access")} disabled={sent.includes("prepare") || !config.data?.enabled}
          onAction={() => once("prepare", async () => adopt(await call("prepareConsent", { operationId: consentId, authorizationUrl })))} />
        <ActionButton intent="refresh" label={text("读取原授权记录", "Read original consent")} onAction={reloadConsent} />
        {consent && <>
          <dl><dt>{text("客户端", "Client")}</dt><dd>{consent.clientId}</dd><dt>{text("范围", "Scopes")}</dt><dd>{consent.scopes.join(", ")}</dd>
            <dt>{text("返回地址", "Callback")}</dt><dd>{consent.redirectUri}</dd><dt>{text("有效至", "Expires")}</dt><dd>{new Date(consent.expiresAt * 1000).toLocaleString(locale)}</dd></dl>
          <p>{text("允许外发的字段：工单编号、标题、状态、版本；收据仅含原操作编号及工单编号、状态、版本。授权不允许执行业务动作。", "Released fields: ticket ID, subject, state and revision. Receipts contain only the original operation ID and ticket ID, state and revision. This grant allows no business action.")}</p>
          {consent.decision === "pending" ? <>
            <ActionButton label={text("同意读取范围", "Approve read access")} disabled={sent.includes("decide")}
              onAction={() => once("decide", async () => adopt(await call("decide", { consentId, reviewHash: consent.reviewHash, decision: "approved" })))} />
            <ActionButton label={text("拒绝", "Deny")} disabled={sent.includes("decide")}
              onAction={() => once("decide", async () => adopt(await call("decide", { consentId, reviewHash: consent.reviewHash, decision: "denied" })))} />
          </> : <><Alert type={consent.decision === "approved" ? "success" : "info"} title={text(consent.decision === "approved" ? "已同意所示范围" : "已拒绝", consent.decision === "approved" ? "Read access approved" : "Denied")} />
            <ActionButton label={text("返回原客户端", "Return to client")} disabled={sent.includes("complete")}
              onAction={() => once("complete", async () => { const result = await call("complete", { consentId, authorizationUrl });
                const callback = new URL(result.callback), reviewed = new URL(consent.redirectUri);
                if (callback.origin !== reviewed.origin || callback.pathname !== reviewed.pathname || callback.hash || callback.username || callback.password)
                  throw new Error(text("原回调依据不一致", "Original callback evidence changed"));
                window.location.assign(callback.href); })} />
          </>}
        </>}
      </>}
    </ListSection>
    <ListSection title={text("原授权与字段审核", "Original grant and field review")}>
      <Form layout="vertical"><Form.Item label={text("原授权编号", "Original grant ID")}><Input aria-label={text("原授权编号", "Original grant ID")} value={grantId}
        onChange={event => { setGrantId(event.target.value); setGrant(undefined); setOriginal(undefined); setPreview(undefined); setAvailable(undefined); }} /></Form.Item></Form>
      <ActionButton intent="refresh" label={text("读取原授权与用量", "Read grant and usage")} onAction={loadGrant} disabled={!grantId} />
      {grant && <>
        <Alert type={grant.revoked ? "warning" : "info"} title={text(grant.revoked ? "原授权已撤回" : "原授权记录可读", grant.revoked ? "Grant revoked" : "Original grant found")}
          description={`${grant.clientId} · ${text("有效至", "Expires")} ${new Date(grant.expiresAt * 1000).toLocaleString(locale)}`} />
        {!grant.revoked && <ConfirmAction label={text("撤回授权", "Revoke grant")} prompt={text("撤回此读取授权？", "Revoke this read grant?")}
          disabled={sent.includes(`revoke:${grant.id}:${grant.revision}`)} onConfirm={() => once(`revoke:${grant.id}:${grant.revision}`, async () => {
            await call("revoke", { grantId: grant.id, expectedRevision: grant.revision }); await loadGrant();
          })} />}
        {!grant.revoked && <><Form layout="vertical"><Form.Item label={text("读取内容", "Read type")}><Select value={tool}
          options={[{ value: TICKETS_MCP_READ_NAMES.get, label: text("工单摘要", "Ticket summary") }, { value: TICKETS_MCP_READ_NAMES.receipt, label: text("原操作收据", "Original receipt") }]}
          onChange={value => { setTool(value); setPreview(undefined); setAvailable(undefined); }} /></Form.Item>
          <Form.Item label={text(tool === TICKETS_MCP_READ_NAMES.get ? "工单编号" : "原操作编号", tool === TICKETS_MCP_READ_NAMES.get ? "Ticket ID" : "Original operation ID")}><Input value={targetId}
            aria-label={text(tool === TICKETS_MCP_READ_NAMES.get ? "工单编号" : "原操作编号", tool === TICKETS_MCP_READ_NAMES.get ? "Ticket ID" : "Original operation ID")}
            onChange={event => { setTargetId(event.target.value); setPreview(undefined); setAvailable(undefined); }} /></Form.Item></Form>
          <ActionButton label={text("审核当前对象", "Review current record")} onAction={readPreview} disabled={!targetId} />
          {preview && <><p>{text("以下为当前将外发的内容。实际调用读取当时的值，并复核当前权限、发布和累计限额。", "These are the fields released now. Each call reads their current values and rechecks access, publication and cumulative limits.")}</p>
            <pre aria-label={text("待外发字段", "Fields to release")}>{JSON.stringify(preview.released, null, 2)}</pre>
            <ActionButton label={text("确认字段并绑定读取", "Confirm fields and bind read")} disabled={bound || bindingSent.current || sent.includes(`bind:${grantId}:${tool}:${targetId}`)}
              onAction={async () => { if (bindingSent.current) throw new Error(text("请核对原目标", "Read the original goal")); bindingSent.current = true;
                await once(`bind:${grantId}:${tool}:${targetId}`, async () => { await call("authorizeRead", { grantId, tool: preview.tool, input: preview.input, reviewHash: preview.reviewHash }); setBound(true); bindingSent.current = false; await loadGrant(); }); }} />
            {tool === TICKETS_MCP_READ_NAMES.get && <ActionButton label={text("检查当前可用性", "Check current availability")}
              onAction={async () => setAvailable(await call("status", { ticketId: targetId, grantId }))} />}
          </>}
          {available && <Alert type={available.state === "available" ? "success" : "warning"}
            title={text(available.state === "available" ? "当前读取可用" : "当前读取不可用", available.state === "available" ? "Reads currently available" : "Reads currently unavailable")}
            description={ticketAiReasons[available.reason][en ? 1 : 0]} />}
        </>}
      </>}
      {original && <div aria-live="polite"><p>{text("原目标", "Original goal")}: {original.goal?.id ?? text("尚未读到原目标", "No original goal observed")}</p>
        {original.budget ? <p>{text("累计调用", "Cumulative calls")}: {original.budget.consumedCalls} / 20 · {text("累计活动时间", "Active time")}: {original.budget.consumedActiveMs} ms · {text("预留", "Reserved")}: {original.budget.reservedActiveMs} ms</p>
          : <p>{text("尚未读到计量记录，不能推断未消耗。", "No usage record was observed; this does not prove no consumption.")}</p>}
        {original.calls.map(item => <p key={item.callId}>{item.callId} · {item.state} · {item.activeMs === null ? text("耗时待核对", "Duration unknown") : `${item.activeMs} ms`}</p>)}
      </div>}
    </ListSection>
  </CorePage>;
}
export function TicketsMcpPage() {
  const { queryKey } = useCoreRequest();
  return <McpAuthorization key={JSON.stringify(queryKey)} />;
}
