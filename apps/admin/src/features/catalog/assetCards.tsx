/** Read-only asset/stock quick looks; quantities, statuses and restrictions stay server-owned. */
import { Box, CircleCheck, CirclePause, Clock3, MapPin, ScanLine, TriangleAlert, Wrench } from "lucide-react";
import type { RentalAsset, RentalAttributeDefinition, RentalItemGroup, RentalStockBalance, RentalStockDisposition } from "@rental-os/shared";
import { DataTableStatus, type ListCard } from "@/components/ui";
import { Button } from "@/registry/components/button/button";
import { CardFacts, CardSecondary, CardSection } from "@/components/ui/data-table/RecordCard";
import { CatalogCardMedia } from "./CatalogCardMedia";
import { catalogAttributeText } from "./catalogAttributeText";
import styles from "./assetCards.module.css";

type Translate = (key: string) => string;
const assetStatus = {
  available: { tone: "success", icon: CircleCheck },
  reserved: { tone: "info", icon: Clock3 },
  rented: { tone: "info", icon: Clock3 },
  inspection: { tone: "warning", icon: ScanLine },
  maintenance: { tone: "warning", icon: Wrench },
  disabled: { tone: "neutral", icon: CirclePause },
} as const;

function photo(groups: RentalItemGroup[], id: string) {
  const group = groups.find(item => item.id === id);
  return group?.images?.length ? <CatalogCardMedia group={group} /> : null;
}

export function assetCards({ t, groups, statusLabel, canManage, canView, edit, history, fields = [], summaryFields = [], itemGroupLabel, locationLabel, serialLabel }: {
  t: Translate;
  groups: RentalItemGroup[];
  statusLabel: (status: string) => string;
  canManage: boolean;
  canView: boolean;
  edit: (row: RentalAsset) => void;
  history: (row: RentalAsset) => void;
  fields?: RentalAttributeDefinition[];
  summaryFields?: RentalAttributeDefinition[];
  itemGroupLabel?: string;
  locationLabel?: string;
  serialLabel?: string;
}): ListCard<RentalAsset> {
  const filled = (row: RentalAsset, candidates: RentalAttributeDefinition[]) => candidates.filter(field => {
    const value = row.attributes[field.code];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
  const extraFields = (row: RentalAsset) => {
    const shown = new Set(filled(row, summaryFields).slice(0, 2).map(field => field.code));
    return filled(row, fields).filter(field => !shown.has(field.code));
  };
  return {
    kind: "asset",
    title: row => row.assetNo,
    subtitle: row => row.itemGroupCode,
    media: row => photo(groups, row.itemGroupId),
    status: row => <DataTableStatus variant="soft" {...assetStatus[row.status]}>{statusLabel(row.status)}</DataTableStatus>,
    body: row => <div className={styles.asset}>
      <dl className={styles.identity}>
        <div><dt><Box aria-hidden="true" /><span>{itemGroupLabel ?? t("型号")}</span></dt><dd>{row.itemGroupName}</dd></div>
        <div><dt><MapPin aria-hidden="true" /><span>{locationLabel ?? t("履约地点")}</span></dt><dd>{row.locationName}</dd></div>
      </dl>
      <dl className={styles.serial}><div><dt>{serialLabel ?? t("序列号")}</dt><dd data-empty={row.serialNo ? undefined : ""}>{row.serialNo || t("未登记序列号")}</dd></div></dl>
      {filled(row, summaryFields).length > 0 && <dl className={styles.attributes}>
        {filled(row, summaryFields).slice(0, 2).map(field => <div key={field.code}><dt>{t(field.label)}</dt><dd>{catalogAttributeText(row.attributes[field.code], t)}</dd></div>)}
      </dl>}
    </div>,
    details: row => extraFields(row).length > 0 ? <CardSection title={t("基本资料")}>
      <CardFacts items={extraFields(row).map(field => ({ label: t(field.label), value: catalogAttributeText(row.attributes[field.code], t) }))} />
    </CardSection> : null,
    actions: (row, afterClose) => <>
      {canManage && <Button variant="secondary" size="sm" onClick={() => afterClose(() => edit(row))}>{t("编辑")}</Button>}
      {canView && <Button variant="secondary" size="sm" onClick={() => afterClose(() => history(row))}>{t("状态历史")}</Button>}
    </>,
  };
}

export function stockCards({ t, groups, dispositions, locale, locationLabel }: {
  t: Translate;
  groups: RentalItemGroup[];
  dispositions: RentalStockDisposition[];
  locale?: string;
  locationLabel?: string;
}): ListCard<RentalStockBalance> {
  const restricted = (row: RentalStockBalance) => dispositions.filter(item => item.itemGroupId === row.itemGroupId && item.locationId === row.locationId && (item.status === "buffered" || item.status === "blocked"));
  return {
    kind: "stock",
    title: row => row.itemGroupName,
    subtitle: row => row.itemGroupCode,
    media: row => photo(groups, row.itemGroupId),
    status: row => <span className={styles.location} title={locationLabel ?? t("履约地点")}><MapPin aria-hidden="true" />{row.locationName}</span>,
    body: row => {
      const unit = groups.find(group => group.id === row.itemGroupId)?.unit;
      return <div className={styles.stock}>
        <div className={styles.availability}>
          <span className={styles.availableLabel}>{t("可用")}</span>
          <span className={styles.availableValue}>{row.availableQuantity}{unit && <span>{t(unit)}</span>}</span>
        </div>
        <dl className={styles.quantities}>
          <div><dt>{t("在手")}</dt><dd>{row.onHandQuantity}</dd></div>
          <div><dt>{t("已预占")}</dt><dd>{row.reservedQuantity}</dd></div>
          <div><dt>{t("维护/清洁")}</dt><dd>{row.maintenanceQuantity}</dd></div>
        </dl>
        {row.reservedQuantity + row.maintenanceQuantity > row.onHandQuantity && <div className={styles.restriction}><TriangleAlert aria-hidden="true" /><span>{t("已预占")} + {t("维护/清洁")} &gt; {t("在手")}</span></div>}
        {restricted(row).slice(0, 2).map(item => <div className={`${styles.restriction} ${styles.dispositionSummary}`} key={item.id} data-blocked={item.status === "blocked" || undefined}>
          <TriangleAlert aria-hidden="true" /><span>{t(item.status === "blocked" ? "异常隔离" : "周转缓冲")} · {item.blockReason || t("养护处理中")}</span>
        </div>)}
      </div>;
    },
    details: row => restricted(row).length > 0 ? <CardSection title={t("不可用原因 / 预计恢复")}>
        {restricted(row).map(item => <div key={item.id}>
          <DataTableStatus variant="soft" tone={item.status === "blocked" ? "error" : "warning"}>{t(item.status === "blocked" ? "异常隔离" : "周转缓冲")}</DataTableStatus>
          <CardSecondary>{item.blockReason || t("养护处理中")}</CardSecondary>
          {item.status === "buffered" && item.bufferUntil && <CardSecondary>{new Date(item.bufferUntil).toLocaleString(locale)}</CardSecondary>}
        </div>)}
      </CardSection> : null,
  };
}
