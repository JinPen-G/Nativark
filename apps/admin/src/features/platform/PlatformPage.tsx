import { DeleteOutlined, EditOutlined, KeyOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import type { OrganizationSummary, SaveOrganizationRequest, SaveSystemRoleRequest, SaveSystemUserRequest, SystemRoleRow, SystemRulesConfig, SystemUserRow } from "@store-rental/shared";
import { Alert, App, Button, Card, Col, Drawer, Form, Input, InputNumber, Modal, Row, Select, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "@/api/rental";
import { setOrganizationStatus } from "@/api/operations";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

type EditorKind = "organization" | "user" | "role" | undefined;

export function PlatformPage() {
  const { message, modal } = App.useApp();
  const location = useLocation();
  const queryClient = useQueryClient();
  const tenant = useAuthStore((state) => state.tenant);
  const operator = useAuthStore((state) => state.user?.displayName ?? "租户管理员");
  const [activeKey, setActiveKey] = useState(location.pathname.endsWith("/system") ? "parameters" : "users");
  const [editor, setEditor] = useState<EditorKind>();
  const [editingOrganization, setEditingOrganization] = useState<OrganizationSummary>();
  const [editingUser, setEditingUser] = useState<SystemUserRow>();
  const [editingRole, setEditingRole] = useState<SystemRoleRow>();
  const [organizationForm] = Form.useForm<SaveOrganizationRequest>();
  const [userForm] = Form.useForm<SaveSystemUserRequest>();
  const [roleForm] = Form.useForm<SaveSystemRoleRequest>();
  const [rulesForm] = Form.useForm<SystemRulesConfig>();

  const organizations = useQuery({ queryKey: ["platform-organizations"], queryFn: api.organizations });
  const users = useQuery({ queryKey: ["platform-users"], queryFn: api.users });
  const roles = useQuery({ queryKey: ["platform-roles"], queryFn: api.roles });
  const permissions = useQuery({ queryKey: ["platform-permissions"], queryFn: api.permissionTree });
  const audit = useQuery({ queryKey: ["platform-audit"], queryFn: api.auditLogs });
  const rules = useQuery({ queryKey: ["system-rules"], queryFn: api.systemRules });

  useEffect(() => setActiveKey(location.pathname.endsWith("/system") ? "parameters" : "users"), [location.pathname]);
  useEffect(() => { if (rules.data) rulesForm.setFieldsValue(rules.data); }, [rules.data, rulesForm]);

  const refreshPlatform = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["platform-organizations"] }),
    queryClient.invalidateQueries({ queryKey: ["platform-users"] }),
    queryClient.invalidateQueries({ queryKey: ["platform-roles"] }),
    queryClient.invalidateQueries({ queryKey: ["platform-audit"] })
  ]);

  const saveOrganization = useMutation({ mutationFn: api.saveOrganization, onSuccess: async () => { await refreshPlatform(); closeEditor(); message.success("组织已保存"); }, onError: () => message.error("组织保存失败，请检查编码和层级") });
  const toggleOrganization = useMutation({ mutationFn: ({ id, status }: { id: string; status: OrganizationSummary["status"] }) => setOrganizationStatus(id, status, operator), onSuccess: async () => { await refreshPlatform(); message.success("组织状态已更新"); }, onError: () => message.error("组织状态更新失败，请检查下级组织和关联账号") });
  const saveUser = useMutation({ mutationFn: api.saveUser, onSuccess: async () => { await refreshPlatform(); closeEditor(); message.success("账号已保存"); }, onError: () => message.error("账号保存失败，请检查账号唯一性、组织和角色") });
  const toggleUser = useMutation({ mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.setUserStatus(id, isActive), onSuccess: async () => { await refreshPlatform(); message.success("账号状态已更新"); }, onError: () => message.error("账号状态更新失败") });
  const resetPassword = useMutation({ mutationFn: api.resetUserPassword, onSuccess: (result) => Modal.success({ title: "密码已重置", content: <><Typography.Paragraph>{result.message}</Typography.Paragraph><Typography.Text code copyable>{result.temporaryPassword}</Typography.Text></> }), onError: () => message.error("密码重置失败") });
  const saveRole = useMutation({ mutationFn: api.saveRole, onSuccess: async () => { await refreshPlatform(); closeEditor(); message.success("角色已保存"); }, onError: () => message.error("角色保存失败，请检查角色编码和权限") });
  const deleteRole = useMutation({ mutationFn: api.deleteRole, onSuccess: async () => { await refreshPlatform(); message.success("角色已删除"); }, onError: () => message.error("角色无法删除，可能是预设角色或仍被账号使用") });
  const saveRules = useMutation({
    mutationFn: (config: SystemRulesConfig) => api.saveSystemRuleSection("memberRegister", { ...config, updatedBy: operator }, operator),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["system-rules"] }); message.success("系统参数已保存"); },
    onError: () => message.error("系统参数保存失败，请检查字段约束")
  });
  const testAi = useMutation({ mutationFn: () => api.testAiConnection(operator), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["system-rules"] }); message.success("AI 连接测试已完成，结果已写入日志"); }, onError: () => message.error("AI 连接测试失败") });

  const permissionOptions = useMemo(() => (permissions.data ?? []).flatMap((module) => module.children.map((item) => ({ value: item.code, label: `${module.name} · ${item.name}` }))), [permissions.data]);
  const roleOptions = (roles.data ?? []).filter((role) => role.isActive).map((role) => ({ value: role.id, label: role.name }));
  const organizationOptions = (organizations.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: `${item.name} · ${item.code}` }));
  const loading = organizations.isLoading || users.isLoading || roles.isLoading || audit.isLoading;
  const error = organizations.error ?? users.error ?? roles.error ?? audit.error;

  function closeEditor() {
    setEditor(undefined);
    setEditingOrganization(undefined);
    setEditingUser(undefined);
    setEditingRole(undefined);
    organizationForm.resetFields();
    userForm.resetFields();
    roleForm.resetFields();
  }

  function openOrganization(record?: OrganizationSummary) {
    setEditingOrganization(record);
    organizationForm.setFieldsValue(record ?? { tenantId: tenant?.tenantId ?? "tenant_001", type: "store" as SaveOrganizationRequest["type"], code: "", name: "", status: "enabled", operator });
    setEditor("organization");
  }

  function openUser(record?: SystemUserRow) {
    setEditingUser(record);
    userForm.setFieldsValue(record ? { id: record.id, tenantId: record.tenantId, account: record.account, displayName: record.displayName, phone: record.phone, organizationId: record.organizationId, roleIds: record.roleIds, isPlatformAdmin: record.isPlatformAdmin, isActive: record.isActive } : { tenantId: tenant?.tenantId ?? "tenant_001", account: "", displayName: "", roleIds: [], isPlatformAdmin: false, isActive: true });
    setEditor("user");
  }

  function openRole(record?: SystemRoleRow) {
    setEditingRole(record);
    roleForm.setFieldsValue(record ? { id: record.id, code: record.code, name: record.name, description: record.description, scope: record.scope, enabledBusinessScopes: record.enabledBusinessScopes, permissions: record.permissions.filter((item) => item !== "*"), buttonPermissions: record.buttonPermissions.filter((item) => item !== "*"), dataScope: record.dataScope, isActive: record.isActive } : { code: "", name: "", scope: "operator" as SaveSystemRoleRequest["scope"], enabledBusinessScopes: ["STORE_STANDARD"], permissions: [], buttonPermissions: [], dataScope: "organization", isActive: true });
    setEditor("role");
  }

  function confirmReset(record: SystemUserRow) {
    modal.confirm({ title: `重置账号 ${record.account} 的密码？`, content: "重置后会生成临时密码，请通过安全渠道交付给账号持有人，并要求首次登录后修改。", okText: "确认重置", onOk: () => resetPassword.mutateAsync(record.id) });
  }

  function confirmDeleteRole(record: SystemRoleRow) {
    modal.confirm({ title: `删除角色 ${record.name}？`, content: "预设角色或仍分配给账号的角色无法删除。删除操作不可撤销。", okText: "确认删除", okButtonProps: { danger: true }, onOk: () => deleteRole.mutateAsync(record.id) });
  }

  return (
    <>
      <PageHeader title="平台配置" description="管理组织、账号、角色权限、审计与系统参数。数据范围仍由后端 API 强制执行。" />
      <QueryState loading={loading} error={error}>
        <Card className="tabbed-workspace">
          <Tabs className="standalone-tabs" activeKey={activeKey} onChange={setActiveKey} items={[
            {
              key: "users",
              label: `账号 (${users.data?.length ?? 0})`,
              children: <><div className="table-toolbar"><Typography.Text type="secondary">账号通过组织、角色和数据范围共同决定可见数据。</Typography.Text><Button type="primary" icon={<PlusOutlined />} onClick={() => openUser()}>新增账号</Button></div><Table<SystemUserRow> rowKey="id" dataSource={users.data ?? []} scroll={{ x: 1080 }} columns={[
                { title: "账号", render: (_, record) => <><b>{record.account}</b><br /><span className="muted">{record.displayName}</span></> },
                { title: "组织", dataIndex: "organizationName", render: (value) => value ?? "未分配" },
                { title: "角色", dataIndex: "roleNames", render: (values: string[]) => values.join("、") || "未分配" },
                { title: "数据范围", dataIndex: "dataScope", render: (value) => <Tag>{value}</Tag> },
                { title: "租户管理员", dataIndex: "isPlatformAdmin", render: (value) => value ? <Tag color="purple">是</Tag> : "否" },
                { title: "启用", render: (_, record) => <Switch checked={record.isActive} loading={toggleUser.isPending} disabled={record.id === useAuthStore.getState().user?.id} onChange={(checked) => toggleUser.mutate({ id: record.id, isActive: checked })} /> },
                { title: "操作", fixed: "right", render: (_, record) => <Space size={0}><Button type="link" icon={<EditOutlined />} onClick={() => openUser(record)}>编辑</Button><Button type="link" icon={<KeyOutlined />} onClick={() => confirmReset(record)}>重置密码</Button></Space> }
              ]} /></>
            },
            {
              key: "organizations",
              label: `组织 (${organizations.data?.length ?? 0})`,
              children: <><div className="table-toolbar"><Typography.Text type="secondary">组织层级用于承载营运中心、门店和履约网点的数据范围。</Typography.Text><Button type="primary" icon={<PlusOutlined />} onClick={() => openOrganization()}>新增组织</Button></div><Table<OrganizationSummary> rowKey="id" dataSource={organizations.data ?? []} columns={[
                { title: "组织", render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.code}</span></> },
                { title: "类型", dataIndex: "type", render: (value) => <Tag>{value}</Tag> },
                { title: "上级组织", dataIndex: "parentId", render: (value) => organizations.data?.find((item) => item.id === value)?.name ?? "根组织" },
                { title: "状态", render: (_, record) => <Switch checked={record.status === "enabled"} loading={toggleOrganization.isPending} onChange={(checked) => toggleOrganization.mutate({ id: record.id, status: checked ? "enabled" : "disabled" })} /> },
                { title: "操作", render: (_, record) => <Button type="link" icon={<EditOutlined />} onClick={() => openOrganization(record)}>编辑</Button> }
              ]} /></>
            },
            {
              key: "roles",
              label: `角色权限 (${roles.data?.length ?? 0})`,
              children: <><div className="table-toolbar"><Typography.Text type="secondary">权限控制功能入口，数据范围控制可见组织或本人数据。</Typography.Text><Button type="primary" icon={<PlusOutlined />} onClick={() => openRole()}>新增角色</Button></div><Table<SystemRoleRow> rowKey="id" dataSource={roles.data ?? []} scroll={{ x: 1080 }} columns={[
                { title: "角色", render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.code}</span></> },
                { title: "作用域", dataIndex: "scope", render: (value) => <Tag>{value}</Tag> },
                { title: "数据范围", dataIndex: "dataScope", render: (value) => <Tag color="blue">{value}</Tag> },
                { title: "权限数", render: (_, record) => record.fixedAllPermissions ? "全部" : record.permissions.length + record.buttonPermissions.length },
                { title: "业务范围", dataIndex: "enabledBusinessScopes", render: (values: string[]) => values.join("、") },
                { title: "状态", dataIndex: "isActive", render: (value) => <Tag color={value ? "success" : "default"}>{value ? "启用" : "停用"}</Tag> },
                { title: "操作", fixed: "right", render: (_, record) => record.fixedAllPermissions ? <Tag>预设角色</Tag> : <Space size={0}><Button type="link" icon={<EditOutlined />} onClick={() => openRole(record)}>编辑</Button><Button type="link" danger icon={<DeleteOutlined />} onClick={() => confirmDeleteRole(record)}>删除</Button></Space> }
              ]} /></>
            },
            {
              key: "audit",
              label: `审计日志 (${audit.data?.total ?? 0})`,
              children: <Table rowKey="id" dataSource={audit.data?.rows ?? []} scroll={{ x: 1000 }} columns={[
                { title: "时间", dataIndex: "createdAt" },
                { title: "动作", dataIndex: "action", render: (value) => <Tag>{value}</Tag> },
                { title: "操作人", dataIndex: "operator" },
                { title: "对象", render: (_, record) => `${record.targetType}${record.targetId ? ` / ${record.targetId}` : ""}` },
                { title: "说明", dataIndex: "detail" }
              ]} />
            },
            {
              key: "parameters",
              label: "系统参数",
              children: <QueryState loading={rules.isLoading} error={rules.error}>{rules.data && <Form<SystemRulesConfig> form={rulesForm} layout="vertical" onFinish={(values) => saveRules.mutate({ ...rules.data, ...values })}>
                <Alert type="warning" showIcon title="这里仍是车辆兼容参数" description="维保里程、清洁次数等字段尚未迁移为通用品类运维规则；非车辆租户启用前必须完成后端模型改造。" style={{ marginBottom: 16 }} />
                <Row gutter={[16, 16]}>
                  <Col xs={24} xl={12}><Card size="small" title="会员注册"><Form.Item name={["member", "accountType"]} label="账号类型"><Select options={[{ value: "MOBILE", label: "手机号" }, { value: "ID_CARD", label: "证件号" }]} /></Form.Item><Form.Item name={["member", "auditRequired"]} label="注册后需要审核" valuePropName="checked"><Switch /></Form.Item></Card></Col>
                  <Col xs={24} xl={12}><Card size="small" title="资产维护"><Row gutter={12}><Col span={12}><Form.Item name={["fleet", "maintenance", "thresholdMileage"]} label="维护阈值（公里）"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col><Col span={12}><Form.Item name={["fleet", "maintenance", "thresholdMonths"]} label="维护周期（月）"><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col><Col span={12}><Form.Item name={["fleet", "cleaning", "thresholdCount"]} label="清洁阈值（次）"><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col><Col span={12}><Form.Item name={["fleet", "cleaning", "thresholdDays"]} label="清洁周期（天）"><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col></Row></Card></Col>
                  <Col span={24}><Card size="small" title="AI 接入"><Row gutter={12}><Col xs={24} md={6}><Form.Item name={["aiModel", "enabled"]} label="启用" valuePropName="checked"><Switch /></Form.Item></Col><Col xs={24} md={6}><Form.Item name={["aiModel", "provider"]} label="提供方"><Select options={[{ value: "OPENAI", label: "OpenAI" }, { value: "GEMINI", label: "Gemini" }, { value: "OPENAI_COMPATIBLE", label: "OpenAI Compatible" }]} /></Form.Item></Col><Col xs={24} md={6}><Form.Item name={["aiModel", "modelName"]} label="模型名称"><Input /></Form.Item></Col><Col xs={24} md={6}><Form.Item name={["aiModel", "baseUrl"]} label="Base URL"><Input /></Form.Item></Col></Row><Space><Button loading={testAi.isPending} onClick={() => testAi.mutate()}>测试连接</Button><Tag color={rules.data.aiModel.lastTestStatus === "成功" ? "success" : "default"}>{rules.data.aiModel.lastTestStatus || "未测试"}</Tag><Typography.Text type="secondary">{rules.data.aiModel.lastTestTime}</Typography.Text></Space></Card></Col>
                </Row>
                <div className="form-actions"><Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saveRules.isPending}>保存系统参数</Button></div>
              </Form>}</QueryState>
            }
          ]} />
        </Card>
      </QueryState>

      <Drawer title={editingOrganization ? "编辑组织" : "新增组织"} open={editor === "organization"} size={500} destroyOnHidden onClose={closeEditor} extra={<Button type="primary" loading={saveOrganization.isPending} onClick={() => organizationForm.submit()}>保存</Button>}>
        <Form form={organizationForm} layout="vertical" onFinish={(values) => saveOrganization.mutate({ ...values, id: editingOrganization?.id, operator })}>
          <Form.Item name="tenantId" hidden><Input /></Form.Item><Form.Item name="name" label="组织名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="code" label="组织编码" rules={[{ required: true }]}><Input disabled={Boolean(editingOrganization)} /></Form.Item><Form.Item name="type" label="组织类型" rules={[{ required: true }]}><Select options={[{ value: "operator", label: "营运中心" }, { value: "car_shop", label: "业务公司" }, { value: "store", label: "门店" }, { value: "station", label: "履约点" }]} /></Form.Item><Form.Item name="parentId" label="上级组织"><Select allowClear options={(organizations.data ?? []).filter((item) => item.id !== editingOrganization?.id).map((item) => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item name="status" label="状态"><Select options={[{ value: "enabled", label: "启用" }, { value: "disabled", label: "停用" }]} /></Form.Item>
        </Form>
      </Drawer>

      <Drawer title={editingUser ? "编辑账号" : "新增账号"} open={editor === "user"} size={520} destroyOnHidden onClose={closeEditor} extra={<Button type="primary" loading={saveUser.isPending} onClick={() => userForm.submit()}>保存</Button>}>
        <Form form={userForm} layout="vertical" onFinish={(values) => saveUser.mutate({ ...values, id: editingUser?.id })}>
          <Form.Item name="tenantId" hidden><Input /></Form.Item><Form.Item name="account" label="登录账号" rules={[{ required: true }]}><Input disabled={Boolean(editingUser)} /></Form.Item><Form.Item name="displayName" label="显示名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="phone" label="联系电话"><Input /></Form.Item><Form.Item name="organizationId" label="所属组织"><Select allowClear options={organizationOptions} /></Form.Item><Form.Item name="roleIds" label="角色" rules={[{ required: true }]}><Select mode="multiple" options={roleOptions} /></Form.Item><Space size="large"><Form.Item name="isPlatformAdmin" label="租户管理员" valuePropName="checked"><Switch /></Form.Item><Form.Item name="isActive" label="启用" valuePropName="checked"><Switch /></Form.Item></Space>
        </Form>
      </Drawer>

      <Drawer title={editingRole ? "编辑角色" : "新增角色"} open={editor === "role"} size={680} destroyOnHidden onClose={closeEditor} extra={<Button type="primary" loading={saveRole.isPending} onClick={() => roleForm.submit()}>保存</Button>}>
        <Form form={roleForm} layout="vertical" onFinish={(values) => saveRole.mutate({ ...values, id: editingRole?.id })}>
          <Row gutter={12}><Col span={12}><Form.Item name="name" label="角色名称" rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={12}><Form.Item name="code" label="角色编码" rules={[{ required: true }]}><Input disabled={Boolean(editingRole)} /></Form.Item></Col></Row><Form.Item name="description" label="角色说明"><Input.TextArea rows={2} /></Form.Item><Row gutter={12}><Col span={12}><Form.Item name="scope" label="作用域" rules={[{ required: true }]}><Select options={[{ value: "operator", label: "营运中心" }, { value: "car_shop", label: "业务公司" }, { value: "store", label: "门店" }, { value: "station", label: "履约点" }]} /></Form.Item></Col><Col span={12}><Form.Item name="dataScope" label="数据范围" rules={[{ required: true }]}><Select options={[{ value: "all", label: "全部" }, { value: "organization", label: "所属组织" }, { value: "store", label: "所属门店" }, { value: "own", label: "仅本人" }]} /></Form.Item></Col></Row><Form.Item name="enabledBusinessScopes" label="业务范围"><Select mode="tags" options={[{ value: "STORE_STANDARD" }, { value: "STORE_24H" }, { value: "SYSTEM_GLOBAL" }]} /></Form.Item><Form.Item name="permissions" label="页面与业务权限"><Select mode="multiple" showSearch optionFilterProp="label" options={permissionOptions.filter((item) => !item.label.includes("按钮-"))} /></Form.Item><Form.Item name="buttonPermissions" label="按钮权限"><Select mode="multiple" showSearch optionFilterProp="label" options={permissionOptions.filter((item) => item.label.includes("按钮-"))} /></Form.Item><Form.Item name="isActive" label="启用" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
