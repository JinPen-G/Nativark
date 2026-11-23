/** 库存作业保留原幂等键、表单和真实流水，当前页面拥有提交状态。
 * 原宿主可供给当前引用资料判定，打开及保存均复验，不用旧下拉资料绕过撤权。 */
import { useLayoutEffect, useMemo, useRef } from "react";
import { UnsavedChangesGuard, useCorePageHost } from "@rental-os/platform-admin/core";
import { useRentalCatalogPageContext } from "./page-context";
import { RENTAL_CATALOG_CORE_ID } from "./pages";
import { useOrderEditor } from "../orders/useOrderEditor";
import { DataTableText, ListSection, SaveButton, SearchField } from "@rental-os/platform-admin/ui";
import { PlusOutlined } from "@rental-os/platform-admin/ui";
import type {
  RentalCategoryTerminology,
  RentalFulfillmentLocation,
  RentalItemGroup,
  RentalStockLedgerEntry,
  RentalStockOperationRequest,
  RentalStockOperationType,
} from "@rental-os/rental-core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Col, InputNumber, Row, Tag, Typography } from "antd";
import { App } from "@rental-os/platform-admin/ui";
import { Form } from "@rental-os/platform-admin/ui";
import { Table } from "@rental-os/platform-admin/ui";
import { Input } from "@rental-os/platform-admin/ui";
import { Button, Modal, Select, Tooltip } from "@rental-os/platform-admin/ui";
import { useState } from "react";
import { useLocale } from "@rental-os/platform-admin/locale";
import { ADMIN_TABLE_COLUMN_WIDTH } from "@rental-os/platform-admin/ui";
import { QueryState } from "@rental-os/platform-admin/core";
import { useModalDismissal } from "@rental-os/platform-admin/ui";

const OPERATION_OPTIONS: Array<{ value: RentalStockOperationType; label: string; description: string }> = [
  { value: "receive", label: "入库", description: "增加某个履约地点的在手数量。" },
  {
    value: "count_adjustment",
    label: "盘点差异",
    description: "按实际盘点数调整在手数量，已预占和维修隔离数量不能被抹掉。",
  },
  { value: "transfer", label: "地点调拨", description: "在两个支持仓储的履约地点之间转移数量。" },
  {
    value: "consume",
    label: "耗材领用",
    description: "登记一次性耗材的人工领用；订单领取会自动记录同类消耗。",
  },
  { value: "scrap", label: "报损", description: "将无法继续经营的数量从在手账中报损。" },
  { value: "retire", label: "退出", description: "将不再经营的数量从在手账中退出。" },
];

function operationLabel(value: string) {
  const automatic: Record<string, string> = {
    return_transfer: "归还调拨",
    maintenance_quarantine: "养护隔离",
    maintenance_release: "养护恢复",
    maintenance_write_off: "养护报损",
  };
  return OPERATION_OPTIONS.find((item) => item.value === value)?.label ?? automatic[value] ?? value;
}

function deltaLabel(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function StockOperationsPanel({
  groups,
  locations,
  terminology,
  canManage,
  unavailable = false,
  unavailableText,
  referencesAvailable,
}: {
  groups: RentalItemGroup[];
  locations: RentalFulfillmentLocation[];
  terminology?: RentalCategoryTerminology;
  canManage: boolean;
  unavailable?: boolean;
  unavailableText?: string;
  referencesAvailable?: () => boolean;
}) {
  const { message } = App.useApp();
  const { t, locale } = useLocale();
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
    if (!isCurrentScope()) throw new DOMException("库存作业页面的会话或经营空间已变化", "AbortError");
    if (!allowed()) throw new Error("当前操作不可用");
    if (referencesAvailable && !referencesAvailable()) throw new Error("关联资料暂不可用");
  };
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [operationType, setOperationType] = useState<RentalStockOperationType>("receive");
  const [operationKey, setOperationKey] = useState(() => crypto.randomUUID());
  const [keyword, setKeyword] = useState("");
  const [form] = Form.useForm<RentalStockOperationRequest>();
  const stockDismissal = useModalDismissal(open, () => {
    setOpen(false);
    form.resetFields();
  });
  const ledger = useQuery({
    queryKey: ["rental-core", "stock-ledger", scope],
    enabled: Boolean(scope),
    queryFn: ({ signal }) => rentalCoreApi.stockLedger({ limit: 100 }, { signal }),
  });
  const quantityGroups = groups.filter(
    (group) => ["quantity", "consumable"].includes(group.inventoryMode) && group.status === "enabled",
  );
  const storageLocations = locations.filter(
    (location) => location.status === "enabled" && location.capabilities.includes("storage"),
  );
  const apply = useMutation({
    mutationFn: (values: RentalStockOperationRequest) => {
      assertManage();
      return rentalCoreApi.applyStockOperation(values);
    },
    onSuccess: async (result) => {
      if (!isCurrentScope()) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "stocks"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "stock-ledger"] }),
      ]);
      if (!isCurrentScope()) return;
      stockDismissal.dismiss();
      message.success(
        result.idempotent ? t("库存作业已按原记录幂等回放") : t("库存作业已记录，余额和流水已更新"),
      );
    },
    onError: (error: Error) => {
      if (isCurrentScope()) message.error(error.message || t("库存作业失败"));
    },
  });

  function openEditor() {
    if (!canManage || unavailable || apply.isPending || !allowed() || (open && !stockDismissal.visible))
      return;
    if (referencesAvailable && !referencesAvailable()) return;
    editor.dismiss(() => {
      const firstGroup = quantityGroups[0]?.id;
      const firstLocation = storageLocations[0]?.id;
      const nextKey = crypto.randomUUID();
      setOperationKey(nextKey);
      setOperationType("receive");
      form.resetFields();
      form.setFieldsValue({
        type: "receive",
        itemGroupId: firstGroup,
        locationId: firstLocation,
        quantity: 1,
        reason: "",
        idempotencyKey: nextKey,
      });
      setOpen(true);
      editor.markClean();
    });
  }

  const currentDescription = t(
    OPERATION_OPTIONS.find((item) => item.value === operationType)?.description ?? "",
  );
  const itemLabel = t(terminology?.itemGroupLabel ?? "商品");
  const rows = (ledger.data ?? []).filter((row) =>
    [
      row.itemGroupName,
      row.itemGroupCode,
      row.locationName,
      row.batchNo,
      row.sourceDocumentNo,
      row.reason,
      row.operator,
      t(operationLabel(row.operationType)),
    ]
      .join(" ")
      .toLocaleLowerCase(locale)
      .includes(keyword.trim().toLocaleLowerCase(locale)),
  );
  const editorUnavailable = !canManage || unavailable || !quantityGroups.length || !storageLocations.length;
  const unavailableReason = unavailable
    ? (unavailableText ?? t("关联资料暂不可用，请先刷新。"))
    : !quantityGroups.length
      ? t("请先建立数量型或耗材型号。")
      : !storageLocations.length
        ? t("请先启用具备仓储能力的履约地点。")
        : undefined;

  const editor = useOrderEditor<RentalStockOperationRequest>({
    form,
    identity: open ? JSON.stringify([scope, "stock-operation", operationKey]) : undefined,
    onSave: submitStock,
    disabled: editorUnavailable,
  });
  const stockForm = useMemo(() => ({ ...form, validateFields: editor.validate }), [form, editor.key]);
  const dismissStockEditor = () => editor.dismiss(stockDismissal.dismiss);
  function submitStock(values: RentalStockOperationRequest): Promise<unknown> {
    assertManage();
    if (editorUnavailable || apply.isPending) return Promise.reject(new Error(t("当前操作不可用")));
    return apply.mutateAsync({ ...values, type: operationType, idempotencyKey: operationKey });
  }

  return (
    <>
      <UnsavedChangesGuard dirty={open && editor.dirty} busy={apply.isPending} />
      <ListSection
        title={t("库存流水")}
        controls={
          <SearchField
            label={t("搜索库存流水")}
            placeholder={t("型号、地点、批次或单据")}
            value={keyword}
            onValueChange={setKeyword}
            style={{ width: "var(--rental-control-width-search)" }}
          />
        }
        extra={
          canManage && (
            <Tooltip title={unavailableReason}>
              <span tabIndex={editorUnavailable ? 0 : undefined}>
                <Button
                  disabled={editorUnavailable || apply.isPending}
                  icon={<PlusOutlined />}
                  onClick={openEditor}
                >
                  {t("新增库存作业")}
                </Button>
              </span>
            </Tooltip>
          )
        }
        style={{ marginTop: "var(--rental-layout-section-gap)" }}
      >
        <QueryState
          transitionKey={scope}
          loading={ledger.isLoading}
          error={ledger.error}
          onRetry={() => ledger.refetch({ throwOnError: true })}
        >
          <Table<RentalStockLedgerEntry>
            rowKey="id"
            loading={ledger.isLoading}
            refreshing={ledger.isFetching}
            onRefresh={() => ledger.refetch()}
            dataSource={rows}
            pagination={{ pageSize: 8 }}
            scroll={{ x: 1200 }}
            emptyScene={keyword.trim() ? "search" : "empty"}
            toolbarNote={ledger.data?.length === 100 ? t("仅显示最近 100 条流水") : undefined}
            locale={{ emptyText: keyword.trim() ? t("没有匹配的库存流水") : t("暂无库存作业流水") }}
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
                title: t("作业"),
                render: (_: unknown, row) => (
                  <Tag color={row.entryKind === "out" ? "orange" : row.entryKind === "in" ? "green" : "blue"}>
                    {t(operationLabel(row.operationType))}
                  </Tag>
                ),
              },
              {
                title: itemLabel,
                dataIndex: "itemGroupName",
                minWidth: ADMIN_TABLE_COLUMN_WIDTH.identity,
                render: (_: unknown, row) => (
                  <DataTableText primary={row.itemGroupName} secondary={row.itemGroupCode} />
                ),
              },
              { title: t(terminology?.fulfillmentLabel ?? "履约地点"), dataIndex: "locationName" },
              {
                title: t("变化"),
                dataIndex: "quantityDelta",
                align: "right",
                render: (value: number) => <DataTableText primary={deltaLabel(value)} />,
              },
              {
                title: t("前 → 后"),
                render: (_: unknown, row) => `${row.onHandBefore} → ${row.onHandAfter}`,
              },
              {
                title: t("批次/单据"),
                minWidth: ADMIN_TABLE_COLUMN_WIDTH.identifier,
                render: (_: unknown, row) => (
                  <DataTableText
                    primary={
                      row.batchNo
                        ? `${t("批次")}: ${row.batchNo}`
                        : row.sourceDocumentNo
                          ? `${t("单据")}: ${row.sourceDocumentNo}`
                          : t("未填写")
                    }
                    secondary={
                      row.batchNo && row.sourceDocumentNo
                        ? `${t("单据")}: ${row.sourceDocumentNo}`
                        : undefined
                    }
                  />
                ),
              },
              { title: t("原因/来源"), dataIndex: "reason", minWidth: ADMIN_TABLE_COLUMN_WIDTH.summary },
              { title: t("操作人"), dataIndex: "operator" },
            ]}
          />
        </QueryState>
      </ListSection>
      <Modal
        presentation="side"
        title={t("新增数量/耗材库存作业")}
        width={640}
        open={stockDismissal.visible}
        destroyOnHidden
        onCancel={dismissStockEditor}
        afterClose={stockDismissal.afterClose}
        closable={!apply.isPending}
        keyboard={!apply.isPending}
        maskClosable={!apply.isPending}
        footer={
          <>
            <Button disabled={apply.isPending} onClick={dismissStockEditor}>
              {t("取消")}
            </Button>
            <SaveButton
              label={t("保存作业")}
              form={stockForm}
              disabled={editorUnavailable}
              pending={apply.isPending}
              onSave={editor.submit}
            />
          </>
        }
      >
        <Form<RentalStockOperationRequest>
          name="stock-operation"
          form={form}
          layout="vertical"
          disabled={editorUnavailable || apply.isPending}
          {...editor.formProps}
        >
          <Form.Item
            label={t("作业类型")}
            name="type"
            extra={currentDescription}
            rules={[{ required: true }]}
          >
            <Select
              options={OPERATION_OPTIONS.map((item) => ({ value: item.value, label: t(item.label) }))}
              onChange={(value: RentalStockOperationType) => {
                setOperationType(value);
                form.setFieldValue("type", value);
              }}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            {t("已预占或维修隔离的库存不可直接扣减。")} {t("余额变化必须有来源流水")}
          </Typography.Paragraph>
          <Form.Item label={itemLabel} name="itemGroupId" rules={[{ required: true }]}>
            <Select
              showSearch={{ optionFilterProp: "label" }}
              options={quantityGroups.map((group) => ({
                value: group.id,
                label: `${group.code} · ${group.name}${group.inventoryMode === "consumable" ? `（${t("一次性耗材")}）` : ""}`,
              }))}
            />
          </Form.Item>
          {operationType === "transfer" ? (
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item label={t("调出地点")} name="fromLocationId" rules={[{ required: true }]}>
                  <Select
                    options={storageLocations.map((location) => ({
                      value: location.id,
                      label: location.name,
                    }))}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label={t("调入地点")} name="toLocationId" rules={[{ required: true }]}>
                  <Select
                    options={storageLocations.map((location) => ({
                      value: location.id,
                      label: location.name,
                    }))}
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            <Form.Item
              label={t(terminology?.fulfillmentLabel ?? "履约地点")}
              name="locationId"
              rules={[{ required: true }]}
            >
              <Select
                options={storageLocations.map((location) => ({ value: location.id, label: location.name }))}
              />
            </Form.Item>
          )}
          {operationType === "count_adjustment" ? (
            <Form.Item label={t("盘点实数")} name="actualOnHandQuantity" rules={[{ required: true }]}>
              <InputNumber min={0} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          ) : (
            <Form.Item label={t("数量")} name="quantity" rules={[{ required: true }]}>
              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          )}
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item label={t("批次号")} name="batchNo" rules={[{ max: 100 }]}>
                <Input placeholder={t("可填外部批次或本次作业批次")} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label={t("来源/审批单号")} name="sourceDocumentNo" rules={[{ max: 100 }]}>
                <Input placeholder={t("可填入库单、盘点单或审批单号")} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            label={t("原因或来源说明")}
            name="reason"
            rules={[{ required: true, whitespace: true, max: 500 }]}
          >
            <Input.TextArea
              rows={4}
              placeholder={t("例如：采购入库单、月末盘点差异、报损审批单号或退出原因")}
            />
          </Form.Item>
          <Form.Item name="idempotencyKey" hidden>
            <Input />
          </Form.Item>
          <Typography.Text type="secondary">
            {t("保存结果未确认时，请保留本窗口并先核对流水，避免重复登记。")}
          </Typography.Text>
        </Form>
      </Modal>
    </>
  );
}
