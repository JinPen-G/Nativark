import { DataTableText, ListSection, SaveButton } from "@/components/ui";
import { PlusOutlined } from "@/components/ui/icons";
import { RentalAssetStatus, RentalInventoryMode, type RentalAsset, type RentalAssetStatusHistory, type RentalAttributeDefinition, type RentalStockBalance, type SaveRentalAssetRequest } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Col, InputNumber, Row, Space, Tag } from "antd";
import { App } from "@/components/ui";
import { Form, FormSection } from "@/components/ui";
import { Alert, Table } from "@/components/ui";
import { Switch } from "@/components/ui";
import { Input } from "@/components/ui";
import { Button, DataTableRowActions, Drawer, SearchField, Select, Tabs } from "@/components/ui";
import { History, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { resolveTenantNavigationLabels } from "@/app/navigation-terminology";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";
import { ItemGroupPhoto } from "./ItemGroupPhoto";
import { assetCards, stockCards } from "./assetCards";
import { StockOperationsPanel } from "./StockOperationsPanel";
import { AnimatedNumber } from "@/components/ui";
import type { ReactNode } from "react";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import styles from "./CatalogEditors.module.css";
import { catalogAttributeText } from "./catalogAttributeText";

const statusMap: Record<string, { label: string; color: string }> = {
  available: { label: "可用", color: "success" }, reserved: { label: "已预占", color: "processing" }, rented: { label: "租赁中", color: "blue" },
  inspection: { label: "检查中", color: "orange" }, maintenance: { label: "维护中", color: "warning" }, disabled: { label: "停用", color: "default" }
};
const historySourceMap: Record<string, string> = { onboarding: "资产登记", manual: "资料维护", order: "订单流程", disposition: "归还处置" };

/** 与商品目录页同一问题与同一修法：受控属性必须透传，否则必填属性永远校验不过。 */
function AttributeInput({
  field,
  value,
  checked,
  onChange,
  id
}: {
  field: RentalAttributeDefinition;
  value?: unknown;
  checked?: boolean;
  onChange?: (...args: never[]) => void;
  id?: string;
}) {
  const { t } = useLocale();
  if (field.type === "number") {
    return <InputNumber id={id} min={0} suffix={field.unit} style={{ width: "100%" }} value={value as number} onChange={onChange as (value: number | null) => void} />;
  }
  if (field.type === "select") {
    return <Select id={id} options={field.options?.map((option) => ({ value: option, label: catalogAttributeText(option, t) }))} value={value as string} onChange={onChange as (value: string) => void} />;
  }
  if (field.type === "boolean") {
    return <Switch id={id} checked={checked ?? Boolean(value)} onChange={onChange as (checked: boolean) => void} />;
  }
  return <Input id={id} type={field.type === "date" ? "date" : undefined} value={value as string} onChange={onChange as (event: unknown) => void} />;
}

export function AssetWorkspacePage() {
  const { message } = App.useApp();
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const canManage = useAuthStore((state) => state.hasPermission("rental-core:asset:manage"));
  const canView = useAuthStore((state) => state.hasPermission("rental-core:asset:view") || state.hasPermission("rental-core:asset:manage"));
  const [activeTab, setActiveTab] = useState<"assets" | "stock">("assets");
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<RentalAsset>();
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
  const [statusHistoryAsset, setStatusHistoryAsset] = useState<RentalAsset>();
  const [assetForm] = Form.useForm<SaveRentalAssetRequest>();
  const selectedItemGroupId = Form.useWatch("itemGroupId", assetForm);
  const assets = useQuery({ queryKey: ["rental-core", "assets"], queryFn: rentalCoreApi.assets });
  const statusHistory = useQuery({ queryKey: ["rental-core", "asset-status-history", statusHistoryAsset?.id], queryFn: () => rentalCoreApi.assetStatusHistory(statusHistoryAsset!.id), enabled: Boolean(statusHistoryAsset) });
  const stocks = useQuery({ queryKey: ["rental-core", "stocks"], queryFn: rentalCoreApi.stockBalances });
  const groups = useQuery({ queryKey: ["rental-core", "groups"], queryFn: rentalCoreApi.itemGroups });
  const locations = useQuery({ queryKey: ["rental-core", "locations"], queryFn: rentalCoreApi.locations });
  // SHARED-WORK-01A：库存页显示不可用原因与预计恢复时间（来自归还处置事实，不由前端拼造）。
  const dispositions = useQuery({ queryKey: ["rental-core", "stock-dispositions"], queryFn: () => rentalCoreApi.stockDispositions() });
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const categories = useQuery({ queryKey: ["rental-core", "categories"], queryFn: rentalCoreApi.categories });
  const category = categories.data?.find((item) => item.code === profile.data?.categoryCode);
  const presentation = category?.businessModel.catalogPresentation;
  const serialNoField = category?.businessModel.assetFields.find((field) => field.scope === "asset" && field.code === "serialNo");
  const assetFields = category?.businessModel.assetFields.filter((field) => field.scope === "asset" && field.code !== "serialNo") ?? [];
  const summaryAssetFields = (presentation?.assetSummaryFields ?? assetFields.map((field) => field.code))
    .map((code) => assetFields.find((field) => field.code === code))
    .filter((field): field is RentalAttributeDefinition => Boolean(field))
    .filter(field => (assets.data ?? []).some(asset => asset.attributes[field.code] != null && asset.attributes[field.code] !== ""));
  const supportsAssets = category?.supportedInventoryModes.includes(RentalInventoryMode.Serialized) ?? true;
  const supportsStock = category?.supportedInventoryModes.some((mode) => [RentalInventoryMode.Quantity, RentalInventoryMode.Consumable].includes(mode)) ?? true;
  const saveAsset = useMutation({ mutationFn: rentalCoreApi.saveAsset, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["rental-core", "assets"] }); setAssetDrawerOpen(false); setEditing(undefined); assetForm.resetFields(); message.success(`${t(profile.data?.terminology.assetLabel ?? "资产")}${t("已保存")}`); }, onError: () => message.error(t("资产保存失败，请检查编号、商品和履约地点")) });
  const assetRows = useMemo(() => (assets.data ?? []).filter((asset) => !keyword || `${asset.assetNo}${asset.serialNo}${asset.itemGroupName}${asset.locationName}${Object.values(asset.attributes).join("")}`.toLowerCase().includes(keyword.toLowerCase())), [assets.data, keyword]);
  const stockRows = useMemo(() => (stocks.data ?? []).filter((stock) => !keyword || `${stock.itemGroupCode}${stock.itemGroupName}${stock.locationName}`.toLowerCase().includes(keyword.toLowerCase())), [stocks.data, keyword]);
  const countLabel = (label: string, count: number): ReactNode => <>{label} {locale === "en-US" ? "(" : "（"}<AnimatedNumber value={count} />{locale === "en-US" ? ")" : "）"}</>;
  const visibleTabs = [
    supportsAssets ? { key: "assets", label: countLabel(t("序列化资产"), assetRows.length) } : undefined,
    supportsStock ? { key: "stock", label: countLabel(t("数量/耗材库存"), stockRows.length) } : undefined
  ].filter((item): item is { key: string; label: ReactNode } => Boolean(item));
  const serializedGroups = (groups.data ?? []).filter((group) => group.inventoryMode === RentalInventoryMode.Serialized && group.status === "enabled");
  const selectedItemGroup = (groups.data ?? []).find((group) => group.id === selectedItemGroupId);
  const selectedItemGroupCover = selectedItemGroup?.images?.find((image) => image.isCover) ?? selectedItemGroup?.images?.[0];

  useEffect(() => {
    if (category && !supportsAssets && supportsStock) setActiveTab("stock");
    if (category && supportsAssets && !supportsStock) setActiveTab("assets");
  }, [category, supportsAssets, supportsStock]);

  function openAssetEditor(record?: RentalAsset) {
    setEditing(record);
    assetForm.setFieldsValue(record ?? { itemGroupId: serializedGroups[0]?.id ?? "", assetNo: "", serialNo: "", locationId: locations.data?.[0]?.id ?? "", status: RentalAssetStatus.Available, attributes: {} });
    setAssetDrawerOpen(true);
  }

  return (
    <>
      <PageHeader title={resolveTenantNavigationLabels(profile.data?.terminology).routes.assets ?? "资产与库存"} note={{ title: `${t(profile.data?.terminology.assetLabel ?? category?.name ?? "当前品类资产")}${t("是具体可交付实体")}`, description: t("每条独立资产必须关联一个产品型号；厂商和型号不在这里重复填写，领取/归还使用量属于订单履约记录。") }} extra={canManage && activeTab === "assets" ? <Button type="primary" icon={<PlusOutlined />} onClick={() => openAssetEditor()}>{locale === "en-US" ? `${t("新增")} ${t(profile.data?.terminology.assetLabel ?? "资产")}` : `${t("新增")}${t(profile.data?.terminology.assetLabel ?? "资产")}`}</Button> : undefined} />
      {visibleTabs.length > 1 && <Tabs aria-label={t("库存视图")} activeKey={activeTab} onChange={(key) => setActiveTab(key as "assets" | "stock")} items={visibleTabs} />}
      <ListSection controls={<SearchField label={t("搜索资产")} placeholder={locale === "en-US" ? `${t(profile.data?.terminology.identifierLabel ?? "资产编号")}, ${t(profile.data?.terminology.itemGroupLabel ?? "产品型号")} or ${t(profile.data?.terminology.fulfillmentLabel ?? "履约地点")}` : `${profile.data?.terminology.identifierLabel ?? "资产编号"}、${profile.data?.terminology.itemGroupLabel ?? "产品型号"}或${profile.data?.terminology.fulfillmentLabel ?? "履约地点"}`} value={keyword} onValueChange={setKeyword} style={{ width: "var(--rental-control-width-search)" }} />}>

        <QueryState transitionKey={activeTab} loading={assets.isLoading || stocks.isLoading || groups.isLoading || locations.isLoading || dispositions.isLoading || profile.isLoading || categories.isLoading} error={assets.error || stocks.error || groups.error || locations.error || dispositions.error || profile.error || categories.error}>
          {activeTab === "assets" ? <Table<RentalAsset> cardView={assetCards({ t, groups: groups.data ?? [], statusLabel: value => t(statusMap[value]?.label ?? value), canManage, canView, edit: openAssetEditor, history: setStatusHistoryAsset, identifier: t(profile.data?.terminology.identifierLabel ?? "资产编号") })} exportConfig={{ filename: t("器材资产"), fields: [{ label: t("资产编号"), value: row => row.assetNo }, { label: t("商品"), value: row => row.itemGroupName }, { label: t("地点"), value: row => row.locationName }, { label: t("状态"), value: row => row.status }] }} rowKey="id" onRefresh={() => assets.refetch()} loading={assets.isLoading} refreshing={assets.isFetching} dataSource={assetRows} scroll={{ x: 960 }} columns={[
            { title: t("照片"), width: 88, fixed: "left", render: (_, row) => {
              const group = (groups.data ?? []).find((item) => item.id === row.itemGroupId);
              const image = group?.images?.find((item) => item.isCover) ?? group?.images?.[0];
              return group && image ? <ItemGroupPhoto groupId={group.id} image={image} /> : <span className="muted">{t("未上传")}</span>;
            } },
            { title: t(profile.data?.terminology.identifierLabel ?? "资产编号"), dataIndex: "assetNo", fixed: "left", render: (value) => <b>{value}</b> },
            ...(serialNoField ? [{ title: t(serialNoField.label), dataIndex: "serialNo", render: (value: string | undefined) => value || "-" }] : []),
            { title: t(profile.data?.terminology.itemGroupLabel ?? "产品型号"), render: (_, row) => <DataTableText primary={row.itemGroupName} secondary={row.itemGroupCode} /> },
            ...summaryAssetFields.map((field) => ({ title: t(field.label), render: (_: unknown, row: RentalAsset) => String(row.attributes[field.code] ?? "-") })),
            { title: t(profile.data?.terminology.fulfillmentLabel ?? "履约地点"), dataIndex: "locationName" },
            { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={statusMap[value]?.color}>{t(statusMap[value]?.label ?? value)}</Tag> },
            { title: t("操作"), fixed: "right", render: (_, row) => canView ? <DataTableRowActions primary={canManage ? { id: "edit", label: t("编辑"), icon: Pencil, onSelect: () => openAssetEditor(row) } : undefined} details={() => setStatusHistoryAsset(row)} detailLabel={t("状态历史")} menuLabel={`${row.assetNo} · ${t("更多操作")}`} actions={canManage ? [{ id: "history", label: t("状态历史"), icon: History, onSelect: () => setStatusHistoryAsset(row) }] : []} /> : "-" }
          ]} /> : <Table<RentalStockBalance> cardView={stockCards({ t, groups: groups.data ?? [], dispositions: dispositions.data ?? [] })} exportConfig={{ filename: t("库存"), fields: [{ label: t("商品"), value: row => row.itemGroupName }, { label: t("地点"), value: row => row.locationName }, { label: t("在手"), value: row => row.onHandQuantity }, { label: t("已预占"), value: row => row.reservedQuantity }, { label: t("维护/清洁"), value: row => row.maintenanceQuantity }] }} rowKey="id" onRefresh={() => stocks.refetch()} loading={stocks.isLoading} refreshing={stocks.isFetching} dataSource={stockRows} columns={[
            { title: t("商品"), render: (_, row) => <DataTableText primary={row.itemGroupName} secondary={row.itemGroupCode} /> },
            { title: t(profile.data?.terminology.fulfillmentLabel ?? "履约地点"), dataIndex: "locationName" },
            { title: t("在手"), dataIndex: "onHandQuantity", align: "right" },
            { title: t("已预占"), dataIndex: "reservedQuantity", align: "right" },
            { title: t("维护/清洁"), dataIndex: "maintenanceQuantity", align: "right" },
            { title: t("可用"), dataIndex: "availableQuantity", align: "right", render: (value) => <b>{value}</b> },
            {
              title: t("不可用原因 / 预计恢复"),
              render: (_, row) => {
                const blocked = (dispositions.data ?? []).filter(
                  (item) => item.itemGroupId === row.itemGroupId && item.locationId === row.locationId && item.status !== "restored"
                );
                if (!blocked.length) return "-";
                return blocked.map((item) => (
                  <div key={item.id} className="text-meta">
                    <Tag color={item.status === "blocked" ? "red" : "orange"} style={{ marginInlineEnd: 4 }}>
                      {t(item.status === "blocked" ? "异常隔离" : "周转缓冲")}
                    </Tag>
                    {item.blockReason || t("养护处理中")}
                    {item.status === "buffered" && item.bufferUntil ? ` · ${t("预计")} ${new Date(item.bufferUntil).toLocaleString()}` : ""}
                  </div>
                ));
              }
            },
            { title: t("操作"), render: () => canManage ? t("请使用下方库存作业") : "-" }
          ]} />}
        </QueryState>
      </ListSection>
      {activeTab === "stock" && <StockOperationsPanel groups={groups.data ?? []} locations={locations.data ?? []} terminology={profile.data?.terminology} canManage={canManage} />}
      <Drawer title={editing ? (locale === "en-US" ? `${t("编辑")} ${t(profile.data?.terminology.assetLabel ?? "资产")}` : `${t("编辑")}${t(profile.data?.terminology.assetLabel ?? "资产")}`) : (locale === "en-US" ? `${t("新增")} ${t(profile.data?.terminology.assetLabel ?? "资产")}` : `${t("新增")}${t(profile.data?.terminology.assetLabel ?? "资产")}`)} size={640} open={assetDrawerOpen} destroyOnHidden onClose={() => setAssetDrawerOpen(false)} extra={<SaveButton  label={t("保存")} form={assetForm} pending={saveAsset.isPending} onSave={(values) => saveAsset.mutateAsync({ ...values, id: editing?.id })} />}>
        <Form<SaveRentalAssetRequest> form={assetForm} layout="vertical" onFinish={(values) => saveAsset.mutate({ ...values, id: editing?.id })}>
          <SettingsWorkspace sections={[
            { key: "profile", label: t("基本资料"), content: <FormSection title={`${t(profile.data?.terminology.assetLabel ?? "资产")}${t("基本资料")}`}>
          {selectedItemGroup && <div className={styles.assetContext}>
            {selectedItemGroupCover ? <div className={styles.assetIdentity}><ItemGroupPhoto groupId={selectedItemGroup.id} image={selectedItemGroupCover} /><div><strong>{selectedItemGroup.name}</strong><p>{locale === "en-US" ? `${t("照片来自")}${t(profile.data?.terminology.itemGroupLabel ?? "产品型号")}${t("主档；该资产的实拍、状态和损伤照片将在具体资产档案中独立维护。")}` : `照片来自${profile.data?.terminology.itemGroupLabel ?? "产品型号"}主档；该资产的实拍、状态和损伤照片将在具体资产档案中独立维护。`}</p></div></div> : <Alert type="info" showIcon title={`${t("该")}${t(profile.data?.terminology.itemGroupLabel ?? "产品型号")}${t("尚未上传照片")}`} description={`${t("请先到")}“${t(resolveTenantNavigationLabels(profile.data?.terminology).routes.itemGroups ?? "产品型号管理")}”${t("上传标准展示图。")}`} />}
          </div>}
            <Row gutter={16}>
            <Col span={24}><Form.Item name="itemGroupId" label={t(profile.data?.terminology.itemGroupLabel ?? "产品型号")} extra={t("厂商、品牌和型号从所选主档带入。")} rules={[{ required: true }]}><Select disabled={Boolean(editing)} showSearch={{ optionFilterProp: "label" }} options={serializedGroups.map((item) => ({ value: item.id, label: `${item.name} · ${item.code}` }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="assetNo" label={t(profile.data?.terminology.identifierLabel ?? "资产编号")} rules={[{ required: true }]}><Input placeholder={t("内部管理编号")} /></Form.Item></Col>
            {serialNoField && <Col span={12}><Form.Item name="serialNo" label={t(serialNoField.label)} extra={serialNoField.unique ? t("当前经营空间内不可重复") : undefined} rules={[{ required: serialNoField.required }]}><AttributeInput field={serialNoField} /></Form.Item></Col>}
            <Col span={12}><Form.Item name="locationId" label={t(profile.data?.terminology.fulfillmentLabel ?? "履约地点")} rules={[{ required: true }]}><Select options={(locations.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="status" label={t("状态")} rules={[{ required: true }]}><Select options={Object.entries(statusMap).map(([value, item]) => ({ value, label: t(item.label) }))} /></Form.Item></Col>
            </Row>
            </FormSection> },
            ...(assetFields.length > 0 ? [{ key: "identification", label: t("识别信息"), content: <FormSection title={locale === "en-US" ? `${t(profile.data?.terminology.assetLabel ?? "资产")} ${t("识别信息")}` : `${t(profile.data?.terminology.assetLabel ?? "资产")}${t("识别信息")}`}><Row gutter={16}>{assetFields.map((field) => <Col span={12} key={field.code}><Form.Item name={["attributes", field.code]} label={t(field.label)} extra={field.unique ? t("当前经营空间内不可重复") : undefined} rules={[{ required: field.required }]} valuePropName={field.type === "boolean" ? "checked" : "value"}><AttributeInput field={field} /></Form.Item></Col>)}</Row></FormSection> }] : [])
          ]} />
        </Form>
      </Drawer>
      <Drawer title={`${statusHistoryAsset?.assetNo ?? t("资产")}${t("状态历史")}`} size={720} open={Boolean(statusHistoryAsset)} onClose={() => setStatusHistoryAsset(undefined)}>
        {statusHistory.isError ? <Alert type="error" showIcon title={t("状态历史读取失败")} description={t("请稍后重试；本次未将失败误显示为没有记录。")} /> : <Table<RentalAssetStatusHistory>
          rowKey="id"
          loading={statusHistory.isLoading} refreshing={statusHistory.isFetching}
          onRefresh={() => statusHistory.refetch()} dataSource={statusHistory.data ?? []}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: t("暂无状态变化记录") }}
          columns={[
            { title: t("时间"), dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() },
            { title: t("状态变化"), render: (_: unknown, row) => `${row.fromStatus ? t(statusMap[row.fromStatus]?.label ?? row.fromStatus) : t("初始")} → ${t(statusMap[row.toStatus]?.label ?? row.toStatus)}` },
            { title: t("来源"), dataIndex: "source", render: (value: string) => t(historySourceMap[value] ?? value) },
            { title: t("原因"), dataIndex: "reason", ellipsis: true },
            { title: t("操作人"), dataIndex: "operator" }
          ]}
        />}
      </Drawer>
    </>
  );
}
