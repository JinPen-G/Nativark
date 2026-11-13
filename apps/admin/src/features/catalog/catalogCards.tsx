/** Model summaries show catalog facts and every rate-group membership; editing stays in the original guarded flow. */
import { Boxes, Check, CircleCheck, CirclePause, Layers3 } from "lucide-react";
import type { ReactNode } from "react";
import type { RentalAttributeDefinition, RentalItemGroup, RentalPricingGroup } from "@rental-os/shared";
import type { ListCard } from "@/components/ui";
import { Button } from "@/registry/components/button/button";
import { CardBadge, CardFacts, CardList, CardSecondary, CardSection } from "@/components/ui/data-table/RecordCard";
import { CatalogCardMedia } from "./CatalogCardMedia";
import { catalogAttributeText } from "./catalogAttributeText";
import styles from "./catalogCards.module.css";
import listing from "./catalogListing.module.css";

type Translate = (key: string) => string;
const inventoryLabels: Record<string, string> = {
  serialized: "序列化资产", quantity: "数量库存", consumable: "一次性耗材", bundle: "套装",
};

export function catalogCards({ t, fields, summaryFields, pricingGroups, canManage, edit, risk }: {
  t: Translate;
  fields: RentalAttributeDefinition[];
  summaryFields: RentalAttributeDefinition[];
  pricingGroups: RentalPricingGroup[];
  canManage: boolean;
  edit: (row: RentalItemGroup) => void;
  risk: (row: RentalItemGroup) => ReactNode;
}): ListCard<RentalItemGroup> {
  const groups = (row: RentalItemGroup) => pricingGroups.filter(group => group.memberItemGroupIds.includes(row.id));
  const filled = (row: RentalItemGroup, candidates: RentalAttributeDefinition[]) => candidates.filter(field => {
    const value = row.attributes[field.code];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
  const extraFields = (row: RentalItemGroup) => {
    const shown = new Set(filled(row, summaryFields).slice(0, 2).map(field => field.code));
    return filled(row, fields).filter(field => !shown.has(field.code) && field.code !== "securityRiskLevel");
  };

  return {
    kind: "catalog",
    title: row => row.name,
    subtitle: row => row.code,
    media: row => <CatalogCardMedia group={row} />,
    listing: row => <>
      <p className={listing.row}>
        <span className={listing.identity} title={row.code}>{row.code}</span>
        <span className={listing.state}>{row.status === "enabled" ? <CircleCheck aria-hidden="true" /> : <CirclePause aria-hidden="true" />}{t(row.status === "enabled" ? "已启用" : "已停用")}</span>
      </p>
      <p className={listing.row}>
        <span className={listing.metadata} title={t(inventoryLabels[row.inventoryMode] ?? row.inventoryMode)}>{t(inventoryLabels[row.inventoryMode] ?? row.inventoryMode)}{row.unit && ` · ${t(row.unit)}`}</span>
        <span className={listing.risk}>{risk(row)}</span>
      </p>
    </>,
    status: row => <div className={styles.context}>
      <span className={styles.mode}><Boxes aria-hidden="true" />{t(inventoryLabels[row.inventoryMode] ?? row.inventoryMode)}{row.unit && <span title={t("单位")}> · {t(row.unit)}</span>}</span>
      <span className={styles.badges}>
        <CardBadge tone={row.status === "enabled" ? "positive" : undefined}>{t(row.status === "enabled" ? "已启用" : "已停用")}</CardBadge>
        {risk(row)}
      </span>
    </div>,
    body: row => {
      const specs = filled(row, summaryFields).slice(0, 2);
      const parts = row.inventoryMode === "bundle" ? row.bundleComponents ?? [] : [];
      const memberships = groups(row);
      return <div className={styles.listing}>
        {(specs.length > 0 || parts.length > 0) && <div className={styles.summaryFacts}>
        {specs.length > 0 && <dl className={styles.specs}>
          {specs.map(field => <div key={field.code}>
            <dt>{t(field.label)}</dt>
            <dd>{catalogAttributeText(row.attributes[field.code], t)}</dd>
          </div>)}
        </dl>}
        {parts.length > 0 && <div className={styles.components}>
          <span className={styles.label}>{t("套装组成")}</span>
          <ul>{parts.slice(0, 2).map((item, index) => <li key={`${item.itemGroupId}-${index}`}>
            <span title={item.itemGroupName}>{item.itemGroupName}</span>
            <span className={styles.quantity}>×{item.quantity}</span>
          </li>)}</ul>
          {parts.length > 2 && <CardSecondary>{t("更多组成")} +{parts.length - 2}</CardSecondary>}
        </div>}
        </div>}
        <div className={styles.pricing}>
          <div className={styles.groupDetails}><Layers3 aria-hidden="true" />
          <div className={styles.groupText}>
            <span className={styles.label}>{t("所属定价分组")}</span>
            {memberships.length ? <ul className={styles.groupNames}>
              {memberships.map(group => <li key={group.id} title={group.name}>{group.name}</li>)}
            </ul> : <span className={styles.unassigned}>{t("未加入定价分组")}</span>}
          </div>
          </div>
        </div>
      </div>;
    },
    details: row => <>
      {extraFields(row).length > 0 && <CardSection title={t("完整规格")}>
        <CardFacts items={extraFields(row).map(field => ({ label: t(field.label), value: catalogAttributeText(row.attributes[field.code], t) }))} />
      </CardSection>}
      {row.description && <CardSection title={t("目录信息")}><CardSecondary>{row.description}</CardSecondary></CardSection>}
      {row.bundleComponents?.length ? <CardSection title={t("套装组成")}>
        <CardList>{row.bundleComponents.map((item, index) => <li key={`${item.itemGroupId}-${index}`}>
          <Check aria-hidden="true" />
          <div>{item.itemGroupName} × {item.quantity}<CardSecondary>{[item.substitutionGroup, item.optional ? t("候选") : t("默认")].filter(Boolean).join(" · ")}</CardSecondary></div>
        </li>)}</CardList>
      </CardSection> : null}
    </>,
    actions: (row, afterClose) => <Button variant="secondary" size="sm" disabled={!canManage} onClick={() => afterClose(() => edit(row))}>{t("编辑型号")}</Button>,
  };
}
