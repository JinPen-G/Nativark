import { DeleteOutlined, PlayCircleOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
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
} from "@store-rental/shared";
import { App, Button, Card, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  createAsyncJob,
  createFileAsset,
  createPrintJob,
  deletePlatformFilterPreset,
  generatePlatformNumber,
  listAsyncJobs,
  listFileAssets,
  listNotificationLogs,
  listNotificationTemplates,
  listPlatformDictionaries,
  listPlatformFilterPresets,
  listPlatformNumberRules,
  listPrintJobs,
  runAsyncJob,
  runDueAsyncJobs,
  savePlatformDictionary,
  savePlatformFilterPreset,
  savePlatformNumberRule,
  setPlatformFilterPresetDefault
} from "@/api/operations";
import { PageHeader } from "@/components/PageHeader";
import { useAuthStore } from "@/features/auth/authStore";

type Editor = "dictionary" | "number" | "preset" | "file" | "print" | "job" | undefined;

export function PlatformToolsPage() {
  const { message, modal } = App.useApp();
  const operator = useAuthStore((state) => state.user?.displayName ?? "租户管理员");
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<Editor>();
  const [editingDictionary, setEditingDictionary] = useState<PlatformDictionaryGroup>();
  const [editingNumber, setEditingNumber] = useState<PlatformNumberRule>();
  const [editingPreset, setEditingPreset] = useState<PlatformFilterPreset>();
  const [form] = Form.useForm<Record<string, unknown>>();

  const dictionaries = useQuery({ queryKey: ["platform-dictionaries"], queryFn: listPlatformDictionaries });
  const numbers = useQuery({ queryKey: ["platform-number-rules"], queryFn: listPlatformNumberRules });
  const presets = useQuery({ queryKey: ["platform-filter-presets"], queryFn: () => listPlatformFilterPresets({}) });
  const files = useQuery({ queryKey: ["files", "platform-tools"], queryFn: listFileAssets });
  const printJobs = useQuery({ queryKey: ["print-jobs"], queryFn: listPrintJobs });
  const notifications = useQuery({ queryKey: ["notification-logs", "platform-tools"], queryFn: listNotificationLogs });
  const templates = useQuery({ queryKey: ["notification-templates"], queryFn: listNotificationTemplates });
  const jobs = useQuery({ queryKey: ["async-jobs", "platform-tools"], queryFn: listAsyncJobs });

  const closeEditor = () => { setEditor(undefined); setEditingDictionary(undefined); setEditingNumber(undefined); setEditingPreset(undefined); form.resetFields(); };
  const saveDictionary = useMutation({ mutationFn: (values: SavePlatformDictionaryGroupRequest) => savePlatformDictionary({ ...values, items: editingDictionary?.items ?? [], operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["platform-dictionaries"] }); closeEditor(); message.success("数据字典已保存"); }, onError: () => message.error("字典保存失败") });
  const saveNumber = useMutation({ mutationFn: (values: SavePlatformNumberRuleRequest) => savePlatformNumberRule({ ...values, operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["platform-number-rules"] }); closeEditor(); message.success("编号规则已保存"); }, onError: () => message.error("编号规则保存失败") });
  const generateNumber = useMutation({ mutationFn: (code: string) => generatePlatformNumber(code, operator), onSuccess: (result) => modal.success({ title: "编号生成成功", content: <Typography.Text code copyable>{result.generatedNo}</Typography.Text> }), onError: () => message.error("编号生成失败") });
  const savePreset = useMutation({ mutationFn: (values: SavePlatformFilterPresetRequest & { filtersText?: string }) => savePlatformFilterPreset({ ...values, id: editingPreset?.id, filters: JSON.parse(values.filtersText || "{}"), operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["platform-filter-presets"] }); closeEditor(); message.success("筛选预设已保存"); }, onError: () => message.error("筛选预设保存失败，请检查 JSON") });
  const presetDefault = useMutation({ mutationFn: (id: string) => setPlatformFilterPresetDefault(id, operator), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["platform-filter-presets"] }); message.success("默认预设已更新"); }, onError: () => message.error("默认预设更新失败") });
  const presetDelete = useMutation({ mutationFn: (id: string) => deletePlatformFilterPreset(id, operator), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["platform-filter-presets"] }); message.success("预设已删除"); }, onError: () => message.error("系统预设不能删除") });
  const createFile = useMutation({ mutationFn: (values: CreateFileAssetRequest) => createFileAsset({ ...values, uploadedBy: operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["files"] }); closeEditor(); message.success("文件资产记录已创建"); }, onError: () => message.error("文件资产创建失败") });
  const createPrint = useMutation({ mutationFn: (values: CreatePrintJobRequest) => createPrintJob({ ...values, operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["print-jobs"] }); closeEditor(); message.success("打印任务已创建"); }, onError: () => message.error("打印任务创建失败") });
  const createJob = useMutation({ mutationFn: (values: CreateAsyncJobRequest) => createAsyncJob({ ...values, operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["async-jobs"] }); closeEditor(); message.success("异步任务已创建"); }, onError: () => message.error("异步任务创建失败") });
  const runJob = useMutation({ mutationFn: runAsyncJob, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["async-jobs"] }); message.success("任务已执行"); }, onError: () => message.error("任务执行失败") });
  const runDue = useMutation({ mutationFn: runDueAsyncJobs, onSuccess: async (result) => { await queryClient.invalidateQueries({ queryKey: ["async-jobs"] }); message.success(result.message); }, onError: () => message.error("到期任务执行失败") });

  function editDictionary(record?: PlatformDictionaryGroup) { setEditingDictionary(record); form.setFieldsValue(record ? { ...record } : { code: "", name: "", module: "platform", description: "" }); setEditor("dictionary"); }
  function editNumber(record?: PlatformNumberRule) { setEditingNumber(record); form.setFieldsValue(record ? { ...record } : { code: "", name: "", module: "platform", prefix: "", datePattern: "yyyyMMdd", sequenceLength: 6, currentSequence: 0, resetCycle: "daily", enabled: true }); setEditor("number"); }
  function editPreset(record?: PlatformFilterPreset) { setEditingPreset(record); form.setFieldsValue(record ? { ...record, filtersText: JSON.stringify(record.filters, null, 2) } : { scopeKey: "store-rental.orders", name: "", description: "", filtersText: "{}", isDefault: false }); setEditor("preset"); }

  return <>
    <PageHeader title="平台工具与治理" description="维护租户初始化模板、字典、编号、筛选预设、文件与任务。" />
    <Card className="tabbed-workspace"><Tabs className="standalone-tabs" items={[
      { key: "governance", label: "平台治理", children: <Tabs items={[
        { key: "dictionaries", label: `数据字典 ${dictionaries.data?.length ?? 0}`, children: <><div className="table-toolbar"><Typography.Text type="secondary">字典项目保持现有值，编辑主属性不会丢失项目。</Typography.Text><Button icon={<PlusOutlined />} onClick={() => editDictionary()}>新增字典</Button></div><Table rowKey="code" dataSource={dictionaries.data ?? []} columns={[{ title: "字典", render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.code}</span></> }, { title: "模块", dataIndex: "module" }, { title: "项目数", dataIndex: "items", render: (values) => values.length }, { title: "更新人", dataIndex: "updatedBy" }, { title: "操作", render: (_, record) => <Button type="link" onClick={() => editDictionary(record)}>编辑</Button> }]} /></> },
        { key: "numbers", label: `编号规则 ${numbers.data?.length ?? 0}`, children: <><div className="table-toolbar"><Typography.Text type="secondary">生成操作会推进当前序号。</Typography.Text><Button icon={<PlusOutlined />} onClick={() => editNumber()}>新增规则</Button></div><Table rowKey="code" dataSource={numbers.data ?? []} columns={[{ title: "规则", render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.code}</span></> }, { title: "前缀", dataIndex: "prefix" }, { title: "日期", dataIndex: "datePattern" }, { title: "当前序号", dataIndex: "currentSequence" }, { title: "示例", dataIndex: "sample" }, { title: "启用", dataIndex: "enabled", render: (value) => <Tag color={value ? "success" : "default"}>{value ? "是" : "否"}</Tag> }, { title: "操作", render: (_, record) => <Space size={0}><Button type="link" onClick={() => editNumber(record)}>编辑</Button><Button type="link" onClick={() => generateNumber.mutate(record.code)}>生成</Button></Space> }]} /></> },
        { key: "presets", label: `筛选预设 ${presets.data?.length ?? 0}`, children: <><div className="table-toolbar"><Typography.Text type="secondary">各业务列表可复用这些服务端筛选条件。</Typography.Text><Button icon={<PlusOutlined />} onClick={() => editPreset()}>新增预设</Button></div><Table rowKey="id" dataSource={presets.data ?? []} columns={[{ title: "预设", render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.scopeKey}</span></> }, { title: "默认", dataIndex: "isDefault", render: (value) => value ? <Tag color="success">默认</Tag> : "—" }, { title: "系统", dataIndex: "isSystem", render: (value) => value ? "是" : "否" }, { title: "更新人", dataIndex: "updatedBy" }, { title: "操作", render: (_, record) => <Space size={0}><Button type="link" onClick={() => editPreset(record)}>编辑</Button>{!record.isDefault && <Button type="link" onClick={() => presetDefault.mutate(record.id)}>设默认</Button>}{!record.isSystem && <Button type="link" danger icon={<DeleteOutlined />} onClick={() => presetDelete.mutate(record.id)}>删除</Button>}</Space> }]} /></> }
      ]} /> },
      { key: "infra", label: "文件与任务", children: <Tabs items={[
        { key: "files", label: `文件 ${files.data?.length ?? 0}`, children: <><div className="table-toolbar"><Typography.Text type="secondary">这里登记文件元数据，真实上传仍取决于文件提供方。</Typography.Text><Button icon={<PlusOutlined />} onClick={() => { form.setFieldsValue({ businessModule: "store-rental", businessType: "general", fileName: "", mimeType: "application/pdf", sizeBytes: 0, uploadScene: "manual" }); setEditor("file"); }}>新增文件</Button></div><Table rowKey="id" dataSource={files.data ?? []} columns={[{ title: "文件", dataIndex: "fileName" }, { title: "业务", render: (_, record) => `${record.businessModule} / ${record.businessType}` }, { title: "类型", dataIndex: "mimeType" }, { title: "大小", dataIndex: "sizeBytes" }, { title: "存储", dataIndex: "storageProvider" }, { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }]} /></> },
        { key: "print", label: `打印任务 ${printJobs.data?.length ?? 0}`, children: <><div className="table-toolbar"><Typography.Text type="secondary">打印结果取决于当前 mock/reserved 提供方。</Typography.Text><Button icon={<PlusOutlined />} onClick={() => { form.setFieldsValue({ documentType: "rental_contract", templateCode: "default", businessType: "store_rental_order", businessId: "" }); setEditor("print"); }}>新建打印任务</Button></div><Table rowKey="id" dataSource={printJobs.data ?? []} columns={[{ title: "任务", dataIndex: "jobNo" }, { title: "文档类型", dataIndex: "documentType" }, { title: "模板", dataIndex: "templateCode" }, { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: "创建时间", dataIndex: "createdAt" }]} /></> },
        { key: "jobs", label: `异步任务 ${jobs.data?.length ?? 0}`, children: <><div className="table-toolbar"><Space><Button icon={<PlusOutlined />} onClick={() => { form.setFieldsValue({ jobType: "manual_job", businessType: "platform", businessId: "", scheduledAt: "" }); setEditor("job"); }}>新建任务</Button><Button icon={<ReloadOutlined />} loading={runDue.isPending} onClick={() => runDue.mutate()}>执行到期任务</Button></Space></div><Table rowKey="id" dataSource={jobs.data ?? []} columns={[{ title: "任务类型", dataIndex: "jobType" }, { title: "业务", render: (_, record) => `${record.businessType ?? "—"} / ${record.businessId ?? "—"}` }, { title: "计划时间", dataIndex: "scheduledAt", render: (value) => value ?? "立即" }, { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: "操作", render: (_, record) => <Button type="link" icon={<PlayCircleOutlined />} disabled={record.status === "running"} onClick={() => runJob.mutate(record.id)}>执行</Button> }]} /></> },
        { key: "notifications", label: `通知 ${notifications.data?.length ?? 0}`, children: <><Typography.Paragraph type="secondary">已配置 {templates.data?.length ?? 0} 个通知模板。</Typography.Paragraph><Table rowKey="id" dataSource={notifications.data ?? []} columns={[{ title: "模板", dataIndex: "templateCode" }, { title: "业务", dataIndex: "businessType" }, { title: "接收方", dataIndex: "targetName" }, { title: "渠道", dataIndex: "channels", render: (values: string[]) => values.join(" / ") }, { title: "提供方", dataIndex: "provider" }, { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: "时间", dataIndex: "createdAt" }]} /></> }
      ]} /> },
    ]} /></Card>

    <Drawer title="平台工具操作" open={Boolean(editor)} size={600} destroyOnHidden onClose={closeEditor} extra={<Button type="primary" loading={saveDictionary.isPending || saveNumber.isPending || savePreset.isPending || createFile.isPending || createPrint.isPending || createJob.isPending} onClick={() => form.submit()}>保存</Button>}><Form form={form} layout="vertical" onFinish={(values) => {
      if (editor === "dictionary") saveDictionary.mutate(values as unknown as SavePlatformDictionaryGroupRequest);
      if (editor === "number") saveNumber.mutate(values as unknown as SavePlatformNumberRuleRequest);
      if (editor === "preset") savePreset.mutate(values as unknown as SavePlatformFilterPresetRequest & { filtersText?: string });
      if (editor === "file") createFile.mutate(values as unknown as CreateFileAssetRequest);
      if (editor === "print") createPrint.mutate(values as unknown as CreatePrintJobRequest);
      if (editor === "job") createJob.mutate(values as unknown as CreateAsyncJobRequest);
    }}>
      {editor === "dictionary" && <><Form.Item name="code" label="字典编码"><Input disabled={Boolean(editingDictionary)} /></Form.Item><Form.Item name="name" label="字典名称"><Input /></Form.Item><Form.Item name="module" label="模块"><Input /></Form.Item><Form.Item name="description" label="说明"><Input.TextArea /></Form.Item><Typography.Text type="secondary">字典项目继续保留当前 {editingDictionary?.items.length ?? 0} 项。</Typography.Text></>}
      {editor === "number" && <><Form.Item name="code" label="规则编码"><Input disabled={Boolean(editingNumber)} /></Form.Item><Form.Item name="name" label="规则名称"><Input /></Form.Item><Form.Item name="module" label="模块"><Input /></Form.Item><Row gutter={12}><Col span={8}><Form.Item name="prefix" label="前缀"><Input /></Form.Item></Col><Col span={8}><Form.Item name="datePattern" label="日期格式"><Select options={["yyyyMMdd", "yyyyMM", "yyMMdd", "none"].map((value) => ({ value, label: value }))} /></Form.Item></Col><Col span={8}><Form.Item name="sequenceLength" label="序号长度"><InputNumber min={1} /></Form.Item></Col></Row><Form.Item name="resetCycle" label="重置周期"><Select options={["daily", "monthly", "yearly", "never"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item></>}
      {editor === "preset" && <><Form.Item name="scopeKey" label="作用域"><Select options={["store-rental.orders", "store-rental.vehicles", "store-rental.members", "store-rental.corporates", "store-rental.stations", "store-rental.vehicle-transfer", "store-rental.contracts"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="name" label="预设名称"><Input /></Form.Item><Form.Item name="description" label="说明"><Input /></Form.Item><Form.Item name="filtersText" label="筛选 JSON"><Input.TextArea rows={8} /></Form.Item><Form.Item name="isDefault" label="设为默认" valuePropName="checked"><Switch /></Form.Item></>}
      {editor === "file" && <><Form.Item name="businessModule" label="业务模块"><Input /></Form.Item><Form.Item name="businessType" label="业务类型"><Input /></Form.Item><Form.Item name="businessId" label="业务 ID"><Input /></Form.Item><Form.Item name="fileName" label="文件名"><Input /></Form.Item><Form.Item name="mimeType" label="MIME 类型"><Input /></Form.Item><Form.Item name="sizeBytes" label="大小"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item><Form.Item name="uploadScene" label="上传场景"><Input /></Form.Item></>}
      {editor === "print" && <><Form.Item name="documentType" label="文档类型"><Select options={["pickup_sheet", "return_sheet", "rental_contract", "invoice"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="templateCode" label="模板编码"><Input /></Form.Item><Form.Item name="businessType" label="业务类型"><Input /></Form.Item><Form.Item name="businessId" label="业务 ID"><Input /></Form.Item></>}
      {editor === "job" && <><Form.Item name="jobType" label="任务类型"><Input /></Form.Item><Form.Item name="businessType" label="业务类型"><Input /></Form.Item><Form.Item name="businessId" label="业务 ID"><Input /></Form.Item><Form.Item name="scheduledAt" label="计划时间"><Input placeholder="ISO 时间，留空立即执行" /></Form.Item></>}
    </Form></Drawer>
  </>;}
