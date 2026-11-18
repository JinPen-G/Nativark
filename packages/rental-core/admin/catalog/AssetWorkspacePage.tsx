/** 资产、状态历史和数量库存沿原字段与服务端事实，当前会话拥有编辑状态。 */
import { useLayoutEffect, useRef } from "react";
import { CorePage, UnsavedChangesGuard, useCorePageHost } from "@rental-os/platform-admin/core";
import {
  RentalCatalogPageProvider,
  useRentalCatalogPageContext,
  type RentalCatalogPageContext,
} from "./page-context";
import { RENTAL_CATALOG_CORE_ID } from "./pages";
import { useOrderEditor } from "../orders/useOrderEditor";
import { DataTableText, ListSection, SaveButton } from "@rental-os/platform-admin/ui";
import { PlusOutlined } from "@rental-os/platform-admin/source/components/ui/icons";
import {
  RentalAssetStatus,
  RentalInventoryMode,
  type RentalAsset,
  type RentalAssetStatusHistory,
  type RentalAttributeDefinition,
  type RentalStockBalance,
  type SaveRentalAssetRequest,
} from "@rental-os/rental-core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Col, InputNumber, Row, Space, Tag } from "antd";
import { App } from "@rental-os/platform-admin/ui";
import { Form } from "@rental-os/platform-admin/ui";
import { Alert, Table } from "@rental-os/platform-admin/ui";
import { Switch } from "@rental-os/platform-admin/ui";
import { Input } from "@rental-os/platform-admin/ui";
import {
  Button,
  DataTableRowActions,
  DatePicker,
  Modal,
  SearchField,
  Select,
  Tabs,
} from "@rental-os/platform-admin/ui";
import { History, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@rental-os/platform-admin/locale";
import { resolveTenantNavigationLabels } from "./pages";
import { QueryState } from "@rental-os/platform-admin/core";
import { ItemGroupPhoto } from "./ItemGroupPhoto";
import { assetCards, stockCards } from "./assetCards";
import { StockOperationsPanel } from "./StockOperationsPanel";
import { AnimatedNumber } from "@rental-os/platform-admin/ui";
import type { ReactNode } from "react";
import { SettingsWorkspace } from "@rental-os/platform-admin/source/components/settings/SettingsWorkspace";
import styles from "./CatalogEditors.module.css";
import { catalogAttributeText } from "./catalogAttributeText";
import { ADMIN_TABLE_COLUMN_WIDTH } from "@rental-os/platform-admin/source/app/designTokens";
import { useModalDismissal } from "@rental-os/platform-admin/ui";
import dayjs from "dayjs";

const statusMap: Record<string, { label: string; color: string }> = {
  available: { label: "可用", color: "success" },
  reserved: { label: "已预占", color: "processing" },
  rented: { label: "租赁中", color: "blue" },
  inspection: { label: "检查中", color: "orange" },
  maintenance: { label: "维护中", color: "warning" },
  disabled: { label: "停用", color: "default" },
};
const historySourceMap: Record<string, string> = {
  onboarding: "资产登记",
  manual: "资料维护",
  order: "订单流程",
  disposition: "归还处置",
};

/** 与商品目录页同一问题与同一修法：受控属性必须透传，否则必填属性永远校验不过。 */
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
  const { t } = useLocale();
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
        options={field.options?.map((option) => ({ value: option, label: catalogAttributeText(option, t) }))}
        value={value as string}
        onChange={onChange as (value: string) => void}
      />
    );
  }
  if (field.type === "boolean") {
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

export function AssetWorkspacePage(context: RentalCatalogPageContext) {
  return (
    <RentalCatalogPageProvider context={context}>
      <AssetWorkspace key={context.scopeKey} />
    </RentalCatalogPageProvider>
  );
}

function AssetWorkspace() {
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
  const allowed = () =>
    isCurrentScope() && host.canAccess(RENTAL_CATALOG_CORE_ID, [{ resource: "asset", action: "manage" }]);
  const assertManage = () => {
    if (!isCurrentScope()) throw new DOMException("商品资产页面的会话或经营空间已变化", "AbortError");
    if (!allowed()) throw new Error("当前操作不可用");
  };
  const { message } = App.useApp();
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const canManage = host.canAccess(RENTAL_CATALOG_CORE_ID, [{ resource: "asset", action: "manage" }]);
  const canView =
    host.canAccess(RENTAL_CATALOG_CORE_ID, [{ resource: "asset", action: "view" }]) || canManage;
  const [activeTab, setActiveTab] = useState<"assets" | "stock">("assets");
  const [keyword, setKeyword] = useState("");
  const editorGeneration = useRef(0);
  const [editorState, setEditorState] = useState<{ record?: RentalAsset; generation: number }>();
  const editing = editorState?.record;
  const assetDrawerOpen = Boolean(editorState);
  const [statusHistoryAsset, setStatusHistoryAsset] = useState<RentalAsset>();
  const [assetForm] = Form.useForm<SaveRentalAssetRequest>();
  const assetDismissal = useModalDismissal(assetDrawerOpen, () => {
    setEditorState(undefined);
    assetForm.resetFields();
  });
  const historyDialog = useModalDismissal(Boolean(statusHistoryAsset), () =>
    setStatusHistoryAsset(undefined),
  );
  const selectedItemGroupId = Form.useWatch("itemGroupId", assetForm);
  const assets = useQuery({
    queryKey: ["rental-core", "assets", scope],
    enabled: Boolean(scope),
    queryFn: ({ signal }) => rentalCoreApi.assets({ signal }),
  });
  const statusHistory = useQuery({
    queryKey: ["rental-core", "asset-status-history", statusHistoryAsset?.id, scope],
    queryFn: ({ signal }) => rentalCoreApi.assetStatusHistory(statusHistoryAsset!.id, { signal }),
    enabled: canView && Boolean(statusHistoryAsset),
  });
  const stocks = useQuery({
    queryKey: ["rental-core", "stocks", scope],
    enabled: Boolean(scope),
    queryFn: ({ signal }) => rentalCoreApi.stockBalances({ signal }),
  });
  const groups = useQuery({
    queryKey: ["rental-core", "groups", scope],
    enabled: Boolean(scope),
    queryFn: ({ signal }) => rentalCoreApi.itemGroups({ signal }),
  });
  const locations = useQuery({
    queryKey: ["rental-core", "locations", scope],
    enabled: Boolean(scope),
    queryFn: ({ signal }) => rentalCoreApi.locations({ signal }),
  });
  // SHARED-WORK-01A：库存页显示不可用原因与预计恢复时间（来自归还处置事实，不由前端拼造）。
  const dispositions = useQuery({
    queryKey: ["rental-core", "stock-dispositions", scope],
    queryFn: ({ signal }) => rentalCoreApi.stockDispositions(undefined, { signal }),
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
  const category = categories.data?.find((item) => item.code === profile.data?.categoryCode);
  const presentation = category?.businessModel.catalogPresentation;
  const serialNoField = category?.businessModel.assetFields.find(
    (field) => field.scope === "asset" && field.code === "serialNo",
  );
  const assetFields =
    category?.businessModel.assetFields.filter(
      (field) => field.scope === "asset" && field.code !== "serialNo",
    ) ?? [];
  const summaryAssetFields = (presentation?.assetSummaryFields ?? assetFields.map((field) => field.code))
    .map((code) => assetFields.find((field) => field.code === code))
    .filter((field): field is RentalAttributeDefinition => Boolean(field))
    .filter((field) =>
      (assets.data ?? []).some(
        (asset) => asset.attributes[field.code] != null && asset.attributes[field.code] !== "",
      ),
    );
  const supportsAssets = category?.supportedInventoryModes.includes(RentalInventoryMode.Serialized) ?? true;
  const supportsStock =
    category?.supportedInventoryModes.some((mode) =>
      [RentalInventoryMode.Quantity, RentalInventoryMode.Consumable].includes(mode),
    ) ?? true;
  const saveAsset = useMutation({
    mutationFn: (values: SaveRentalAssetRequest) => {
      assertManage();
      return rentalCoreApi.saveAsset(values);
    },
    onSuccess: async () => {
      if (!isCurrentScope()) return;
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "assets"] });
      if (!isCurrentScope()) return;
      assetDismissal.dismiss();
      message.success(t(profile.data?.terminology.assetLabel ?? "资产") + t("已保存"));
    },
    onError: () => {
      if (isCurrentScope()) message.error(t("资产保存失败，请检查编号、商品和履约地点"));
    },
  });
  const assetRows = useMemo(
    () =>
      (assets.data ?? []).filter(
        (asset) =>
          !keyword ||
          `${asset.assetNo}${asset.serialNo}${asset.itemGroupName}${asset.locationName}${Object.values(asset.attributes).join("")}`
            .toLowerCase()
            .includes(keyword.toLowerCase()),
      ),
    [assets.data, keyword],
  );
  const stockRows = useMemo(
    () =>
      (stocks.data ?? []).filter(
        (stock) =>
          !keyword ||
          `${stock.itemGroupCode}${stock.itemGroupName}${stock.locationName}`
            .toLowerCase()
            .includes(keyword.toLowerCase()),
      ),
    [stocks.data, keyword],
  );
  const countLabel = (label: string, count?: number): ReactNode =>
    count == null ? (
      label
    ) : (
      <>
        {label} {locale === "en-US" ? "(" : "（"}
        <AnimatedNumber value={count} />
        {locale === "en-US" ? ")" : "）"}
      </>
    );
  const visibleTabs = [
    supportsAssets
      ? { key: "assets", label: countLabel(t("序列化资产"), assets.isSuccess ? assetRows.length : undefined) }
      : undefined,
    supportsStock
      ? {
          key: "stock",
          label: countLabel(t("数量/耗材库存"), stocks.isSuccess ? stockRows.length : undefined),
        }
      : undefined,
  ].filter((item): item is { key: string; label: ReactNode } => Boolean(item));
  const serializedGroups = (groups.data ?? []).filter(
    (group) => group.inventoryMode === RentalInventoryMode.Serialized && group.status === "enabled",
  );
  const selectedItemGroup = (groups.data ?? []).find((group) => group.id === selectedItemGroupId);
  const selectedItemGroupCover =
    selectedItemGroup?.images?.find((image) => image.isCover) ?? selectedItemGroup?.images?.[0];
  const editorUnavailable =
    !canManage ||
    !category ||
    groups.isPending ||
    locations.isPending ||
    groups.isError ||
    locations.isError ||
    profile.isError ||
    categories.isError;
  const searchTerms = [
    ...(activeTab === "assets" ? [t(profile.data?.terminology.identifierLabel ?? "资产编号")] : []),
    t(profile.data?.terminology.itemGroupLabel ?? "产品型号"),
    t(profile.data?.terminology.fulfillmentLabel ?? "履约地点"),
  ];
  const searchPlaceholder = `${searchTerms.slice(0, -1).join(locale === "en-US" ? ", " : "、")}${locale === "en-US" ? " or " : "或"}${searchTerms.at(-1)}`;

  useEffect(() => {
    if (category && !supportsAssets && supportsStock) setActiveTab("stock");
    if (category && supportsAssets && !supportsStock) setActiveTab("assets");
  }, [category, supportsAssets, supportsStock]);

  const assetEditor = useOrderEditor<SaveRentalAssetRequest>({
    form: assetForm,
    identity: editorState ? JSON.stringify([scope, "asset", editorState.generation, editing?.id]) : undefined,
    onSave: submitAsset,
    disabled: editorUnavailable,
  });
  const boundAssetForm = useMemo(
    () => ({ ...assetForm, validateFields: assetEditor.validate }),
    [assetForm, assetEditor.key],
  );
  const dismissAssetEditor = () => assetEditor.dismiss(assetDismissal.dismiss);
  function submitAsset(values: SaveRentalAssetRequest): Promise<unknown> {
    assertManage();
    if (editorUnavailable || saveAsset.isPending) return Promise.reject(new Error(t("当前操作不可用")));
    return saveAsset.mutateAsync({ ...values, id: editing?.id });
  }

  function openAssetEditor(record?: RentalAsset) {
    if (
      editorUnavailable ||
      saveAsset.isPending ||
      !allowed() ||
      (assetDrawerOpen && !assetDismissal.visible)
    )
      return;
    assetEditor.dismiss(() => {
      editorGeneration.current += 1;
      setEditorState({ record, generation: editorGeneration.current });
      assetForm.resetFields();
      assetForm.setFieldsValue(
        record ?? {
          itemGroupId: serializedGroups[0]?.id ?? "",
          assetNo: "",
          serialNo: "",
          locationId: locations.data?.[0]?.id ?? "",
          status: RentalAssetStatus.Available,
          attributes: {},
        },
      );
      assetEditor.markClean();
    });
  }

  return (
    <CorePage
      title={t(resolveTenantNavigationLabels(profile.data?.terminology).routes.assets ?? "资产与库存")}
      note={{
        title: `${t(profile.data?.terminology.assetLabel ?? category?.name ?? "当前品类资产")}${t("是具体可交付实体")}`,
        description: t(
          "每条独立资产必须关联一个产品型号；厂商和型号不在这里重复填写，领取/归还使用量属于订单履约记录。",
        ),
      }}
      actions={
        canManage && activeTab === "assets"
          ? [
              {
                id: "create-asset",
                kind: "open",
                label: {
                  default:
                    locale === "en-US"
                      ? `${t("新增")} ${t(profile.data?.terminology.assetLabel ?? "资产")}`
                      : `${t("新增")}${t(profile.data?.terminology.assetLabel ?? "资产")}`,
                },
                emphasis: "primary",
                permissions: [{ resource: "asset", action: "manage" }],
                icon: <PlusOutlined />,
                disabled: editorUnavailable || saveAsset.isPending,
                open: () => openAssetEditor(),
              },
            ]
          : []
      }
    >
      <UnsavedChangesGuard dirty={assetDrawerOpen && assetEditor.dirty} busy={saveAsset.isPending} />

      {visibleTabs.length > 1 && (
        <Tabs
          aria-label={t("库存视图")}
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as "assets" | "stock")}
          items={visibleTabs}
        />
      )}
      <ListSection
        controls={
          <SearchField
            label={t(activeTab === "assets" ? "搜索资产" : "搜索库存")}
            placeholder={searchPlaceholder}
            value={keyword}
            onValueChange={setKeyword}
            style={{ width: "var(--rental-control-width-search)" }}
          />
        }
      >
        <QueryState
          transitionKey={activeTab}
          loading={
            groups.isLoading ||
            locations.isLoading ||
            profile.isLoading ||
            categories.isLoading ||
            (activeTab === "assets" ? assets.isLoading : stocks.isLoading || dispositions.isLoading)
          }
          error={
            groups.error ||
            locations.error ||
            profile.error ||
            categories.error ||
            (activeTab === "assets" ? assets.error : stocks.error || dispositions.error)
          }
          onRetry={() =>
            Promise.all([
              groups.refetch({ throwOnError: true }),
              locations.refetch({ throwOnError: true }),
              profile.refetch({ throwOnError: true }),
              categories.refetch({ throwOnError: true }),
              ...(activeTab === "assets"
                ? [assets.refetch({ throwOnError: true })]
                : [stocks.refetch({ throwOnError: true }), dispositions.refetch({ throwOnError: true })]),
            ])
          }
        >
          {activeTab === "assets" ? (
            <Table<RentalAsset>
              emptyScene={keyword.trim() ? "search" : "empty"}
              cardView={assetCards({
                t,
                groups: groups.data ?? [],
                statusLabel: (value) => t(statusMap[value]?.label ?? value),
                canManage,
                canView,
                edit: openAssetEditor,
                history: setStatusHistoryAsset,
                fields: assetFields,
                summaryFields: summaryAssetFields,
                serialLabel: serialNoField ? t(serialNoField.label) : undefined,
                itemGroupLabel: t(profile.data?.terminology.itemGroupLabel ?? "产品型号"),
                locationLabel: t(profile.data?.terminology.fulfillmentLabel ?? "履约地点"),
              })}
              exportConfig={{
                filename: t("器材资产"),
                fields: [
                  { label: t("资产编号"), value: (row) => row.assetNo },
                  { label: t("商品"), value: (row) => row.itemGroupName },
                  { label: t("地点"), value: (row) => row.locationName },
                  { label: t("状态"), value: (row) => row.status },
                ],
              }}
              rowKey="id"
              onRefresh={() => assets.refetch()}
              loading={assets.isLoading}
              refreshing={assets.isFetching}
              dataSource={assetRows}
              scroll={{ x: 960 }}
              columns={[
                {
                  title: t("照片"),
                  width: 88,
                  fixed: "left",
                  render: (_, row) => {
                    const group = (groups.data ?? []).find((item) => item.id === row.itemGroupId);
                    const image = group?.images?.find((item) => item.isCover) ?? group?.images?.[0];
                    return group && image ? (
                      <ItemGroupPhoto groupId={group.id} image={image} />
                    ) : (
                      <span className="muted">{t("未上传")}</span>
                    );
                  },
                },
                {
                  title: t(profile.data?.terminology.identifierLabel ?? "资产编号"),
                  dataIndex: "assetNo",
                  minWidth: ADMIN_TABLE_COLUMN_WIDTH.identifier,
                  fixed: "left",
                  render: (value) => <DataTableText primary={value} />,
                },
                ...(serialNoField
                  ? [
                      {
                        title: t(serialNoField.label),
                        dataIndex: "serialNo",
                        render: (value: string | undefined) => value || "-",
                      },
                    ]
                  : []),
                {
                  title: t(profile.data?.terminology.itemGroupLabel ?? "产品型号"),
                  dataIndex: "itemGroupName",
                  minWidth: ADMIN_TABLE_COLUMN_WIDTH.identity,
                  render: (_, row) => (
                    <DataTableText primary={row.itemGroupName} secondary={row.itemGroupCode} />
                  ),
                },
                ...summaryAssetFields.map((field) => ({
                  title: t(field.label),
                  render: (_: unknown, row: RentalAsset) =>
                    catalogAttributeText(row.attributes[field.code], t),
                })),
                {
                  title: t(profile.data?.terminology.fulfillmentLabel ?? "履约地点"),
                  dataIndex: "locationName",
                },
                {
                  title: t("状态"),
                  dataIndex: "status",
                  render: (value) => (
                    <Tag color={statusMap[value]?.color}>{t(statusMap[value]?.label ?? value)}</Tag>
                  ),
                },
                {
                  title: t("操作"),
                  fixed: "right",
                  render: (_, row) =>
                    canView ? (
                      <DataTableRowActions
                        primary={
                          canManage
                            ? {
                                id: "edit",
                                label: t("编辑"),
                                icon: Pencil,
                                onSelect: () => openAssetEditor(row),
                              }
                            : undefined
                        }
                        details={() => setStatusHistoryAsset(row)}
                        detailLabel={t("状态历史")}
                        menuLabel={`${row.assetNo} · ${t("更多操作")}`}
                        actions={
                          canManage
                            ? [
                                {
                                  id: "history",
                                  label: t("状态历史"),
                                  icon: History,
                                  onSelect: () => setStatusHistoryAsset(row),
                                },
                              ]
                            : []
                        }
                      />
                    ) : (
                      "-"
                    ),
                },
              ]}
            />
          ) : (
            <Table<RentalStockBalance>
              emptyScene={keyword.trim() ? "search" : "empty"}
              cardView={stockCards({
                t,
                locale,
                groups: groups.data ?? [],
                dispositions: dispositions.data ?? [],
                locationLabel: t(profile.data?.terminology.fulfillmentLabel ?? "履约地点"),
              })}
              exportConfig={{
                filename: t("库存"),
                fields: [
                  { label: t("商品"), value: (row) => row.itemGroupName },
                  { label: t("地点"), value: (row) => row.locationName },
                  { label: t("在手"), value: (row) => row.onHandQuantity },
                  { label: t("已预占"), value: (row) => row.reservedQuantity },
                  { label: t("维护/清洁"), value: (row) => row.maintenanceQuantity },
                ],
              }}
              rowKey="id"
              onRefresh={() => stocks.refetch()}
              loading={stocks.isLoading}
              refreshing={stocks.isFetching}
              dataSource={stockRows}
              columns={[
                {
                  title: t("商品"),
                  dataIndex: "itemGroupName",
                  minWidth: ADMIN_TABLE_COLUMN_WIDTH.identity,
                  render: (_, row) => (
                    <DataTableText primary={row.itemGroupName} secondary={row.itemGroupCode} />
                  ),
                },
                {
                  title: t(profile.data?.terminology.fulfillmentLabel ?? "履约地点"),
                  dataIndex: "locationName",
                },
                { title: t("在手"), dataIndex: "onHandQuantity", align: "right" },
                { title: t("已预占"), dataIndex: "reservedQuantity", align: "right" },
                { title: t("维护/清洁"), dataIndex: "maintenanceQuantity", align: "right" },
                {
                  title: t("可用"),
                  dataIndex: "availableQuantity",
                  align: "right",
                  render: (value) => <DataTableText primary={value} />,
                },
                {
                  title: t("不可用原因 / 预计恢复"),
                  render: (_, row) => {
                    const blocked = (dispositions.data ?? []).filter(
                      (item) =>
                        item.itemGroupId === row.itemGroupId &&
                        item.locationId === row.locationId &&
                        item.status !== "restored",
                    );
                    if (!blocked.length) return "-";
                    return blocked.map((item) => (
                      <div key={item.id} className="text-meta">
                        <Tag
                          color={item.status === "blocked" ? "red" : "orange"}
                          style={{ marginInlineEnd: 4 }}
                        >
                          {t(item.status === "blocked" ? "异常隔离" : "周转缓冲")}
                        </Tag>
                        {item.blockReason || t("养护处理中")}
                        {item.status === "buffered" && item.bufferUntil
                          ? ` · ${t("预计")} ${new Date(item.bufferUntil).toLocaleString(locale)}`
                          : ""}
                      </div>
                    ));
                  },
                },
              ]}
            />
          )}
        </QueryState>
      </ListSection>
      {activeTab === "stock" && (
        <StockOperationsPanel
          groups={groups.data ?? []}
          locations={locations.data ?? []}
          terminology={profile.data?.terminology}
          canManage={canManage}
          unavailable={editorUnavailable}
        />
      )}
      <Modal
        presentation="side"
        title={[t(editing ? "编辑" : "新增"), t(profile.data?.terminology.assetLabel ?? "资产")].join(
          locale === "en-US" ? " " : "",
        )}
        width={640}
        open={assetDismissal.visible}
        destroyOnHidden
        onCancel={dismissAssetEditor}
        afterClose={assetDismissal.afterClose}
        closable={!saveAsset.isPending}
        keyboard={!saveAsset.isPending}
        maskClosable={!saveAsset.isPending}
        footer={
          <>
            <Button disabled={saveAsset.isPending} onClick={dismissAssetEditor}>
              {t("取消")}
            </Button>
            <SaveButton
              disabled={editorUnavailable}
              label={t("保存")}
              form={boundAssetForm}
              pending={saveAsset.isPending}
              onSave={assetEditor.submit}
            />
          </>
        }
      >
        <Form<SaveRentalAssetRequest>
          name="catalog-asset"
          form={assetForm}
          layout="vertical"
          disabled={editorUnavailable || saveAsset.isPending}
          {...assetEditor.formProps}
        >
          <SettingsWorkspace
            sections={[
              {
                key: "profile",
                label: t("基本资料"),
                content: (
                  <div>
                    {selectedItemGroup && (
                      <div className={styles.assetContext}>
                        {selectedItemGroupCover ? (
                          <div className={styles.assetIdentity}>
                            <ItemGroupPhoto groupId={selectedItemGroup.id} image={selectedItemGroupCover} />
                            <div>
                              <strong>{selectedItemGroup.name}</strong>
                              <p>
                                {locale === "en-US"
                                  ? `${t("照片来自")}${t(profile.data?.terminology.itemGroupLabel ?? "产品型号")}${t("主档；该资产的实拍、状态和损伤照片将在具体资产档案中独立维护。")}`
                                  : `照片来自${profile.data?.terminology.itemGroupLabel ?? "产品型号"}主档；该资产的实拍、状态和损伤照片将在具体资产档案中独立维护。`}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <Alert
                            type="info"
                            showIcon
                            title={`${t("该")}${t(profile.data?.terminology.itemGroupLabel ?? "产品型号")}${t("尚未上传照片")}`}
                            description={`${t("请先到")}“${t(resolveTenantNavigationLabels(profile.data?.terminology).routes.itemGroups ?? "产品型号管理")}”${t("上传标准展示图。")}`}
                          />
                        )}
                      </div>
                    )}
                    <Row gutter={16}>
                      <Col span={24}>
                        <Form.Item
                          name="itemGroupId"
                          label={t(profile.data?.terminology.itemGroupLabel ?? "产品型号")}
                          extra={t("厂商、品牌和型号从所选主档带入。")}
                          rules={[{ required: true }]}
                        >
                          <Select
                            disabled={Boolean(editing) || editorUnavailable || saveAsset.isPending}
                            showSearch={{ optionFilterProp: "label" }}
                            options={(groups.data ?? [])
                              .filter(
                                (item) =>
                                  item.inventoryMode === RentalInventoryMode.Serialized &&
                                  (item.status === "enabled" || item.id === editing?.itemGroupId),
                              )
                              .map((item) => ({
                                value: item.id,
                                label: `${item.name} · ${item.code}`,
                                disabled: item.status !== "enabled",
                              }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          name="assetNo"
                          label={t(profile.data?.terminology.identifierLabel ?? "资产编号")}
                          rules={[{ required: true }]}
                        >
                          <Input placeholder={t("内部管理编号")} />
                        </Form.Item>
                      </Col>
                      {serialNoField && (
                        <Col span={12}>
                          <Form.Item
                            name="serialNo"
                            label={t(serialNoField.label)}
                            extra={serialNoField.unique ? t("当前经营空间内不可重复") : undefined}
                            rules={[{ required: serialNoField.required }]}
                          >
                            <AttributeInput field={serialNoField} />
                          </Form.Item>
                        </Col>
                      )}
                      <Col span={12}>
                        <Form.Item
                          name="locationId"
                          label={t(profile.data?.terminology.fulfillmentLabel ?? "履约地点")}
                          rules={[{ required: true }]}
                        >
                          <Select
                            options={(locations.data ?? [])
                              .filter((item) => item.status === "enabled" || item.id === editing?.locationId)
                              .map((item) => ({
                                value: item.id,
                                label: item.name,
                                disabled: item.status !== "enabled",
                              }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="status" label={t("状态")} rules={[{ required: true }]}>
                          <Select
                            options={Object.entries(statusMap).map(([value, item]) => ({
                              value,
                              label: t(item.label),
                            }))}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  </div>
                ),
              },
              ...(assetFields.length > 0
                ? [
                    {
                      key: "identification",
                      label: t("识别信息"),
                      content: (
                        <div>
                          <Row gutter={16}>
                            {assetFields.map((field) => (
                              <Col span={12} key={field.code}>
                                <Form.Item
                                  name={["attributes", field.code]}
                                  label={t(field.label)}
                                  extra={field.unique ? t("当前经营空间内不可重复") : undefined}
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
                  ]
                : []),
            ]}
          />
        </Form>
      </Modal>
      <Modal
        presentation="side"
        title={`${statusHistoryAsset?.assetNo ?? t("资产")} · ${t("状态历史")}`}
        width={720}
        open={historyDialog.visible}
        onCancel={historyDialog.dismiss}
        afterClose={historyDialog.afterClose}
        destroyOnHidden
        footer={<Button onClick={historyDialog.dismiss}>{t("关闭")}</Button>}
      >
        <QueryState
          loading={statusHistory.isLoading}
          error={statusHistory.error}
          onRetry={() => statusHistory.refetch({ throwOnError: true })}
        >
          <Table<RentalAssetStatusHistory>
            rowKey="id"
            loading={statusHistory.isLoading}
            refreshing={statusHistory.isFetching}
            onRefresh={() => statusHistory.refetch()}
            dataSource={statusHistory.data ?? []}
            pagination={{ pageSize: 10 }}
            locale={{ emptyText: t("暂无状态变化记录") }}
            columns={[
              {
                title: t("时间"),
                dataIndex: "createdAt",
                render: (value: string) => (
                  <DataTableText
                    primary={new Date(value).toLocaleDateString(locale)}
                    secondary={new Date(value).toLocaleTimeString(locale)}
                  />
                ),
              },
              {
                title: t("状态变化"),
                render: (_: unknown, row) =>
                  `${row.fromStatus ? t(statusMap[row.fromStatus]?.label ?? row.fromStatus) : t("初始")} → ${t(statusMap[row.toStatus]?.label ?? row.toStatus)}`,
              },
              {
                title: t("来源"),
                dataIndex: "source",
                render: (value: string) => t(historySourceMap[value] ?? value),
              },
              { title: t("原因"), dataIndex: "reason", minWidth: ADMIN_TABLE_COLUMN_WIDTH.summary },
              { title: t("操作人"), dataIndex: "operator" },
            ]}
          />
        </QueryState>
      </Modal>
    </CorePage>
  );
}
