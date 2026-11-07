import { Check } from "lucide-react";
import type { ReactNode } from "react";
import type { RentalAttributeDefinition, RentalItemGroup, RentalPricingGroup } from "@rental-os/shared";
import type { ListCard } from "@/components/ui";
import { Button } from "@/registry/components/button/button";
import { CardBadge, CardFacts, CardFootnote, CardList, CardSecondary, CardSection } from "@/components/ui/data-table/RecordCard";
import { ItemGroupPhoto } from "./ItemGroupPhoto";
import { catalogAttributeText } from "./catalogAttributeText";
type Translate = (key: string) => string;
const inventoryLabels: Record<string, string> = { serialized: "序列化资产", quantity: "数量库存", consumable: "一次性耗材", bundle: "套装" };
export function catalogCards({ t, fields, summaryFields, pricingGroups, canManage, edit, risk }: {
  t: Translate; fields: RentalAttributeDefinition[]; summaryFields: RentalAttributeDefinition[]; pricingGroups: RentalPricingGroup[]; canManage: boolean;
  edit: (row: RentalItemGroup) => void; risk: (row: RentalItemGroup) => ReactNode;
}): ListCard<RentalItemGroup> {
  const groups = (row: RentalItemGroup) => pricingGroups.filter(group => group.memberItemGroupIds.includes(row.id));
  const filled = (row: RentalItemGroup, candidates: RentalAttributeDefinition[]) => candidates.filter(field => {
    const value = row.attributes[field.code]; return value !== undefined && value !== null && String(value).trim() !== "";
  });
  const extraFields = (row: RentalItemGroup) => {
    const shown = new Set(filled(row, summaryFields).slice(0, 2).map(field => field.code));
    return filled(row, fields).filter(field => !shown.has(field.code));
  };
  return { kind: "catalog", title: row => row.name, subtitle: row => row.code,
    media: row => { const image = row.images?.find(image => image.isCover) ?? row.images?.[0]; return image ? <ItemGroupPhoto groupId={row.id} image={image} presentation="card" alt={row.name} /> : null; },
    status: row => <><CardBadge tone={row.status === "enabled" ? "positive" : undefined}>{t(row.status === "enabled" ? "已启用" : "已停用")}</CardBadge><CardSecondary>{t(inventoryLabels[row.inventoryMode] ?? row.inventoryMode)}</CardSecondary></>,
    body: row => <>{filled(row, summaryFields).length > 0 && <CardFacts items={filled(row, summaryFields).slice(0, 2).map(field => ({ label: t(field.label), value: catalogAttributeText(row.attributes[field.code],t) }))} />}
      {row.inventoryMode === "bundle" && !!row.bundleComponents?.length && <CardSecondary>{row.bundleComponents.slice(0, 2).map(item => `${item.itemGroupName} × ${item.quantity}`).join(" · ")}</CardSecondary>}
      <CardFootnote>{risk(row)}</CardFootnote>
    </>,
    details: row => <>{extraFields(row).length > 0 && <CardSection title={t("完整规格")}><CardFacts items={extraFields(row).map(field => ({ label: t(field.label), value: catalogAttributeText(row.attributes[field.code],t) }))} /></CardSection>}
      <CardSection title={t("目录信息")}><CardFacts items={[{ label: t("单位"), value: row.unit || "—" }, { label: t("所属定价分组"), value: groups(row).map(group => group.name).join(" · ") || t("未加入定价分组") }]} />{row.description && <CardSecondary>{row.description}</CardSecondary>}</CardSection>
      {row.bundleComponents?.length ? <CardSection title={t("套装组成")}><CardList>{row.bundleComponents.map((item, index) => <li key={index}><Check aria-hidden="true" /><div>{item.itemGroupName} × {item.quantity}<CardSecondary>{[item.substitutionGroup, item.optional ? t("候选") : t("默认")].filter(Boolean).join(" · ")}</CardSecondary></div></li>)}</CardList></CardSection> : null}
    </>,
    actions: (row, afterClose) => <Button variant="secondary" size="sm" disabled={!canManage} onClick={() => afterClose(() => edit(row))}>{t("编辑型号")}</Button>,
  };
}
