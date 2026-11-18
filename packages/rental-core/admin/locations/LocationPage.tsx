/** 履约网络沿原地点与经营主体表单、卡片和列表能力，当前范围拥有编辑状态。 */
import type {
  RentalFulfillmentLocation,
  RentalFulfillmentOperator,
  SaveRentalFulfillmentLocationRequest,
  SaveRentalFulfillmentOperatorRequest,
} from "@rental-os/rental-core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Col, InputNumber, Row, Space, Tag } from "antd";
import {
  ActionButton,
  Alert,
  App,
  Button,
  ContentTransition,
  DataTableText,
  Form,
  Input,
  ListSection,
  Modal,
  SaveButton,
  SearchField,
  Select,
  Table,
  Tabs,
  useModalDismissal,
} from "@rental-os/platform-admin/ui";
import { CorePage, QueryState, UnsavedChangesGuard, useCorePageHost } from "@rental-os/platform-admin/core";
import { useLocale } from "@rental-os/platform-admin/locale";
import { PlusOutlined } from "@rental-os/platform-admin/source/components/ui/icons";
import { SettingsWorkspace } from "@rental-os/platform-admin/source/components/settings/SettingsWorkspace";
import { ADMIN_TABLE_COLUMN_WIDTH } from "@rental-os/platform-admin/source/app/designTokens";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useOrderEditor } from "../orders/useOrderEditor";
import { locationCapabilities, operatorCapabilities } from "./listCapabilities";
import { locationCards } from "./locationCards";
import type { RentalLocationPageContext } from "./page-context";
import { RENTAL_LOCATION_CORE_ID, rentalLocationTitle } from "./pages";

const locationTypeLabels: Record<string, string> = {
  store: "门店",
  warehouse: "仓库",
  station: "取还点",
  locker: "自提柜",
  delivery_hub: "配送中心",
  project_site: "项目现场",
};
const capabilityLabels: Record<string, string> = {
  pickup: "领取",
  return: "归还",
  storage: "仓储",
  delivery: "配送",
};

interface LocationEditorState {
  record?: RentalFulfillmentLocation;
  generation: number;
}
interface OperatorEditorState {
  record?: RentalFulfillmentOperator;
  generation: number;
}

export function LocationPage(context: RentalLocationPageContext) {
  return <LocationWorkspace key={context.scopeKey} {...context} />;
}

function LocationWorkspace({
  api: rentalCoreApi,
  scopeKey,
  currentScopeKey,
  canViewOrganizations: readOrganizationAccess,
  canManageOrganizationMapping: readOrganizationMappingAccess,
}: RentalLocationPageContext) {
  const { message } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const host = useCorePageHost();
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const isCurrentScope = () => active.current && Boolean(scopeKey) && currentScopeKey() === scopeKey;
  const canManage = host.canAccess(RENTAL_LOCATION_CORE_ID, [{ resource: "station", action: "manage" }]);
  const canManageOrganizationMapping = readOrganizationMappingAccess();
  const canViewOrganizations = readOrganizationAccess();
  const allowed = () =>
    isCurrentScope() && host.canAccess(RENTAL_LOCATION_CORE_ID, [{ resource: "station", action: "manage" }]);
  const assertManage = () => {
    if (!isCurrentScope()) throw new DOMException("地点页面的会话或经营空间已变化", "AbortError");
    if (!allowed()) throw new Error(t("当前操作不可用"));
  };
  const [keyword, setKeyword] = useState("");
  const [view, setView] = useState("locations");
  const editorGeneration = useRef(0);
  const [locationEditorState, setLocationEditorState] = useState<LocationEditorState>();
  const [operatorEditorState, setOperatorEditorState] = useState<OperatorEditorState>();
  const editing = locationEditorState?.record;
  const editingOperator = operatorEditorState?.record;
  const drawerOpen = Boolean(locationEditorState);
  const operatorDrawerOpen = Boolean(operatorEditorState);
  const [form] = Form.useForm<SaveRentalFulfillmentLocationRequest>();
  const [operatorForm] = Form.useForm<SaveRentalFulfillmentOperatorRequest>();
  const locationDismissal = useModalDismissal(drawerOpen, () => {
    setLocationEditorState(undefined);
    form.resetFields();
  });
  const operatorDismissal = useModalDismissal(operatorDrawerOpen, () => {
    setOperatorEditorState(undefined);
    operatorForm.resetFields();
  });
  const locations = useQuery({
    queryKey: ["rental-core", "locations", scopeKey],
    enabled: Boolean(scopeKey),
    queryFn: ({ signal }) => rentalCoreApi.locations({ signal }),
  });
  const organizations = useQuery({
    queryKey: ["tenant-access", "organizations", scopeKey],
    queryFn: ({ signal }) => rentalCoreApi.organizations({ signal }),
    enabled: Boolean(scopeKey) && canViewOrganizations,
  });
  const operators = useQuery({
    queryKey: ["rental-core", "operators", scopeKey],
    enabled: Boolean(scopeKey),
    queryFn: ({ signal }) => rentalCoreApi.operators({ signal }),
  });
  const profile = useQuery({
    queryKey: ["rental-core", "profile", scopeKey],
    enabled: Boolean(scopeKey),
    queryFn: ({ signal }) => rentalCoreApi.profile({ signal }),
  });
  const categories = useQuery({
    queryKey: ["rental-core", "categories", scopeKey],
    enabled: Boolean(scopeKey),
    queryFn: ({ signal }) => rentalCoreApi.categories({ signal }),
  });
  const category = categories.data?.find((item) => item.code === profile.data?.categoryCode);
  const organizationNames = useMemo(
    () => new Map((organizations.data ?? []).map((item) => [item.id, item.name])),
    [organizations.data],
  );
  const save = useMutation({
    mutationFn: (values: SaveRentalFulfillmentLocationRequest) => {
      assertManage();
      return rentalCoreApi.saveLocation(values);
    },
    onSuccess: async () => {
      if (!isCurrentScope()) return;
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "locations"] });
      if (!isCurrentScope()) return;
      locationDismissal.dismiss();
      message.success(t("履约地点已保存"));
    },
  });
  const saveOperator = useMutation({
    mutationFn: (values: SaveRentalFulfillmentOperatorRequest) => {
      assertManage();
      return rentalCoreApi.saveOperator(values);
    },
    onSuccess: async () => {
      if (!isCurrentScope()) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "operators"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "locations"] }),
      ]);
      if (!isCurrentScope()) return;
      operatorDismissal.dismiss();
      message.success(t("经营主体已保存"));
    },
  });
  const rows = useMemo(
    () =>
      (locations.data ?? []).filter(
        (item) =>
          !keyword ||
          `${item.code}${item.name}${item.operatorName}${item.address}${organizationNames.get(item.organizationId ?? "") ?? ""}`
            .toLowerCase()
            .includes(keyword.toLowerCase()),
      ),
    [keyword, locations.data, organizationNames],
  );
  const locationUnavailable =
    !canManage ||
    !category ||
    locations.isError ||
    operators.isPending ||
    operators.isError ||
    profile.isError ||
    categories.isError ||
    (canManageOrganizationMapping && (organizations.isPending || organizations.isError));
  const operatorUnavailable = !canManage || operators.isPending || operators.isError;
  const cards = locationCards({
    t,
    typeLabels: locationTypeLabels,
    capabilityLabels,
    canManage: !locationUnavailable && !save.isPending,
    edit: openEditor,
  });

  const locationEditor = useOrderEditor<SaveRentalFulfillmentLocationRequest>({
    form,
    identity: locationEditorState
      ? JSON.stringify([scopeKey, "location", locationEditorState.generation, editing?.id])
      : undefined,
    onSave: submitLocation,
    disabled: locationUnavailable,
  });
  const operatorEditor = useOrderEditor<SaveRentalFulfillmentOperatorRequest>({
    form: operatorForm,
    identity: operatorEditorState
      ? JSON.stringify([scopeKey, "operator", operatorEditorState.generation, editingOperator?.id])
      : undefined,
    onSave: submitOperator,
    disabled: operatorUnavailable,
  });
  const locationForm = useMemo(
    () => ({ ...form, validateFields: locationEditor.validate }),
    [form, locationEditor.key],
  );
  const boundOperatorForm = useMemo(
    () => ({ ...operatorForm, validateFields: operatorEditor.validate }),
    [operatorForm, operatorEditor.key],
  );
  const listContext = { api: rentalCoreApi, allowed };

  function submitLocation(values: SaveRentalFulfillmentLocationRequest): Promise<unknown> {
    assertManage();
    if (locationUnavailable || save.isPending) return Promise.reject(new Error(t("当前操作不可用")));
    const payload: SaveRentalFulfillmentLocationRequest = { ...values, id: editing?.id };
    if (readOrganizationMappingAccess()) payload.organizationId = values.organizationId || null;
    else delete payload.organizationId;
    return save.mutateAsync(payload);
  }

  function submitOperator(values: SaveRentalFulfillmentOperatorRequest): Promise<unknown> {
    assertManage();
    if (operatorUnavailable || saveOperator.isPending) return Promise.reject(new Error(t("当前操作不可用")));
    return saveOperator.mutateAsync({ ...values, id: editingOperator?.id });
  }

  function openEditor(record?: RentalFulfillmentLocation) {
    if (locationUnavailable || save.isPending || !allowed() || (drawerOpen && !locationDismissal.visible))
      return;
    locationEditor.dismiss(() => {
      editorGeneration.current += 1;
      setLocationEditorState({ record, generation: editorGeneration.current });
      form.resetFields();
      form.setFieldsValue(
        record
          ? { ...record }
          : {
              code: "",
              name: "",
              organizationId: undefined,
              type: category?.businessModel.locationTypes[0] ?? "store",
              operatorId: operators.data?.find((item) => item.status === "enabled")?.id,
              capabilities: ["pickup", "return", "storage"],
              address: "",
              province: "",
              city: "",
              district: "",
              timezone: "Asia/Shanghai",
              latitude: undefined,
              longitude: undefined,
              contactName: "",
              contactPhone: "",
              businessHours: "09:00-18:00",
              status: "enabled",
            },
      );
      locationEditor.markClean();
    });
  }

  function openOperatorEditor(record?: RentalFulfillmentOperator) {
    if (
      operatorUnavailable ||
      saveOperator.isPending ||
      !allowed() ||
      (operatorDrawerOpen && !operatorDismissal.visible)
    )
      return;
    operatorEditor.dismiss(() => {
      editorGeneration.current += 1;
      setOperatorEditorState({ record, generation: editorGeneration.current });
      operatorForm.resetFields();
      operatorForm.setFieldsValue(
        record
          ? { ...record }
          : { code: "", name: "", type: "partner", settlementMode: "monthly", status: "enabled" },
      );
      operatorEditor.markClean();
    });
  }

  return (
    <CorePage
      title={t(rentalLocationTitle(profile.data?.terminology))}
      note={{
        title: `${t(category?.name ?? "当前品类")}${t("履约网络")}`,
        description: t(
          "自营机构与合作商是经营主体；门店、仓库、自提柜、取还点和项目现场是主体下的履约地点。订单保存地点与经营主体快照，避免后续档案变更影响历史单据。",
        ),
      }}
      actions={
        canManage
          ? [
              {
                id: view === "operators" ? "create-operator" : "create-location",
                kind: "open",
                label: { default: t(view === "operators" ? "新增经营主体" : "新增履约地点") },
                emphasis: "primary",
                permissions: [{ resource: "station", action: "manage" }],
                icon: <PlusOutlined />,
                disabled:
                  view === "operators"
                    ? operatorUnavailable || saveOperator.isPending
                    : locationUnavailable || save.isPending,
                open: () => (view === "operators" ? openOperatorEditor() : openEditor()),
              },
            ]
          : []
      }
    >
      <UnsavedChangesGuard
        dirty={(drawerOpen && locationEditor.dirty) || (operatorDrawerOpen && operatorEditor.dirty)}
        busy={save.isPending || saveOperator.isPending}
      />
      <Tabs
        aria-label={t("履约网络")}
        activeKey={view}
        onChange={setView}
        items={[
          { key: "locations", label: t("履约地点") },
          { key: "operators", label: t("经营主体") },
        ]}
      />
      <ContentTransition value={view}>
        <div hidden={view !== "operators"}>
          <ListSection title={t("经营主体")} style={{ marginBottom: "var(--rental-layout-section-gap)" }}>
            <QueryState
              loading={operators.isLoading}
              error={operators.error}
              onRetry={() => operators.refetch({ throwOnError: true })}
            >
              <Table<RentalFulfillmentOperator>
                rowKey="id"
                onRefresh={() => operators.refetch()}
                loading={operators.isLoading}
                refreshing={operators.isFetching}
                dataSource={operators.data ?? []}
                pagination={false}
                {...operatorCapabilities(
                  t,
                  () =>
                    Promise.all([
                      operators.refetch({ throwOnError: true }),
                      locations.refetch({ throwOnError: true }),
                    ]),
                  listContext,
                )}
                columns={[
                  {
                    title: t("主体"),
                    dataIndex: "name",
                    minWidth: ADMIN_TABLE_COLUMN_WIDTH.identity,
                    render: (_, row) => <DataTableText primary={row.name} secondary={row.code} />,
                  },
                  {
                    title: t("经营方式"),
                    dataIndex: "type",
                    render: (value) => (
                      <Tag color={value === "partner" ? "purple" : "blue"}>
                        {t(value === "partner" ? "合作商" : "自营")}
                      </Tag>
                    ),
                  },
                  {
                    title: t("结算方式"),
                    dataIndex: "settlementMode",
                    render: (value) =>
                      t({ self: "内部结算", monthly: "月结", per_order: "逐单结算" }[value as string] ?? "-"),
                  },
                  {
                    title: t("联系人"),
                    render: (_, row) => (
                      <DataTableText
                        primary={row.contactName || row.contactPhone || "—"}
                        secondary={row.contactName ? row.contactPhone : undefined}
                      />
                    ),
                  },
                  {
                    title: t("状态"),
                    dataIndex: "status",
                    render: (value) => (
                      <Tag color={value === "enabled" ? "success" : "default"}>
                        {t(value === "enabled" ? "启用" : "停用")}
                      </Tag>
                    ),
                  },
                  {
                    title: t("操作"),
                    render: (_, row) =>
                      canManage ? (
                        <Button
                          type="link"
                          disabled={operatorUnavailable || saveOperator.isPending}
                          onClick={() => openOperatorEditor(row)}
                        >
                          {t("编辑")}
                        </Button>
                      ) : (
                        "-"
                      ),
                  },
                ]}
              />
            </QueryState>
          </ListSection>
        </div>
        <div hidden={view !== "locations"}>
          {(operators.isError || (canViewOrganizations && organizations.isError)) && (
            <div style={{ marginBottom: "var(--rental-layout-section-gap)" }}>
              <Alert
                type="warning"
                showIcon
                title={t("地点关联资料读取失败")}
                description={t("地点列表仍可查看，重新载入关联资料后再编辑。")}
                action={
                  <ActionButton
                    label={t("重试")}
                    onAction={() =>
                      Promise.all([
                        operators.refetch({ throwOnError: true }),
                        ...(canViewOrganizations ? [organizations.refetch({ throwOnError: true })] : []),
                      ])
                    }
                  />
                }
              />
            </div>
          )}
          <ListSection
            controls={
              <>
                <SearchField
                  label={t("搜索履约地点")}
                  placeholder={t("搜索地点、经营主体或地址")}
                  value={keyword}
                  onValueChange={setKeyword}
                  style={{ width: "var(--rental-control-width-search)" }}
                />
              </>
            }
          >
            <QueryState
              loading={locations.isLoading || profile.isLoading || categories.isLoading}
              error={locations.error || profile.error || categories.error}
              onRetry={() =>
                Promise.all([
                  locations.refetch({ throwOnError: true }),
                  profile.refetch({ throwOnError: true }),
                  categories.refetch({ throwOnError: true }),
                ])
              }
            >
              <Table<RentalFulfillmentLocation>
                emptyScene={keyword.trim() ? "search" : "empty"}
                cardView={cards}
                rowKey="id"
                onRefresh={() => locations.refetch()}
                loading={locations.isLoading}
                refreshing={locations.isFetching}
                dataSource={rows}
                scroll={{ x: 960 }}
                {...locationCapabilities(
                  t,
                  category?.businessModel.locationTypes ?? [],
                  () => locations.refetch({ throwOnError: true }),
                  listContext,
                )}
                columns={[
                  {
                    title: t("履约地点"),
                    dataIndex: "name",
                    minWidth: ADMIN_TABLE_COLUMN_WIDTH.location,
                    fixed: "left",
                    render: (_, row) => <DataTableText primary={row.name} secondary={row.code} />,
                  },
                  {
                    title: t("归属组织"),
                    render: (_, row) =>
                      row.organizationId
                        ? (organizationNames.get(row.organizationId) ?? t("已关联组织"))
                        : t("未分配"),
                  },
                  {
                    title: t("经营主体"),
                    dataIndex: "operatorName",
                    render: (_, row) => (
                      <DataTableText
                        primary={row.operatorName ?? t("未配置")}
                        secondary={
                          row.operatorType ? t(row.operatorType === "partner" ? "合作商" : "自营") : undefined
                        }
                      />
                    ),
                  },
                  {
                    title: t("地点类型"),
                    dataIndex: "type",
                    render: (value) => <Tag>{t(locationTypeLabels[value] ?? value)}</Tag>,
                  },
                  {
                    title: t("履约能力"),
                    dataIndex: "capabilities",
                    render: (values: string[]) =>
                      values.length ? (
                        <Space wrap size={[8, 4]}>
                          {values.map((value) => (
                            <span key={value} style={{ whiteSpace: "nowrap" }}>
                              {t(capabilityLabels[value] ?? value)}
                            </span>
                          ))}
                        </Space>
                      ) : (
                        "—"
                      ),
                  },
                  { title: t("地址"), dataIndex: "address", render: (value) => value || "-" },
                  {
                    title: t("联系人"),
                    render: (_, row) => (
                      <DataTableText
                        primary={row.contactName || row.contactPhone || "—"}
                        secondary={row.contactName ? row.contactPhone : undefined}
                      />
                    ),
                  },
                  {
                    title: t("状态"),
                    dataIndex: "status",
                    render: (value) => (
                      <Tag color={value === "enabled" ? "success" : "default"}>
                        {t(value === "enabled" ? "启用" : "停用")}
                      </Tag>
                    ),
                  },
                  {
                    title: t("操作"),
                    fixed: "right",
                    render: (_, row) =>
                      canManage ? (
                        <Button
                          type="link"
                          disabled={locationUnavailable || save.isPending}
                          onClick={() => openEditor(row)}
                        >
                          {t("编辑")}
                        </Button>
                      ) : (
                        "-"
                      ),
                  },
                ]}
              />
            </QueryState>
          </ListSection>
        </div>
      </ContentTransition>

      <Modal
        presentation="side"
        title={editing ? t("编辑履约地点") : t("新增履约地点")}
        width={640}
        open={locationDismissal.visible}
        destroyOnHidden
        onCancel={() => locationEditor.dismiss(locationDismissal.dismiss)}
        afterClose={locationDismissal.afterClose}
        closable={!save.isPending}
        keyboard={!save.isPending}
        maskClosable={!save.isPending}
        footer={
          <>
            <Button
              disabled={save.isPending}
              onClick={() => locationEditor.dismiss(locationDismissal.dismiss)}
            >
              {t("取消")}
            </Button>
            <SaveButton
              disabled={locationUnavailable}
              label={t("保存")}
              form={locationForm}
              pending={save.isPending}
              onSave={locationEditor.submit}
              onActionError={(error) => {
                if (isCurrentScope() && !(error && typeof error === "object" && "errorFields" in error))
                  message.error(t("保存失败，请检查地点类型、编码、经营主体和履约能力"));
              }}
            />
          </>
        }
      >
        <Form<SaveRentalFulfillmentLocationRequest>
          name="fulfillment-location"
          form={form}
          layout="vertical"
          disabled={locationUnavailable || save.isPending}
          {...locationEditor.formProps}
        >
          {locationEditor.error instanceof Error && (
            <Alert type="error" showIcon title={locationEditor.error.message} />
          )}
          <SettingsWorkspace
            sections={[
              {
                key: "profile",
                label: t("基本资料"),
                content: (
                  <div>
                    <Row gutter={16}>
                      <Col span={24}>
                        <Form.Item name="name" label={t("地点名称")} rules={[{ required: true }]}>
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="code" label={t("地点编码")} rules={[{ required: true }]}>
                          <Input disabled={Boolean(editing) || locationUnavailable || save.isPending} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="type" label={t("地点类型")} rules={[{ required: true }]}>
                          <Select
                            options={category?.businessModel.locationTypes.map((value) => ({
                              value,
                              label: t(locationTypeLabels[value] ?? value),
                            }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="parentLocationId" label={t("上级地点")}>
                          <Select
                            allowClear
                            options={(locations.data ?? [])
                              .filter((item) => item.id !== editing?.id)
                              .map((item) => ({ value: item.id, label: item.name }))}
                          />
                        </Form.Item>
                      </Col>
                      {canManageOrganizationMapping ? (
                        <Col span={24}>
                          <Form.Item
                            name="organizationId"
                            label={t("归属组织")}
                            tooltip={t(
                              "组织范围账号只能访问当前组织及下级组织明确关联的履约地点；未关联地点不会自动归属。",
                            )}
                          >
                            <Select
                              allowClear
                              loading={organizations.isLoading}
                              options={(organizations.data ?? [])
                                .filter(
                                  (item) => item.status === "enabled" || item.id === editing?.organizationId,
                                )
                                .map((item) => ({
                                  value: item.id,
                                  label: `${item.name} · ${item.code}${item.status === "enabled" ? "" : ` · ${t("已停用")}`}`,
                                  disabled: item.status !== "enabled",
                                }))}
                            />
                          </Form.Item>
                        </Col>
                      ) : null}
                      <Col span={24}>
                        <Form.Item name="operatorId" label={t("经营主体")} rules={[{ required: true }]}>
                          <Select
                            options={(operators.data ?? [])
                              .filter((item) => item.status === "enabled" || item.id === editing?.operatorId)
                              .map((item) => ({
                                value: item.id,
                                label: `${item.name} · ${t(item.type === "partner" ? "合作商" : "自营")}`,
                              }))}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item name="capabilities" label={t("履约能力")} rules={[{ required: true }]}>
                      <Select
                        mode="multiple"
                        aria-label={t("履约能力")}
                        showSearch={false}
                        options={Object.entries(capabilityLabels).map(([value, label]) => ({
                          value,
                          label: t(label),
                        }))}
                      />
                    </Form.Item>
                    <Form.Item name="status" label={t("状态")} rules={[{ required: true }]}>
                      <Select
                        options={[
                          { value: "enabled", label: t("启用") },
                          { value: "disabled", label: t("停用") },
                        ]}
                      />
                    </Form.Item>
                  </div>
                ),
              },
              {
                key: "address",
                label: t("地理位置"),
                content: (
                  <div>
                    <Form.Item name="address" label={t("地址")}>
                      <Input />
                    </Form.Item>
                    <Row gutter={12}>
                      <Col span={8}>
                        <Form.Item name="province" label={t("省/直辖市")}>
                          <Input placeholder={t("如 上海市")} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="city" label={t("城市")}>
                          <Input placeholder={t("如 上海市")} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="district" label={t("区/县")}>
                          <Input placeholder={t("如 徐汇区")} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="timezone" label={t("时区")} tooltip={t("选填；默认 Asia/Shanghai")}>
                          <Input placeholder="Asia/Shanghai" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={12}>
                      <Col span={12}>
                        <Form.Item
                          name="latitude"
                          label={t("纬度")}
                          tooltip={t(
                            "选填；填写后小程序可按客户位置排序门店并提供地图导航，经纬度需成对填写",
                          )}
                          rules={[{ type: "number", min: -90, max: 90, message: t("纬度范围 -90~90") }]}
                        >
                          <InputNumber
                            style={{ width: "100%" }}
                            step={0.000001}
                            placeholder={t("如 31.2231")}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          name="longitude"
                          label={t("经度")}
                          rules={[{ type: "number", min: -180, max: 180, message: t("经度范围 -180~180") }]}
                        >
                          <InputNumber
                            style={{ width: "100%" }}
                            step={0.000001}
                            placeholder={t("如 121.4737")}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  </div>
                ),
              },
              {
                key: "contact",
                label: t("联系与营业"),
                content: (
                  <div>
                    <Row gutter={12}>
                      <Col span={12}>
                        <Form.Item name="contactName" label={t("联系人")}>
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="contactPhone" label={t("联系电话")}>
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="businessHours" label={t("营业时间")}>
                          <Input placeholder="09:00-18:00" />
                        </Form.Item>
                      </Col>
                    </Row>
                  </div>
                ),
              },
            ]}
          />
        </Form>
      </Modal>
      <Modal
        presentation="side"
        title={editingOperator ? t("编辑经营主体") : t("新增经营主体")}
        width={560}
        open={operatorDismissal.visible}
        destroyOnHidden
        onCancel={() => operatorEditor.dismiss(operatorDismissal.dismiss)}
        afterClose={operatorDismissal.afterClose}
        closable={!saveOperator.isPending}
        keyboard={!saveOperator.isPending}
        maskClosable={!saveOperator.isPending}
        footer={
          <>
            <Button
              disabled={saveOperator.isPending}
              onClick={() => operatorEditor.dismiss(operatorDismissal.dismiss)}
            >
              {t("取消")}
            </Button>
            <SaveButton
              disabled={operatorUnavailable}
              label={t("保存")}
              form={boundOperatorForm}
              pending={saveOperator.isPending}
              onSave={operatorEditor.submit}
              onActionError={(error) => {
                if (isCurrentScope() && !(error && typeof error === "object" && "errorFields" in error))
                  message.error(t("经营主体保存失败"));
              }}
            />
          </>
        }
      >
        <Form<SaveRentalFulfillmentOperatorRequest>
          name="fulfillment-operator"
          form={operatorForm}
          layout="vertical"
          disabled={operatorUnavailable || saveOperator.isPending}
          {...operatorEditor.formProps}
        >
          {operatorEditor.error instanceof Error && (
            <Alert type="error" showIcon title={operatorEditor.error.message} />
          )}
          <div>
            <Row gutter={16}>
              <Col span={24}>
                <Form.Item name="name" label={t("主体名称")} rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="code" label={t("主体编码")} rules={[{ required: true }]}>
                  <Input
                    disabled={Boolean(editingOperator) || operatorUnavailable || saveOperator.isPending}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="status" label={t("状态")} rules={[{ required: true }]}>
                  <Select
                    options={[
                      { value: "enabled", label: t("启用") },
                      { value: "disabled", label: t("停用") },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="type" label={t("经营方式")} rules={[{ required: true }]}>
                  <Select
                    options={[
                      { value: "self_operated", label: t("自营") },
                      { value: "partner", label: t("合作商") },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="settlementMode" label={t("结算方式")} rules={[{ required: true }]}>
                  <Select
                    options={[
                      { value: "self", label: t("内部结算") },
                      { value: "monthly", label: t("月结") },
                      { value: "per_order", label: t("逐单结算") },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="contactName" label={t("联系人")}>
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="contactPhone" label={t("联系电话")}>
                  <Input />
                </Form.Item>
              </Col>
            </Row>
          </div>
        </Form>
      </Modal>
    </CorePage>
  );
}
