/** 原组织列表与编辑器。请求、范围和缓存代次来自宿主，原后台可嵌入同一组件。 */
import type { OrganizationSummary, SaveOrganizationRequest } from "@rental-os/platform-contracts";
import { Tag } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale } from "../../app/locale";
import { useServerFormSync } from "../../app/useServerFormSync";
import { PageHeading } from "../../components/PageHeading";
import { QueryState } from "../../components/QueryState";
import { WorkspacePageActions } from "../../components/workspace/WorkspaceHeader";
import { Alert, App, Button, Drawer, Form, Input, ListFilters, Result, SaveButton, Select, Switch, Table, useListFilter } from "../../components/ui";
import { EditOutlined, PlusOutlined } from "../../components/ui/icons";
import { useAdminRuntime, useAdminSession } from "../../runtime";
import { usePlatformSettingsApi } from "./client";
import { canReadOrganizations, canWriteOrganizations } from "./platformSettingsAccess";

export function useOrganizationsQuery() {
  const api = usePlatformSettingsApi();
  const runtime = useAdminRuntime();
  const { sessionVerified, user } = useAdminSession();
  return useQuery({
    queryKey: ["platform-organizations", runtime.currentSessionEpoch()],
    queryFn: ({ signal }) => api.organizations(signal),
    enabled: sessionVerified && canReadOrganizations(user),
    meta: { liveRefresh: false }
  });
}

export function OrganizationsPage({ embedded = false, onSaved }: { embedded?: boolean; onSaved?: () => Promise<unknown> }) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const { user, tenant, sessionVerified } = useAdminSession();
  const runtime = useAdminRuntime();
  const api = usePlatformSettingsApi();
  const queryClient = useQueryClient();
  const organizations = useOrganizationsQuery();
  const filter = useListFilter(organizations.data, { fields: row => [row.name, row.code] });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OrganizationSummary>();
  const [form] = Form.useForm<SaveOrganizationRequest>();
  const pending = useRef<Promise<OrganizationSummary> | null>(null);
  const epoch = runtime.currentSessionEpoch();
  const canWrite = sessionVerified && canWriteOrganizations(user);
  const source = useMemo(() => editing
    ? organizations.data?.find(row => row.id === editing.id)
    : { tenantId: user?.tenantId, type: "store", code: "", name: "", status: "enabled" }, [editing, organizations.data, user?.tenantId]);
  const isCurrent = useServerFormSync(form, source, () => {
    if (source) form.setFieldsValue(source as SaveOrganizationRequest);
  }, `${epoch}:${open}:${editing?.id ?? "new"}`);

  useEffect(() => { setOpen(false); setEditing(undefined); form.resetFields(); }, [epoch, form]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["platform-organizations", epoch] }, { throwOnError: true });
    await onSaved?.();
  }

  const save = useMutation({
    mutationFn: async (values: SaveOrganizationRequest) => {
      const current = runtime.getSession();
      if (runtime.currentSessionEpoch() !== epoch || !current.sessionVerified || !canWriteOrganizations(current.user) || current.user?.tenantId !== values.tenantId)
        throw new Error(t("当前没有组织维护权限"));
      if (!isCurrent() || editing && !source) throw new Error(t("服务端配置已变更，请重新打开本页核对后再保存"));
      return api.saveOrganization({ ...values, id: editing?.id, operator: current.user?.displayName ?? t("租户管理员") });
    },
    onSuccess: async () => {
      if (runtime.currentSessionEpoch() !== epoch) return;
      setOpen(false);
      message.success(t("组织已保存"));
      try { await refresh(); } catch { message.warning(t("组织已保存，列表刷新失败，请重新读取。")); }
    },
    onError: () => message.error(t("组织保存失败，请检查编码和层级"))
  });
  const status = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => {
      const current = runtime.getSession();
      if (runtime.currentSessionEpoch() !== epoch || !current.sessionVerified || !canWriteOrganizations(current.user)) throw new Error(t("当前没有组织维护权限"));
      return api.setOrganizationStatus(id, enabled ? "enabled" : "disabled", current.user?.displayName ?? t("租户管理员"));
    },
    onSuccess: async () => {
      if (runtime.currentSessionEpoch() !== epoch) return;
      message.success(t("组织状态已更新"));
      try { await refresh(); } catch { message.warning(t("组织状态已更新，列表刷新失败，请重新读取。")); }
    },
    onError: () => message.error(t("组织状态更新失败，请检查下级组织和关联账号"))
  });

  function submit(values: SaveOrganizationRequest) {
    if (pending.current) return pending.current;
    const request = save.mutateAsync(values);
    pending.current = request;
    void request.finally(() => { if (pending.current === request) pending.current = null; }).catch(() => undefined);
    return request;
  }

  function edit(record?: OrganizationSummary) {
    form.resetFields();
    setEditing(record);
    save.reset();
    setOpen(true);
  }

  if (!sessionVerified || !canReadOrganizations(user)) return <Result status="403" title="403" />;
  const action = canWrite && <Button type="primary" icon={<PlusOutlined />} disabled={save.isPending || status.isPending} onClick={() => edit()}>{t("新增组织")}</Button>;
  return <>
    {embedded ? <WorkspacePageActions>{action}</WorkspacePageActions> : <PageHeading title={t("组织管理")} brandName={tenant?.tenantName ?? "Nativark"} extra={action} />}
    <QueryState loading={organizations.isLoading} error={organizations.error} onRetry={() => organizations.refetch({ throwOnError: true })}>
      <Table<OrganizationSummary> toolbar={<ListFilters filter={filter} placeholder={t("组织名称或编码")} />} rowKey="id"
        onRefresh={() => organizations.refetch({ throwOnError: true })} loading={organizations.isLoading} refreshing={organizations.isFetching}
        dataSource={filter.rows} pagination={filter.pagination} columns={[
          { title: t("组织"), render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.code}</span></> },
          { title: t("类型"), dataIndex: "type", render: value => <Tag>{t(String(value))}</Tag> },
          { title: t("上级组织"), dataIndex: "parentId", render: value => organizations.data?.find(row => row.id === value)?.name ?? t("根组织") },
          { title: t("状态"), render: (_, record) => <Switch checked={record.status === "enabled"} disabled={!canWrite || save.isPending || status.isPending}
            loading={status.isPending} onChange={enabled => { void status.mutateAsync({ id: record.id, enabled }).catch(() => undefined); }} /> },
          { title: t("操作"), render: (_, record) => <Button type="link" icon={<EditOutlined />} disabled={!canWrite || status.isPending} onClick={() => edit(record)}>{t("编辑")}</Button> }
        ]} />
    </QueryState>
    <Drawer presentation="dialog" title={t(editing ? "编辑组织" : "新增组织")} open={open} size={500} destroyOnHidden
      closable={!save.isPending} onClose={() => setOpen(false)} afterOpenChange={visible => { if (!visible) { setEditing(undefined); form.resetFields(); } }}
      extra={<SaveButton label={t("保存")} form={form} pending={save.isPending} disabled={!canWrite || !source} onSave={submit} />}>
      <Form form={form} layout="vertical" disabled={!canWrite || save.isPending} onFinish={values => { void submit(values).catch(() => undefined); }}>
        <Form.Item name="tenantId" hidden><Input /></Form.Item>
        <Form.Item name="name" label={t("组织名称")} rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="code" label={t("组织编码")} rules={[{ required: true }]}><Input disabled={Boolean(editing)} /></Form.Item>
        <Form.Item name="type" label={t("组织类型")} rules={[{ required: true }]}><Select options={[
          { value: "operator", label: t("营运中心") }, { value: "car_shop", label: t("业务公司") },
          { value: "store", label: t("门店") }, { value: "station", label: t("履约点") }
        ]} /></Form.Item>
        <Form.Item name="parentId" label={t("上级组织")}><Select allowClear options={(organizations.data ?? []).filter(row => row.id !== editing?.id).map(row => ({ value: row.id, label: row.name }))} /></Form.Item>
        <Form.Item name="status" label={t("状态")}><Select options={[{ value: "enabled", label: t("启用") }, { value: "disabled", label: t("停用") }]} /></Form.Item>
        {save.error && <Alert type="error" showIcon title={save.error.message} />}
      </Form>
    </Drawer>
  </>;
}
