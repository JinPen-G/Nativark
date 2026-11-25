/** 原治理、文件和任务页签、表单及取号交互，原后台与公共页面消费同一组件。
 * 会话代次隔离缓存和响应，保存按钮与回车共用一次提交，取号沿真实服务端推进。 */
import type { GeneratePlatformNumberResult, PlatformDictionaryGroup, PlatformNumberRule,
  SavePlatformDictionaryGroupRequest, SavePlatformNumberRuleRequest, CreateAsyncJobRequest,
  CreateFileAssetRequest, CreatePrintJobRequest, PlatformFilterPreset, SavePlatformFilterPresetRequest,
  FileAssetSummary, PrintJobSummary, AsyncJobSummary, NotificationSendLogSummary
} from "@rental-os/platform-contracts";
import { Col, InputNumber, Row, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale } from "../../app/locale";
import { resolveAdminBrandName } from "../../app/branding";
import { useServerFormSync } from "../../app/useServerFormSync";
import { PageHeading } from "../../components/PageHeading";
import { QueryState } from "../../components/QueryState";
import { Alert, App, Button, Drawer, Form, Input, ListFilters, ListSection, Result,
  SaveButton, Select, Switch, Table, Tabs, useListFilter } from "../../components/ui";
import { DeleteOutlined, PlayCircleOutlined, PlusOutlined } from "../../components/ui/icons";
import { useAdminRuntime, useAdminSession } from "../../runtime";
import { usePlatformToolsApi } from "./client";
import { canManagePlatformDictionaries, canManagePlatformNumberRules, canManagePlatformTools,
  canManagePlatformInfrastructure, canManagePlatformFilterPresets } from "./platformToolsAccess";

type Editor = { kind: "dictionary"; code?: string } | { kind: "number"; code?: string };

export function usePlatformToolsTabs() {
  const { t } = useLocale();
  const { message, modal } = App.useApp();
  const runtime = useAdminRuntime();
  const { user, sessionVerified } = useAdminSession();
  const api = usePlatformToolsApi();
  const queryClient = useQueryClient();
  const epoch = runtime.currentSessionEpoch();
  const canDictionary = sessionVerified && canManagePlatformDictionaries(user);
  const canNumber = sessionVerified && canManagePlatformNumberRules(user);
  const dictionaries = useQuery({ queryKey: ["platform-dictionaries", epoch],
    queryFn: ({ signal }) => api.dictionaries(signal), enabled: canDictionary, meta: { liveRefresh: false } });
  const numbers = useQuery({ queryKey: ["platform-number-rules", epoch],
    queryFn: ({ signal }) => api.numberRules(signal), enabled: canNumber, meta: { liveRefresh: false } });
  const dictionaryFilter = useListFilter(dictionaries.data, { fields: row => [row.name, row.code] });
  const numberFilter = useListFilter(numbers.data, { fields: row => [row.name, row.code] });
  const [editor, setEditor] = useState<Editor>();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<Record<string, unknown>>();
  const pending = useRef<Promise<PlatformDictionaryGroup | PlatformNumberRule> | null>(null);
  const generating = useRef<Promise<GeneratePlatformNumberResult> | null>(null);
  const source = useMemo(() => {
    if (!editor) return undefined;
    if (editor.kind === "dictionary") return editor.code ? dictionaries.data?.find(row => row.code === editor.code)
      : { code: "", name: "", module: "platform", description: "", items: [{ code: "", label: "", value: "", sortNo: 10, enabled: true, remark: "" }] };
    return editor.code ? numbers.data?.find(row => row.code === editor.code)
      : { code: "", name: "", module: "platform", prefix: "", datePattern: "yyyyMMdd", sequenceLength: 6, resetCycle: "daily", enabled: true };
  }, [editor, dictionaries.data, numbers.data]);
  const isCurrent = useServerFormSync(form, source, () => { if (source) form.setFieldsValue({ ...source }); }, `${epoch}:${open}:${editor?.kind}:${editor?.code ?? "new"}`);

  useEffect(() => { setOpen(false); setEditor(undefined); form.resetFields(); }, [epoch, form]);

  function authorize(kind: Editor["kind"]) {
    const current = runtime.getSession();
    if (runtime.currentSessionEpoch() !== epoch || !current.sessionVerified
      || !(kind === "dictionary" ? canManagePlatformDictionaries(current.user) : canManagePlatformNumberRules(current.user)))
      throw new Error(t("当前没有对应工具维护权限"));
    return current.user?.displayName ?? t("租户管理员");
  }

  async function refresh(key: string) {
    await queryClient.invalidateQueries({ queryKey: [key, epoch] }, { throwOnError: true });
  }

  const save = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      if (!editor) throw new Error(t("请重新打开工具编辑器"));
      const operator = authorize(editor.kind);
      if (!isCurrent() || !source) throw new Error(t("服务端配置已变更，请重新打开本页核对后再保存"));
      if (editor.kind === "dictionary") {
        const items = editor.code ? dictionaries.data?.find(row => row.code === editor.code)?.items ?? []
          : (values as Partial<SavePlatformDictionaryGroupRequest>).items ?? [];
        return api.saveDictionary({ ...values, code: editor.code ?? values.code, items, operator } as SavePlatformDictionaryGroupRequest);
      }
      // 原表单没有编辑当前流水的控件。省略该字段，让服务在锁内保留最新流水。
      return api.saveNumberRule({ ...values, code: editor.code ?? values.code, currentSequence: undefined, operator } as SavePlatformNumberRuleRequest);
    },
    onSuccess: async () => {
      if (runtime.currentSessionEpoch() !== epoch) return;
      const dictionary = editor?.kind === "dictionary";
      setOpen(false);
      message.success(t(dictionary ? "数据字典已保存" : "编号规则已保存"));
      try { await refresh(dictionary ? "platform-dictionaries" : "platform-number-rules"); }
      catch { message.warning(t("工具操作已成功，列表刷新失败，请重新读取。")); }
    },
    onError: () => { if (runtime.currentSessionEpoch() === epoch) message.error(t(editor?.kind === "dictionary" ? "字典保存失败" : "编号规则保存失败")); }
  });

  function submit(values: Record<string, unknown>) {
    if (pending.current) return pending.current;
    const request = save.mutateAsync(values);
    pending.current = request;
    void request.finally(() => { if (pending.current === request) pending.current = null; }).catch(() => undefined);
    return request;
  }

  const generate = useMutation({
    mutationFn: (code: string) => api.generateNumber(code, authorize("number")),
    onSuccess: async result => {
      if (runtime.currentSessionEpoch() !== epoch) return;
      modal.success({ title: t("编号生成成功"), content: <Typography.Text code copyable>{result.generatedNo}</Typography.Text> });
      try { await refresh("platform-number-rules"); }
      catch { message.warning(t("工具操作已成功，列表刷新失败，请重新读取。")); }
    },
    onError: () => { if (runtime.currentSessionEpoch() === epoch) message.error(t("编号生成失败")); }
  });

  function generateNumber(code: string) {
    if (generating.current) return generating.current;
    const request = generate.mutateAsync(code);
    generating.current = request;
    void request.finally(() => { if (generating.current === request) generating.current = null; }).catch(() => undefined);
    return request;
  }

  function edit(next: Editor) {
    form.resetFields();
    save.reset();
    setEditor(next);
    setOpen(true);
  }

  const items = [];
  if (canDictionary) items.push({ key: "dictionaries", label: `${t("数据字典")} ${dictionaries.data?.length ?? 0}`, children:
    <QueryState loading={dictionaries.isLoading} error={dictionaries.error} onRetry={() => dictionaries.refetch({ throwOnError: true })}>
      <Table<PlatformDictionaryGroup> toolbar={<><ListFilters filter={dictionaryFilter} placeholder={t("字典名称或编码")} />
        <Button icon={<PlusOutlined />} disabled={save.isPending} onClick={() => edit({ kind: "dictionary" })}>{t("新增字典")}</Button></>}
        rowKey="code" onRefresh={() => dictionaries.refetch({ throwOnError: true })} loading={dictionaries.isLoading} refreshing={dictionaries.isFetching}
        dataSource={dictionaryFilter.rows} pagination={dictionaryFilter.pagination} columns={[
          { title: t("字典"), render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.code}</span></> },
          { title: t("模块"), dataIndex: "module" }, { title: t("项目数"), dataIndex: "items", render: values => values.length },
          { title: t("更新人"), dataIndex: "updatedBy" },
          { title: t("操作"), render: (_, record) => <Button type="link" disabled={save.isPending} onClick={() => edit({ kind: "dictionary", code: record.code })}>{t("编辑")}</Button> }
        ]} />
    </QueryState>
  });
  if (canNumber) items.push({ key: "numbers", label: `${t("编号规则")} ${numbers.data?.length ?? 0}`, children:
    <QueryState loading={numbers.isLoading} error={numbers.error} onRetry={() => numbers.refetch({ throwOnError: true })}>
      <Table<PlatformNumberRule> toolbar={<><ListFilters filter={numberFilter} placeholder={t("规则名称或编码")} />
        <Button icon={<PlusOutlined />} disabled={save.isPending || generate.isPending} onClick={() => edit({ kind: "number" })}>{t("新增规则")}</Button></>}
        toolbarNote={<Typography.Text type="secondary">{t("生成操作会推进当前序号。")}</Typography.Text>}
        rowKey="code" onRefresh={() => numbers.refetch({ throwOnError: true })} loading={numbers.isLoading} refreshing={numbers.isFetching}
        dataSource={numberFilter.rows} pagination={numberFilter.pagination} columns={[
          { title: t("规则"), render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.code}</span></> },
          { title: t("前缀"), dataIndex: "prefix" }, { title: t("日期"), dataIndex: "datePattern" },
          { title: t("当前序号"), dataIndex: "currentSequence" }, { title: t("示例"), dataIndex: "sample" },
          { title: t("启用"), dataIndex: "enabled", render: value => <Tag color={value ? "success" : "default"}>{value ? t("是") : t("否")}</Tag> },
          { title: t("操作"), render: (_, record) => <Space size={0}>
            <Button type="link" disabled={save.isPending || generate.isPending} onClick={() => edit({ kind: "number", code: record.code })}>{t("编辑")}</Button>
            <Button type="link" disabled={!record.enabled || save.isPending || generate.isPending}
              onClick={() => { void generateNumber(record.code).catch(() => undefined); }}>{t("生成")}</Button>
          </Space> }
        ]} />
    </QueryState>
  });

  const canEdit = editor?.kind === "dictionary" ? canDictionary : canNumber;
  const overlay = <Drawer presentation={editor?.kind === "dictionary" ? "dialog" : "side"} title={t("平台工具操作")}
    open={open && canEdit} size={600} destroyOnHidden closable={!save.isPending}
    onClose={() => setOpen(false)} afterOpenChange={visible => { if (!visible) { setEditor(undefined); form.resetFields(); } }}
    extra={<SaveButton form={form} label={t("保存")} pending={save.isPending} disabled={!canEdit || !source} onSave={submit} />}>
    <Form form={form} layout="vertical" disabled={!canEdit || save.isPending} onFinish={values => { void submit(values).catch(() => undefined); }}>
      {editor?.kind === "dictionary" && <>
        <Form.Item name="code" label={t("字典编码")} rules={[{ required: true }]}><Input disabled={Boolean(editor.code)} /></Form.Item>
        <Form.Item name="name" label={t("字典名称")} rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="module" label={t("模块")} rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="description" label={t("说明")}><Input.TextArea /></Form.Item>
        {editor.code ? <Typography.Text type="secondary">{t("字典项目继续保留当前")} {dictionaries.data?.find(row => row.code === editor.code)?.items.length ?? 0} {t("项")}</Typography.Text>
          : <Form.List name="items">{fields => fields.map(field => <div key={field.key}>
            <Typography.Text>{t("首个字典项")}</Typography.Text>
            <Row gutter={12}>
              <Col span={8}><Form.Item name={[field.name, "code"]} label={t("字典项编码")} rules={[{ required: true }]}><Input /></Form.Item></Col>
              <Col span={8}><Form.Item name={[field.name, "label"]} label={t("显示名称")} rules={[{ required: true }]}><Input /></Form.Item></Col>
              <Col span={8}><Form.Item name={[field.name, "value"]} label={t("字典项值")} rules={[{ required: true }]}><Input /></Form.Item></Col>
            </Row>
            <Row gutter={12}>
              <Col span={8}><Form.Item name={[field.name, "sortNo"]} label={t("排序")} rules={[{ required: true }]}><InputNumber precision={0} /></Form.Item></Col>
              <Col span={8}><Form.Item name={[field.name, "enabled"]} label={t("启用")} valuePropName="checked"><Switch /></Form.Item></Col>
              <Col span={8}><Form.Item name={[field.name, "remark"]} label={t("备注")}><Input /></Form.Item></Col>
            </Row>
          </div>)}</Form.List>}
      </>}
      {editor?.kind === "number" && <>
        <Form.Item name="code" label={t("规则编码")}><Input disabled={Boolean(editor.code)} /></Form.Item>
        <Form.Item name="name" label={t("规则名称")}><Input /></Form.Item>
        <Form.Item name="module" label={t("模块")}><Input /></Form.Item>
        <Row gutter={12}>
          <Col span={8}><Form.Item name="prefix" label={t("前缀")}><Input /></Form.Item></Col>
          <Col span={8}><Form.Item name="datePattern" label={t("日期格式")}><Select options={["yyyyMMdd", "yyyyMM", "yyMMdd", "none"].map(value => ({ value, label: value }))} /></Form.Item></Col>
          <Col span={8}><Form.Item name="sequenceLength" label={t("序号长度")}><InputNumber min={1} /></Form.Item></Col>
        </Row>
        <Form.Item name="resetCycle" label={t("重置周期")}><Select options={["daily", "monthly", "yearly", "never"].map(value => ({ value, label: value }))} /></Form.Item>
        <Form.Item name="enabled" label={t("启用")} valuePropName="checked"><Switch /></Form.Item>
      </>}
    </Form>
  </Drawer>;
  return { items, overlay };
}


type ExtendedEditor = "preset" | "file" | "print" | "job";
type ToolAuthority = "preset" | "infrastructure";

/** 按原作用域等待一次实际调用。读回失败不能把已成功写入改报失败并诱发重发。 */
function useToolMutation<Values, Result>({ authority, mutationFn, success, failure, refresh, onSaved }: {
  authority: ToolAuthority;
  mutationFn: (values: Values, operator: string) => Promise<Result>;
  success: string | ((result: Result) => string);
  failure: string;
  refresh: readonly string[];
  onSaved?: () => void;
}) {
  const runtime = useAdminRuntime(), cache = useQueryClient();
  const { t } = useLocale(), { message } = App.useApp();
  const epoch = runtime.currentSessionEpoch();
  const active = useRef(true), pending = useRef<Promise<Result> | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const isCurrent = () => {
    const session = runtime.getSession();
    return active.current && runtime.currentSessionEpoch() === epoch && session.sessionVerified
      && (authority === "preset" ? canManagePlatformFilterPresets(session.user) : canManagePlatformInfrastructure(session.user));
  };
  const mutation = useMutation({
    retry: false,
    mutationFn: (values: Values) => {
      if (!isCurrent()) throw new DOMException("当前工具页面已失效", "AbortError");
      return mutationFn(values, runtime.getSession().user?.displayName ?? t("租户管理员"));
    },
    onSuccess: async result => {
      if (!isCurrent()) return;
      onSaved?.();
      message.success(t(typeof success === "function" ? success(result) : success));
      try { await Promise.all(refresh.map(key => cache.invalidateQueries({ queryKey: [key, epoch] }, { throwOnError: true }))); }
      catch { if (isCurrent()) message.warning(t("工具操作已成功，列表刷新失败，请重新读取。")); }
    },
    onError: error => {
      if (isCurrent() && !(error instanceof Error && error.name === "AbortError")) message.error(t(failure));
    }
  });
  const submit = (values: Values) => {
    if (pending.current) return pending.current;
    const request = mutation.mutateAsync(values);
    pending.current = request;
    void request.finally(() => { if (pending.current === request) pending.current = null; }).catch(() => undefined);
    return request;
  };
  return { ...mutation, submit };
}

export function PlatformToolsPage() {
  const { t } = useLocale();
  const { user, tenant, sessionVerified } = useAdminSession();
  const runtime = useAdminRuntime();
  if (!sessionVerified) return <Result status="403" title="403" />;
  if (user?.isSaasAdmin) return <>
    <PageHeading title={t("平台工具与治理")} brandName={resolveAdminBrandName(tenant, user)} />
    <Alert type="info" showIcon title={t("这些工具暂不向平台账号开放")}
      description={t("字典、编号规则、筛选预设、文件与任务仍属于租户工具。当前平台入口不会读取租户资料或执行工具操作。")} />
  </>;
  if (!canManagePlatformTools(user)) return <Result status="403" title="403" />;
  return <TenantToolsWorkspace key={runtime.currentSessionEpoch()} />;
}

function TenantToolsWorkspace() {
  const { t } = useLocale();
  const { user, tenant } = useAdminSession();
  const runtime = useAdminRuntime(), platformOpsApi = usePlatformToolsApi();
  const epoch = runtime.currentSessionEpoch();
  const canPresets = canManagePlatformFilterPresets(user);
  const canInfrastructure = canManagePlatformInfrastructure(user);
  const dictionaryNumbers = usePlatformToolsTabs();
  const [editor, setEditor] = useState<ExtendedEditor>();
  const [editingPreset, setEditingPreset] = useState<PlatformFilterPreset>();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<Record<string, unknown>>();
  const owner = useRef({ active: true, generation: 0 });
  const editorGeneration = owner.current.generation;
  useEffect(() => { owner.current.active = true; return () => { owner.current.active = false; }; }, []);
  const isCurrentEditor = () => owner.current.active && owner.current.generation === editorGeneration
    && runtime.currentSessionEpoch() === epoch;
  const presets = useQuery({ queryKey: ["platform-filter-presets", epoch], enabled: canPresets,
    queryFn: ({ signal }) => platformOpsApi.filterPresets({}, signal) });
  const presetScopes = useQuery({ queryKey: ["platform-filter-preset-scopes", epoch], enabled: canPresets,
    queryFn: ({ signal }) => platformOpsApi.filterPresetScopes(signal) });
  const presetFilter = useListFilter(presets.data, { fields: row => [row.name, row.scopeKey] });
  const files = useQuery({ queryKey: ["files", epoch, "platform-tools"], enabled: canInfrastructure,
    queryFn: ({ signal }) => platformOpsApi.fileAssets(signal) });
  const printJobs = useQuery({ queryKey: ["print-jobs", epoch], enabled: canInfrastructure,
    queryFn: ({ signal }) => platformOpsApi.printJobs(signal) });
  const notifications = useQuery({ queryKey: ["notification-logs", epoch, "platform-tools"], enabled: canInfrastructure,
    queryFn: ({ signal }) => platformOpsApi.notificationLogs(signal) });
  const jobs = useQuery({ queryKey: ["async-jobs", epoch, "platform-tools"], enabled: canInfrastructure,
    queryFn: ({ signal }) => platformOpsApi.asyncJobs(signal) });
  const closeEditor = () => { if (isCurrentEditor() && !saving.current) { owner.current.generation += 1; setOpen(false); } };
  const savedEditor = () => { owner.current.generation += 1; setOpen(false); };
  const savePreset = useToolMutation({ authority: "preset",
    mutationFn: (values: SavePlatformFilterPresetRequest & { filtersText?: string }, operator) =>
      platformOpsApi.saveFilterPreset({ ...values, id: editingPreset?.id, filters: JSON.parse(values.filtersText || "{}"), operator }),
    success: "筛选预设已保存", failure: "筛选预设保存失败，请检查 JSON", refresh: ["platform-filter-presets"], onSaved: savedEditor });
  const presetDefault = useToolMutation({ authority: "preset", mutationFn: (id: string, operator) => platformOpsApi.setFilterPresetDefault(id, operator),
    success: "默认预设已更新", failure: "默认预设更新失败", refresh: ["platform-filter-presets"] });
  const presetDelete = useToolMutation({ authority: "preset", mutationFn: (id: string, operator) => platformOpsApi.deleteFilterPreset(id, operator),
    success: "预设已删除", failure: "系统预设不能删除", refresh: ["platform-filter-presets"] });
  const createFile = useToolMutation({ authority: "infrastructure", mutationFn: (values: CreateFileAssetRequest, operator) => platformOpsApi.createFileAsset({ ...values, uploadedBy: operator }),
    success: "文件资产记录已创建", failure: "文件资产创建失败", refresh: ["files"], onSaved: savedEditor });
  const createPrint = useToolMutation({ authority: "infrastructure", mutationFn: (values: CreatePrintJobRequest, operator) => platformOpsApi.createPrintJob({ ...values, operator }),
    success: "打印任务已创建", failure: "打印任务创建失败", refresh: ["print-jobs"], onSaved: savedEditor });
  const createJob = useToolMutation({ authority: "infrastructure", mutationFn: (values: CreateAsyncJobRequest, operator) => platformOpsApi.createAsyncJob({ ...values, operator }),
    success: "异步任务已创建", failure: "异步任务创建失败", refresh: ["async-jobs"], onSaved: savedEditor });
  const runJob = useToolMutation({ authority: "infrastructure", mutationFn: (id: string) => platformOpsApi.runJob(id),
    success: "任务已执行", failure: "任务执行失败", refresh: ["async-jobs"] });
  const runDue = useToolMutation({ authority: "infrastructure", mutationFn: (_: void) => platformOpsApi.runDueJobs(),
    success: result => result.message, failure: "到期任务执行失败", refresh: ["async-jobs"] });
  const saving = useRef<Promise<unknown> | null>(null);
  const busy = savePreset.isPending || createFile.isPending || createPrint.isPending || createJob.isPending;
  function saveEditor(values: Record<string, unknown>): Promise<unknown> {
    if (!isCurrentEditor() || !open) return Promise.reject(new DOMException("当前工具表单已失效", "AbortError"));
    if (saving.current) return saving.current;
    let request: Promise<unknown>;
    if (editor === "preset") request = savePreset.submit(values as unknown as SavePlatformFilterPresetRequest & { filtersText?: string });
    else if (editor === "file") request = createFile.submit(values as unknown as CreateFileAssetRequest);
    else if (editor === "print") request = createPrint.submit(values as unknown as CreatePrintJobRequest);
    else if (editor === "job") request = createJob.submit(values as unknown as CreateAsyncJobRequest);
    else return Promise.reject(new Error(t("请重新打开工具编辑器")));
    saving.current = request;
    void request.finally(() => { if (saving.current === request) saving.current = null; }).catch(() => undefined);
    return request;
  }
  type Validation = typeof form.validateFields;
  const validate: Validation = async (...args: Parameters<Validation> | [options?: Parameters<Validation>[1]]) => {
    if (!isCurrentEditor()) throw new DOMException("当前工具表单已失效", "AbortError");
    const values = await form.validateFields(...args as Parameters<Validation>);
    if (!isCurrentEditor()) throw new DOMException("当前工具表单已失效", "AbortError");
    return values;
  };
  const boundForm = useMemo(() => ({ ...form, validateFields: validate }), [form, epoch, editorGeneration]);
  function openEditor(kind: ExtendedEditor, values: Record<string, unknown>, preset?: PlatformFilterPreset) {
    if (!isCurrentEditor() || saving.current) return;
    owner.current.generation += 1;
    form.resetFields(); form.setFieldsValue(values);
    setEditingPreset(preset); setEditor(kind); setOpen(true);
  }
  function editPreset(record?: PlatformFilterPreset) {
    openEditor("preset", record ? { ...record, filtersText: JSON.stringify(record.filters, null, 2) }
      : { scopeKey: presetScopes.data?.[0], name: "", description: "", filtersText: "{}", isDefault: false }, record);
  }
  return <>
    <PageHeading title={t("平台工具与治理")} brandName={resolveAdminBrandName(tenant, user)} />
    <ListSection><Tabs className="standalone-tabs" items={[
      { key: "governance", label: t("平台治理"), children: <Tabs items={[
        ...dictionaryNumbers.items,
        ...(canPresets ? [{ key: "presets", label: `${t("筛选预设")} ${presets.data?.length ?? 0}`, children: <QueryState loading={presets.isLoading || presetScopes.isLoading} error={presets.error || presetScopes.error} onRetry={() => Promise.all([presets.refetch({ throwOnError: true }), presetScopes.refetch({ throwOnError: true })])}><Table<PlatformFilterPreset> toolbar={<><ListFilters filter={presetFilter} placeholder="预设名称或范围" /><Button icon={<PlusOutlined />} disabled={busy} onClick={() => editPreset()}>{t("新增预设")}</Button></>} rowKey="id" onRefresh={() => presets.refetch()} loading={presets.isLoading} refreshing={presets.isFetching} dataSource={presetFilter.rows} pagination={presetFilter.pagination} columns={[{ title: t("预设"), render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.scopeKey}</span></> }, { title: t("默认"), dataIndex: "isDefault", render: (value) => value ? <Tag color="success">{t("默认")}</Tag> : "—" }, { title: t("系统"), dataIndex: "isSystem", render: (value) => value ? t("是") : t("否") }, { title: t("更新人"), dataIndex: "updatedBy" }, { title: t("操作"), render: (_, record) => <Space size={0}><Button type="link" disabled={busy} onClick={() => editPreset(record)}>{t("编辑")}</Button>{!record.isDefault && <Button type="link" disabled={presetDefault.isPending || presetDelete.isPending} onClick={() => { void presetDefault.submit(record.id).catch(() => undefined); }}>{t("设默认")}</Button>}{!record.isSystem && <Button type="link" danger icon={<DeleteOutlined />} disabled={presetDefault.isPending || presetDelete.isPending} onClick={() => { void presetDelete.submit(record.id).catch(() => undefined); }}>{t("删除")}</Button>}</Space> }]} /></QueryState> }] : [])
      ]} /> },
      ...(canInfrastructure ? [{ key: "infra", label: t("文件与任务"), children: <Tabs items={[
        { key: "files", label: `${t("文件")} ${files.data?.length ?? 0}`, children: <QueryState loading={files.isLoading} error={files.error} onRetry={() => files.refetch({ throwOnError: true })}><Table<FileAssetSummary> toolbar={<><Button icon={<PlusOutlined />} disabled={busy} onClick={() => openEditor("file", { businessModule: "rental-os", businessType: "general", fileName: "", mimeType: "application/pdf", sizeBytes: 0, uploadScene: "manual" })}>{t("新增文件")}</Button></>} toolbarNote={<><Typography.Text type="secondary">{t("这里登记文件元数据，真实上传仍取决于文件提供方。")}</Typography.Text></>} rowKey="id" onRefresh={() => files.refetch()} loading={files.isLoading} refreshing={files.isFetching} dataSource={files.data ?? []} columns={[{ title: t("文件"), dataIndex: "fileName" }, { title: t("业务"), render: (_, record) => `${record.businessModule} / ${record.businessType}` }, { title: t("类型"), dataIndex: "mimeType" }, { title: t("大小"), dataIndex: "sizeBytes" }, { title: t("存储"), dataIndex: "storageProvider" }, { title: t("状态"), dataIndex: "status", render: (value) => <Tag>{value}</Tag> }]} /></QueryState> },
        { key: "print", label: `${t("打印任务")} ${printJobs.data?.length ?? 0}`, children: <QueryState loading={printJobs.isLoading} error={printJobs.error} onRetry={() => printJobs.refetch({ throwOnError: true })}><Table<PrintJobSummary> toolbar={<><Button icon={<PlusOutlined />} disabled={busy} onClick={() => openEditor("print", { documentType: "rental_contract", templateCode: "default", businessType: "rental_order", businessId: "" })}>{t("新建打印任务")}</Button></>} toolbarNote={<><Typography.Text type="secondary">{t("打印结果取决于当前 mock/reserved 提供方。")}</Typography.Text></>} rowKey="id" onRefresh={() => printJobs.refetch()} loading={printJobs.isLoading} refreshing={printJobs.isFetching} dataSource={printJobs.data ?? []} columns={[{ title: t("任务"), dataIndex: "jobNo" }, { title: t("文档类型"), dataIndex: "documentType" }, { title: t("模板"), dataIndex: "templateCode" }, { title: t("状态"), dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: t("创建时间"), dataIndex: "createdAt" }]} /></QueryState> },
        { key: "jobs", label: `${t("异步任务")} ${jobs.data?.length ?? 0}`, children: <QueryState loading={jobs.isLoading} error={jobs.error} onRetry={() => jobs.refetch({ throwOnError: true })}><Table<AsyncJobSummary> toolbar={<><Button icon={<PlusOutlined />} disabled={busy} onClick={() => openEditor("job", { jobType: "manual_job", businessType: "platform", businessId: "", scheduledAt: "" })}>{t("新建任务")}</Button><Button icon={<PlayCircleOutlined />} loading={runDue.isPending} disabled={runJob.isPending} onClick={() => { void runDue.submit(undefined).catch(() => undefined); }}>{t("执行到期任务")}</Button></>} rowKey="id" onRefresh={() => jobs.refetch()} loading={jobs.isLoading} refreshing={jobs.isFetching} dataSource={jobs.data ?? []} columns={[{ title: t("任务类型"), dataIndex: "jobType" }, { title: t("业务"), render: (_, record) => `${record.businessType ?? "—"} / ${record.businessId ?? "—"}` }, { title: t("计划时间"), dataIndex: "scheduledAt", render: (value) => value ?? t("立即") }, { title: t("状态"), dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: t("操作"), render: (_, record) => <Button type="link" icon={<PlayCircleOutlined />} disabled={record.status === "running" || runJob.isPending || runDue.isPending} onClick={() => { void runJob.submit(record.id).catch(() => undefined); }}>{t("执行")}</Button> }]} /></QueryState> },
        { key: "notifications", label: `${t("通知")} ${notifications.data?.length ?? 0}`, children: <QueryState loading={notifications.isLoading} error={notifications.error} onRetry={() => notifications.refetch({ throwOnError: true })}><Table<NotificationSendLogSummary> rowKey="id" onRefresh={() => notifications.refetch()} loading={notifications.isLoading} refreshing={notifications.isFetching} dataSource={notifications.data ?? []} columns={[{ title: t("模板"), dataIndex: "templateCode" }, { title: t("业务"), dataIndex: "businessType" }, { title: t("接收方"), dataIndex: "targetName" }, { title: t("渠道"), dataIndex: "channels", render: (values: string[]) => values.join(" / ") }, { title: t("提供方"), dataIndex: "provider" }, { title: t("状态"), dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: t("时间"), dataIndex: "createdAt" }]} /></QueryState> }
      ]} /> }] : []),
    ]} /></ListSection>

    {dictionaryNumbers.overlay}
    <Drawer presentation={editor === "print" || editor === "job" ? "dialog" : "side"} title={t("平台工具操作")} open={open} size={600} destroyOnHidden closable={!busy} keyboard={!busy} maskClosable={!busy} onClose={closeEditor}
      afterOpenChange={visible => { if (isCurrentEditor() && !visible && !open && !saving.current) { setEditor(undefined); setEditingPreset(undefined); form.resetFields(); } }} extra={<SaveButton form={boundForm} label={t("保存")} pending={busy} onSave={saveEditor} />}><Form form={form} layout="vertical" disabled={busy} onSubmitCapture={event => { event.preventDefault(); event.stopPropagation(); void boundForm.validateFields().then(saveEditor).catch(() => undefined); }}>
      {editor === "preset" && <><Form.Item name="scopeKey" label={t("作用域")}><Select loading={presetScopes.isFetching} options={(presetScopes.data ?? []).map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="name" label={t("预设名称")}><Input /></Form.Item><Form.Item name="description" label={t("说明")}><Input /></Form.Item><Form.Item name="filtersText" label={t("筛选 JSON")}><Input.TextArea rows={8} /></Form.Item><Form.Item name="isDefault" label={t("设为默认")} valuePropName="checked"><Switch /></Form.Item></>}
      {editor === "file" && <><Form.Item name="businessModule" label={t("业务模块")}><Input /></Form.Item><Form.Item name="businessType" label={t("业务类型")}><Input /></Form.Item><Form.Item name="businessId" label={t("业务 ID")}><Input /></Form.Item><Form.Item name="fileName" label={t("文件名")}><Input /></Form.Item><Form.Item name="mimeType" label={t("MIME 类型")}><Input /></Form.Item><Form.Item name="sizeBytes" label={t("大小")}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item><Form.Item name="uploadScene" label={t("上传场景")}><Input /></Form.Item></>}
      {editor === "print" && <><Form.Item name="documentType" label={t("文档类型")}><Select options={["pickup_sheet", "return_sheet", "rental_contract", "invoice"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="templateCode" label={t("模板编码")}><Input /></Form.Item><Form.Item name="businessType" label={t("业务类型")}><Input /></Form.Item><Form.Item name="businessId" label={t("业务 ID")}><Input /></Form.Item></>}
      {editor === "job" && <><Form.Item name="jobType" label={t("任务类型")}><Input /></Form.Item><Form.Item name="businessType" label={t("业务类型")}><Input /></Form.Item><Form.Item name="businessId" label={t("业务 ID")}><Input /></Form.Item><Form.Item name="scheduledAt" label={t("计划时间")}><Input placeholder={t("ISO 时间，留空立即执行")} /></Form.Item></>}
    </Form></Drawer>
  </>;}
