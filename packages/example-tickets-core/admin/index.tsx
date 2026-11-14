/**
 * 工单自己的列表/新建/详情贡献，仅从正式平台适配出口取得外壳、组件和请求。
 * 本文件不注册到主应用、不自报授权；写入失败保留原请求键和输入供显式核对。
 */
import { useRef, useState, type ComponentType } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { corePageKey, resolveCorePageLocation, type CoreAdminContribution } from "@rental-os/core-contracts";
import {
  Alert, Button, CorePage, DataTableText, Form, Input, ListSection, QueryState, SaveButton, Select, Table, UnsavedChangesGuard,
  useCorePageHost, useCoreRequest, useLocale, type CoreAdminPageAction
} from "@rental-os/admin/core";
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
  const [offset, setOffset] = useState(0), [state, setState] = useState<string>();
  const query = useQuery({ queryKey: [...queryKey, "list", offset, state], queryFn: async ({ signal }) =>
    TICKETS_HTTP.list.response.parse(await request(pathFor(TICKETS_HTTP.list.path), { params: { offset, limit: 20, state }, signal })), meta: { liveRefresh: false } });
  return <CorePage actions={[{ id: "create", kind: "navigate", label: "新建工单", emphasis: "primary", permissions: permission("create"), to: page("create") }]}>
    <ListSection controls={<Select allowClear aria-label={t("工单状态")} placeholder={t("全部状态")} value={state}
      options={Object.entries(stateNames).map(([value, label]) => ({ value, label: t(label) }))}
      onChange={value => { setState(value); setOffset(0); }} />}>
      <QueryState loading={query.isPending} error={query.error} onRetry={query.refetch}>
        <Table<Ticket> rowKey="id" dataSource={query.data ?? []} pagination={false} sorting={false}
          loading={query.isPending} refreshing={query.isFetching} onRefresh={query.refetch} columns={[
            { title: t("标题"), key: "subject", render: (_, row) => <DataTableText primary={row.subject} secondary={row.description || undefined} /> },
            { title: t("状态"), dataIndex: "state", render: (value: Ticket["state"]) => t(stateNames[value]) },
            { title: t("受派成员"), dataIndex: "assigneeId", render: value => value ?? t("尚未分派") },
            { title: t("操作"), key: "actions", render: (_, row) => <Button onClick={() => navigate("detail", row.id)}>{t("查看")}</Button> }
          ]} />
      </QueryState>
    </ListSection>
    <div role="group" aria-label={t("工单分页")}>
      <Button disabled={offset === 0 || query.isFetching} onClick={() => setOffset(value => Math.max(0, value - 20))}>{t("上一页")}</Button>
      <Button disabled={offset >= 100_000 || query.isFetching || !query.data || query.data.length < 20} onClick={() => setOffset(value => value + 20)}>{t("下一页")}</Button>
    </div>
  </CorePage>;
}

type CreateValues = { subject: string; description: string };
export function CreateTicketPage() {
  const { request } = useCoreRequest(), { t } = useLocale();
  const client = useQueryClient();
  const [form] = Form.useForm<CreateValues>();
  const original = useRef<{ operationId: string; subject: string; description: string } | undefined>(undefined);
  const pending = useRef<Promise<unknown> | null>(null);
  const [unknown, setUnknown] = useState(false), [sending, setSending] = useState(false), [dirty, setDirty] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [createdId, setCreatedId] = useState<string>();
  const reconcile = async () => {
    if (!original.current) throw new Error("没有原操作可核对");
    setSending(true);
    try {
      const result = TICKETS_HTTP.receipt.response.parse(await request(`/operations/${original.current.operationId}`));
      if (result.status !== "recorded") throw new Error("原收据暂不可用，请保留此页稍后再核对");
      if (result.receipt.operationId !== original.current.operationId) throw new Error("工单回执与原操作不一致");
      setUnknown(false); setDirty(false); setCreatedId(result.receipt.ticket.id);
      void client.invalidateQueries({ queryKey: ["core", TICKETS_CORE_ID] });
      return result.receipt;
    } finally { setSending(false); }
  };
  const save = (values: CreateValues) => {
    if (pending.current) return pending.current;
    if (unknown) return reconcile();
    if (createdId) return Promise.reject(new Error("工单已经创建，请查看原工单"));
    const input = TICKETS_HTTP.create.body.parse({ ...values, operationId: original.current?.operationId ?? crypto.randomUUID() });
    if (original.current && JSON.stringify(input) !== JSON.stringify(original.current)) return Promise.reject(new Error("请先核对原提交结果"));
    original.current = input;
    setSending(true); setRejected(false);
    const job = request(pathFor(TICKETS_HTTP.create.path), { method: "post", data: input }).then(result => {
      const receipt = TICKETS_HTTP.create.response.parse(result);
      if (receipt.operationId !== input.operationId) throw new Error("工单回执与原操作不一致");
      setUnknown(false); setDirty(false); setCreatedId(receipt.ticket.id);
      void client.invalidateQueries({ queryKey: ["core", TICKETS_CORE_ID] });
      return receipt;
    }).catch(error => {
      if (rejectedBeforeCommit(error)) { original.current = undefined; setRejected(true); }
      else setUnknown(true);
      throw error;
    }).finally(() => { pending.current = null; setSending(false); });
    pending.current = job;
    return job;
  };
  const actions: CoreAdminPageAction<CreateValues>[] = [{ id: "back", kind: "navigate", label: "返回工单", to: page("tickets") }];
  if (createdId) actions.push({ id: "detail", kind: "navigate", label: "查看工单", emphasis: "primary", to: page("detail", createdId) });
  else if (unknown) actions.push({ id: "reconcile", kind: "command", label: "核对原提交", intent: "review", emphasis: "primary", permissions: permission("read"), execute: reconcile });
  else actions.push({ id: "save", kind: "save", label: "创建工单", intent: "create", emphasis: "primary", form, onSave: save, permissions: permission("create") });
  return <Form form={form} layout="vertical" initialValues={{ subject: "", description: "" }} onValuesChange={() => setDirty(true)} onFinish={save}>
    <UnsavedChangesGuard dirty={dirty || unknown} busy={sending} />
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
  const { request, queryKey } = useCoreRequest(), client = useQueryClient(), host = useCorePageHost(), { t } = useLocale();
  const [form] = Form.useForm<{ assigneeId: string }>();
  const [failed, setFailed] = useState<{ action: "assign" | "start" | "close"; data: Record<string, unknown> }>();
  const [rejected, setRejected] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [sending, setSending] = useState(false);
  const pending = useRef<Promise<unknown> | null>(null);
  const query = useQuery({ queryKey: [...queryKey, "detail", ticketId], queryFn: async ({ signal }) =>
    TicketSchema.parse(await request(pathFor(TICKETS_HTTP.get.path, ticketId), { signal })), meta: { liveRefresh: false } });
  const reconcile = async () => {
    if (!failed) throw new Error("没有原操作可核对");
    setSending(true);
    try {
      const result = TICKETS_HTTP.receipt.response.parse(await request(`/operations/${String(failed.data.operationId)}`));
      if (result.status !== "recorded") throw new Error("原收据暂不可用，请保留此页稍后再核对");
      if (result.receipt.ticket.id !== ticketId || result.receipt.operationId !== failed.data.operationId) throw new Error("原收据对应另一工单或操作");
      setFailed(undefined); setDirty(false); await client.invalidateQueries({ queryKey: ["core", TICKETS_CORE_ID] });
      return result.receipt;
    } finally { setSending(false); }
  };
  const mutate = (action: "assign" | "start" | "close", extra: Record<string, unknown> = {}) => {
    if (pending.current) return pending.current;
    if (!query.data || query.error || query.isFetching) return Promise.reject(new Error("请先读取当前工单"));
    if (failed && (failed.action !== action || Object.entries(extra).some(([key, value]) => failed.data[key] !== value)))
      return Promise.reject(new Error("请先核对原操作"));
    const data = failed?.data ?? { operationId: crypto.randomUUID(), expectedRevision: query.data.revision, ...extra };
    const op = TICKETS_HTTP[action], input = op.body.parse(data);
    setSending(true); setRejected(false);
    const job = request(pathFor(op.path, ticketId), { method: "post", data: input }).then(async result => {
      const receipt = op.response.parse(result);
      if (receipt.operationId !== input.operationId || receipt.ticket.id !== ticketId) throw new Error("工单回执与原操作不一致");
      setFailed(undefined); setDirty(false); await client.invalidateQueries({ queryKey: ["core", TICKETS_CORE_ID] });
      return receipt;
    }).catch(error => {
      if (rejectedBeforeCommit(error)) { setRejected(true); void client.invalidateQueries({ queryKey }); }
      else setFailed({ action, data: input });
      throw error;
    }).finally(() => { pending.current = null; setSending(false); });
    pending.current = job;
    return job;
  };
  const actions: CoreAdminPageAction<Record<string, unknown>>[] = [{ id: "back", kind: "navigate", label: "返回工单", to: page("tickets") }];
  const current = query.data;
  if (failed) actions.push({ id: "reconcile", kind: "command", label: "核对原操作", intent: "review", emphasis: "primary",
    permissions: permission("read"), disabled: query.isFetching || sending, execute: reconcile });
  else if (current && !query.error) {
    const action = current.state === "open" ? "start" : current.state === "in_progress" ? "close" : undefined;
    if (action) actions.push({ id: action, kind: "command", label: action === "start" ? "开始处理" : "关闭工单", emphasis: "primary",
      permissions: permission(action), disabled: query.isFetching || sending || !current.assigneeId,
      confirmation: action === "close" ? "确认关闭这张工单？" : undefined, execute: () => mutate(action) });
  }
  const canAssign = host.canAccess(TICKETS_CORE_ID, permission("assign"));
  return <CorePage actions={actions}>
    <UnsavedChangesGuard dirty={dirty || Boolean(failed)} busy={sending} />
    <QueryState loading={query.isPending} error={query.error} onRetry={query.refetch}>
      {current && <><ListSection title={current.subject}><p>{t(stateNames[current.state])}</p><p>{current.description || t("未填写说明")}</p>
        <dl><dt>{t("创建者")}</dt><dd>{current.createdBy}</dd><dt>{t("受派成员")}</dt><dd>{current.assigneeId ?? t("尚未分派")}</dd></dl>
      </ListSection>
      {failed && <Alert type="warning" title={t("未能确认操作结果")} description={`${t("使用同一原操作核对，不要换键重做。")} ${String(failed.data.operationId)}`} />}
      {rejected && <Alert type="error" title={t("操作被拒绝，请读取当前状态并核对权限后再处理")} />}
      {canAssign && current.state === "open" && !failed && <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)} onFinish={values => mutate("assign", values)}>
        <Form.Item name="assigneeId" label={t("受派成员ID")} rules={[{ required: true }]}><Input disabled={sending} /></Form.Item>
        <SaveButton variant="secondary" label={t("分派工单")} disabled={query.isFetching || sending} form={form} onSave={values => mutate("assign", values)} />
      </Form>}</>}
    </QueryState>
  </CorePage>;
}

function RegisteredTicketDetailPage() {
  const ticketId = useCorePageHost().params?.ticketId;
  if (!ticketId) throw new Error("工单详情需要当前已登记路由的ticketId");
  return <TicketDetailPage ticketId={ticketId} />;
}

/** 默认详情消费框架的登记参数；已有受控宿主可以沿原参数继续提供自己的详情组件。 */
export function createTicketsAdmin(detail: ComponentType = RegisteredTicketDetailPage): CoreAdminContribution<ComponentType> {
  return { coreId: TICKETS_CORE_ID, implementationVersion: TICKETS_CORE_VERSION, pages: [
    { id: "tickets", path: "/tickets", title: "工单", menu: {}, permissions: permission("read"), component: TicketsPage },
    { id: "create", path: "/tickets/new", title: "新建工单", parent: "tickets", permissions: [...permission("read"), ...permission("create")], component: CreateTicketPage },
    { id: "detail", path: "/tickets/:ticketId", title: "工单详情", parent: "tickets", permissions: permission("read"), component: detail }
  ] };
}
