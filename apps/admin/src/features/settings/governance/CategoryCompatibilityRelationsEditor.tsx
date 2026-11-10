import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Space, Typography } from "antd";
import { Alert, Button, ConfirmAction, Input, Select } from "@/components/ui";
import type { RentalCompatibilityEntityRef, RentalCompatibilityRelation } from "@rental-os/shared";
import type { CategoryPreparationOperation, CategoryPreparationPreview } from "@/api/categoryPreparation";
import { categoryPreparationApi } from "@/api/categoryPreparation";
import { useLocale } from "@/app/locale";

const relationLabels: Record<RentalCompatibilityRelation["relationType"], string> = {
  equipment_target: "设备适配", mount_adapter: "卡口转接", battery_support: "电池兼容", storage_support: "存储介质兼容", port_support: "接口兼容", model_fit: "型号兼容"
};
const outcomes: Record<RentalCompatibilityRelation["outcome"], string> = { allow: "允许", warn: "提醒", block: "阻止" };
const referenceLabels: Record<RentalCompatibilityEntityRef["kind"], string> = { item_group: "型号", asset: "资产", attribute: "属性值" };
function readable(value: unknown): value is RentalCompatibilityRelation[] {
  return Array.isArray(value) && value.every(row => row && typeof row === "object" && !Array.isArray(row) &&
    Object.keys(row).every(key => ["id", "relationType", "source", "target", "outcome", "sourceName", "reason"].includes(key)) &&
    typeof row.id === "string" && row.id && Object.hasOwn(relationLabels, row.relationType) && Object.hasOwn(outcomes, row.outcome) &&
    ["source", "target"].every(side => row[side] && typeof row[side] === "object" && Object.hasOwn(referenceLabels, row[side].kind) &&
      Object.keys(row[side]).every(key => ["kind", "id", "field", "value"].includes(key))) && typeof row.sourceName === "string" && typeof row.reason === "string");
}

function ReferenceEditor({ label, value, disabled, targetId, operation, scopeKey, preview, onChange }: {
  label: string; value: RentalCompatibilityEntityRef; disabled: boolean; targetId: string;
  operation: CategoryPreparationOperation; scopeKey: string; preview: CategoryPreparationPreview; onChange: (value: RentalCompatibilityEntityRef) => void;
}) {
  const { t } = useLocale(), prefix = useId();
  const [search, setSearch] = useState(""), [applied, setApplied] = useState("");
  useEffect(() => { const timer = setTimeout(() => setApplied(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const kind = value.kind === "asset" ? "asset" : "item_group";
  const policy = { staleTime: 0, refetchOnWindowFocus: false, refetchInterval: false, meta: { liveRefresh: false } } as const;
  const page = useQuery({ ...policy, queryKey: ["category-preparation-reference", scopeKey, targetId, operation, kind, applied],
    queryFn: ({ signal }) => categoryPreparationApi.entities(targetId, { operation, entityType: kind, search: applied || undefined, limit: 50 }, signal),
    enabled: !disabled && value.kind !== "attribute" });
  const selected = useQuery({ ...policy, queryKey: ["category-preparation-reference-selected", scopeKey, targetId, operation, kind, value.id],
    queryFn: ({ signal }) => categoryPreparationApi.entities(targetId, { operation, entityType: kind, entityId: value.id, limit: 1 }, signal),
    enabled: !disabled && value.kind !== "attribute" && Boolean(value.id) });
  const rows = new Map([...(selected.data?.rows ?? []), ...(page.data?.rows ?? [])].map(row => [row.id, row]));
  const fields = preview.targetDefinition.businessModel.assetFields.filter(field => ["string", "date", "select"].includes(field.type) && !(field.scope === "asset" && field.code === "serialNo"));
  const selectedField = fields.find(field => field.code === value.field);
  return <Space orientation="vertical" size={8} style={{ width: "100%" }}>
    <label htmlFor={`${prefix}-kind`}>{t(label)}</label>
    <Select id={`${prefix}-kind`} aria-label={`${t(label)} · ${t("引用类型")}`} value={value.kind} disabled={disabled}
      options={Object.entries(referenceLabels).map(([key, text]) => ({ value: key, label: t(text) }))}
      onChange={kind => { setSearch(""); onChange({ kind }); }} />
    {value.kind === "attribute" ? <>
      <Select aria-label={`${t(label)} · ${t("属性字段")}`} value={value.field} disabled={disabled} allowClear
        options={[...new Map(fields.map(field => [field.code, { value: field.code, label: field.label }])).values()]}
        onChange={field => onChange({ kind: "attribute", field, value: "" })} />
      {selectedField?.type === "select" ? <Select aria-label={`${t(label)} · ${t("属性值")}`} value={value.value || undefined} disabled={disabled} allowClear
        options={selectedField.options?.map(option => ({ value: option, label: option }))} onChange={next => onChange({ ...value, value: next ?? "" })} />
        : <Input aria-label={`${t(label)} · ${t("属性值")}`} value={value.value ?? ""} disabled={disabled} maxLength={1000} onChange={event => onChange({ ...value, value: event.target.value })} />}
    </> : <>
      <Select aria-label={`${t(label)} · ${t(referenceLabels[value.kind])}`} value={value.id} disabled={disabled} allowClear loading={page.isFetching || selected.isFetching}
        showSearch={{ filterOption: false, onSearch: setSearch }}
        options={[...(value.id && !rows.has(value.id) ? [{ value: value.id, label: t("已保存引用（待核对）"), disabled: true }] : []),
          ...[...rows.values()].map(row => ({ value: row.id, label: row.name ?? row.assetNo ?? row.id }))]}
        onChange={id => onChange({ kind: value.kind, id })} />
      {(page.isError || selected.isError) && <Typography.Text type="danger">{t("引用资料读取失败，原引用已保留")}</Typography.Text>}
      {value.id && selected.isSuccess && !selected.data.rows.length && <Typography.Text type="warning">{t("已保存引用不在当前受权资料中，请重新选择")}</Typography.Text>}
    </>}
  </Space>;
}

/** Structured staged relation editing. Selection comes from scoped Core reads;
 * no relation writes or applicability decisions happen inside this editor. */
export function CategoryCompatibilityRelationsEditor({ value, disabled, targetId, operation, scopeKey, preview, onChange }: {
  value: unknown; disabled: boolean; targetId: string; operation: CategoryPreparationOperation; scopeKey: string;
  preview: CategoryPreparationPreview; onChange: (value: RentalCompatibilityRelation[]) => void;
}) {
  const { t } = useLocale();
  if (!readable(value)) return <Space orientation="vertical">
    <Alert type="warning" title={t("原兼容关系结构无法读取，尚未覆盖原配置")} />
    <ConfirmAction label={t("重新准备兼容关系")} prompt={t("放弃无法读取的关系输入，从空关系表重新准备？保存后才更新准备集合。")} disabled={disabled} onConfirm={async () => onChange([])} />
  </Space>;
  const update = (index: number, patch: Partial<RentalCompatibilityRelation>) => onChange(value.map((row, current) => current === index ? { ...structuredClone(row), ...patch } : structuredClone(row)));
  return <Space orientation="vertical" size={16} style={{ width: "100%" }}>
    {value.map((row, index) => <Space key={row.id} orientation="vertical" size={8} style={{ width: "100%" }}>
      <Space wrap>
        <Typography.Text strong>{t("兼容关系 {index}", { index: index + 1 })}</Typography.Text>
        <Button disabled={disabled} onClick={() => onChange(value.filter((_, current) => current !== index))}>{t("移除关系")}</Button>
      </Space>
      <Select aria-label={t("关系类型")} value={row.relationType} disabled={disabled} options={Object.entries(relationLabels).map(([value, label]) => ({ value, label: t(label) }))} onChange={relationType => update(index, { relationType })} />
      <ReferenceEditor label="来源对象" value={row.source} disabled={disabled} targetId={targetId} operation={operation} scopeKey={scopeKey} preview={preview} onChange={source => update(index, { source })} />
      <ReferenceEditor label="目标对象" value={row.target} disabled={disabled} targetId={targetId} operation={operation} scopeKey={scopeKey} preview={preview} onChange={target => update(index, { target })} />
      <Select aria-label={t("兼容结论")} value={row.outcome} disabled={disabled} options={Object.entries(outcomes).map(([value, label]) => ({ value, label: t(label) }))} onChange={outcome => update(index, { outcome })} />
      <Input aria-label={t("资料来源")} placeholder={t("资料来源")} value={row.sourceName} disabled={disabled} maxLength={1000} onChange={event => update(index, { sourceName: event.target.value })} />
      <Input.TextArea aria-label={t("关系说明")} placeholder={t("关系说明")} value={row.reason} disabled={disabled} maxLength={1000} onChange={event => update(index, { reason: event.target.value })} />
    </Space>)}
    {!value.length && <Typography.Text type="secondary">{t("暂无兼容关系，可添加需要核对的对象关系")}</Typography.Text>}
    <Button disabled={disabled} onClick={() => onChange([...value, { id: crypto.randomUUID(), relationType: "model_fit", source: { kind: "item_group" }, target: { kind: "item_group" }, outcome: "warn", sourceName: "", reason: "" }])}>{t("添加兼容关系")}</Button>
  </Space>;
}
