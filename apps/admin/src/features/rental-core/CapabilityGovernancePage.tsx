import { HistoryOutlined, SettingOutlined } from "@ant-design/icons";
import type {
  RentalCapabilityConfigField,
  RentalCapabilityLifecycleStatus,
  SaveWorkspaceCapabilityRequest,
  WorkspaceCapabilityView
} from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Drawer, Form, Input, InputNumber, Select, Space, Switch, Table, Tag, Tooltip, Typography } from "antd";
import { useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

/** 五种状态的展示口径。「未启用」与「已声明未实现」必须区分：后者连启用按钮都不该给。 */
const stateMeta: Record<WorkspaceCapabilityView["state"], { label: string; color: string }> = {
  enabled: { label: "已启用", color: "success" },
  paused: { label: "已暂停", color: "warning" },
  disabled: { label: "已停用", color: "default" },
  not_enabled: { label: "未启用", color: "default" },
  declared_not_implemented: { label: "已声明但未实现", color: "gold" }
};

const kindMeta = {
  category_required: { label: "品类必选", color: "red" },
  category_optional: { label: "可选增强", color: "blue" },
  shared: { label: "跨品类共享", color: "purple" }
} as const;

/** 按注册表的 configSchema 渲染表单项：管理端与服务端共用同一份字段描述。 */
function ConfigField({ field }: { field: RentalCapabilityConfigField }) {
  const rules = field.required ? [{ required: true, message: `${field.label}为必填` }] : [];
  if (field.type === "number") {
    return (
      <Form.Item name={["config", field.key]} label={field.label} rules={rules} extra={field.description}>
        <InputNumber min={field.min} max={field.max} style={{ width: "100%" }} />
      </Form.Item>
    );
  }
  if (field.type === "boolean") {
    return (
      <Form.Item name={["config", field.key]} label={field.label} valuePropName="checked" extra={field.description}>
        <Switch />
      </Form.Item>
    );
  }
  if (field.type === "enum") {
    return (
      <Form.Item name={["config", field.key]} label={field.label} rules={rules} extra={field.description}>
        <Select options={(field.options ?? []).map((option) => ({ value: option, label: option }))} />
      </Form.Item>
    );
  }
  return (
    <Form.Item name={["config", field.key]} label={field.label} rules={rules} extra={field.description}>
      <Input />
    </Form.Item>
  );
}

interface LifecycleFormValues {
  status: RentalCapabilityLifecycleStatus;
  reason: string;
  config?: Record<string, string | number | boolean>;
}

export function CapabilityGovernancePage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const canManage = hasPermission("rental-core:capability:manage");
  const [editing, setEditing] = useState<WorkspaceCapabilityView>();
  const [auditCode, setAuditCode] = useState<string>();
  const [form] = Form.useForm<LifecycleFormValues>();
  const overview = useQuery({ queryKey: ["rental-core", "capabilities"], queryFn: rentalCoreApi.capabilities });
  const audits = useQuery({
    queryKey: ["rental-core", "capability-audits", auditCode],
    queryFn: () => rentalCoreApi.capabilityAudits(auditCode)
  });

  // 任何生命周期变更都会同时影响菜单入口：入口可见性取自会话上下文里的**已启用能力集**。
  // 因此除了刷新本页数据，还必须重新拉一次会话上下文——否则页面上已经暂停，
  // 左侧菜单却还留着该能力的入口，点进去才 403。
  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["rental-core", "capabilities"] }),
      queryClient.invalidateQueries({ queryKey: ["rental-core", "capability-audits"] })
    ]);
    await useAuthStore.getState().bootstrap();
  };

  const save = useMutation({
    mutationFn: (data: SaveWorkspaceCapabilityRequest) => rentalCoreApi.saveCapability(data),
    onSuccess: async () => {
      await invalidateAll();
      setEditing(undefined);
      form.resetFields();
      message.success("能力状态已更新");
    },
    onError: (error: Error) => message.error(error.message || "更新失败：请检查依赖、互斥能力与配置项")
  });

  const upgrade = useMutation({
    mutationFn: (view: WorkspaceCapabilityView) =>
      rentalCoreApi.upgradeCapability(view.definition.code, {
        reason: `升级到 ${view.definition.implementationVersion ?? ""}`,
        expectedRevision: view.instance?.revision
      }),
    onSuccess: async () => {
      await invalidateAll();
      message.success("能力实现版本已升级；历史报价与在途订单仍按原快照执行");
    },
    onError: (error: Error) => message.error(error.message || "升级失败")
  });

  function openEditor(view: WorkspaceCapabilityView) {
    setEditing(view);
    form.setFieldsValue({
      status: view.instance?.status ?? "enabled",
      reason: "",
      config: (view.instance?.config ?? {}) as LifecycleFormValues["config"]
    });
  }

  const data = overview.data;
  const missing = data?.missingRequired ?? [];

  return (
    <>
      <PageHeader
        title="经营空间能力"
        description="能力的启用、暂停、停用与配置版本。菜单入口与 API 放行都以这里的「已启用」为准，品类声明不等于已启用。"
      />
      <QueryState loading={overview.isLoading} error={overview.error}>
        {/* 「可访问」与「已达生产经营条件」分开表示：开发/演示空间可以继续验证通用
            Rental Core，但必须明确显示缺失的首期必选能力，不得因为进得去就当成能力齐备。 */}
        {data?.productionReady ? (
          <Alert
            type="success"
            showIcon
            message="该经营空间已达到生产经营条件"
            description="本品类声明的必选能力均已启用。"
            style={{ marginBottom: 16 }}
          />
        ) : (
          <Alert
            type="warning"
            showIcon
            message="该经营空间尚未达到生产经营条件"
            description={
              missing.length
                ? `仍缺少必选能力：${missing.join("、")}。缺失期间可以继续验证通用 Rental Core 流程，但不应据此认定品类能力已具备。`
                : "本品类没有已实现的必选能力，暂时只能验证通用 Rental Core 流程。"
            }
            style={{ marginBottom: 16 }}
          />
        )}
        {!canManage && (
          <Alert
            type="info"
            showIcon
            message="当前账号只有查看权限"
            description="启用、暂停、停用与升级需要「经营空间能力治理」权限。"
            style={{ marginBottom: 16 }}
          />
        )}
        <Card className="data-panel" styles={{ body: { paddingBottom: 0 } }}>
          <Table<WorkspaceCapabilityView>
            rowKey={(row) => row.definition.code}
            dataSource={data?.capabilities ?? []}
            scroll={{ x: 1280 }}
            columns={[
              {
                title: "能力",
                fixed: "left",
                render: (_, row) => (
                  <>
                    <b>{row.definition.label}</b>
                    <br />
                    <span className="muted">{row.definition.code}</span>
                  </>
                )
              },
              {
                title: "种类",
                render: (_, row) => <Tag color={kindMeta[row.definition.kind].color}>{kindMeta[row.definition.kind].label}</Tag>
              },
              {
                title: "状态",
                render: (_, row) => (
                  <Space direction="vertical" size={2}>
                    <Tag color={stateMeta[row.state].color}>{stateMeta[row.state].label}</Tag>
                    {!row.applicable && <span className="muted">不适用于当前品类</span>}
                    {row.applicable && !row.declaredByCategory && <span className="muted">本品类未声明</span>}
                  </Space>
                )
              },
              {
                title: "依赖 / 互斥",
                render: (_, row) => (
                  <Space direction="vertical" size={2}>
                    {row.definition.dependsOn.length ? <span>依赖：{row.definition.dependsOn.join("、")}</span> : <span className="muted">无依赖</span>}
                    {row.definition.conflictsWith.length ? <span>互斥：{row.definition.conflictsWith.join("、")}</span> : null}
                  </Space>
                )
              },
              {
                title: "版本",
                render: (_, row) => (
                  <Space direction="vertical" size={2}>
                    <span>实现：{row.instance?.implementationVersion ?? row.definition.implementationVersion ?? "未实现"}</span>
                    <span className="muted">配置：{row.instance?.configVersion ?? "-"}</span>
                    {row.upgradeAvailable && <Tag color="processing">可升级到 {row.definition.implementationVersion}</Tag>}
                  </Space>
                )
              },
              {
                title: "配置",
                render: (_, row) =>
                  row.definition.configSchema.length ? (
                    <Space direction="vertical" size={2}>
                      {row.definition.configSchema.map((field) => (
                        <span key={field.key}>
                          {field.label}：{String(row.instance?.config?.[field.key] ?? "-")}
                        </span>
                      ))}
                    </Space>
                  ) : (
                    <span className="muted">无配置项</span>
                  )
              },
              {
                title: "操作",
                fixed: "right",
                render: (_, row) => (
                  <Space>
                    <Tooltip
                      title={
                        !row.implemented
                          ? "该能力只登记了扩展点，尚无可执行模块，不能启用"
                          : !row.applicable
                            ? "该能力不适用于当前经营品类"
                            : undefined
                      }
                    >
                      <Button
                        type="link"
                        icon={<SettingOutlined />}
                        disabled={!canManage || !row.implemented || !row.applicable}
                        onClick={() => openEditor(row)}
                      >
                        状态与配置
                      </Button>
                    </Tooltip>
                    {row.upgradeAvailable && (
                      <Button type="link" loading={upgrade.isPending} disabled={!canManage} onClick={() => upgrade.mutate(row)}>
                        升级
                      </Button>
                    )}
                    <Button type="link" icon={<HistoryOutlined />} onClick={() => setAuditCode(row.definition.code)}>
                      审计
                    </Button>
                  </Space>
                )
              }
            ]}
          />
        </Card>
      </QueryState>

      <Card
        className="data-panel"
        title={
          <Space>
            <span>生命周期审计</span>
            {auditCode ? <Tag>{auditCode}</Tag> : <Tag>全部能力</Tag>}
          </Space>
        }
        extra={auditCode ? <Button onClick={() => setAuditCode(undefined)}>查看全部</Button> : null}
        style={{ marginTop: 16 }}
      >
        <Typography.Paragraph type="secondary">
          审计只追加不修改。每次启用、暂停、停用、改配置与升级都必须填写原因，事后要能解释这项经营决策。
        </Typography.Paragraph>
        <QueryState loading={audits.isLoading} error={audits.error}>
          <Table
            rowKey={(row) => `${row.code}:${row.at}:${row.action}`}
            dataSource={audits.data ?? []}
            columns={[
              { title: "时间", dataIndex: "at" },
              { title: "能力", dataIndex: "code" },
              { title: "动作", dataIndex: "action" },
              { title: "状态变化", render: (_, row) => `${row.fromStatus ?? "（无实例）"} → ${row.toStatus}` },
              { title: "实现 / 配置版本", render: (_, row) => `${row.implementationVersion ?? "-"} / ${row.configVersion ?? "-"}` },
              { title: "原因", dataIndex: "reason" },
              { title: "操作人", dataIndex: "operator" }
            ]}
          />
        </QueryState>
      </Card>

      <Drawer
        title={editing ? `${editing.definition.label} · 状态与配置` : "状态与配置"}
        width={560}
        open={Boolean(editing)}
        destroyOnHidden
        onClose={() => setEditing(undefined)}
        extra={
          <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
            保存
          </Button>
        }
      >
        {editing && (
          <Form<LifecycleFormValues>
            form={form}
            layout="vertical"
            onFinish={(values) =>
              save.mutate({
                code: editing.definition.code,
                status: values.status,
                reason: values.reason,
                config: values.config,
                // 带上读到的 revision：并发修改时服务端返回 409 而不是静默覆盖别人的变更。
                expectedRevision: editing.instance?.revision ?? 0
              })
            }
          >
            <Alert
              type="info"
              showIcon
              message="暂停与停用会立即收回菜单入口与 API 放行"
              description="已启用是唯一可用状态。暂停后该能力的接口会返回 403，历史数据不受影响。"
              style={{ marginBottom: 16 }}
            />
            <Form.Item name="status" label="目标状态" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: "enabled", label: "启用" },
                  { value: "paused", label: "暂停" },
                  { value: "disabled", label: "停用" }
                ]}
              />
            </Form.Item>
            {editing.definition.configSchema.map((field) => (
              <ConfigField key={field.key} field={field} />
            ))}
            <Form.Item name="reason" label="变更原因" rules={[{ required: true, message: "变更能力状态必须填写原因" }]}>
              <Input.TextArea rows={3} maxLength={500} showCount placeholder="例如：门店已具备配送人员与车辆，开通同城配送" />
            </Form.Item>
          </Form>
        )}
      </Drawer>
    </>
  );
}
