import { DeleteOutlined, EditOutlined, KeyOutlined, PlusOutlined } from "@ant-design/icons";
import type { OrganizationSummary, SaveOrganizationRequest, SaveSystemRoleRequest, SaveSystemUserRequest, SystemRoleRow, SystemRulesConfig, SystemUserRow } from "@rental-os/shared";
import { Card, Col, InputNumber, Row, Space, Tag, Typography } from "antd";
import { App } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, Table } from "@/components/ui";
import { Switch } from "@/components/ui";
import { Input } from "@/components/ui";
import { Select } from "@/components/ui";
import { Button, ConfirmAction, CopyButton, Drawer, SaveButton, Tabs } from "@/components/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "@/api/platform";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { useServerFormSync } from "@/app/useServerFormSync";

type EditorKind = "organization" | "user" | "role" | undefined;

export function PlatformPage() {
  const { message, modal } = App.useApp();
  const { t } = useLocale();
  const location = useLocation();
  const queryClient = useQueryClient();
  const tenant = useAuthStore((state) => state.tenant);
  const operator = useAuthStore((state) => state.user?.displayName ?? t("租户管理员"));
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
  const rulesCurrent = useServerFormSync(rulesForm, rules.data, () => { if (rules.data) rulesForm.setFieldsValue(rules.data); });

  const refreshPlatform = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["platform-organizations"] }),
    queryClient.invalidateQueries({ queryKey: ["platform-users"] }),
    queryClient.invalidateQueries({ queryKey: ["platform-roles"] }),
    queryClient.invalidateQueries({ queryKey: ["platform-audit"] })
  ]);

  const saveOrganization = useMutation({ mutationFn: api.saveOrganization, onSuccess: async () => { await refreshPlatform(); closeEditor(); message.success(t("组织已保存")); }, onError: () => message.error(t("组织保存失败，请检查编码和层级")) });
  const toggleOrganization = useMutation({ mutationFn: ({ id, status }: { id: string; status: OrganizationSummary["status"] }) => api.setOrganizationStatus(id, status, operator), onSuccess: async () => { await refreshPlatform(); message.success(t("组织状态已更新")); }, onError: () => message.error(t("组织状态更新失败，请检查下级组织和关联账号")) });
  const saveUser = useMutation({ mutationFn: api.saveUser, onSuccess: async () => { await refreshPlatform(); closeEditor(); message.success(t("账号已保存")); }, onError: () => message.error(t("账号保存失败，请检查账号唯一性、组织和角色")) });
  const toggleUser = useMutation({ mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.setUserStatus(id, isActive), onSuccess: async () => { await refreshPlatform(); message.success(t("账号状态已更新")); }, onError: () => message.error(t("账号状态更新失败")) });
  const resetPassword = useMutation({ mutationFn: api.resetUserPassword, onSuccess: (result) => modal.success({ title: t("密码已重置"), content: <><Typography.Paragraph>{result.message}</Typography.Paragraph><Typography.Text code>{result.temporaryPassword}</Typography.Text><CopyButton value={result.temporaryPassword} /></> }), onError: () => message.error(t("密码重置失败")) });
  const saveRole = useMutation({ mutationFn: api.saveRole, onSuccess: async () => { await refreshPlatform(); closeEditor(); message.success(t("角色已保存")); }, onError: () => message.error(t("角色保存失败，请检查角色编码和权限")) });
  const deleteRole = useMutation({ mutationFn: api.deleteRole, onSuccess: async () => { await refreshPlatform(); message.success(t("角色已删除")); }, onError: () => message.error(t("角色无法删除，可能是预设角色或仍被账号使用")) });
  const saveRules = useMutation({
    mutationFn: async (config: SystemRulesConfig) => {
      if (!rulesCurrent()) throw new Error(t("服务端配置已变更，请重新打开本页核对后再保存"));
      return api.saveSystemRuleSection("memberRegister", { ...config, updatedBy: operator }, operator);
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["system-rules"] }); message.success(t("系统参数已保存")); },
    onError: (error: Error) => message.error(error.message || t("系统参数保存失败，请检查字段约束"))
  });
  const testAi = useMutation({ mutationFn: () => api.testAiConnection(operator), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["system-rules"] }); message.success(t("AI 连接测试已完成，结果已写入日志")); }, onError: () => message.error(t("AI 连接测试失败")) });

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
    modal.confirm({ title: `${t("重置账号密码")} ${record.account}?`, content: t("重置后会生成临时密码，请通过安全渠道交付给账号持有人，并要求首次登录后修改。"), okText: t("确认重置"), onOk: () => resetPassword.mutateAsync(record.id) });
  }

  return (
    <>
      <PageHeader title={t("平台配置")} description={t("管理组织、账号、角色权限、审计与系统参数。数据范围仍由后端 API 强制执行。")} />
      <QueryState loading={loading} error={error}>
        <Card className="tabbed-workspace">
          <Tabs className="standalone-tabs" activeKey={activeKey} onChange={setActiveKey} items={[
            {
              key: "users",
              label: `${t("账号")} (${users.data?.length ?? 0})`,
              children: <><div className="table-toolbar"><Typography.Text type="secondary">{t("账号通过组织、角色和数据范围共同决定可见数据。")}</Typography.Text><Button type="primary" icon={<PlusOutlined />} onClick={() => openUser()}>{t("新增账号")}</Button></div><Table<SystemUserRow> rowKey="id" dataSource={users.data ?? []} scroll={{ x: 1080 }} columns={[
                { title: t("账号"), render: (_, record) => <><b>{record.account}</b><br /><span className="muted">{record.displayName}</span></> },
                { title: t("组织"), dataIndex: "organizationName", render: (value) => value ?? t("未分配") },
                { title: t("角色"), dataIndex: "roleNames", render: (values: string[]) => values.join("、") || t("未分配") },
                { title: t("数据范围"), dataIndex: "dataScope", render: (value) => <Tag>{t(String(value))}</Tag> },
                { title: t("租户管理员"), dataIndex: "isPlatformAdmin", render: (value) => value ? <Tag color="purple">{t("是")}</Tag> : t("否") },
                { title: t("启用"), render: (_, record) => <Switch checked={record.isActive} loading={toggleUser.isPending} disabled={record.id === useAuthStore.getState().user?.id} onChange={(checked) => toggleUser.mutate({ id: record.id, isActive: checked })} /> },
                { title: t("操作"), fixed: "right", render: (_, record) => <Space size={0}><Button type="link" icon={<EditOutlined />} onClick={() => openUser(record)}>{t("编辑")}</Button><Button type="link" icon={<KeyOutlined />} onClick={() => confirmReset(record)}>{t("重置密码")}</Button></Space> }
              ]} /></>
            },
            {
              key: "organizations",
              label: `${t("组织")} (${organizations.data?.length ?? 0})`,
              children: <><div className="table-toolbar"><Typography.Text type="secondary">{t("组织层级用于承载营运中心、门店和履约网点的数据范围。")}</Typography.Text><Button type="primary" icon={<PlusOutlined />} onClick={() => openOrganization()}>{t("新增组织")}</Button></div><Table<OrganizationSummary> rowKey="id" dataSource={organizations.data ?? []} columns={[
                { title: t("组织"), render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.code}</span></> },
                { title: t("类型"), dataIndex: "type", render: (value) => <Tag>{t(String(value))}</Tag> },
                { title: t("上级组织"), dataIndex: "parentId", render: (value) => organizations.data?.find((item) => item.id === value)?.name ?? t("根组织") },
                { title: t("状态"), render: (_, record) => <Switch checked={record.status === "enabled"} loading={toggleOrganization.isPending} onChange={(checked) => toggleOrganization.mutate({ id: record.id, status: checked ? "enabled" : "disabled" })} /> },
                { title: t("操作"), render: (_, record) => <Button type="link" icon={<EditOutlined />} onClick={() => openOrganization(record)}>{t("编辑")}</Button> }
              ]} /></>
            },
            {
              key: "roles",
              label: `${t("角色权限")} (${roles.data?.length ?? 0})`,
              children: <><div className="table-toolbar"><Typography.Text type="secondary">{t("权限控制功能入口，数据范围控制可见组织或本人数据。")}</Typography.Text><Button type="primary" icon={<PlusOutlined />} onClick={() => openRole()}>{t("新增角色")}</Button></div><Table<SystemRoleRow> rowKey="id" dataSource={roles.data ?? []} scroll={{ x: 1080 }} columns={[
                { title: t("角色"), render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.code}</span></> },
                { title: t("作用域"), dataIndex: "scope", render: (value) => <Tag>{t(String(value))}</Tag> },
                { title: t("数据范围"), dataIndex: "dataScope", render: (value) => <Tag color="blue">{t(String(value))}</Tag> },
                { title: t("权限数"), render: (_, record) => record.fixedAllPermissions ? t("全部") : record.permissions.length + record.buttonPermissions.length },
                { title: t("业务范围"), dataIndex: "enabledBusinessScopes", render: (values: string[]) => values.join("、") },
                { title: t("状态"), dataIndex: "isActive", render: (value) => <Tag color={value ? "success" : "default"}>{value ? t("启用") : t("停用")}</Tag> },
                { title: t("操作"), fixed: "right", render: (_, record) => record.fixedAllPermissions ? <Tag>{t("预设角色")}</Tag> : <Space size={0}><Button type="link" icon={<EditOutlined />} onClick={() => openRole(record)}>{t("编辑")}</Button><ConfirmAction label={t("删除")} icon={<DeleteOutlined />} prompt={<>{`${t("删除角色")} ${record.name}？`} {t("预设角色或仍分配给账号的角色无法删除。删除操作不可撤销。")}</>} onConfirm={() => deleteRole.mutateAsync(record.id)} /></Space> }
              ]} /></>
            },
            {
              key: "audit",
              label: `${t("审计日志")} (${audit.data?.total ?? 0})`,
              children: <Table rowKey="id" dataSource={audit.data?.rows ?? []} scroll={{ x: 1000 }} columns={[
                { title: t("时间"), dataIndex: "createdAt" },
                { title: t("动作"), dataIndex: "action", render: (value) => <Tag>{t(String(value))}</Tag> },
                { title: t("操作人"), dataIndex: "operator" },
                { title: t("对象"), render: (_, record) => `${record.targetType}${record.targetId ? ` / ${record.targetId}` : ""}` },
                { title: t("说明"), dataIndex: "detail" }
              ]} />
            },
            {
              key: "parameters",
              label: t("系统参数"),
              children: <QueryState loading={rules.isLoading} error={rules.error}>{rules.data && <Form<SystemRulesConfig> form={rulesForm} layout="vertical" onFinish={(values) => saveRules.mutate({ ...rules.data, ...values })}>
                <Alert type="warning" showIcon title={t("这里仍是车辆兼容参数")} description={t("维保里程、清洁次数等字段尚未迁移为通用品类运维规则；非车辆租户启用前必须完成后端模型改造。")} style={{ marginBottom: 16 }} />
                <Row gutter={[16, 16]}>
                  <Col xs={24} xl={12}><Card size="small" title={t("会员注册")}><Form.Item name={["member", "accountType"]} label={t("账号类型")}><Select options={[{ value: "MOBILE", label: t("手机号") }, { value: "ID_CARD", label: t("证件号") }]} /></Form.Item><Form.Item name={["member", "auditRequired"]} label={t("注册后需要审核")} valuePropName="checked"><Switch /></Form.Item></Card></Col>
                  <Col xs={24} xl={12}><Card size="small" title={t("资产维护")}><Row gutter={12}><Col span={12}><Form.Item name={["fleet", "maintenance", "thresholdMileage"]} label={t("维护阈值（公里）")}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col><Col span={12}><Form.Item name={["fleet", "maintenance", "thresholdMonths"]} label={t("维护周期（月）")}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col><Col span={12}><Form.Item name={["fleet", "cleaning", "thresholdCount"]} label={t("清洁阈值（次）")}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col><Col span={12}><Form.Item name={["fleet", "cleaning", "thresholdDays"]} label={t("清洁周期（天）")}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col></Row></Card></Col>
                  <Col span={24}><Card size="small" title={t("AI 接入")}><Row gutter={12}><Col xs={24} md={6}><Form.Item name={["aiModel", "enabled"]} label={t("启用")} valuePropName="checked"><Switch /></Form.Item></Col><Col xs={24} md={6}><Form.Item name={["aiModel", "provider"]} label={t("提供方")}><Select options={[{ value: "OPENAI", label: "OpenAI" }, { value: "GEMINI", label: "Gemini" }, { value: "OPENAI_COMPATIBLE", label: "OpenAI Compatible" }]} /></Form.Item></Col><Col xs={24} md={6}><Form.Item name={["aiModel", "modelName"]} label={t("模型名称")}><Input /></Form.Item></Col><Col xs={24} md={6}><Form.Item name={["aiModel", "baseUrl"]} label="Base URL"><Input /></Form.Item></Col></Row><Space><Button loading={testAi.isPending} onClick={() => testAi.mutate()}>{t("测试连接")}</Button><Tag color={rules.data.aiModel.lastTestStatus === "成功" ? "success" : "default"}>{rules.data.aiModel.lastTestStatus ? t(rules.data.aiModel.lastTestStatus) : t("未测试")}</Tag><Typography.Text type="secondary">{rules.data.aiModel.lastTestTime}</Typography.Text></Space></Card></Col>
                </Row>
                <div className="form-actions"><SaveButton label={t("保存系统参数")} form={rulesForm} pending={saveRules.isPending} onSave={(values) => saveRules.mutateAsync({ ...rules.data!, ...values })} /></div>
              </Form>}</QueryState>
            }
          ]} />
        </Card>
      </QueryState>

      <Drawer title={editingOrganization ? t("编辑组织") : t("新增组织")} open={editor === "organization"} size={500} destroyOnHidden onClose={closeEditor} extra={<SaveButton label={t("保存")} form={organizationForm} pending={saveOrganization.isPending} onSave={(values) => saveOrganization.mutateAsync({ ...values, id: editingOrganization?.id, operator })} />}>
        <Form form={organizationForm} layout="vertical" onFinish={(values) => saveOrganization.mutate({ ...values, id: editingOrganization?.id, operator })}>
          <Form.Item name="tenantId" hidden><Input /></Form.Item><Form.Item name="name" label={t("组织名称")} rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="code" label={t("组织编码")} rules={[{ required: true }]}><Input disabled={Boolean(editingOrganization)} /></Form.Item><Form.Item name="type" label={t("组织类型")} rules={[{ required: true }]}><Select options={[{ value: "operator", label: t("营运中心") }, { value: "car_shop", label: t("业务公司") }, { value: "store", label: t("门店") }, { value: "station", label: t("履约点") }]} /></Form.Item><Form.Item name="parentId" label={t("上级组织")}><Select allowClear options={(organizations.data ?? []).filter((item) => item.id !== editingOrganization?.id).map((item) => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item name="status" label={t("状态")}><Select options={[{ value: "enabled", label: t("启用") }, { value: "disabled", label: t("停用") }]} /></Form.Item>
        </Form>
      </Drawer>

      <Drawer title={editingUser ? t("编辑账号") : t("新增账号")} open={editor === "user"} size={520} destroyOnHidden onClose={closeEditor} extra={<SaveButton label={t("保存")} form={userForm} pending={saveUser.isPending} onSave={(values) => saveUser.mutateAsync({ ...values, id: editingUser?.id })} />}>
        <Form form={userForm} layout="vertical" onFinish={(values) => saveUser.mutate({ ...values, id: editingUser?.id })}>
          <Form.Item name="tenantId" hidden><Input /></Form.Item><Form.Item name="account" label={t("登录账号")} rules={[{ required: true }]}><Input disabled={Boolean(editingUser)} /></Form.Item><Form.Item name="displayName" label={t("显示名称")} rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="phone" label={t("联系电话")}><Input /></Form.Item><Form.Item name="organizationId" label={t("所属组织")}><Select allowClear options={organizationOptions} /></Form.Item><Form.Item name="roleIds" label={t("角色")} rules={[{ required: true }]}><Select mode="multiple" options={roleOptions} /></Form.Item><Space size="large"><Form.Item name="isPlatformAdmin" label={t("租户管理员")} valuePropName="checked"><Switch /></Form.Item><Form.Item name="isActive" label={t("启用")} valuePropName="checked"><Switch /></Form.Item></Space>
        </Form>
      </Drawer>

      <Drawer title={editingRole ? t("编辑角色") : t("新增角色")} open={editor === "role"} size={680} destroyOnHidden onClose={closeEditor} extra={<SaveButton label={t("保存")} form={roleForm} pending={saveRole.isPending} onSave={(values) => saveRole.mutateAsync({ ...values, id: editingRole?.id })} />}>
        <Form form={roleForm} layout="vertical" onFinish={(values) => saveRole.mutate({ ...values, id: editingRole?.id })}>
          <Row gutter={12}><Col span={12}><Form.Item name="name" label={t("角色名称")} rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={12}><Form.Item name="code" label={t("角色编码")} rules={[{ required: true }]}><Input disabled={Boolean(editingRole)} /></Form.Item></Col></Row><Form.Item name="description" label={t("角色说明")}><Input.TextArea rows={2} /></Form.Item><Row gutter={12}><Col span={12}><Form.Item name="scope" label={t("作用域")} rules={[{ required: true }]}><Select options={[{ value: "operator", label: t("营运中心") }, { value: "car_shop", label: t("业务公司") }, { value: "store", label: t("门店") }, { value: "station", label: t("履约点") }]} /></Form.Item></Col><Col span={12}><Form.Item name="dataScope" label={t("数据范围")} rules={[{ required: true }]}><Select options={[{ value: "all", label: t("全部") }, { value: "organization", label: t("所属组织") }, { value: "store", label: t("所属门店") }, { value: "own", label: t("仅本人") }]} /></Form.Item></Col></Row><Form.Item name="enabledBusinessScopes" label={t("业务范围")}><Select mode="tags" options={[{ value: "STORE_STANDARD" }, { value: "STORE_24H" }, { value: "SYSTEM_GLOBAL" }]} /></Form.Item><Form.Item name="permissions" label={t("页面与业务权限")}><Select mode="multiple" showSearch={{ optionFilterProp: "label" }} options={permissionOptions.filter((item) => !item.label.includes("按钮-"))} /></Form.Item><Form.Item name="buttonPermissions" label={t("按钮权限")}><Select mode="multiple" showSearch={{ optionFilterProp: "label" }} options={permissionOptions.filter((item) => item.label.includes("按钮-"))} /></Form.Item><Form.Item name="isActive" label={t("启用")} valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
