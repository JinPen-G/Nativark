/** Rental 经营空间能力目录、配置与生命周期审计，复用原状态口径和服务端修订校验。 */
import { DataTableText, ListFilters, useListFilter, ListSection, SaveButton, Tabs,
  App, Form, Alert, Table, Switch, Input, Select, Button, Drawer, Tooltip } from "@rental-os/platform-admin/ui";
import { Button as ArcButton } from "@rental-os/platform-admin/native-ui";
import { CardBadge, CardFacts, CardSecondary, CardSection } from "@rental-os/platform-admin/ui";
import { HistoryOutlined, SettingOutlined } from "@rental-os/platform-admin/ui";
import { CorePage, QueryState, UnsavedChangesGuard, useCorePageHost } from "@rental-os/platform-admin/core";
import { useLocale } from "@rental-os/platform-admin/locale";
import type { RentalCapabilityConfigField, RentalCapabilityConfig, RentalCapabilityLifecycleStatus,
  SaveWorkspaceCapabilityRequest, WorkspaceCapabilityView } from "@rental-os/rental-core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InputNumber, Space, Tag } from "antd";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Minus } from "lucide-react";
import { useOrderEditor } from "../orders/useOrderEditor";
import type { RentalCapabilityPageContext } from "./page-context";
import { RENTAL_CAPABILITY_CORE_ID } from "./pages";
import capabilityCardStyles from "./capabilityCards.module.css";

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

const capabilityOptionLabels: Record<string, string> = {
  mileage: "里程",
  hours: "工时",
  shutter: "快门次数",
};

/** 按注册表的 configSchema 渲染表单项：管理端与服务端共用同一份字段描述。 */
function ConfigField({ field }: { field: RentalCapabilityConfigField }) {
  const { t } = useLocale();
  const fieldLabel = field.label ?? field.key;
  const fieldDescription = field.description ? t(field.description) : undefined;
  const rules = field.required ? [{ required: true, message: `${t(fieldLabel)}${t("为必填")}` }] : [];
  if (field.type === "number") {
    return (
      <Form.Item name={["config", field.key]} label={t(fieldLabel)} rules={rules} extra={fieldDescription}>
        <InputNumber min={field.min} max={field.max} style={{ width: "100%" }} />
      </Form.Item>
    );
  }
  if (field.type === "boolean") {
    return (
      <Form.Item name={["config", field.key]} label={t(fieldLabel)} valuePropName="checked" extra={fieldDescription}>
        <Switch />
      </Form.Item>
    );
  }
  if (field.type === "enum") {
    return (
      <Form.Item name={["config", field.key]} label={t(fieldLabel)} rules={rules} extra={fieldDescription}>
        <Select options={(field.options ?? []).map((option) => ({ value: option, label: t(capabilityOptionLabels[option] ?? option) }))} />
      </Form.Item>
    );
  }
  if (field.type === "compatibility_relations") {
    return (
      <Form.Item name={["config", field.key]} label={t(fieldLabel)} rules={rules} extra={fieldDescription}>
        <Input.TextArea
          rows={12}
          spellCheck={false}
          placeholder={t("兼容关系 JSON 示例")}
        />
      </Form.Item>
    );
  }
  return (
    <Form.Item name={["config", field.key]} label={t(fieldLabel)} rules={rules} extra={fieldDescription}>
      <Input />
    </Form.Item>
  );
}

interface LifecycleFormValues {
  status: RentalCapabilityLifecycleStatus;
  reason: string;
  config?: RentalCapabilityConfig;
}

interface CapabilityEditorState {
  view: WorkspaceCapabilityView;
  generation: number;
}

export function CapabilityGovernancePage(context: RentalCapabilityPageContext) {
  return <CapabilityGovernanceContent key={context.scopeKey} {...context} />;
}

function CapabilityGovernanceContent({ api: rentalCoreApi, scopeKey, currentScopeKey,
  refreshSession }: RentalCapabilityPageContext) {
  const { message } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const host = useCorePageHost();
  const canManage = host.canAccess(RENTAL_CAPABILITY_CORE_ID, [{ resource: "capability", action: "manage" }]);
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const isCurrentScope = () => active.current && Boolean(scopeKey) && currentScopeKey() === scopeKey;
  const assertManage = () => {
    if (!isCurrentScope()) throw new DOMException("能力页面的会话或经营空间已变化", "AbortError");
    if (!host.canAccess(RENTAL_CAPABILITY_CORE_ID, [{ resource: "capability", action: "manage" }]))
      throw new Error(t("当前操作不可用"));
  };
  const editorGeneration = useRef(0);
  const [editorState, setEditorState] = useState<CapabilityEditorState>();
  const editing = editorState?.view;
  const upgradeRequest = useRef<{ key: string; request: Promise<unknown> } | undefined>(undefined);
  const [auditCode, setAuditCode] = useState<string>();
  const [view, setView] = useState("capabilities");
  const [form] = Form.useForm<LifecycleFormValues>();
  const overview = useQuery({
    queryKey: ["rental-core", "capabilities", scopeKey], enabled: Boolean(scopeKey),
    queryFn: ({ signal }) => rentalCoreApi.capabilities({ signal })
  });
  const capabilityFilter = useListFilter(overview.data?.capabilities, {
    fields: row => [row.definition.label, t(row.definition.label), row.definition.code],
    status: row => row.state,
  });
  const audits = useQuery({
    queryKey: ["rental-core", "capability-audits", scopeKey, auditCode], enabled: Boolean(scopeKey),
    queryFn: ({ signal }) => rentalCoreApi.capabilityAudits(auditCode, { signal })
  });

  // 任何生命周期变更都会同时影响菜单入口：入口可见性取自会话上下文里的**已启用能力集**。
  // 因此除了刷新本页数据，还必须重新拉一次会话上下文——否则页面上已经暂停，
  // 左侧菜单却还留着该能力的入口，点进去才 403。
  const invalidateAll = async () => {
    if (!isCurrentScope()) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["rental-core", "capabilities", scopeKey] }),
      queryClient.invalidateQueries({ queryKey: ["rental-core", "capability-audits", scopeKey] })
    ]);
    if (isCurrentScope()) await refreshSession();
  };

  const save = useMutation({
    mutationFn: (data: SaveWorkspaceCapabilityRequest) => {
      assertManage();
      return rentalCoreApi.saveCapability(data);
    },
    onSuccess: async () => {
      await invalidateAll();
      if (!isCurrentScope()) return;
      setEditorState(undefined);
      form.resetFields();
      message.success(t("能力状态已更新"));
    }
  });

  const upgrade = useMutation({
    mutationFn: (view: WorkspaceCapabilityView) => {
      assertManage();
      return rentalCoreApi.upgradeCapability(view.definition.code, {
        reason: `升级到 ${view.definition.implementationVersion ?? ""}`,
        expectedRevision: view.instance?.revision
      });
    },
    onSuccess: async () => {
      await invalidateAll();
      if (isCurrentScope()) message.success(t("能力实现版本已升级；历史报价与在途订单仍按原快照执行"));
    },
    onError: (error: Error) => {
      if (isCurrentScope()) message.error(error.message || t("升级失败"));
    }
  });

  const reportLifecycleError = (error: unknown) => {
    if (!isCurrentScope() || error && typeof error === "object"
      && ("errorFields" in error || "name" in error && error.name === "AbortError")) return;
    message.error(error instanceof Error && error.message
      ? error.message : t("更新失败：请检查依赖、互斥能力与配置项"));
  };

  // 生命周期编辑共用现有 Rental 表单代次，查询刷新保留原打开时的修订和输入。
  const editor = useOrderEditor<LifecycleFormValues>({ form,
    identity: editorState ? JSON.stringify([scopeKey, editorState.generation, editing?.definition.code]) : undefined,
    onSave: submitLifecycle, onError: reportLifecycleError, disabled: !canManage
  });
  const lifecycleForm = useMemo(() => ({ ...form, validateFields: editor.validate }), [form, editor.key]);

  function executeUpgrade(view: WorkspaceCapabilityView): Promise<unknown> {
    const key = JSON.stringify([scopeKey, view.definition.code, view.instance?.revision]);
    const pending = upgradeRequest.current;
    if (pending) {
      if (pending.key === key) return pending.request;
      return Promise.reject(new Error(t("正在保存，请等待操作完成。")));
    }
    const request = upgrade.mutateAsync(view);
    upgradeRequest.current = { key, request };
    void request.finally(() => {
      if (upgradeRequest.current?.request === request) upgradeRequest.current = undefined;
    }).catch(() => undefined);
    return request;
  }

  function openEditor(view: WorkspaceCapabilityView) {
    if (!isCurrentScope() || !host.canAccess(RENTAL_CAPABILITY_CORE_ID, [{ resource: "capability", action: "manage" }])
      || !view.implemented || !view.applicable || view.providedByCore) return;
    editor.dismiss(() => {
      editorGeneration.current += 1;
      setEditorState({ view, generation: editorGeneration.current });
      // AntD 保留卸载字段，切换能力先清掉前一个配置的字段和值。
      form.resetFields();
      form.setFieldsValue({
        status: view.instance?.status ?? "enabled",
        reason: "",
        config: Object.fromEntries(
          Object.entries(view.instance?.config ?? {}).map(([key, value]) => [
            key,
            Array.isArray(value) ? JSON.stringify(value, null, 2) : value
          ])
        ) as LifecycleFormValues["config"]
      });
      editor.markClean();
    });
  }

  function normalizedConfig(view: WorkspaceCapabilityView, config: RentalCapabilityConfig | undefined): RentalCapabilityConfig | undefined {
    if (!config) return undefined;
    const relationKeys = new Set(
      view.definition.configSchema.filter((field) => field.type === "compatibility_relations").map((field) => field.key)
    );
    return Object.fromEntries(
      Object.entries(config).map(([key, value]) => {
        if (!relationKeys.has(key) || typeof value !== "string") return [key, value];
        try {
          return [key, JSON.parse(value)];
        } catch {
          throw new Error(`${t("配置项")} ${t(view.definition.configSchema.find((field) => field.key === key)?.label ?? key)} ${t("不是有效 JSON")}`);
        }
      })
    );
  }

  async function submitLifecycle(values: LifecycleFormValues): Promise<unknown> {
    if (!editing) throw new Error("Capability editor unavailable");
    assertManage();
    return save.mutateAsync({
      code: editing.definition.code,
      status: values.status,
      reason: values.reason,
      config: normalizedConfig(editing, values.config),
      expectedRevision: editing.instance?.revision ?? 0
    });
  }

  const data = overview.data;
  const missing = data?.missingRequired ?? [];
  const capabilityNames = (codes: string[]) => codes.map(code => t(data?.capabilities.find(item => item.definition.code === code)?.definition.label ?? code)).join(" · ");
  const configValue = (value: RentalCapabilityConfig[string] | undefined) => {
    if (value === undefined) return t("未配置");
    if (typeof value === "boolean") return t(value ? "是" : "否");
    if (Array.isArray(value)) return t("{count} 条兼容关系", { count: value.length });
    return t(capabilityOptionLabels[String(value)] ?? String(value));
  };
  const inspectAudit = (code: string) => { setAuditCode(code); setView("audit"); };

  return (
    <CorePage>
      <UnsavedChangesGuard dirty={Boolean(editing) && editor.dirty} busy={save.isPending} />
      <Tabs activeKey={view} onChange={setView} aria-label={t("经营空间能力")} items={[
        { key: "capabilities", label: t("能力目录"), children:
      <QueryState loading={overview.isLoading} error={overview.error}>
        {/* 「可访问」与「已达生产经营条件」分开表示：开发/演示空间可以继续验证通用
            Rental Core，但必须明确显示缺失的首期必选能力，不得因为进得去就当成能力齐备。 */}
        {data?.productionReady ? (
          <Alert
            type="success"
            showIcon
            title={t("该经营空间已达到生产经营条件")}
            description={t("本品类声明的必选能力均已启用。")}
            style={{ marginBottom: 16 }}
          />
        ) : (
          <Alert
            type="warning"
            showIcon
            title={t("该经营空间尚未达到生产经营条件")}
            description={
              missing.length
                ? `${t("仍缺少必选能力")}：${missing.map((item) => t(item)).join("、")}。${t("缺失期间可以继续验证通用 Rental Core 流程，但不应据此认定品类能力已具备。")}`
                : t("本品类没有已实现的必选能力，暂时只能验证通用 Rental Core 流程。")
            }
            style={{ marginBottom: 16 }}
          />
        )}
        {!canManage && (
          <Alert
            type="info"
            showIcon
            title={t("当前账号只有查看权限")}
            description={t("启用、暂停、停用与升级需要「经营空间能力治理」权限。")}
            style={{ marginBottom: 16 }}
          />
        )}
        <ListSection controls={<ListFilters filter={capabilityFilter} placeholder="搜索能力名称" options={Object.entries(stateMeta).map(([value,meta])=>({value,label:t(meta.label)}))}/>}>
          <Table<WorkspaceCapabilityView>
            cardView={{
              kind: "capability", defaultView: "cards", title: row => t(row.definition.label), subtitle: row => row.definition.code,
              status: row => <CardBadge tone={row.state === "enabled" ? "positive" : undefined} emphasis={row.state === "declared_not_implemented"}>{t(stateMeta[row.state].label)}</CardBadge>,
              body: row => <>
                {!row.providedByCore && <CardSecondary>{t(row.requiredForCategory ? "品类必选" : kindMeta[row.definition.kind].label)}</CardSecondary>}
                <ul className={capabilityCardStyles.readiness}>
                  {[
                    { ready: row.applicable, text: row.applicable ? "适用于当前品类" : "不适用于当前品类" },
                    { ready: row.declaredByCategory, text: row.declaredByCategory ? "本品类已声明" : "本品类未声明" },
                    { ready: row.providedByCore || row.implemented, text: row.providedByCore ? "Core 内建" : row.implemented ? "已实现" : "未实现" },
                  ].map(item => <li key={item.text} data-blocked={item.ready ? undefined : ""}><span className={capabilityCardStyles.mark}>{item.ready ? <Check aria-hidden="true" /> : <Minus aria-hidden="true" />}</span>{t(item.text)}</li>)}
                </ul>
                <div className={capabilityCardStyles.dependencies}><span>{t("依赖")}：{capabilityNames(row.definition.dependsOn) || t("无依赖")}</span><span>{t("配置项")} {row.definition.configSchema.length}</span></div>
                {!!row.definition.conflictsWith.length && <CardSecondary>{t("互斥")}：{capabilityNames(row.definition.conflictsWith)}</CardSecondary>}
                {row.upgradeAvailable && <CardSecondary>{t("可升级到")} {row.definition.implementationVersion}</CardSecondary>}
              </>,
              details: row => <CardSection title={t("状态与配置")}>
                {row.providedByCore && <CardSecondary>{t("该能力由 Rental Core 内建提供，请到对应业务规则中配置")}</CardSecondary>}
                {!row.implemented && <CardSecondary>{t("该能力只登记了扩展点，尚无可执行模块，不能启用")}</CardSecondary>}
                <CardFacts items={[
                  { label: t("实现"), value: row.instance?.implementationVersion ?? row.definition.implementationVersion ?? t("未实现") },
                  { label: t("配置版本"), value: row.instance?.configVersion ?? t("未配置") },
                  { label: t("依赖"), value: capabilityNames(row.definition.dependsOn) || t("无依赖") },
                  ...row.definition.configSchema.map(field => ({ label: t(field.label), value: configValue(row.instance?.config?.[field.key]) })),
                ]} />
              </CardSection>,
              actions: (row, afterClose) => <>
                <ArcButton variant="secondary" size="sm" disabled={!canManage || !row.implemented || !row.applicable || row.providedByCore} onClick={() => afterClose(() => openEditor(row))}>{t("状态与配置")}</ArcButton>
                {row.upgradeAvailable && <ArcButton variant="secondary" size="sm" disabled={!canManage || upgrade.isPending} onClick={() => afterClose(() => { void executeUpgrade(row).catch(() => undefined); })}>{t("升级")}</ArcButton>}
                <ArcButton variant="secondary" size="sm" onClick={() => afterClose(() => inspectAudit(row.definition.code))}>{t("审计")}</ArcButton>
              </>,
            }}
            rowKey={(row) => row.definition.code}
            onRefresh={() => overview.refetch()} loading={overview.isLoading} refreshing={overview.isFetching} dataSource={capabilityFilter.rows} pagination={capabilityFilter.pagination}
            scroll={{ x: 1280 }}
            columns={[
              {
                title: t("能力"),
                fixed: "left",
                render: (_, row) => <DataTableText primary={t(row.definition.label)} secondary={row.definition.code} />
              },
              {
                title: t("当前品类定位"),
                render: (_, row) =>
                  row.providedByCore ? (
                    <Tag color="blue">{t("Core 内建")}</Tag>
                  ) : row.requiredForCategory ? (
                    <Tag color="red">{t("品类必选")}</Tag>
                  ) : (
                    <Tag color={kindMeta[row.definition.kind].color}>{t(kindMeta[row.definition.kind].label)}</Tag>
                  )
              },
              {
                title: t("状态"),
                render: (_, row) => (
                  <Space orientation="vertical" size={2}>
                    <Tag color={stateMeta[row.state].color}>{t(stateMeta[row.state].label)}</Tag>
                    {!row.applicable && <span className="muted">{t("不适用于当前品类")}</span>}
                    {row.applicable && !row.declaredByCategory && <span className="muted">{t("本品类未声明")}</span>}
                  </Space>
                )
              },
              {
                title: t("依赖 / 互斥"),
                render: (_, row) => (
                  <Space orientation="vertical" size={2}>
                    {row.definition.dependsOn.length ? <span>{t("依赖")}：{capabilityNames(row.definition.dependsOn)}</span> : <span className="muted">{t("无依赖")}</span>}
                    {row.definition.conflictsWith.length ? <span>{t("互斥")}：{capabilityNames(row.definition.conflictsWith)}</span> : null}
                  </Space>
                )
              },
              {
                title: t("版本"),
                render: (_, row) => (
                  <Space orientation="vertical" size={2}>
                    <span>{t("实现")}：{row.instance?.implementationVersion ?? row.definition.implementationVersion ?? t("未实现")}</span>
                    <span className="muted">{t("配置")}：{row.instance?.configVersion ?? "-"}</span>
                    {row.upgradeAvailable && <Tag color="processing">{t("可升级到")} {row.definition.implementationVersion}</Tag>}
                  </Space>
                )
              },
              {
                title: t("配置"),
                render: (_, row) =>
                  row.definition.configSchema.length ? (
                    <Space orientation="vertical" size={2}>
                      {row.definition.configSchema.map((field) => (
                        <span key={field.key}>
                          {t(field.label)}：{configValue(row.instance?.config?.[field.key])}
                        </span>
                      ))}
                    </Space>
                  ) : (
                    <span className="muted">{t("无配置项")}</span>
                  )
              },
              {
                title: t("操作"),
                fixed: "right",
                render: (_, row) => (
                  <Space>
                    <Tooltip
                      title={
                        !row.implemented
                          ? t("该能力只登记了扩展点，尚无可执行模块，不能启用")
                          : row.providedByCore
                            ? t("该能力由 Rental Core 内建提供，请到对应业务规则中配置")
                          : !row.applicable
                            ? t("该能力不适用于当前经营品类")
                            : undefined
                      }
                    >
                      <Button
                        type="link"
                        icon={<SettingOutlined />}
                        disabled={!canManage || !row.implemented || !row.applicable || row.providedByCore}
                        onClick={() => openEditor(row)}
                      >
                        {t("状态与配置")}
                      </Button>
                    </Tooltip>
                    {row.upgradeAvailable && (
                      <Button type="link" loading={upgrade.isPending} disabled={!canManage} onClick={() => {
                        const request = executeUpgrade(row);
                        void request.catch(() => undefined);
                        return request;
                      }}>
                        {t("升级")}
                      </Button>
                    )}
                    <Button type="link" icon={<HistoryOutlined />} onClick={() => inspectAudit(row.definition.code)}>
                      {t("审计")}
                    </Button>
                  </Space>
                )
              }
            ]}
          />
        </ListSection>
      </QueryState> },
        { key: "audit", label: t("生命周期审计"), children:
      <ListSection id="capability-audits" title={
          <Space>
            <span>{t("生命周期审计")}</span>
            {auditCode ? <Tag>{auditCode}</Tag> : <Tag>{t("全部能力")}</Tag>}
          </Space>
        } extra={auditCode ? <Button onClick={() => setAuditCode(undefined)}>{t("查看全部")}</Button> : null}>

        <QueryState loading={audits.isLoading} error={audits.error}>
          <Table
            rowKey={(row) => `${row.code}:${row.at}:${row.action}`}
            onRefresh={() => audits.refetch()} loading={audits.isLoading} refreshing={audits.isFetching} dataSource={audits.data ?? []}
            columns={[
              { title: t("时间"), dataIndex: "at" },
              { title: t("能力"), dataIndex: "code" },
              { title: t("动作"), dataIndex: "action" },
              { title: t("状态变化"), render: (_, row) => `${row.fromStatus ? t(row.fromStatus) : t("（无实例）")} → ${t(row.toStatus)}` },
              { title: t("实现 / 配置版本"), render: (_, row) => `${row.implementationVersion ?? "-"} / ${row.configVersion ?? "-"}` },
              {
                title: t("配置快照"),
                render: (_, row) => row.configSnapshot
                  ? <Tooltip title={<pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(row.configSnapshot, null, 2)}</pre>}><Button type="link" size="small">{t("查看")}</Button></Tooltip>
                  : "-"
              },
              { title: t("原因"), dataIndex: "reason" },
              { title: t("操作人"), dataIndex: "operator" }
            ]}
          />
        </QueryState>
      </ListSection> }
      ]} />

      <Drawer
        title={editing ? `${t(editing.definition.label)} · ${t("状态与配置")}` : t("状态与配置")}
        size={560}
        open={Boolean(editing)}
        destroyOnHidden
        onClose={() => editor.dismiss(() => setEditorState(undefined))}
        extra={
          <SaveButton label={t("保存")} form={lifecycleForm} pending={save.isPending}
            disabled={!canManage} onSave={editor.submit} onActionError={reportLifecycleError} />
        }
      >
        {editing && (
          <Form<LifecycleFormValues>
            form={form}
            layout="vertical"
            disabled={!canManage || save.isPending}
            {...editor.formProps}
          >
            <Alert
              type="info"
              showIcon
              title={t("暂停与停用会立即收回菜单入口与 API 放行")}
              description={t("已启用是唯一可用状态。暂停后该能力的接口会返回 403，历史数据不受影响。")}
              style={{ marginBottom: 16 }}
            />
            <Form.Item name="status" label={t("目标状态")} rules={[{ required: true }]}>
              <Select
                options={[
                  { value: "enabled", label: t("启用") },
                  { value: "paused", label: t("暂停") },
                  { value: "disabled", label: t("停用") }
                ]}
              />
            </Form.Item>
            {editing.definition.configSchema.map((field) => (
              <ConfigField key={field.key} field={field} />
            ))}
            <Form.Item name="reason" label={t("变更原因")} rules={[{ required: true, message: t("变更能力状态必须填写原因") }]}>
              <Input.TextArea rows={3} maxLength={500} showCount placeholder={t("例如：门店已具备配送人员与车辆，开通同城配送")} />
            </Form.Item>
          </Form>
        )}
      </Drawer>
    </CorePage>
  );
}
