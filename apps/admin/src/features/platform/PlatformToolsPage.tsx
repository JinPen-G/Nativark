import { ListFilters, useListFilter } from "@/components/ui";
import { DeleteOutlined, PlayCircleOutlined, PlusOutlined, ReloadOutlined } from "@/components/ui/icons";
import type {
  CreateAsyncJobRequest,
  CreateFileAssetRequest,
  CreatePrintJobRequest,
  PlatformDictionaryGroup,
  PlatformFilterPreset,
  PlatformNumberRule,
  SavePlatformDictionaryGroupRequest,
  SavePlatformFilterPresetRequest,
  SavePlatformNumberRuleRequest,
} from "@rental-os/shared";
import { Col, InputNumber, Row, Space, Tag, Typography } from "antd";
import { ListSection, App } from "@/components/ui";
import { Form } from "@/components/ui";
import { Table } from "@/components/ui";
import { Switch } from "@/components/ui";
import { Input } from "@/components/ui";
import { Select } from "@/components/ui";
import { Button, Drawer, SaveButton, Tabs } from "@/components/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { platformOpsApi } from "@/api/platformOps";
import { PageHeader } from "@/components/PageHeader";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";

type Editor = "dictionary" | "number" | "preset" | "file" | "print" | "job" | undefined;

export function PlatformToolsPage() {
  const { message, modal } = App.useApp();
  const { t } = useLocale();
  const operator = useAuthStore((state) => state.user?.displayName) ?? t("租户管理员");
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<Editor>();
  const [editingDictionary, setEditingDictionary] = useState<PlatformDictionaryGroup>();
  const [editingNumber, setEditingNumber] = useState<PlatformNumberRule>();
  const [editingPreset, setEditingPreset] = useState<PlatformFilterPreset>();
  const [form] = Form.useForm<Record<string, unknown>>();

  const dictionaries = useQuery({ queryKey: ["platform-dictionaries"], queryFn: platformOpsApi.dictionaries });
  const numbers = useQuery({ queryKey: ["platform-number-rules"], queryFn: platformOpsApi.numberRules });
  const presets = useQuery({ queryKey: ["platform-filter-presets"], queryFn: () => platformOpsApi.filterPresets({}) });
  const dictionaryFilter = useListFilter(dictionaries.data, { fields: row => [row.name, row.code] });
  const numberFilter = useListFilter(numbers.data, { fields: row => [row.name, row.code] });
  const presetFilter = useListFilter(presets.data, { fields: row => [row.name, row.scopeKey] });
  const files = useQuery({ queryKey: ["files", "platform-tools"], queryFn: platformOpsApi.fileAssets });
  const printJobs = useQuery({ queryKey: ["print-jobs"], queryFn: platformOpsApi.printJobs });
  const notifications = useQuery({ queryKey: ["notification-logs", "platform-tools"], queryFn: platformOpsApi.notificationLogs });
  const templates = useQuery({ queryKey: ["notification-templates"], queryFn: platformOpsApi.notificationTemplates });
  const jobs = useQuery({ queryKey: ["async-jobs", "platform-tools"], queryFn: platformOpsApi.asyncJobs });

  const closeEditor = () => { setEditor(undefined); setEditingDictionary(undefined); setEditingNumber(undefined); setEditingPreset(undefined); form.resetFields(); };
  const saveDictionary = useMutation({ mutationFn: (values: SavePlatformDictionaryGroupRequest) => platformOpsApi.saveDictionary({ ...values, items: editingDictionary?.items ?? [], operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["platform-dictionaries"] }); closeEditor(); message.success(t("数据字典已保存")); }, onError: () => message.error(t("字典保存失败")) });
  const saveNumber = useMutation({ mutationFn: (values: SavePlatformNumberRuleRequest) => platformOpsApi.saveNumberRule({ ...values, operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["platform-number-rules"] }); closeEditor(); message.success(t("编号规则已保存")); }, onError: () => message.error(t("编号规则保存失败")) });
  const generateNumber = useMutation({ mutationFn: (code: string) => platformOpsApi.generateNumber(code, operator), onSuccess: (result) => modal.success({ title: t("编号生成成功"), content: <Typography.Text code copyable>{result.generatedNo}</Typography.Text> }), onError: () => message.error(t("编号生成失败")) });
  const savePreset = useMutation({ mutationFn: (values: SavePlatformFilterPresetRequest & { filtersText?: string }) => platformOpsApi.saveFilterPreset({ ...values, id: editingPreset?.id, filters: JSON.parse(values.filtersText || "{}"), operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["platform-filter-presets"] }); closeEditor(); message.success(t("筛选预设已保存")); }, onError: () => message.error(t("筛选预设保存失败，请检查 JSON")) });
  const presetDefault = useMutation({ mutationFn: (id: string) => platformOpsApi.setFilterPresetDefault(id, operator), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["platform-filter-presets"] }); message.success(t("默认预设已更新")); }, onError: () => message.error(t("默认预设更新失败")) });
  const presetDelete = useMutation({ mutationFn: (id: string) => platformOpsApi.deleteFilterPreset(id, operator), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["platform-filter-presets"] }); message.success(t("预设已删除")); }, onError: () => message.error(t("系统预设不能删除")) });
  const createFile = useMutation({ mutationFn: (values: CreateFileAssetRequest) => platformOpsApi.createFileAsset({ ...values, uploadedBy: operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["files"] }); closeEditor(); message.success(t("文件资产记录已创建")); }, onError: () => message.error(t("文件资产创建失败")) });
  const createPrint = useMutation({ mutationFn: (values: CreatePrintJobRequest) => platformOpsApi.createPrintJob({ ...values, operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["print-jobs"] }); closeEditor(); message.success(t("打印任务已创建")); }, onError: () => message.error(t("打印任务创建失败")) });
  const createJob = useMutation({ mutationFn: (values: CreateAsyncJobRequest) => platformOpsApi.createAsyncJob({ ...values, operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["async-jobs"] }); closeEditor(); message.success(t("异步任务已创建")); }, onError: () => message.error(t("异步任务创建失败")) });
  const runJob = useMutation({ mutationFn: platformOpsApi.runJob, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["async-jobs"] }); message.success(t("任务已执行")); }, onError: () => message.error(t("任务执行失败")) });
  const runDue = useMutation({ mutationFn: platformOpsApi.runDueJobs, onSuccess: async (result) => { await queryClient.invalidateQueries({ queryKey: ["async-jobs"] }); message.success(result.message); }, onError: () => message.error(t("到期任务执行失败")) });

  async function saveEditor(values: Record<string, unknown>) {
    if (editor === "dictionary") return saveDictionary.mutateAsync(values as unknown as SavePlatformDictionaryGroupRequest);
    if (editor === "number") return saveNumber.mutateAsync(values as unknown as SavePlatformNumberRuleRequest);
    if (editor === "preset") return savePreset.mutateAsync(values as unknown as SavePlatformFilterPresetRequest & { filtersText?: string });
    if (editor === "file") return createFile.mutateAsync(values as unknown as CreateFileAssetRequest);
    if (editor === "print") return createPrint.mutateAsync(values as unknown as CreatePrintJobRequest);
    if (editor === "job") return createJob.mutateAsync(values as unknown as CreateAsyncJobRequest);
    throw new Error("Platform editor unavailable");
  }

  function editDictionary(record?: PlatformDictionaryGroup) { setEditingDictionary(record); form.setFieldsValue(record ? { ...record } : { code: "", name: "", module: "platform", description: "" }); setEditor("dictionary"); }
  function editNumber(record?: PlatformNumberRule) { setEditingNumber(record); form.setFieldsValue(record ? { ...record } : { code: "", name: "", module: "platform", prefix: "", datePattern: "yyyyMMdd", sequenceLength: 6, currentSequence: 0, resetCycle: "daily", enabled: true }); setEditor("number"); }
  function editPreset(record?: PlatformFilterPreset) { setEditingPreset(record); form.setFieldsValue(record ? { ...record, filtersText: JSON.stringify(record.filters, null, 2) } : { scopeKey: "rental-os.orders", name: "", description: "", filtersText: "{}", isDefault: false }); setEditor("preset"); }

  return <>
    <PageHeader title={t("平台工具与治理")} />
    <ListSection><Tabs className="standalone-tabs" items={[
      { key: "governance", label: t("平台治理"), children: <Tabs items={[
        { key: "dictionaries", label: `${t("数据字典")} ${dictionaries.data?.length ?? 0}`, children: <><Table toolbar={<><ListFilters filter={dictionaryFilter} placeholder="字典名称或编码" /><Button icon={<PlusOutlined />} onClick={() => editDictionary()}>{t("新增字典")}</Button></>} rowKey="code" onRefresh={() => dictionaries.refetch()} loading={dictionaries.isLoading} refreshing={dictionaries.isFetching} dataSource={dictionaryFilter.rows} pagination={dictionaryFilter.pagination} columns={[{ title: t("字典"), render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.code}</span></> }, { title: t("模块"), dataIndex: "module" }, { title: t("项目数"), dataIndex: "items", render: (values) => values.length }, { title: t("更新人"), dataIndex: "updatedBy" }, { title: t("操作"), render: (_, record) => <Button type="link" onClick={() => editDictionary(record)}>{t("编辑")}</Button> }]} /></> },
        { key: "numbers", label: `${t("编号规则")} ${numbers.data?.length ?? 0}`, children: <><Table toolbar={<><ListFilters filter={numberFilter} placeholder="规则名称或编码" /><Button icon={<PlusOutlined />} onClick={() => editNumber()}>{t("新增规则")}</Button></>} toolbarNote={<><Typography.Text type="secondary">{t("生成操作会推进当前序号。")}</Typography.Text></>} rowKey="code" onRefresh={() => numbers.refetch()} loading={numbers.isLoading} refreshing={numbers.isFetching} dataSource={numberFilter.rows} pagination={numberFilter.pagination} columns={[{ title: t("规则"), render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.code}</span></> }, { title: t("前缀"), dataIndex: "prefix" }, { title: t("日期"), dataIndex: "datePattern" }, { title: t("当前序号"), dataIndex: "currentSequence" }, { title: t("示例"), dataIndex: "sample" }, { title: t("启用"), dataIndex: "enabled", render: (value) => <Tag color={value ? "success" : "default"}>{value ? t("是") : t("否")}</Tag> }, { title: t("操作"), render: (_, record) => <Space size={0}><Button type="link" onClick={() => editNumber(record)}>{t("编辑")}</Button><Button type="link" onClick={() => generateNumber.mutate(record.code)}>{t("生成")}</Button></Space> }]} /></> },
        { key: "presets", label: `${t("筛选预设")} ${presets.data?.length ?? 0}`, children: <><Table toolbar={<><ListFilters filter={presetFilter} placeholder="预设名称或范围" /><Button icon={<PlusOutlined />} onClick={() => editPreset()}>{t("新增预设")}</Button></>} rowKey="id" onRefresh={() => presets.refetch()} loading={presets.isLoading} refreshing={presets.isFetching} dataSource={presetFilter.rows} pagination={presetFilter.pagination} columns={[{ title: t("预设"), render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.scopeKey}</span></> }, { title: t("默认"), dataIndex: "isDefault", render: (value) => value ? <Tag color="success">{t("默认")}</Tag> : "—" }, { title: t("系统"), dataIndex: "isSystem", render: (value) => value ? t("是") : t("否") }, { title: t("更新人"), dataIndex: "updatedBy" }, { title: t("操作"), render: (_, record) => <Space size={0}><Button type="link" onClick={() => editPreset(record)}>{t("编辑")}</Button>{!record.isDefault && <Button type="link" onClick={() => presetDefault.mutate(record.id)}>{t("设默认")}</Button>}{!record.isSystem && <Button type="link" danger icon={<DeleteOutlined />} onClick={() => presetDelete.mutate(record.id)}>{t("删除")}</Button>}</Space> }]} /></> }
      ]} /> },
      { key: "infra", label: t("文件与任务"), children: <Tabs items={[
        { key: "files", label: `${t("文件")} ${files.data?.length ?? 0}`, children: <><Table toolbar={<><Button icon={<PlusOutlined />} onClick={() => { form.setFieldsValue({ businessModule: "rental-os", businessType: "general", fileName: "", mimeType: "application/pdf", sizeBytes: 0, uploadScene: "manual" }); setEditor("file"); }}>{t("新增文件")}</Button></>} toolbarNote={<><Typography.Text type="secondary">{t("这里登记文件元数据，真实上传仍取决于文件提供方。")}</Typography.Text></>} rowKey="id" onRefresh={() => files.refetch()} loading={files.isLoading} refreshing={files.isFetching} dataSource={files.data ?? []} columns={[{ title: t("文件"), dataIndex: "fileName" }, { title: t("业务"), render: (_, record) => `${record.businessModule} / ${record.businessType}` }, { title: t("类型"), dataIndex: "mimeType" }, { title: t("大小"), dataIndex: "sizeBytes" }, { title: t("存储"), dataIndex: "storageProvider" }, { title: t("状态"), dataIndex: "status", render: (value) => <Tag>{value}</Tag> }]} /></> },
        { key: "print", label: `${t("打印任务")} ${printJobs.data?.length ?? 0}`, children: <><Table toolbar={<><Button icon={<PlusOutlined />} onClick={() => { form.setFieldsValue({ documentType: "rental_contract", templateCode: "default", businessType: "rental_order", businessId: "" }); setEditor("print"); }}>{t("新建打印任务")}</Button></>} toolbarNote={<><Typography.Text type="secondary">{t("打印结果取决于当前 mock/reserved 提供方。")}</Typography.Text></>} rowKey="id" onRefresh={() => printJobs.refetch()} loading={printJobs.isLoading} refreshing={printJobs.isFetching} dataSource={printJobs.data ?? []} columns={[{ title: t("任务"), dataIndex: "jobNo" }, { title: t("文档类型"), dataIndex: "documentType" }, { title: t("模板"), dataIndex: "templateCode" }, { title: t("状态"), dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: t("创建时间"), dataIndex: "createdAt" }]} /></> },
        { key: "jobs", label: `${t("异步任务")} ${jobs.data?.length ?? 0}`, children: <><Table toolbar={<><Space><Button icon={<PlusOutlined />} onClick={() => { form.setFieldsValue({ jobType: "manual_job", businessType: "platform", businessId: "", scheduledAt: "" }); setEditor("job"); }}>{t("新建任务")}</Button><Button icon={<ReloadOutlined />} loading={runDue.isPending} onClick={() => runDue.mutate()}>{t("执行到期任务")}</Button></Space></>} rowKey="id" onRefresh={() => jobs.refetch()} loading={jobs.isLoading} refreshing={jobs.isFetching} dataSource={jobs.data ?? []} columns={[{ title: t("任务类型"), dataIndex: "jobType" }, { title: t("业务"), render: (_, record) => `${record.businessType ?? "—"} / ${record.businessId ?? "—"}` }, { title: t("计划时间"), dataIndex: "scheduledAt", render: (value) => value ?? t("立即") }, { title: t("状态"), dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: t("操作"), render: (_, record) => <Button type="link" icon={<PlayCircleOutlined />} disabled={record.status === "running"} onClick={() => runJob.mutate(record.id)}>{t("执行")}</Button> }]} /></> },
        { key: "notifications", label: `${t("通知")} ${notifications.data?.length ?? 0}`, children: <><Table rowKey="id" onRefresh={() => notifications.refetch()} loading={notifications.isLoading} refreshing={notifications.isFetching} dataSource={notifications.data ?? []} columns={[{ title: t("模板"), dataIndex: "templateCode" }, { title: t("业务"), dataIndex: "businessType" }, { title: t("接收方"), dataIndex: "targetName" }, { title: t("渠道"), dataIndex: "channels", render: (values: string[]) => values.join(" / ") }, { title: t("提供方"), dataIndex: "provider" }, { title: t("状态"), dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: t("时间"), dataIndex: "createdAt" }]} /></> }
      ]} /> },
    ]} /></ListSection>

    <Drawer title={t("平台工具操作")} open={Boolean(editor)} size={600} destroyOnHidden onClose={closeEditor} extra={<SaveButton form={form} label={t("保存")} pending={saveDictionary.isPending || saveNumber.isPending || savePreset.isPending || createFile.isPending || createPrint.isPending || createJob.isPending} onSave={saveEditor} />}><Form form={form} layout="vertical" onFinish={(values) => { void saveEditor(values).catch(() => undefined); }}>
      {editor === "dictionary" && <><Form.Item name="code" label={t("字典编码")}><Input disabled={Boolean(editingDictionary)} /></Form.Item><Form.Item name="name" label={t("字典名称")}><Input /></Form.Item><Form.Item name="module" label={t("模块")}><Input /></Form.Item><Form.Item name="description" label={t("说明")}><Input.TextArea /></Form.Item><Typography.Text type="secondary">{t("字典项目继续保留当前")} {editingDictionary?.items.length ?? 0} {t("项")}</Typography.Text></>}
      {editor === "number" && <><Form.Item name="code" label={t("规则编码")}><Input disabled={Boolean(editingNumber)} /></Form.Item><Form.Item name="name" label={t("规则名称")}><Input /></Form.Item><Form.Item name="module" label={t("模块")}><Input /></Form.Item><Row gutter={12}><Col span={8}><Form.Item name="prefix" label={t("前缀")}><Input /></Form.Item></Col><Col span={8}><Form.Item name="datePattern" label={t("日期格式")}><Select options={["yyyyMMdd", "yyyyMM", "yyMMdd", "none"].map((value) => ({ value, label: value }))} /></Form.Item></Col><Col span={8}><Form.Item name="sequenceLength" label={t("序号长度")}><InputNumber min={1} /></Form.Item></Col></Row><Form.Item name="resetCycle" label={t("重置周期")}><Select options={["daily", "monthly", "yearly", "never"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="enabled" label={t("启用")} valuePropName="checked"><Switch /></Form.Item></>}
      {editor === "preset" && <><Form.Item name="scopeKey" label={t("作用域")}><Select options={["rental-os.orders", "rental-os.vehicles", "rental-os.members", "rental-os.corporates", "rental-os.stations", "rental-os.vehicle-transfer", "rental-os.contracts"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="name" label={t("预设名称")}><Input /></Form.Item><Form.Item name="description" label={t("说明")}><Input /></Form.Item><Form.Item name="filtersText" label={t("筛选 JSON")}><Input.TextArea rows={8} /></Form.Item><Form.Item name="isDefault" label={t("设为默认")} valuePropName="checked"><Switch /></Form.Item></>}
      {editor === "file" && <><Form.Item name="businessModule" label={t("业务模块")}><Input /></Form.Item><Form.Item name="businessType" label={t("业务类型")}><Input /></Form.Item><Form.Item name="businessId" label={t("业务 ID")}><Input /></Form.Item><Form.Item name="fileName" label={t("文件名")}><Input /></Form.Item><Form.Item name="mimeType" label={t("MIME 类型")}><Input /></Form.Item><Form.Item name="sizeBytes" label={t("大小")}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item><Form.Item name="uploadScene" label={t("上传场景")}><Input /></Form.Item></>}
      {editor === "print" && <><Form.Item name="documentType" label={t("文档类型")}><Select options={["pickup_sheet", "return_sheet", "rental_contract", "invoice"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="templateCode" label={t("模板编码")}><Input /></Form.Item><Form.Item name="businessType" label={t("业务类型")}><Input /></Form.Item><Form.Item name="businessId" label={t("业务 ID")}><Input /></Form.Item></>}
      {editor === "job" && <><Form.Item name="jobType" label={t("任务类型")}><Input /></Form.Item><Form.Item name="businessType" label={t("业务类型")}><Input /></Form.Item><Form.Item name="businessId" label={t("业务 ID")}><Input /></Form.Item><Form.Item name="scheduledAt" label={t("计划时间")}><Input placeholder={t("ISO 时间，留空立即执行")} /></Form.Item></>}
    </Form></Drawer>
  </>;}
