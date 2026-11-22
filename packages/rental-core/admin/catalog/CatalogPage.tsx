/** 原商品资产字段、列表和图片沿同源实现，当前会话拥有编辑状态。
 * 定价归属按当前宿主权限附属读取，受限或失败独立呈现，不能投影为空分组。 */
import { useLayoutEffect, useRef } from "react";
import { CorePage, UnsavedChangesGuard, useCorePageHost } from "@rental-os/platform-admin/core";
import {
  RentalCatalogPageProvider,
  useRentalCatalogPageContext,
  type RentalCatalogPageContext,
} from "./page-context";
import { RENTAL_CATALOG_CORE_ID } from "./pages";
import { useOrderEditor } from "../orders/useOrderEditor";
import { catalogCards } from "./catalogCards";
import {
  DeleteOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  UploadOutlined,
} from "@rental-os/platform-admin/source/components/ui/icons";
import {
  RentalInventoryMode,
  type RentalAttributeDefinition,
  type RentalItemGroup,
  type SaveRentalItemGroupRequest,
} from "@rental-os/rental-core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Col, InputNumber, Row, Tag, Typography } from "antd";
import { ListSection, App, Empty } from "@rental-os/platform-admin/ui";
import { Form, FormSection } from "@rental-os/platform-admin/ui";
import { Alert, Table, Upload } from "@rental-os/platform-admin/ui";
import { Switch } from "@rental-os/platform-admin/ui";
import { Input } from "@rental-os/platform-admin/ui";
import {
  Button,
  ConfirmAction,
  DataTableText,
  DatePicker,
  Modal,
  SaveButton,
  SearchField,
  Select,
} from "@rental-os/platform-admin/ui";
import type { UploadFile } from "antd";
import { useMemo, useState } from "react";
import { useLocale } from "@rental-os/platform-admin/locale";
import { resolveTenantNavigationLabels } from "./pages";
import { QueryState } from "@rental-os/platform-admin/core";
import { ItemGroupPhoto } from "./ItemGroupPhoto";
import { catalogCapabilities } from "./listCapabilities";
import { SettingsWorkspace } from "@rental-os/platform-admin/source/components/settings/SettingsWorkspace";
import { catalogAttributeText } from "./catalogAttributeText";
import { ADMIN_TABLE_COLUMN_WIDTH } from "@rental-os/platform-admin/source/app/designTokens";
import { useModalDismissal } from "@rental-os/platform-admin/ui";
import dayjs from "dayjs";
import { useSearchParams } from "react-router-dom";
import styles from "./CatalogEditors.module.css";

const inventoryLabels: Record<string, string> = {
  serialized: "序列化资产",
  quantity: "数量库存",
  consumable: "一次性耗材",
  bundle: "套装",
};
const cameraEquipmentTypeLabels: Record<string, [string, string]> = {
  camera_body: ["相机机身", "Camera body"],
  lens: ["镜头", "Lens"],
  tripod: ["三脚架", "Tripod"],
  gimbal_camera: ["云台相机", "Gimbal camera"],
  action_camera: ["运动相机", "Action camera"],
  lighting: ["灯光", "Lighting"],
  other: ["其他器材", "Other equipment"],
};
const securityRiskLevelLabels: Record<string, [string, string]> = {
  low: ["低风险", "Low risk"],
  standard: ["一般风险", "Standard risk"],
  high: ["高风险", "High risk"],
};

function riskLevelLabels(riskLevel: string, locale: string, t: (value: string) => string) {
  if (!riskLevel || !securityRiskLevelLabels[riskLevel]) return <Tag color="warning">{t("未分级")}</Tag>;
  const color = riskLevel === "high" ? "error" : riskLevel === "standard" ? "processing" : "success";
  return <Tag color={color}>{securityRiskLevelLabels[riskLevel][locale === "en-US" ? 1 : 0]}</Tag>;
}

/**
 * 品类动态属性的受控控件。
 *
 * 必须把 Form.Item 注入的受控属性透传给内部控件：`(field) => <Input />` 会让控件退化成
 * 非受控，输入只改 DOM、不进表单值——而四个品类的 item_group 必填属性（厂商/品牌/型号等）
 * 都在这里，表现为「框里明明有值，保存却报请输入厂商」且不发出任何请求，新增型号被彻底卡死。
 */
function AttributeInput({
  field,
  value,
  checked,
  onChange,
  id,
}: {
  field: RentalAttributeDefinition;
  value?: unknown;
  checked?: boolean;
  onChange?: (...args: never[]) => void;
  id?: string;
}) {
  const { locale, t } = useLocale();
  if (field.type === "number") {
    return (
      <InputNumber
        id={id}
        min={0}
        suffix={field.unit}
        style={{ width: "100%" }}
        value={value as number}
        onChange={onChange as (value: number | null) => void}
      />
    );
  }
  if (field.type === "select") {
    return (
      <Select
        id={id}
        options={field.options?.map((option) => ({
          value: option,
          label:
            field.code === "equipmentType"
              ? (cameraEquipmentTypeLabels[option]?.[locale === "en-US" ? 1 : 0] ?? option)
              : field.code === "securityRiskLevel"
                ? (securityRiskLevelLabels[option]?.[locale === "en-US" ? 1 : 0] ?? option)
                : catalogAttributeText(option, t),
        }))}
        value={value as string}
        onChange={onChange as (value: string) => void}
      />
    );
  }
  if (field.type === "boolean") {
    // Form.Item 对该类字段使用 valuePropName="checked"，注入的是 checked 而非 value。
    return (
      <Switch id={id} checked={checked ?? Boolean(value)} onChange={onChange as (checked: boolean) => void} />
    );
  }
  if (field.type === "date")
    return (
      <DatePicker
        id={id}
        value={typeof value === "string" && value ? dayjs(value) : null}
        onChange={(date) => (onChange as (value: string) => void)?.(date?.format("YYYY-MM-DD") ?? "")}
      />
    );
  return <Input id={id} value={value as string} onChange={onChange as (event: unknown) => void} />;
}

export function CatalogPage(context: RentalCatalogPageContext) {
  return (
    <RentalCatalogPageProvider context={context}>
      <CatalogWorkspace key={context.scopeKey} />
    </RentalCatalogPageProvider>
  );
}

function CatalogWorkspace() {
  const { api: rentalCoreApi, scopeKey: scope, currentScopeKey } = useRentalCatalogPageContext();
  const host = useCorePageHost();
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const isCurrentScope = () => active.current && Boolean(scope) && currentScopeKey() === scope;
  const canReadPricingGroups = () =>
    Boolean(scope) && currentScopeKey() === scope && (
      host.canAccess(RENTAL_CATALOG_CORE_ID, [{ resource: "price", action: "manage" }]) ||
      host.canAccess(RENTAL_CATALOG_CORE_ID, [{ resource: "order", action: "view" }]) ||
      host.canAccess(RENTAL_CATALOG_CORE_ID, [{ resource: "order", action: "create" }])
    );
  const allowed = () =>
    isCurrentScope() && host.canAccess(RENTAL_CATALOG_CORE_ID, [{ resource: "catalog", action: "manage" }]);
  const assertManage = () => {
    if (!isCurrentScope()) throw new DOMException("商品资产页面的会话或经营空间已变化", "AbortError");
    if (!allowed()) throw new Error("当前操作不可用");
  };
  const { message } = App.useApp();
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const canManage = host.canAccess(RENTAL_CATALOG_CORE_ID, [{ resource: "catalog", action: "manage" }]);
  const [searchParams] = useSearchParams();
  const requestedItemGroup = searchParams.get("itemGroupId");
  const focusedItemGroup =
    requestedItemGroup && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(requestedItemGroup)
      ? requestedItemGroup
      : null;
  const [keyword, setKeyword] = useState("");
  const editorGeneration = useRef(0);
  const [editorState, setEditorState] = useState<{ record?: RentalItemGroup; generation: number }>();
  const editing = editorState?.record;
  const drawerOpen = Boolean(editorState);
  const [pendingFiles, setPendingFiles] = useState<UploadFile[]>([]);
  const [form] = Form.useForm<SaveRentalItemGroupRequest>();
  const catalogDismissal = useModalDismissal(drawerOpen, () => {
    setEditorState(undefined);
    form.resetFields();
    setPendingFiles([]);
  });
  const groups = useQuery({
    queryKey: ["rental-core", "groups", scope],
    enabled: Boolean(scope),
    queryFn: ({ signal }) => rentalCoreApi.itemGroups({ signal }),
  });
  const pricingGroups = useQuery({
    queryKey: ["rental-core", "pricing-groups", scope],
    enabled: canReadPricingGroups(),
    queryFn: async ({ signal }) => {
      // enabled 不约束手动 refetch，迟到结果也必须再核当前权限。
      if (!isCurrentScope() || !canReadPricingGroups()) throw new Error(t("定价分组读取受限"));
      const result = await rentalCoreApi.pricingGroups({ signal });
      if (!isCurrentScope() || !canReadPricingGroups()) throw new Error(t("定价分组读取受限"));
      return result;
    },
  });
  const profile = useQuery({
    queryKey: ["rental-core", "profile", scope],
    enabled: Boolean(scope),
    queryFn: ({ signal }) => rentalCoreApi.profile({ signal }),
  });
  const categories = useQuery({
    queryKey: ["rental-core", "categories", scope],
    enabled: Boolean(scope),
    queryFn: ({ signal }) => rentalCoreApi.categories({ signal }),
  });
  const visiblePricingGroups = canReadPricingGroups() && !pricingGroups.isError
    ? pricingGroups.data : undefined;
  const pricingGroupsUnavailableText = !canReadPricingGroups()
    ? (locale === "en-US" ? "Pricing group access is restricted" : "定价分组读取受限")
    : pricingGroups.isError
      ? (locale === "en-US" ? "Unable to read pricing groups" : "未能读取定价分组")
      : (locale === "en-US" ? "Reading pricing groups" : "正在读取定价分组");
  async function refreshCatalog(throwOnError = false) {
    if (!isCurrentScope()) throw new DOMException("商品资产页面的会话或经营空间已变化", "AbortError");
    await Promise.all([
      groups.refetch({ throwOnError }),
      profile.refetch({ throwOnError }),
      categories.refetch({ throwOnError }),
      // 附属查询独立持有错误，不阻断受权型号列表的恢复。
      ...(canReadPricingGroups() ? [pricingGroups.refetch()] : []),
    ]);
  }
  const category = categories.data?.find((item) => item.code === profile.data?.categoryCode);
  const presentation = category?.businessModel.catalogPresentation;
  const groupFields =
    category?.businessModel.assetFields.filter((field) => field.scope === "item_group") ?? [];
  const summaryFields = (presentation?.itemGroupSummaryFields ?? ["manufacturer", "brand", "model"])
    .map((code) => groupFields.find((field) => field.code === code))
    .filter((field): field is RentalAttributeDefinition => Boolean(field));
  const itemGroupLabel = t(profile.data?.terminology.itemGroupLabel ?? "产品型号");
  const save = useMutation({
    mutationFn: async (values: SaveRentalItemGroupRequest) => {
      assertManage();
      const generation = editorGeneration.current;
      const assertEditor = () => {
        assertManage();
        if (editorGeneration.current !== generation)
          throw new DOMException("型号编辑对象已变化", "AbortError");
      };
      let group = await rentalCoreApi.saveItemGroup(values);
      assertEditor();
      // 型号已保存，照片阶段保留这个原ID，后续显式保存继续更新同一型号。
      setEditorState((current) =>
        current && current.generation === generation ? { ...current, record: group } : current,
      );
      form.setFieldValue("id", group.id);
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "groups"] });
      assertEditor();
      for (const file of pendingFiles) {
        if (file.originFileObj) {
          assertEditor();
          group = await rentalCoreApi.uploadItemGroupImage(group.id, file.originFileObj);
          assertEditor();
          setEditorState((current) =>
            current && current.generation === generation ? { ...current, record: group } : current,
          );
          setPendingFiles((current) => current.filter((row) => row.uid !== file.uid));
        }
      }
      return group;
    },
    onSuccess: async () => {
      if (!isCurrentScope()) return;
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "groups"] });
      if (!isCurrentScope()) return;
      catalogDismissal.dismiss();
      message.success(`${itemGroupLabel}${t("已保存")}`);
    },
    onError: () => {
      if (isCurrentScope()) message.error(t("保存失败，请检查编码、库存模式、品类字段和套装组成"));
    },
  });
  const removeImage = useMutation({
    mutationFn: ({ groupId, imageId }: { groupId: string; imageId: string }) => {
      assertManage();
      return rentalCoreApi.removeItemGroupImage(groupId, imageId);
    },
    onSuccess: async (group) => {
      if (!isCurrentScope()) return;
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "groups"] });
      if (!isCurrentScope()) return;
      setEditorState((current) =>
        current && current.record?.id === group.id ? { ...current, record: group } : current,
      );
      message.success(t("照片已删除"));
    },
    onError: () => {
      if (isCurrentScope()) message.error(t("照片删除失败"));
    },
  });
  // A registered Action may focus an already-authorized original row. URL
  // parameters never replace the page Guard or fetch a wider catalog.
  const rows = useMemo(
    () =>
      (groups.data ?? []).filter(
        (item) =>
          (!focusedItemGroup || item.id === focusedItemGroup) &&
          `${item.code}${item.name}${Object.values(item.attributes).join("")}`
            .toLowerCase()
            .includes(keyword.toLowerCase()),
      ),
    [groups.data, keyword, focusedItemGroup],
  );
  const busy = save.isPending || removeImage.isPending;
  const editorUnavailable =
    !canManage || !category || groups.isError || profile.isError || categories.isError;

  // 本次打开的代次保持到照片阶段结束，已保存的型号ID用于后续显式重试。
  const editor = useOrderEditor<SaveRentalItemGroupRequest>({
    form,
    identity: editorState ? JSON.stringify([scope, "item-group", editorState.generation]) : undefined,
    onSave: submitCatalog,
    disabled: editorUnavailable || removeImage.isPending,
  });
  const catalogForm = useMemo(() => ({ ...form, validateFields: editor.validate }), [form, editor.key]);
  const dismissEditor = () => {
    if (!busy) editor.dismiss(catalogDismissal.dismiss);
  };
  function submitCatalog(values: SaveRentalItemGroupRequest): Promise<unknown> {
    assertManage();
    if (editorUnavailable || busy) return Promise.reject(new Error(t("当前操作不可用")));
    return save.mutateAsync({
      ...values,
      inventoryMode: presentation?.fixedInventoryMode ?? values.inventoryMode,
      unit: presentation?.fixedUnit ?? values.unit,
      id: editing?.id,
    });
  }

  function openEditor(record?: RentalItemGroup) {
    if (editorUnavailable || busy || !allowed() || (drawerOpen && !catalogDismissal.visible)) return;
    editor.dismiss(() => {
      editorGeneration.current += 1;
      setEditorState({ record, generation: editorGeneration.current });
      setPendingFiles([]);
      form.resetFields();
      form.setFieldsValue(
        record ?? {
          code: "",
          name: "",
          inventoryMode:
            presentation?.fixedInventoryMode ??
            category?.supportedInventoryModes[0] ??
            RentalInventoryMode.Serialized,
          unit: presentation?.fixedUnit ?? "件",
          description: "",
          attributes: {},
          bundleComponents: [],
          status: "enabled",
        },
      );
      editor.markClean();
    });
  }

  return (
    <CorePage
      title={t(resolveTenantNavigationLabels(profile.data?.terminology).routes.itemGroups ?? "商品目录")}
      note={{
        title: `${itemGroupLabel}${t("是厂商产品主档，不是定价分组")}`,
        description:
          locale === "en-US"
            ? `This page stores manufacturer, brand, model, and shared specifications. ${t(profile.data?.terminology.identifierLabel ?? "资产编号")} and other per-asset information are maintained in “${t(resolveTenantNavigationLabels(profile.data?.terminology).routes.assets ?? "资产管理")}”; customer-facing commercial groups are created in “${t(resolveTenantNavigationLabels(profile.data?.terminology).routes.pricingGroups ?? "定价分组")}”.`
            : `这里保存厂商、品牌、型号和共享规格；${profile.data?.terminology.identifierLabel ?? "资产编号"}等单件信息在“${resolveTenantNavigationLabels(profile.data?.terminology).routes.assets ?? "资产管理"}”登记，面向客户的商业分组在“${resolveTenantNavigationLabels(profile.data?.terminology).routes.pricingGroups ?? "定价分组"}”建立。`,
      }}
      actions={
        canManage
          ? [
              {
                id: "create-item-group",
                kind: "open",
                label: { default: locale === "en-US" ? t("新增型号") : `${t("新增")}${itemGroupLabel}` },
                emphasis: "primary",
                permissions: [{ resource: "catalog", action: "manage" }],
                icon: <PlusOutlined />,
                disabled: editorUnavailable || busy,
                open: () => openEditor(),
              },
            ]
          : []
      }
    >
      <UnsavedChangesGuard dirty={drawerOpen && (editor.dirty || pendingFiles.length > 0)} busy={busy} />

      <ListSection
        controls={
          <>
            <SearchField
              label={t("搜索商品型号")}
              placeholder={t("搜索编码、名称或规格")}
              value={keyword}
              onValueChange={setKeyword}
              style={{ width: "var(--rental-control-width-search)" }}
            />
          </>
        }
      >
        <QueryState
          loading={groups.isLoading || profile.isLoading || categories.isLoading}
          error={groups.error || profile.error || categories.error}
          onRetry={() => refreshCatalog(true)}
        >
          <Table<RentalItemGroup>
            emptyScene={keyword.trim() ? "search" : "empty"}
            rowKey="id"
            onRefresh={() => refreshCatalog()}
            loading={groups.isLoading}
            refreshing={groups.isFetching}
            dataSource={rows}
            scroll={{ x: 960 }}
            {...catalogCapabilities(
              t,
              groupFields,
              () => queryClient.invalidateQueries({ queryKey: ["rental-core", "groups"] }),
              { api: rentalCoreApi, allowed },
              category?.supportedInventoryModes ?? [],
              presentation?.fixedInventoryMode,
              presentation?.fixedUnit,
            )}
            cardView={catalogCards({
              t,
              fields: groupFields,
              summaryFields,
              pricingGroups: visiblePricingGroups,
              pricingGroupsUnavailableText,
              canManage,
              edit: openEditor,
              risk: (row) => riskLevelLabels(String(row.attributes.securityRiskLevel ?? ""), locale, t),
            })}
            columns={[
              {
                title: t("照片"),
                width: 82,
                render: (_, row) =>
                  row.images?.[0] ? (
                    <ItemGroupPhoto
                      groupId={row.id}
                      image={row.images.find((image) => image.isCover) ?? row.images[0]}
                    />
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={false}
                      styles={{ image: { height: 36 } }}
                    />
                  ),
              },
              {
                title: itemGroupLabel,
                dataIndex: "name",
                minWidth: ADMIN_TABLE_COLUMN_WIDTH.resources,
                fixed: "left",
                render: (_, row) => <DataTableText primary={row.name} secondary={row.code} />,
              },
              {
                title: t("商品风控等级"),
                width: 120,
                render: (_, row) => {
                  const riskLevel = String(row.attributes.securityRiskLevel ?? "");
                  return riskLevelLabels(riskLevel, locale, t);
                },
              },
              ...summaryFields.map((field) => ({
                title: t(field.label),
                render: (_: unknown, row: RentalItemGroup) => String(row.attributes[field.code] ?? "-"),
              })),
              {
                title: t(
                  resolveTenantNavigationLabels(profile.data?.terminology).routes.pricingGroups ??
                    "所属定价分组",
                ),
                minWidth: ADMIN_TABLE_COLUMN_WIDTH.summary,
                render: (_, row) => {
                  if (!visiblePricingGroups) return (
                    <Typography.Text type="secondary">{pricingGroupsUnavailableText}</Typography.Text>
                  );
                  const memberships = visiblePricingGroups.filter((pricingGroup) =>
                    pricingGroup.memberItemGroupIds.includes(row.id),
                  );
                  return memberships.length ? (
                    <div>
                      {memberships.map((pricingGroup) => (
                        <DataTableText key={pricingGroup.id} primary={pricingGroup.name} />
                      ))}
                    </div>
                  ) : (
                    <Typography.Text type="secondary">{t("未加入定价分组")}</Typography.Text>
                  );
                },
              },
              ...(!presentation?.fixedInventoryMode
                ? [
                    {
                      title: t("库存方式"),
                      dataIndex: "inventoryMode",
                      render: (value: string) => (
                        <Tag color={value === "bundle" ? "purple" : value === "quantity" ? "gold" : "blue"}>
                          {t(inventoryLabels[value] ?? value)}
                        </Tag>
                      ),
                    },
                  ]
                : []),
              ...(!presentation?.fixedUnit ? [{ title: t("单位"), dataIndex: "unit" }] : []),
              ...(category?.supportedInventoryModes.includes(RentalInventoryMode.Bundle)
                ? [
                    {
                      title: t("套装组成"),
                      dataIndex: "bundleComponents",
                      render: (items: RentalItemGroup["bundleComponents"]) =>
                        items?.length
                          ? items
                              .map(
                                (item) =>
                                  `${item.itemGroupName}×${item.quantity}${item.substitutionGroup ? ` [${item.substitutionGroup}${item.optional ? `·${t("候选")}` : `·${t("默认")}`}]` : ""}`,
                              )
                              .join("，")
                          : "-",
                    },
                  ]
                : []),
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
                    <Button type="link" onClick={() => openEditor(row)}>
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

      <Modal
        presentation="side"
        title={
          locale === "en-US"
            ? t(editing ? "编辑型号" : "新增型号")
            : `${t(editing ? "编辑" : "新增")}${itemGroupLabel}`
        }
        width={760}
        open={catalogDismissal.visible}
        destroyOnHidden
        onCancel={dismissEditor}
        afterClose={catalogDismissal.afterClose}
        closable={!busy}
        keyboard={!busy}
        maskClosable={!busy}
        footer={
          <>
            <Button disabled={busy} onClick={dismissEditor}>
              {t("取消")}
            </Button>
            <SaveButton
              disabled={editorUnavailable || removeImage.isPending}
              label={t("保存")}
              form={catalogForm}
              pending={save.isPending}
              onSave={editor.submit}
            />
          </>
        }
      >
        <Form<SaveRentalItemGroupRequest>
          name="catalog-item"
          form={form}
          layout="vertical"
          disabled={editorUnavailable || busy}
          {...editor.formProps}
        >
          <SettingsWorkspace
            sections={[
              {
                key: "profile",
                label: t("基本资料"),
                content: (
                  <>
                    <div>
                      <Row gutter={16}>
                        <Col span={24}>
                          <Form.Item
                            name="name"
                            label={
                              presentation?.itemGroupNameLabel
                                ? t(presentation.itemGroupNameLabel)
                                : locale === "en-US"
                                  ? t("型号名称")
                                  : `${itemGroupLabel}${t("名称")}`
                            }
                            extra={t("这是型号的显示名称，不是面向客户的定价组名称。")}
                            rules={[{ required: true }]}
                          >
                            <Input placeholder={t(presentation?.itemGroupNamePlaceholder ?? "")} />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item
                            name="code"
                            label={
                              presentation?.itemGroupCodeLabel
                                ? t(presentation.itemGroupCodeLabel)
                                : locale === "en-US"
                                  ? t("型号编码")
                                  : `${itemGroupLabel}${t("编码")}`
                            }
                            rules={[{ required: true }]}
                          >
                            <Input
                              disabled={Boolean(editing) || editorUnavailable || busy}
                              placeholder={t("用于内部检索和接口引用")}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item name="status" label={t("状态")} rules={[{ required: true }]}>
                            <Select
                              options={[
                                { value: "enabled", label: t("启用") },
                                { value: "disabled", label: t("停用") },
                              ]}
                            />
                          </Form.Item>
                        </Col>
                        {presentation?.fixedInventoryMode ? (
                          <Form.Item name="inventoryMode" hidden>
                            <Input />
                          </Form.Item>
                        ) : (
                          <Col span={12}>
                            <Form.Item
                              name="inventoryMode"
                              label={t("库存方式")}
                              rules={[{ required: true }]}
                            >
                              <Select
                                disabled={Boolean(editing) || editorUnavailable || busy}
                                options={category?.supportedInventoryModes.map((value) => ({
                                  value,
                                  label: t(inventoryLabels[value] ?? value),
                                }))}
                              />
                            </Form.Item>
                          </Col>
                        )}
                        {presentation?.fixedUnit ? (
                          <Form.Item name="unit" hidden>
                            <Input />
                          </Form.Item>
                        ) : (
                          <Col span={12}>
                            <Form.Item name="unit" label={t("计量单位")} rules={[{ required: true }]}>
                              <Input placeholder={t("台、套、顶、辆")} />
                            </Form.Item>
                          </Col>
                        )}
                      </Row>
                      {presentation?.fixedInventoryMode && (
                        <Typography.Text type="secondary">
                          {locale === "en-US"
                            ? `${t("固定按“")}${t(inventoryLabels[presentation.fixedInventoryMode])}${t(" / ")}${presentation.fixedUnit}${t("”管理，具体")}${t(profile.data?.terminology.assetLabel ?? "资产")}${t("在“")}${resolveTenantNavigationLabels(profile.data?.terminology).routes.assets ?? t("资产管理")}${t("”中登记。")}`
                            : `该品类固定按“${inventoryLabels[presentation.fixedInventoryMode]} / ${presentation.fixedUnit}”管理，具体${profile.data?.terminology.assetLabel ?? "资产"}在“${resolveTenantNavigationLabels(profile.data?.terminology).routes.assets ?? "资产管理"}”中登记。`}
                        </Typography.Text>
                      )}
                      <Form.Item name="description" label={t("说明")}>
                        <Input.TextArea rows={3} />
                      </Form.Item>
                    </div>
                    <Form.Item
                      noStyle
                      shouldUpdate={(previous, current) => previous.inventoryMode !== current.inventoryMode}
                    >
                      {({ getFieldValue }) =>
                        getFieldValue("inventoryMode") === RentalInventoryMode.Bundle && (
                          <FormSection title={t("套装组成")}>
                            <Form.List name="bundleComponents">
                              {(fields, { add, remove }) => (
                                <div className={styles.bundleList}>
                                  {fields.map(({ key: fieldKey, ...field }) => (
                                    <div className={styles.bundleItem} key={fieldKey}>
                                      <div className={styles.bundleMain}>
                                        <Form.Item
                                          {...field}
                                          className={styles.bundleProduct}
                                          name={[field.name, "itemGroupId"]}
                                          label={t("组成商品")}
                                          rules={[{ required: true }]}
                                        >
                                          <Select
                                            placeholder={t("选择组成商品")}
                                            options={(groups.data ?? [])
                                              .filter(
                                                (item) =>
                                                  item.id !== editing?.id &&
                                                  item.inventoryMode !== RentalInventoryMode.Bundle,
                                              )
                                              .map((item) => ({
                                                value: item.id,
                                                label: `${item.code} · ${item.name}`,
                                              }))}
                                          />
                                        </Form.Item>
                                        <Form.Item
                                          {...field}
                                          name={[field.name, "quantity"]}
                                          label={t("数量")}
                                          rules={[{ required: true }]}
                                        >
                                          <InputNumber
                                            min={1}
                                            precision={0}
                                            placeholder={t("数量")}
                                            style={{ width: "100%" }}
                                          />
                                        </Form.Item>
                                        <Button
                                          className={styles.bundleRemove}
                                          danger
                                          type="text"
                                          aria-label={t("移除组成项")}
                                          icon={<MinusCircleOutlined />}
                                          onClick={() => remove(field.name)}
                                        />
                                      </div>
                                      <div className={styles.bundleOptions}>
                                        <Form.Item
                                          {...field}
                                          name={[field.name, "substitutionGroup"]}
                                          label={t("替代组编码")}
                                        >
                                          <Input placeholder={t("替代组编码")} />
                                        </Form.Item>
                                        <Form.Item
                                          {...field}
                                          name={[field.name, "optional"]}
                                          label={t("候选")}
                                          valuePropName="checked"
                                        >
                                          <Switch checkedChildren={t("候选")} unCheckedChildren={t("默认")} />
                                        </Form.Item>
                                      </div>
                                    </div>
                                  ))}
                                  <Alert
                                    type="info"
                                    showIcon
                                    title={t("替代组规则")}
                                    description={t(
                                      "同一替代组必须配置一个默认组成和至少一个替代候选；订单确认后、配货前可以在组内替换。",
                                    )}
                                  />
                                  <Button
                                    block
                                    type="dashed"
                                    onClick={() => add({ quantity: 1, optional: false })}
                                    icon={<PlusOutlined />}
                                  >
                                    {t("增加组成项")}
                                  </Button>
                                </div>
                              )}
                            </Form.List>
                          </FormSection>
                        )
                      }
                    </Form.Item>
                  </>
                ),
              },
              {
                key: "specifications",
                label: t("型号规格"),
                content: (
                  <div>
                    <Row gutter={16}>
                      {groupFields.map((field) => (
                        <Col span={12} key={field.code}>
                          <Form.Item
                            name={["attributes", field.code]}
                            label={t(field.label)}
                            extra={
                              field.code === "securityRiskLevel"
                                ? t(
                                    "未分级商品按未获风控许可处理；会员押金或预授权减免只对空间规则明确允许的等级生效。",
                                  )
                                : field.unique
                                  ? t("当前经营空间内不可重复")
                                  : undefined
                            }
                            rules={[{ required: field.required }]}
                            valuePropName={field.type === "boolean" ? "checked" : "value"}
                          >
                            <AttributeInput field={field} />
                          </Form.Item>
                        </Col>
                      ))}
                    </Row>
                  </div>
                ),
              },
              {
                key: "photos",
                label: t("展示照片"),
                content: (
                  <div>
                    <Typography.Paragraph type="secondary">
                      {t(
                        "上传型号的标准展示图，第一张作为列表封面；具体资产的实拍、状态和损伤照片在资产管理中维护。",
                      )}
                    </Typography.Paragraph>
                    {editing?.images?.length ? (
                      <div className={styles.photoList}>
                        {editing.images.map((image) => (
                          <div key={image.id} className={styles.photoItem}>
                            <div className={styles.photoPreview}>
                              <ItemGroupPhoto groupId={editing.id} image={image} size={112} />
                              {image.isCover && (
                                <Tag color="processing" className={styles.photoCover}>
                                  {t("封面")}
                                </Tag>
                              )}
                            </div>
                            <ConfirmAction
                              label={t("删除图片")}
                              prompt={t("删除这张型号照片？")}
                              icon={<DeleteOutlined />}
                              disabled={editorUnavailable || busy}
                              onConfirm={() =>
                                removeImage.mutateAsync({ groupId: editing.id, imageId: image.id })
                              }
                            />
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <Upload
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      listType="picture"
                      fileList={pendingFiles}
                      maxCount={Math.max(0, 6 - (editing?.images?.length ?? 0))}
                      disabled={editorUnavailable || busy}
                      beforeUpload={(file) => {
                        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
                          message.error(t("只支持 JPG、PNG 或 WebP 图片"));
                          return Upload.LIST_IGNORE;
                        }
                        if (file.size > 5 * 1024 * 1024) {
                          message.error(t("单张图片不能超过 5MB"));
                          return Upload.LIST_IGNORE;
                        }
                        return false;
                      }}
                      onChange={({ fileList }) => setPendingFiles(fileList)}
                    >
                      {(editing?.images?.length ?? 0) + pendingFiles.length < 6 && (
                        <Button icon={<UploadOutlined />}>{t("选择照片")}</Button>
                      )}
                    </Upload>
                    {pendingFiles.length > 0 && (
                      <Typography.Text type="secondary">{t("所选照片将在保存时上传。")}</Typography.Text>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </Form>
      </Modal>
    </CorePage>
  );
}
