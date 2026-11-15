/**
 * 工单自己的列表/新建/详情贡献，仅从正式平台适配出口取得外壳、组件和请求。
 * 本文件不注册到主应用、不自报授权；写入失败保留原请求键和输入供显式核对。
 */
import { useRef, useState, type ComponentType } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { corePageKey, resolveCorePageLocation, type CoreAdminContribution } from "@rental-os/core-contracts";
import {
  Alert, Button, CoreList, CorePage, DataTableText, Form, Input, ListSection, QueryState, SaveButton, Select, UnsavedChangesGuard,
  useCorePageHost, useCoreRequest, useCoreForm, useCoreBinding, useLocale, type CoreAdminPageAction
} from "@rental-os/platform-admin/core";
import { TICKETS_CORE_ID, TICKETS_CORE_VERSION, TicketSchema, type Ticket } from "@rental-os/example-tickets-core/contracts";
import { TICKETS_HTTP } from "@rental-os/example-tickets-core/http";

const page = (pageId: string, ticketId?: string) => ({ coreId: TICKETS_CORE_ID, pageId, ...(ticketId ? { params: { ticketId } } : {}) });
const permission = (action: string) => [{ resource: "ticket", action }];
const stateNames = { open: "待处理", in_progress: "处理中", closed: "已关闭" };
const pathFor = (path: string, id?: string) => "/" + path.replace(":ticketId", encodeURIComponent(id ?? ""));
/** 只有本Core明确在提交前拒绝的错误才释放当前编辑；网络/500/无原收据继续保持未知。 */
function rejectedBeforeCommit(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: { code?: string } } } | undefined)?.response;
  return response?.status === 400 && response.data?.code === "input_invalid"
    || response?.status === 403 && response.data?.code === "denied"
    || response?.status === 404 && response.data?.code === "not_found"
    || response?.status === 409 && ["revision_conflict", "state_conflict"].includes(response.data?.code ?? "");
}

function useTicketNavigation() {
  const host = useCorePageHost();
  return (pageId: string, ticketId?: string) => {
    const target = host.pages.get(corePageKey(TICKETS_CORE_ID, pageId));
    if (!target || !host.canAccess(TICKETS_CORE_ID, target.definition.permissions)) throw new Error("当前工单页面不可用");
    host.navigate(resolveCorePageLocation(host.pages, page(pageId, ticketId)));
  };
}

export function TicketsPage() {
  const { request, queryKey } = useCoreRequest(), navigate = useTicketNavigation(), { t } = useLocale();
  const [offset, setOffset] = useState(0), [limit, setLimit] = useState(20), [state, setState] = useState<string>();
  const listKey = [...queryKey, "list", offset, limit, state];
  const query = useQuery({ queryKey: listKey, queryFn: async ({ signal }) =>
    TICKETS_HTTP.page.response.parse(await request(pathFor(TICKETS_HTTP.page.path), { params: { offset, limit, state }, signal })), meta: { liveRefresh: false } });
  return <CorePage actions={[{ id: "create", kind: "navigate", label: "新建工单", emphasis: "primary", permissions: permission("create"), to: page("create") }]}>
    <CoreList<Ticket> query={query} queryKey={listKey} rowKey="id"
      pagination={{ offset, limit, onChange: (next, size) => { setOffset(next); setLimit(size); } }}
      controls={<Select allowClear aria-label={t("工单状态")} placeholder={t("全部状态")} value={state}
        options={Object.entries(stateNames).map(([value, label]) => ({ value, label: t(label) }))}
        onChange={value => { setState(value); setOffset(0); }} />} columns={[
          { title: t("标题"), key: "subject", render: (_, row) => <DataTableText primary={row.subject} secondary={row.description || undefined} /> },
          { title: t("状态"), dataIndex: "state", render: (value: Ticket["state"]) => t(stateNames[value]) },
          { title: t("受派成员"), dataIndex: "assigneeId", render: value => value ?? t("尚未分派") },
          { title: t("操作"), key: "actions", render: (_, row) => <Button onClick={() => navigate("detail", row.id)}>{t("查看")}</Button> }
        ]} />
  </CorePage>;
}

type CreateValues = { subject: string; description: string };
export function CreateTicketPage() {
  const { request } = useCoreRequest(), { t } = useLocale();
  const client = useQueryClient();
  const [form] = Form.useForm<CreateValues>();
  const original = useRef<{ operationId: string; subject: string; description: string } | undefined>(undefined);
  const completed = useRef<string | undefined>(undefined);
  const uncertain = useRef(false);
  const [unknown, setUnknown] = useState(false), [reconciling, setReconciling] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [createdId, setCreatedId] = useState<string>();
  const reconcile = async () => {
    if (!original.current) throw new Error("没有原操作可核对");
    setReconciling(true);
    try {
      const result = TICKETS_HTTP.receipt.response.parse(await request(`/operations/${original.current.operationId}`));
      if (result.status !== "recorded") throw new Error("原收据暂不可用，请保留此页稍后再核对");
      if (result.receipt.operationId !== original.current.operationId) throw new Error("工单回执与原操作不一致");
      completed.current = result.receipt.ticket.id;
      uncertain.current = false;
      setUnknown(false); editor.markClean(); setCreatedId(completed.current);
      void client.invalidateQueries({ queryKey: ["core", TICKETS_CORE_ID] });
      return result.receipt;
    } finally { setReconciling(false); }
  };
  const save = (values: CreateValues) => {
    if (uncertain.current) return Promise.reject(new Error("请先核对原提交结果"));
    if (completed.current) return Promise.reject(new Error("工单已经创建，请查看原工单"));
    const input = TICKETS_HTTP.create.body.parse({ ...values, operationId: original.current?.operationId ?? crypto.randomUUID() });
    if (original.current && JSON.stringify(input) !== JSON.stringify(original.current)) return Promise.reject(new Error("请先核对原提交结果"));
    original.current = input;
    setRejected(false);
    return request(pathFor(TICKETS_HTTP.create.path), { method: "post", data: input }).then(result => {
      const receipt = TICKETS_HTTP.create.response.parse(result);
      if (receipt.operationId !== input.operationId) throw new Error("工单回执与原操作不一致");
      completed.current = receipt.ticket.id;
      setUnknown(false); setCreatedId(completed.current);
      void client.invalidateQueries({ queryKey: ["core", TICKETS_CORE_ID] });
      return receipt;
    }).catch(error => {
      if (rejectedBeforeCommit(error)) { original.current = undefined; setRejected(true); }
      else { uncertain.current = true; setUnknown(true); }
      throw error;
    });
  };
  const editor = useCoreForm({ form, onSave: save, permissions: permission("create"), disabled: unknown || Boolean(createdId) });
  const sending = editor.busy || reconciling;
  const actions: CoreAdminPageAction<CreateValues>[] = [{ id: "back", kind: "navigate", label: "返回工单", to: page("tickets") }];
  if (createdId) actions.push({ id: "detail", kind: "navigate", label: "查看工单", emphasis: "primary", to: page("detail", createdId) });
  else if (unknown) actions.push({ id: "reconcile", kind: "command", label: "核对原提交", intent: "review", emphasis: "primary", permissions: permission("read"), disabled: sending, execute: reconcile });
  else actions.push({ id: "save", kind: "save", label: "创建工单", intent: "create", emphasis: "primary", form, onSave: editor.submit,
    disabled: editor.busy, permissions: permission("create") });
  return <Form form={form} layout="vertical" initialValues={{ subject: "", description: "" }} {...editor.formProps}>
    <UnsavedChangesGuard dirty={editor.dirty || unknown} busy={sending} />
    <CorePage<CreateValues> actions={actions}>
      {createdId && <Alert type="success" title={t("工单已创建")} />}
      {rejected && <Alert type="error" title={t("创建被拒绝，请核对输入和当前权限后再提交")} />}
      {unknown && <Alert type="warning" title={t("未能确认工单创建结果")}
        description={`${t("保留此页并使用同一请求核对，不要重新创建。")} ${original.current?.operationId}`} />}
      <Form.Item name="subject" label={t("标题")} rules={[{ required: true }, { max: 160 }]}><Input disabled={unknown || sending || Boolean(createdId)} /></Form.Item>
      <Form.Item name="description" label={t("说明")} rules={[{ max: 4000 }]}><Input.TextArea disabled={unknown || sending || Boolean(createdId)} /></Form.Item>
    </CorePage>
  </Form>;
}

/** 路由适配显式传入已解析ticketId；不读取并执行任意URL、页面表达式或模型目标。 */
export function TicketDetailPage({ ticketId }: { ticketId: string }) {
  return <TicketDetailContent key={ticketId} ticketId={ticketId} />;
}

type TicketAction = "assign" | "start" | "close";
type TicketOperation = { action: TicketAction; data: Record<string, unknown> };

function TicketDetailContent({ ticketId }: { ticketId: string }) {
  const { request, queryKey } = useCoreRequest(), client = useQueryClient(), host = useCorePageHost(), { t, locale } = useLocale();
  const [form] = Form.useForm<{ assigneeId: string }>();
  const [failed, setFailed] = useState<TicketOperation>();
  const original = useRef<TicketOperation | undefined>(undefined);
  const confirmedRevision = useRef(0);
  const [rejected, setRejected] = useState(false);
  const [refreshFailure, setRefreshFailure] = useState<unknown>();
  const [sending, setSending] = useState(false);
  const pending = useRef<{ operation: TicketOperation; request: Promise<unknown> } | null>(null);
  const query = useQuery({ queryKey: [...queryKey, "detail", ticketId], queryFn: async ({ signal }) =>
    TicketSchema.parse(await request(pathFor(TICKETS_HTTP.get.path, ticketId), { signal })), meta: { liveRefresh: false } });
  const latest = useRef({ query, host, refreshFailure }); latest.current = { query, host, refreshFailure };
  const retry = async () => {
    const result = await latest.current.query.refetch();
    if (result.isError) throw result.error;
    setRefreshFailure(undefined);
    return result;
  };
  const refresh = async () => {
    try {
      await client.invalidateQueries({ queryKey: ["core", TICKETS_CORE_ID], refetchType: "none" });
      await retry();
    } catch (error) { setRefreshFailure(error); } // 原业务已确认，单独保留可重读的资料错误。
  };
  const reconcile = async () => {
    const operation = original.current;
    if (!operation) throw new Error("没有原操作可核对");
    setSending(true);
    try {
      const result = TICKETS_HTTP.receipt.response.parse(await request(`/operations/${String(operation.data.operationId)}`));
      if (result.status !== "recorded") throw new Error("原收据暂不可用，请保留此页稍后再核对");
      if (result.receipt.ticket.id !== ticketId || result.receipt.operationId !== operation.data.operationId) throw new Error("原收据对应另一工单或操作");
      confirmedRevision.current = Math.max(confirmedRevision.current, result.receipt.ticket.revision);
      // 核对处理/关闭不保存分派草稿；分派原结果也不能清掉等待中换成的另一成员。
      if (operation.action === "assign" && form.getFieldValue("assigneeId") === operation.data.assigneeId) editor.markClean();
      original.current = undefined; setFailed(undefined);
      await refresh();
      return result.receipt;
    } finally { setSending(false); }
  };
  const mutate = (action: TicketAction, extra: Record<string, unknown> = {}) => {
    const current = latest.current.query;
    if (!latest.current.host.canAccess(TICKETS_CORE_ID, permission(action))) return Promise.reject(new Error("当前工单操作不可用"));
    const op = TICKETS_HTTP[action], waiting = pending.current;
    if (waiting) {
      if (waiting.operation.action !== action) return Promise.reject(new Error("正在处理另一工单操作，请等待完成"));
      const input = op.body.parse({ ...extra, operationId: waiting.operation.data.operationId, expectedRevision: waiting.operation.data.expectedRevision });
      return JSON.stringify(waiting.operation.data) === JSON.stringify(input)
        ? waiting.request : Promise.reject(new Error("正在处理另一工单操作，请等待完成"));
    }
    if (original.current) return Promise.reject(new Error("请先核对原操作"));
    if (!current.data || current.error || current.isFetching || latest.current.refreshFailure || current.data.revision < confirmedRevision.current)
      return Promise.reject(new Error("请先读取当前工单"));
    const input = op.body.parse({ ...extra, operationId: crypto.randomUUID(), expectedRevision: current.data.revision });
    setSending(true); setRejected(false);
    const response = request(pathFor(op.path, ticketId), { method: "post", data: input }).then(result => {
      const receipt = op.response.parse(result);
      if (receipt.operationId !== input.operationId || receipt.ticket.id !== ticketId) throw new Error("工单回执与原操作不一致");
      confirmedRevision.current = Math.max(confirmedRevision.current, receipt.ticket.revision);
      return receipt;
    }).catch(error => {
      if (rejectedBeforeCommit(error)) { setRejected(true); void client.invalidateQueries({ queryKey }); }
      else { original.current = { action, data: input }; setFailed(original.current); }
      throw error;
    });
    // 收据已可信确认后，刷新失败只是当前资料未更新，不能重新判定原业务为unknown。
    const job = response.then(async receipt => {
      await refresh();
      return receipt;
    }).finally(() => { pending.current = null; setSending(false); });
    pending.current = { operation: { action, data: input }, request: job };
    return job;
  };
  const editor = useCoreForm({ form, onSave: values => mutate("assign", values), permissions: permission("assign"),
    disabled: sending || Boolean(failed) || query.isFetching || Boolean(query.error || refreshFailure) || query.data?.state !== "open" });
  const busy = sending || editor.busy;
  const actions: CoreAdminPageAction<Record<string, unknown>>[] = [{ id: "back", kind: "navigate", label: "返回工单", to: page("tickets") }];
  const current = query.data;
  if (failed) actions.push({ id: "reconcile", kind: "command", label: "核对原操作", intent: "review", emphasis: "primary",
    permissions: permission("read"), disabled: query.isFetching || busy, execute: reconcile });
  else if (current && !query.error) {
    const action = current.state === "open" ? "start" : current.state === "in_progress" ? "close" : undefined;
    if (action) actions.push({ id: action, kind: "command", label: action === "start" ? "开始处理" : "关闭工单", emphasis: "primary",
      permissions: permission(action), disabled: query.isFetching || busy || Boolean(refreshFailure) || !current.assigneeId || current.revision < confirmedRevision.current,
      confirmation: action === "close" ? "确认关闭这张工单？" : undefined, execute: () => mutate(action) });
  }
  const canAssign = host.canAccess(TICKETS_CORE_ID, permission("assign"));
  return <CorePage actions={actions}>
    <UnsavedChangesGuard dirty={editor.dirty || Boolean(failed)} busy={busy} />
    {Boolean(refreshFailure) && <Alert type="warning" title={locale === "en-US"
      ? "The ticket operation was recorded. Reload the current details." : "工单操作已记录，当前资料未更新，请重新读取。"}
      action={<Button onClick={() => { void retry().catch(setRefreshFailure); }}>{locale === "en-US" ? "Reload details" : "重新读取"}</Button>} />}
    <QueryState loading={query.isPending} error={query.error} onRetry={retry}>
      {current && <><ListSection title={current.subject}><p>{t(stateNames[current.state])}</p><p>{current.description || t("未填写说明")}</p>
        <dl><dt>{t("创建者")}</dt><dd>{current.createdBy}</dd><dt>{t("受派成员")}</dt><dd>{current.assigneeId ?? t("尚未分派")}</dd></dl>
      </ListSection>
      {failed && <Alert type="warning" title={t("未能确认操作结果")} description={`${t("使用同一原操作核对，不要换键重做。")} ${String(failed.data.operationId)}`} />}
      {rejected && <Alert type="error" title={t("操作被拒绝，请读取当前状态并核对权限后再处理")} />}
      {canAssign && current.state === "open" && !failed && <Form form={form} layout="vertical" {...editor.formProps}>
        <Form.Item name="assigneeId" label={t("受派成员ID")} rules={[{ required: true }]}><Input disabled={busy} /></Form.Item>
        <SaveButton variant="secondary" label={t("分派工单")} disabled={query.isFetching || busy || Boolean(refreshFailure)} form={form} onSave={editor.submit} />
      </Form>}</>}
    </QueryState>
  </CorePage>;
}

function RegisteredTicketDetailPage() {
  const ticketId = useCorePageHost().params?.ticketId;
  if (!ticketId) throw new Error("工单详情需要当前已登记路由的ticketId");
  return <TicketDetailPage ticketId={ticketId} />;
}

/** 工单没有额外初始化配置；首次设置使用平台绑定服务，重新进入只读取原绑定。 */
export function TicketsSetupPage() {
  const setting = useCoreBinding(TICKETS_CORE_ID), { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "en-US" ? en : zh;
  const actions: CoreAdminPageAction<Record<string, unknown>>[] = [];
  if (setting.original && setting.canManage) actions.push({ id: "reconcile", kind: "command", intent: "review", emphasis: "primary",
    label: text("核对原设置", "Read original setup"), disabled: setting.busy, execute: setting.reconcile });
  else if (setting.binding) actions.push({ id: "tickets", kind: "navigate", label: text("进入工单", "Open tickets"),
    emphasis: "primary", to: page("tickets") });
  else if (setting.canInitialize) actions.push({ id: "initialize", kind: "command", intent: "confirm", emphasis: "primary",
    label: text("完成工单设置", "Complete ticket setup"), disabled: setting.busy || setting.loading || Boolean(setting.error),
    execute: () => setting.initialize() });
  return <CorePage actions={actions}>
    <QueryState loading={setting.loading} error={setting.error} onRetry={setting.refetch}>
      {!setting.canManage ? <Alert type="info" title={text("请联系租户管理员完成工单设置", "Ask your tenant administrator to complete ticket setup")} />
        : setting.binding ? <p>{text("工单设置已完成，已有工单与操作记录继续保留。", "Ticket setup is complete. Existing tickets and operation records are retained.")}</p>
          : <p>{text("工单不需要额外配置，完成设置后即可按当前权限使用。", "No additional configuration is needed. Complete setup to use tickets with your current access.")}</p>}
    </QueryState>
    {setting.original && <Alert type="warning" title={text("原设置结果待核对", "The original setup needs confirmation")}
      description={`${text("请先核对原操作，暂未取得收据不表示可以重新提交。核对编号", "Read the original operation first. A missing receipt does not permit resubmission. Reference")} ${setting.original.operationId}`} />}
    {!setting.original && setting.failure === "rejected" && <Alert type="error" title={text("设置被拒绝，请核对当前权限和状态", "Setup was rejected. Check your current access and state")} />}
  </CorePage>;
}

/** 默认详情消费框架的登记参数；已有受控宿主可以沿原参数继续提供自己的详情组件。 */
export function createTicketsAdmin(detail: ComponentType = RegisteredTicketDetailPage): CoreAdminContribution<ComponentType> {
  return { coreId: TICKETS_CORE_ID, implementationVersion: TICKETS_CORE_VERSION, pages: [
    { id: "tickets", path: "/tickets", title: "工单", menu: {}, permissions: permission("read"), component: TicketsPage },
    { id: "setup", path: "/setup", title: { default: "工单设置", translations: { "en-US": "Ticket setup" } },
      purpose: "configuration", menu: { order: 10 }, permissions: [], component: TicketsSetupPage },
    { id: "create", path: "/tickets/new", title: "新建工单", parent: "tickets", permissions: [...permission("read"), ...permission("create")], component: CreateTicketPage },
    { id: "detail", path: "/tickets/:ticketId", title: "工单详情", parent: "tickets", permissions: permission("read"), component: detail }
  ] };
}
