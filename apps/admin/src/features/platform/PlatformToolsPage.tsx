import { ListFilters, useListFilter } from "@/components/ui";
import { DeleteOutlined, PlayCircleOutlined, PlusOutlined } from "@/components/ui/icons";
import type {
  CreateAsyncJobRequest,
  CreateFileAssetRequest,
  CreatePrintJobRequest,
  PlatformFilterPreset,
  SavePlatformFilterPresetRequest,
} from "@rental-os/shared";
import { InputNumber, Space, Tag, Typography } from "antd";
import { ListSection, App } from "@/components/ui";
import { Form } from "@/components/ui";
import { Table } from "@/components/ui";
import { Switch } from "@/components/ui";
import { Input } from "@/components/ui";
import { Select } from "@/components/ui";
import { Alert, Button, Drawer, SaveButton, Tabs } from "@/components/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { platformOpsApi } from "@/api/platformOps";
import { PageHeader } from "@/components/PageHeader";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { usePlatformToolsTabs } from "@rental-os/platform-admin/platform-tools";

type Editor = "preset" | "file" | "print" | "job" | undefined;

export function PlatformToolsPage() {
  const { t } = useLocale();
  const isSaas = useAuthStore(state => Boolean(state.user?.isSaasAdmin));
  // Do not start tenant queries before checking the audience. Parameter permission does not grant these APIs.
  if (isSaas) return <>
    <PageHeader title={t("平台工具与治理")} />
    <Alert type="info" showIcon title={t("这些工具暂不向平台账号开放")} description={t("字典、编号规则、筛选预设、文件与任务仍属于租户工具。当前平台入口不会读取租户资料或执行工具操作。")}/>
  </>;
  return <TenantToolsWorkspace />;
}

function TenantToolsWorkspace() {
  const { message } = App.useApp();
  const { t } = useLocale();
  const operator = useAuthStore((state) => state.user?.displayName) ?? t("租户管理员");
  const queryClient = useQueryClient();
  const dictionaryNumbers = usePlatformToolsTabs();
  const [editor, setEditor] = useState<Editor>();
  const [editingPreset, setEditingPreset] = useState<PlatformFilterPreset>();
  const [form] = Form.useForm<Record<string, unknown>>();

  const presets = useQuery({ queryKey: ["platform-filter-presets"], queryFn: () => platformOpsApi.filterPresets({}) });
  const presetFilter = useListFilter(presets.data, { fields: row => [row.name, row.scopeKey] });
  const files = useQuery({ queryKey: ["files", "platform-tools"], queryFn: platformOpsApi.fileAssets });
  const printJobs = useQuery({ queryKey: ["print-jobs"], queryFn: platformOpsApi.printJobs });
  const notifications = useQuery({ queryKey: ["notification-logs", "platform-tools"], queryFn: platformOpsApi.notificationLogs });
  const templates = useQuery({ queryKey: ["notification-templates"], queryFn: platformOpsApi.notificationTemplates });
  const jobs = useQuery({ queryKey: ["async-jobs", "platform-tools"], queryFn: platformOpsApi.asyncJobs });

  const closeEditor = () => { setEditor(undefined); setEditingPreset(undefined); form.resetFields(); };
  const savePreset = useMutation({ mutationFn: (values: SavePlatformFilterPresetRequest & { filtersText?: string }) => platformOpsApi.saveFilterPreset({ ...values, id: editingPreset?.id, filters: JSON.parse(values.filtersText || "{}"), operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["platform-filter-presets"] }); closeEditor(); message.success(t("筛选预设已保存")); }, onError: () => message.error(t("筛选预设保存失败，请检查 JSON")) });
  const presetDefault = useMutation({ mutationFn: (id: string) => platformOpsApi.setFilterPresetDefault(id, operator), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["platform-filter-presets"] }); message.success(t("默认预设已更新")); }, onError: () => message.error(t("默认预设更新失败")) });
  const presetDelete = useMutation({ mutationFn: (id: string) => platformOpsApi.deleteFilterPreset(id, operator), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["platform-filter-presets"] }); message.success(t("预设已删除")); }, onError: () => message.error(t("系统预设不能删除")) });
  const createFile = useMutation({ mutationFn: (values: CreateFileAssetRequest) => platformOpsApi.createFileAsset({ ...values, uploadedBy: operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["files"] }); closeEditor(); message.success(t("文件资产记录已创建")); }, onError: () => message.error(t("文件资产创建失败")) });
  const createPrint = useMutation({ mutationFn: (values: CreatePrintJobRequest) => platformOpsApi.createPrintJob({ ...values, operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["print-jobs"] }); closeEditor(); message.success(t("打印任务已创建")); }, onError: () => message.error(t("打印任务创建失败")) });
  const createJob = useMutation({ mutationFn: (values: CreateAsyncJobRequest) => platformOpsApi.createAsyncJob({ ...values, operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["async-jobs"] }); closeEditor(); message.success(t("异步任务已创建")); }, onError: () => message.error(t("异步任务创建失败")) });
  const runJob = useMutation({ mutationFn: platformOpsApi.runJob, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["async-jobs"] }); message.success(t("任务已执行")); }, onError: () => message.error(t("任务执行失败")) });
  const runDue = useMutation({ mutationFn: platformOpsApi.runDueJobs, onSuccess: async (result) => { await queryClient.invalidateQueries({ queryKey: ["async-jobs"] }); message.success(result.message); }, onError: () => message.error(t("到期任务执行失败")) });

  async function saveEditor(values: Record<string, unknown>) {
    if (editor === "preset") return savePreset.mutateAsync(values as unknown as SavePlatformFilterPresetRequest & { filtersText?: string });
    if (editor === "file") return createFile.mutateAsync(values as unknown as CreateFileAssetRequest);
    if (editor === "print") return createPrint.mutateAsync(values as unknown as CreatePrintJobRequest);
    if (editor === "job") return createJob.mutateAsync(values as unknown as CreateAsyncJobRequest);
    throw new Error("Platform editor unavailable");
  }

  function editPreset(record?: PlatformFilterPreset) { setEditingPreset(record); form.setFieldsValue(record ? { ...record, filtersText: JSON.stringify(record.filters, null, 2) } : { scopeKey: "rental-os.orders", name: "", description: "", filtersText: "{}", isDefault: false }); setEditor("preset"); }

  return <>
    <PageHeader title={t("平台工具与治理")} />
    <ListSection><Tabs className="standalone-tabs" items={[
      { key: "governance", label: t("平台治理"), children: <Tabs items={[
        ...dictionaryNumbers.items,
        { key: "presets", label: `${t("筛选预设")} ${presets.data?.length ?? 0}`, children: <><Table toolbar={<><ListFilters filter={presetFilter} placeholder="预设名称或范围" /><Button icon={<PlusOutlined />} onClick={() => editPreset()}>{t("新增预设")}</Button></>} rowKey="id" onRefresh={() => presets.refetch()} loading={presets.isLoading} refreshing={presets.isFetching} dataSource={presetFilter.rows} pagination={presetFilter.pagination} columns={[{ title: t("预设"), render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.scopeKey}</span></> }, { title: t("默认"), dataIndex: "isDefault", render: (value) => value ? <Tag color="success">{t("默认")}</Tag> : "—" }, { title: t("系统"), dataIndex: "isSystem", render: (value) => value ? t("是") : t("否") }, { title: t("更新人"), dataIndex: "updatedBy" }, { title: t("操作"), render: (_, record) => <Space size={0}><Button type="link" onClick={() => editPreset(record)}>{t("编辑")}</Button>{!record.isDefault && <Button type="link" onClick={() => presetDefault.mutate(record.id)}>{t("设默认")}</Button>}{!record.isSystem && <Button type="link" danger icon={<DeleteOutlined />} onClick={() => presetDelete.mutate(record.id)}>{t("删除")}</Button>}</Space> }]} /></> }
      ]} /> },
      { key: "infra", label: t("文件与任务"), children: <Tabs items={[
        { key: "files", label: `${t("文件")} ${files.data?.length ?? 0}`, children: <><Table toolbar={<><Button icon={<PlusOutlined />} onClick={() => { form.setFieldsValue({ businessModule: "rental-os", businessType: "general", fileName: "", mimeType: "application/pdf", sizeBytes: 0, uploadScene: "manual" }); setEditor("file"); }}>{t("新增文件")}</Button></>} toolbarNote={<><Typography.Text type="secondary">{t("这里登记文件元数据，真实上传仍取决于文件提供方。")}</Typography.Text></>} rowKey="id" onRefresh={() => files.refetch()} loading={files.isLoading} refreshing={files.isFetching} dataSource={files.data ?? []} columns={[{ title: t("文件"), dataIndex: "fileName" }, { title: t("业务"), render: (_, record) => `${record.businessModule} / ${record.businessType}` }, { title: t("类型"), dataIndex: "mimeType" }, { title: t("大小"), dataIndex: "sizeBytes" }, { title: t("存储"), dataIndex: "storageProvider" }, { title: t("状态"), dataIndex: "status", render: (value) => <Tag>{value}</Tag> }]} /></> },
        { key: "print", label: `${t("打印任务")} ${printJobs.data?.length ?? 0}`, children: <><Table toolbar={<><Button icon={<PlusOutlined />} onClick={() => { form.setFieldsValue({ documentType: "rental_contract", templateCode: "default", businessType: "rental_order", businessId: "" }); setEditor("print"); }}>{t("新建打印任务")}</Button></>} toolbarNote={<><Typography.Text type="secondary">{t("打印结果取决于当前 mock/reserved 提供方。")}</Typography.Text></>} rowKey="id" onRefresh={() => printJobs.refetch()} loading={printJobs.isLoading} refreshing={printJobs.isFetching} dataSource={printJobs.data ?? []} columns={[{ title: t("任务"), dataIndex: "jobNo" }, { title: t("文档类型"), dataIndex: "documentType" }, { title: t("模板"), dataIndex: "templateCode" }, { title: t("状态"), dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: t("创建时间"), dataIndex: "createdAt" }]} /></> },
        { key: "jobs", label: `${t("异步任务")} ${jobs.data?.length ?? 0}`, children: <><Table toolbar={<><Button icon={<PlusOutlined />} onClick={() => { form.setFieldsValue({ jobType: "manual_job", businessType: "platform", businessId: "", scheduledAt: "" }); setEditor("job"); }}>{t("新建任务")}</Button><Button icon={<PlayCircleOutlined />} loading={runDue.isPending} onClick={() => runDue.mutate()}>{t("执行到期任务")}</Button></>} rowKey="id" onRefresh={() => jobs.refetch()} loading={jobs.isLoading} refreshing={jobs.isFetching} dataSource={jobs.data ?? []} columns={[{ title: t("任务类型"), dataIndex: "jobType" }, { title: t("业务"), render: (_, record) => `${record.businessType ?? "—"} / ${record.businessId ?? "—"}` }, { title: t("计划时间"), dataIndex: "scheduledAt", render: (value) => value ?? t("立即") }, { title: t("状态"), dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: t("操作"), render: (_, record) => <Button type="link" icon={<PlayCircleOutlined />} disabled={record.status === "running"} onClick={() => runJob.mutate(record.id)}>{t("执行")}</Button> }]} /></> },
        { key: "notifications", label: `${t("通知")} ${notifications.data?.length ?? 0}`, children: <><Table rowKey="id" onRefresh={() => notifications.refetch()} loading={notifications.isLoading} refreshing={notifications.isFetching} dataSource={notifications.data ?? []} columns={[{ title: t("模板"), dataIndex: "templateCode" }, { title: t("业务"), dataIndex: "businessType" }, { title: t("接收方"), dataIndex: "targetName" }, { title: t("渠道"), dataIndex: "channels", render: (values: string[]) => values.join(" / ") }, { title: t("提供方"), dataIndex: "provider" }, { title: t("状态"), dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: t("时间"), dataIndex: "createdAt" }]} /></> }
      ]} /> },
    ]} /></ListSection>

    {dictionaryNumbers.overlay}
    <Drawer presentation={editor === "print" || editor === "job" ? "dialog" : "side"} title={t("平台工具操作")} open={Boolean(editor)} size={600} destroyOnHidden onClose={closeEditor} extra={<SaveButton form={form} label={t("保存")} pending={ savePreset.isPending || createFile.isPending || createPrint.isPending || createJob.isPending} onSave={saveEditor} />}><Form form={form} layout="vertical" onFinish={(values) => { void saveEditor(values).catch(() => undefined); }}>
      {editor === "preset" && <><Form.Item name="scopeKey" label={t("作用域")}><Select options={["rental-os.orders", "rental-os.vehicles", "rental-os.members", "rental-os.corporates", "rental-os.stations", "rental-os.vehicle-transfer", "rental-os.contracts"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="name" label={t("预设名称")}><Input /></Form.Item><Form.Item name="description" label={t("说明")}><Input /></Form.Item><Form.Item name="filtersText" label={t("筛选 JSON")}><Input.TextArea rows={8} /></Form.Item><Form.Item name="isDefault" label={t("设为默认")} valuePropName="checked"><Switch /></Form.Item></>}
      {editor === "file" && <><Form.Item name="businessModule" label={t("业务模块")}><Input /></Form.Item><Form.Item name="businessType" label={t("业务类型")}><Input /></Form.Item><Form.Item name="businessId" label={t("业务 ID")}><Input /></Form.Item><Form.Item name="fileName" label={t("文件名")}><Input /></Form.Item><Form.Item name="mimeType" label={t("MIME 类型")}><Input /></Form.Item><Form.Item name="sizeBytes" label={t("大小")}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item><Form.Item name="uploadScene" label={t("上传场景")}><Input /></Form.Item></>}
      {editor === "print" && <><Form.Item name="documentType" label={t("文档类型")}><Select options={["pickup_sheet", "return_sheet", "rental_contract", "invoice"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="templateCode" label={t("模板编码")}><Input /></Form.Item><Form.Item name="businessType" label={t("业务类型")}><Input /></Form.Item><Form.Item name="businessId" label={t("业务 ID")}><Input /></Form.Item></>}
      {editor === "job" && <><Form.Item name="jobType" label={t("任务类型")}><Input /></Form.Item><Form.Item name="businessType" label={t("业务类型")}><Input /></Form.Item><Form.Item name="businessId" label={t("业务 ID")}><Input /></Form.Item><Form.Item name="scheduledAt" label={t("计划时间")}><Input placeholder={t("ISO 时间，留空立即执行")} /></Form.Item></>}
    </Form></Drawer>
  </>;}
