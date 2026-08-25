import { EditOutlined, PauseCircleOutlined, PlusOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import type { TenantBootstrapRequest, TenantSummary, UpdateTenantStatusRequest } from "@store-rental/shared";
import { TenantStatus } from "@store-rental/shared";
import { App, Button, Card, Descriptions, Drawer, Form, Input, Modal, Segmented, Select, Space, Table, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  bootstrapTenant,
  getTenantBootstrapPreview,
  listTenants,
  updateTenant,
  updateTenantStatus
} from "@/api/operations";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

type Editor = { type: "create" } | { type: "edit"; tenant: TenantSummary } | { type: "status"; tenant: TenantSummary } | undefined;

const statusMeta = {
  [TenantStatus.Active]: { label: "正常", color: "success" },
  [TenantStatus.Frozen]: { label: "冻结", color: "warning" },
  [TenantStatus.Disabled]: { label: "停用", color: "default" }
} as const;

export function TenantManagementPage() {
  const { message } = App.useApp();
  const operator = useAuthStore((state) => state.user?.displayName ?? "SaaS 平台管理员");
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [editor, setEditor] = useState<Editor>();
  const [form] = Form.useForm<Record<string, unknown>>();

  const tenants = useQuery({ queryKey: ["saas-tenants"], queryFn: listTenants });
  const categories = useQuery({ queryKey: ["rental-categories"], queryFn: rentalCoreApi.categories });
  const preview = useQuery({ queryKey: ["tenant-bootstrap-preview"], queryFn: getTenantBootstrapPreview });

  const rows = useMemo(() => (tenants.data ?? []).filter((tenant) =>
    tenant.tenantCode !== "platform" && (filter === "all" || tenant.tenantStatus === filter)
  ), [filter, tenants.data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["saas-tenants"] });
  const createTenant = useMutation({
    mutationFn: (values: TenantBootstrapRequest) => bootstrapTenant({ ...values, operator }),
    onSuccess: async (result) => {
      await refresh();
      closeEditor();
      Modal.success({
        title: "SaaS 租户已初始化",
        width: 560,
        content: (
          <Descriptions column={1} size="small" bordered items={[
            { key: "tenant", label: "租户", children: `${result.tenant.tenantName}（${result.tenant.tenantCode}）` },
            { key: "category", label: "经营品类", children: result.tenant.categoryCode },
            { key: "account", label: "管理员账号", children: result.adminUser.account },
            { key: "password", label: "一次性临时密码", children: <Typography.Text code copyable>{result.temporaryPassword}</Typography.Text> }
          ]} />
        )
      });
    },
    onError: () => message.error("租户初始化失败，数据库事务已回滚")
  });
  const saveTenant = useMutation({
    mutationFn: ({ id, tenantName }: { id: string; tenantName: string }) => updateTenant(id, { tenantName }),
    onSuccess: async () => { await refresh(); closeEditor(); message.success("租户资料已更新"); },
    onError: () => message.error("租户资料更新失败")
  });
  const changeStatus = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateTenantStatusRequest }) => updateTenantStatus(id, payload),
    onSuccess: async () => { await refresh(); closeEditor(); message.success("租户状态已更新，相关会话已按规则处理"); },
    onError: () => message.error("租户状态更新失败")
  });

  function closeEditor() {
    setEditor(undefined);
    form.resetFields();
  }

  function openCreate() {
    form.setFieldsValue({ tenantCode: "", tenantName: "", categoryCode: undefined, adminAccount: "admin", adminDisplayName: "租户管理员", storeName: "", storeCode: "" });
    setEditor({ type: "create" });
  }

  function openEdit(tenant: TenantSummary) {
    form.setFieldsValue({ tenantName: tenant.tenantName });
    setEditor({ type: "edit", tenant });
  }

  function openStatus(tenant: TenantSummary) {
    form.setFieldsValue({ status: tenant.tenantStatus, reason: "" });
    setEditor({ type: "status", tenant });
  }

  async function submit(values: Record<string, unknown>) {
    if (editor?.type === "create") createTenant.mutate(values as unknown as TenantBootstrapRequest);
    if (editor?.type === "edit") saveTenant.mutate({ id: editor.tenant.tenantId, tenantName: String(values.tenantName ?? "") });
    if (editor?.type === "status") changeStatus.mutate({ id: editor.tenant.tenantId, payload: values as unknown as UpdateTenantStatusRequest });
  }

  return (
    <>
      <PageHeader
        title="SaaS 租户"
        description="管理使用 Rental OS 的经营主体、经营品类和生命周期。"
        view={(
          <Segmented
            value={filter}
            onChange={(value) => setFilter(String(value))}
            options={[
              { label: "全部", value: "all" },
              { label: "正常", value: TenantStatus.Active },
              { label: "冻结", value: TenantStatus.Frozen },
              { label: "停用", value: TenantStatus.Disabled }
            ]}
          />
        )}
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增 SaaS 租户</Button>}
      />
      <QueryState loading={tenants.isLoading || categories.isLoading} error={tenants.error ?? categories.error}>
        <Card className="data-panel" title={<Space><SafetyCertificateOutlined />租户管理<Typography.Text type="secondary">{tenants.data?.filter((item) => item.tenantCode !== "platform").length ?? 0}</Typography.Text></Space>}>
          <div className="table-toolbar">
            <Typography.Text type="secondary">经营品类创建后固定；租户不做物理删除，只进行冻结或停用。</Typography.Text>
          </div>
          <Table<TenantSummary>
            rowKey="tenantId"
            dataSource={rows}
            scroll={{ x: 1120 }}
            columns={[
              { title: "租户", fixed: "left", width: 230, render: (_, row) => <><b>{row.tenantName}</b><br /><span className="muted">{row.tenantCode}</span></> },
              { title: "经营品类", width: 140, render: (_, row) => row.categoryName ?? row.categoryCode ?? "未配置" },
              { title: "状态", width: 100, dataIndex: "tenantStatus", render: (value: TenantStatus) => <Tag color={statusMeta[value].color}>{statusMeta[value].label}</Tag> },
              { title: "组织", width: 90, dataIndex: "organizationCount" },
              { title: "账号", width: 90, dataIndex: "userCount" },
              { title: "订单", width: 90, dataIndex: "orderCount" },
              { title: "状态原因", dataIndex: "statusReason", render: (value) => value || "—" },
              { title: "创建时间", width: 170, dataIndex: "createdAt", render: (value) => value ? new Date(value).toLocaleString() : "—" },
              { title: "操作", fixed: "right", width: 180, render: (_, row) => <Space size={0}><Button type="link" icon={<EditOutlined />} onClick={() => openEdit(row)}>编辑</Button><Button type="link" icon={<PauseCircleOutlined />} onClick={() => openStatus(row)}>状态</Button></Space> }
            ]}
          />
        </Card>
      </QueryState>

      <Drawer
        title={editor?.type === "create" ? "初始化 SaaS 租户" : editor?.type === "edit" ? "编辑租户资料" : "变更租户状态"}
        width={560}
        open={Boolean(editor)}
        destroyOnHidden
        onClose={closeEditor}
        extra={<Button type="primary" loading={createTenant.isPending || saveTenant.isPending || changeStatus.isPending} onClick={() => form.submit()}>保存</Button>}
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          {editor?.type === "create" && (
            <>
              <Form.Item name="tenantCode" label="租户编码" extra="创建后不可修改，用于登录和数据隔离。" rules={[{ required: true }, { pattern: /^[a-z][a-z0-9_-]{1,31}$/, message: "以小写字母开头，仅支持小写字母、数字、_ 和 -" }]}><Input /></Form.Item>
              <Form.Item name="tenantName" label="租户名称" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="categoryCode" label="默认空间品类" extra="用于创建首个默认经营空间；该空间创建后品类固定。" rules={[{ required: true }]}><Select options={(categories.data ?? []).map((item) => ({ value: item.code, label: `${item.name} · ${item.description}` }))} /></Form.Item>
              <Form.Item name="adminAccount" label="租户管理员账号" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="adminDisplayName" label="租户管理员姓名" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="adminPhone" label="联系电话"><Input /></Form.Item>
              <Form.Item name="storeName" label="首个门店/履约点"><Input /></Form.Item>
              <Form.Item name="storeCode" label="门店编码"><Input /></Form.Item>
              <Typography.Paragraph type="secondary">初始化将原子创建租户档案、经营品类、根组织、租户管理员、默认角色、字典和编号规则。模板项：{preview.data?.templates?.length ?? 0} 类。</Typography.Paragraph>
            </>
          )}
          {editor?.type === "edit" && <Form.Item name="tenantName" label="租户名称" rules={[{ required: true }]}><Input /></Form.Item>}
          {editor?.type === "status" && (
            <>
              <Form.Item name="status" label="目标状态" rules={[{ required: true }]}><Select options={Object.entries(statusMeta).map(([value, meta]) => ({ value, label: meta.label }))} /></Form.Item>
              <Form.Item name="reason" label="变更原因" rules={[{ required: true, min: 3 }]}><Input.TextArea rows={4} /></Form.Item>
              <Typography.Paragraph type="secondary">冻结或停用会立即撤销该租户所有登录会话；恢复为正常后账号可重新登录。</Typography.Paragraph>
            </>
          )}
        </Form>
      </Drawer>
    </>
  );
}
