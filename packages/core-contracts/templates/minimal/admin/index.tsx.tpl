/** 本Core的真实列表/新建/详情/设置；沿公共壳、表单和请求，不创建本地权限。 */
import { useRef, useState, type ComponentType } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { corePageKey, resolveCorePageLocation, type CoreAdminContribution } from "@rental-os/core-contracts";
import { Alert, Button, CoreList, CorePage, DataTableText, Form, Input, ListSection, QueryState, Select, UnsavedChangesGuard,
  useCorePageHost, useCoreRequest, useCoreForm, useCoreBinding, useLocale, type CoreAdminPageAction } from "@rental-os/platform-admin/core";
import { CORE_ID, CORE_VERSION, ItemViewSchema, type ItemView } from "{{PACKAGE_NAME}}/contracts";
import { HTTP } from "{{PACKAGE_NAME}}/http";

const page = (pageId: string, itemId?: string) => ({ coreId: CORE_ID, pageId, ...(itemId ? { params: { itemId } } : {}) });
const permission = (action: string) => [{ resource: "item", action }];
const stateNames = { active: "未归档", archived: "已归档" };
const pathFor = (path: string, id?: string) => "/" + path.replace(":itemId", encodeURIComponent(id ?? ""));
/** 只有本Core明确在提交前拒绝的错误才释放当前编辑；网络/500/无原收据继续保持未知。 */
function rejectedBeforeCommit(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: { code?: string } } } | undefined)?.response;
  return response?.status === 400 && response.data?.code === "input_invalid"
    || response?.status === 403 && response.data?.code === "denied"
    || response?.status === 404 && response.data?.code === "not_found"
    || response?.status === 409 && ["revision_conflict", "state_conflict"].includes(response.data?.code ?? "");
}

function useItemNavigation() {
  const host = useCorePageHost();
  return (pageId: string, itemId?: string) => {
    const target = host.pages.get(corePageKey(CORE_ID, pageId));
    if (!target || !host.canAccess(CORE_ID, target.definition.permissions)) throw new Error("当前条目页面不可用");
    host.navigate(resolveCorePageLocation(host.pages, page(pageId, itemId)));
  };
}

export function ItemsPage() {
  const { request, queryKey } = useCoreRequest(), navigate = useItemNavigation(), { t } = useLocale();
  const [offset, setOffset] = useState(0), [limit, setLimit] = useState(20), [state, setState] = useState<string>();
  const [title, setTitle] = useState("");
  const listKey = [...queryKey, "list", offset, limit, state, title.trim()];
  const query = useQuery({ queryKey: listKey, queryFn: async ({ signal }) => HTTP.list.response.parse(await request(pathFor(HTTP.list.path),
    { params: { offset, limit, state, title: title.trim() || undefined }, signal })), meta: { liveRefresh: false } });
  return <CorePage summary={t("仅显示当前账号创建的条目")} actions={[{ id: "create", kind: "navigate", label: "新建条目", emphasis: "primary",
    permissions: permission("create"), to: page("create") }]}>
    <CoreList<ItemView> query={query} queryKey={listKey} rowKey="id" pagination={{ offset, limit, onChange: (next, size) => { setOffset(next); setLimit(size); } }}
      controls={<><Input allowClear aria-label={t("条目标题")} placeholder={t("搜索标题")} maxLength={160} value={title}
        onChange={event => { setTitle(event.target.value); setOffset(0); }} />
        <Select allowClear aria-label={t("条目状态")} placeholder={t("全部状态")} value={state}
          options={Object.entries(stateNames).map(([value, label]) => ({ value, label: t(label) }))}
          onChange={value => { setState(value); setOffset(0); }} /></>}
      columns={[
        { title: t("标题"), key: "title", render: (_, row) => <DataTableText primary={row.title} secondary={row.description || undefined} /> },
        { title: t("状态"), dataIndex: "state", render: (value: ItemView["state"]) => t(stateNames[value]) },
        { title: t("操作"), key: "actions", render: (_, row) => <Button onClick={() => navigate("detail", row.id)}>{t("查看")}</Button> }
      ]} />
  </CorePage>;
}

type CreateValues = { title: string; description: string };
export function CreateItemPage() {
  const { request } = useCoreRequest(), { t } = useLocale();
  const client = useQueryClient();
  const [form] = Form.useForm<CreateValues>();
  const original = useRef<{ operationId: string; title: string; description: string } | undefined>(undefined);
  const completed = useRef<string | undefined>(undefined);
  const uncertain = useRef(false);
  const [unknown, setUnknown] = useState(false), [reconciling, setReconciling] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [createdId, setCreatedId] = useState<string>();
  const reconcile = async () => {
    if (!original.current) throw new Error("没有原操作可核对");
    setReconciling(true);
    try {
      const result = HTTP.receipt.response.parse(await request(`/operations/${original.current.operationId}`));
      if (result.status !== "recorded") throw new Error("原收据暂不可用，请保留此页稍后再核对");
      if (result.receipt.operationId !== original.current.operationId) throw new Error("条目回执与原操作不一致");
      completed.current = result.receipt.item.id;
      uncertain.current = false;
      setUnknown(false); editor.markClean(); setCreatedId(completed.current);
      void client.invalidateQueries({ queryKey: ["core", CORE_ID] });
      return result.receipt;
    } finally { setReconciling(false); }
  };
  const save = (values: CreateValues) => {
    if (uncertain.current) return Promise.reject(new Error("请先核对原提交结果"));
    if (completed.current) return Promise.reject(new Error("条目已经创建，请查看原条目"));
    const input = HTTP.create.body.parse({ ...values, operationId: original.current?.operationId ?? crypto.randomUUID() });
    if (original.current && JSON.stringify(input) !== JSON.stringify(original.current)) return Promise.reject(new Error("请先核对原提交结果"));
    original.current = input;
    setRejected(false);
    return request(pathFor(HTTP.create.path), { method: "post", data: input, retryAuthentication: false }).then(result => {
      const receipt = HTTP.create.response.parse(result);
      if (receipt.operationId !== input.operationId) throw new Error("条目回执与原操作不一致");
      completed.current = receipt.item.id;
      setUnknown(false); setCreatedId(completed.current);
      void client.invalidateQueries({ queryKey: ["core", CORE_ID] });
      return receipt;
    }).catch(error => {
      if (rejectedBeforeCommit(error)) { original.current = undefined; setRejected(true); }
      else { uncertain.current = true; setUnknown(true); }
      throw error;
    });
  };
  const editor = useCoreForm({ form, onSave: save, permissions: permission("create"), disabled: unknown || Boolean(createdId) });
  const sending = editor.busy || reconciling;
  const actions: CoreAdminPageAction<CreateValues>[] = [{ id: "back", kind: "navigate", label: "返回条目", to: page("items") }];
  if (createdId) actions.push({ id: "detail", kind: "navigate", label: "查看条目", emphasis: "primary", to: page("detail", createdId) });
  else if (unknown) actions.push({ id: "reconcile", kind: "command", label: "核对原提交", intent: "review", emphasis: "primary", permissions: permission("read"), disabled: sending, execute: reconcile });
  else actions.push({ id: "save", kind: "save", label: "创建条目", intent: "create", emphasis: "primary", form, onSave: editor.submit,
    disabled: editor.busy, permissions: permission("create") });
  return <Form form={form} layout="vertical" initialValues={{ title: "", description: "" }} {...editor.formProps}>
    <UnsavedChangesGuard dirty={editor.dirty || unknown} busy={sending} />
    <CorePage<CreateValues> actions={actions}>
      {createdId && <Alert type="success" title={t("条目已创建")} />}
      {rejected && <Alert type="error" title={t("创建被拒绝，请核对输入和当前权限后再提交")} />}
      {Boolean(editor.error) && !unknown && !rejected && <Alert type="error" title={t("创建未完成，请核对标题和说明")} />}
      {unknown && <Alert type="warning" title={t("未能确认条目创建结果")}
        description={`${t("保留此页并使用同一请求核对，不要重新创建。")} ${original.current?.operationId}`} />}
      <Form.Item name="title" label={t("标题")} rules={[{ required: true }, { max: 160 }]}><Input disabled={unknown || sending || Boolean(createdId)} /></Form.Item>
      <Form.Item name="description" label={t("说明")} rules={[{ max: 4000 }]}><Input.TextArea disabled={unknown || sending || Boolean(createdId)} /></Form.Item>
    </CorePage>
  </Form>;
}


type EditValues = { title: string; description: string };
type Operation = { action: "update" | "archive"; data: Record<string, unknown> };
function RegisteredItemDetailPage() {
  const id = useCorePageHost().params?.itemId;
  if (!id) throw new Error("条目详情缺少已登记的对象参数");
  return <ItemDetailPage key={id} itemId={id} />;
}
export function ItemDetailPage({ itemId }: { itemId: string }) {
  const { request, queryKey } = useCoreRequest(), client = useQueryClient(), host = useCorePageHost(), { t } = useLocale();
  const [form] = Form.useForm<EditValues>();
  const [editing, setEditing] = useState<ItemView>();
  const [unknown, setUnknown] = useState<Operation>(), original = useRef<Operation | undefined>(undefined);
  const [sending, setSending] = useState(false), inFlight = useRef(false);
  const [rejected, setRejected] = useState(false), [refreshError, setRefreshError] = useState<unknown>();
  const confirmedRevision = useRef(0);
  const query = useQuery({ queryKey: [...queryKey, "detail", itemId], queryFn: async ({ signal }) =>
    ItemViewSchema.parse(await request(pathFor(HTTP.get.path, itemId), { signal })), meta: { liveRefresh: false } });
  const current = query.data;
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["core", CORE_ID], refetchType: "none" });
    const result = await query.refetch();
    if (result.isError) throw result.error;
    setRefreshError(undefined);
  };
  const recorded = async (receipt: { item: ItemView }) => {
    confirmedRevision.current = Math.max(confirmedRevision.current, receipt.item.revision);
    original.current = undefined; setUnknown(undefined); setEditing(undefined); editor.markClean();
    // 原结果已确认；资料刷新失败保留单独的读取错误，不把已提交操作重新判成未知。
    try { await refresh(); } catch (error) { setRefreshError(error); }
  };
  const reconcile = async () => {
    if (!original.current || inFlight.current) throw new Error("当前没有可核对的原操作");
    inFlight.current = true; setSending(true);
    try {
      const operation = original.current;
      const result = HTTP.receipt.response.parse(await request(`/operations/${String(operation.data.operationId)}`));
      if (result.status !== "recorded") throw new Error("原回执暂不可用，请保留原操作键稍后核对");
      if (result.receipt.operationId !== operation.data.operationId || result.receipt.item.id !== itemId) throw new Error("原回执不属于当前操作");
      await recorded(result.receipt); return result.receipt;
    } finally { inFlight.current = false; setSending(false); }
  };
  const mutate = async (action: Operation["action"], values: Partial<EditValues> = {}) => {
    if (inFlight.current || original.current) throw new Error("请先等待或核对原操作");
    if (!current || query.error || query.isFetching || refreshError || current.revision < confirmedRevision.current
      || !host.canAccess(CORE_ID, permission(action))) throw new Error("请先重新读取条目并核对当前权限");
    const route = HTTP[action];
    const data = route.body.parse({ ...values, operationId: crypto.randomUUID(), expectedRevision: action === "update" ? editing?.revision : current.revision });
    inFlight.current = true; setSending(true); setRejected(false);
    try {
      let receipt;
      try {
        receipt = route.response.parse(await request(pathFor(route.path, itemId), { method: "post", data, retryAuthentication: false }));
        if (receipt.operationId !== data.operationId || receipt.item.id !== itemId) throw new Error("回执与原操作不符");
      } catch (error) {
        if (rejectedBeforeCommit(error)) { setRejected(true); void client.invalidateQueries({ queryKey }); }
        else { original.current = { action, data }; setUnknown(original.current); }
        throw error;
      }
      await recorded(receipt); return receipt;
    } finally { inFlight.current = false; setSending(false); }
  };
  const blocked = sending || Boolean(unknown) || query.isFetching || Boolean(query.error || refreshError);
  const editor = useCoreForm({ form, onSave: values => mutate("update", values), permissions: permission("update"), disabled: blocked || !editing });
  const actions: CoreAdminPageAction<EditValues>[] = [{ id: "back", kind: "navigate", label: "返回条目", to: page("items") }];
  if (unknown) actions.push({ id: "reconcile", kind: "command", label: "核对原操作", intent: "review", emphasis: "primary",
    permissions: permission("read"), disabled: sending, execute: reconcile });
  else if (current?.state === "active" && !query.error) {
    if (editing) {
      actions.push({ id: "save", kind: "save", label: "保存条目", emphasis: "primary", permissions: permission("update"),
        disabled: blocked, form, onSave: editor.submit });
      actions.push({ id: "cancel", kind: "command", label: "取消编辑", disabled: sending || editor.busy,
        confirmation: editor.dirty ? "确认放弃当前未保存的修改？" : undefined,
        execute: async () => { setEditing(undefined); form.resetFields(); editor.markClean(); } });
    }
    else {
      actions.push({ id: "edit", kind: "command", label: "编辑条目", emphasis: "primary", permissions: permission("update"), disabled: blocked,
        execute: async () => { setEditing(current); form.setFieldsValue({ title: current.title, description: current.description }); editor.markClean(); } });
      actions.push({ id: "archive", kind: "command", label: "归档条目", permissions: permission("archive"), disabled: blocked,
        confirmation: "归档后条目仍可读取，但不能再次编辑。确认归档？", execute: () => mutate("archive") });
    }
  }
  return <Form form={form} layout="vertical" {...editor.formProps}>
    <UnsavedChangesGuard dirty={editor.dirty || Boolean(unknown)} busy={sending || editor.busy} />
    <CorePage<EditValues> actions={actions}>
      {Boolean(refreshError) && <Alert type="warning" title={t("操作已记录，当前资料未更新")}
        action={<Button onClick={() => { void refresh().catch(setRefreshError); }}>{t("重新读取")}</Button>} />}
      {unknown && <Alert type="warning" title={t("未能确认操作结果")}
        description={`${t("保留此页并核对原操作，不要换键重新提交。")} ${String(unknown.data.operationId)}`} />}
      {rejected && <Alert type="error" title={t("操作被拒绝，请读取当前状态并核对权限")} />}
      {Boolean(editor.error) && !unknown && !rejected && <Alert type="error" title={t("保存未完成，请核对输入或重新读取条目")} />}
      <QueryState loading={query.isPending} error={query.error} onRetry={refresh}>
        {current && <ListSection title={current.title}>
          <p>{t(stateNames[current.state])}</p>
          {editing ? <>
            <Form.Item name="title" label={t("标题")} rules={[{ required: true }, { max: 160 }]}><Input disabled={blocked} /></Form.Item>
            <Form.Item name="description" label={t("说明")} rules={[{ max: 4000 }]}><Input.TextArea disabled={blocked} /></Form.Item>
          </> : <p>{current.description || t("未填写说明")}</p>}
        </ListSection>}
      </QueryState>
    </CorePage>
  </Form>;
}

/** 条目没有额外初始化配置；首次设置使用平台绑定服务，重新进入只读取原绑定。 */
export function ItemsSetupPage() {
  const setting = useCoreBinding(CORE_ID), { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "en-US" ? en : zh;
  const actions: CoreAdminPageAction<Record<string, unknown>>[] = [];
  if (setting.original && setting.canManage) actions.push({ id: "reconcile", kind: "command", intent: "review", emphasis: "primary",
    label: text("核对原设置", "Read original setup"), disabled: setting.busy, execute: setting.reconcile });
  else if (setting.binding) actions.push({ id: "items", kind: "navigate", label: text("进入条目", "Open items"),
    emphasis: "primary", to: page("items") });
  else if (setting.canInitialize) actions.push({ id: "initialize", kind: "command", intent: "confirm", emphasis: "primary",
    label: text("完成条目设置", "Complete item setup"), disabled: setting.busy || setting.loading || Boolean(setting.error),
    execute: () => setting.initialize() });
  return <CorePage actions={actions}>
    <QueryState loading={setting.loading} error={setting.error} onRetry={setting.refetch}>
      {!setting.canManage ? <Alert type="info" title={text("请联系租户管理员完成条目设置", "Ask your tenant administrator to complete item setup")} />
        : setting.binding ? <p>{text("条目设置已完成，已有条目与操作记录继续保留。", "Item setup is complete. Existing items and operation records are retained.")}</p>
          : <p>{text("条目不需要额外配置，完成设置后即可按当前权限使用。", "No additional configuration is needed. Complete setup to use items with your current access.")}</p>}
    </QueryState>
    {setting.original && <Alert type="warning" title={text("原设置结果待核对", "The original setup needs confirmation")}
      description={`${text("请先核对原操作，暂未取得收据不表示可以重新提交。核对编号", "Read the original operation first. A missing receipt does not permit resubmission. Reference")} ${setting.original.operationId}`} />}
    {!setting.original && setting.failure === "rejected" && <Alert type="error" title={text("设置被拒绝，请核对当前权限和状态", "Setup was rejected. Check your current access and state")} />}
  </CorePage>;
}

/** 默认详情消费框架的登记参数；已有受控宿主可以沿原参数继续提供自己的详情组件。 */
export function createAdmin(detail: ComponentType = RegisteredItemDetailPage): CoreAdminContribution<ComponentType> {
  return { coreId: CORE_ID, implementationVersion: CORE_VERSION, pages: [
    { id: "items", path: "/items", title: "条目", menu: {}, permissions: permission("read"), component: ItemsPage },
    { id: "setup", path: "/setup", title: { default: "条目设置", translations: { "en-US": "Item setup" } },
      purpose: "configuration", menu: { order: 10 }, permissions: [], component: ItemsSetupPage },
    { id: "create", path: "/items/new", title: "新建条目", parent: "items", permissions: [...permission("read"), ...permission("create")], component: CreateItemPage },
    { id: "detail", path: "/items/:itemId", title: "条目详情", parent: "items", permissions: permission("read"), component: detail }
  ] };
}
