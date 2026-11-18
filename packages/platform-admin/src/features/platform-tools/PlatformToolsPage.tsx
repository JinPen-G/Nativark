/** 原字典与编号列表、表单和取号交互。原后台页签与公共页面消费同一组件。
 * 会话代次隔离缓存和响应，保存按钮与回车共用一次提交，取号沿真实服务端推进。 */
import type { GeneratePlatformNumberResult, PlatformDictionaryGroup, PlatformNumberRule,
  SavePlatformDictionaryGroupRequest, SavePlatformNumberRuleRequest } from "@rental-os/platform-contracts";
import { Col, InputNumber, Row, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale } from "../../app/locale";
import { useServerFormSync } from "../../app/useServerFormSync";
import { PageHeading } from "../../components/PageHeading";
import { QueryState } from "../../components/QueryState";
import { ActionButton, Alert, App, Button, Drawer, Form, Input, ListFilters, ListSection, Result,
  SaveButton, Select, Switch, Table, Tabs, useListFilter } from "../../components/ui";
import { PlusOutlined } from "../../components/ui/icons";
import { useAdminRuntime, useAdminSession } from "../../runtime";
import { usePlatformToolsApi } from "./client";
import { canManagePlatformDictionaries, canManagePlatformNumberRules, canManagePlatformTools } from "./platformToolsAccess";

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
            <ActionButton label={t("生成")} variant="secondary" disabled={!record.enabled || save.isPending || generate.isPending} onAction={() => generateNumber(record.code)} />
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
      {save.error && <Alert type="error" showIcon title={save.error.message} />}
    </Form>
  </Drawer>;
  return { items, overlay };
}

export function PlatformToolsPage() {
  const { t } = useLocale();
  const { user, tenant, sessionVerified } = useAdminSession();
  const tools = usePlatformToolsTabs();
  if (!sessionVerified || !canManagePlatformTools(user)) return <Result status="403" title="403" />;
  return <>
    <PageHeading title={t("平台工具与治理")} brandName={tenant?.tenantName ?? "Nativark"} />
    <ListSection><Tabs className="standalone-tabs" items={tools.items} /></ListSection>
    {tools.overlay}
  </>;
}
