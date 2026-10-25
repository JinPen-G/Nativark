/** Read-only asset/stock quick looks; quantities and restrictions stay server-owned. */
import { MapPin } from "lucide-react";
import type { RentalAsset, RentalItemGroup, RentalStockBalance, RentalStockDisposition } from "@rental-os/shared";
import type { ListCard } from "@/components/ui";
import { Button } from "@/registry/components/button/button";
import { CardBadge, CardFacts, CardFootnote, CardHighlights, CardMetric, CardSecondary, CardSection } from "@/components/ui/data-table/RecordCard";
import { ItemGroupPhoto } from "./ItemGroupPhoto";

type Translate = (key: string) => string;
function photo(groups: RentalItemGroup[], id: string, name: string) {
  const group = groups.find(item => item.id === id);
  const image = group?.images?.find(item => item.isCover) ?? group?.images?.[0];
  return group && image ? <ItemGroupPhoto groupId={group.id} image={image} presentation="card" alt={name} /> : null;
}
export function assetCards({ t, groups, statusLabel, canManage, canView, edit, history, identifier }: {
  t: Translate; groups: RentalItemGroup[]; statusLabel: (status: string) => string;
  canManage: boolean; canView: boolean; edit: (row: RentalAsset) => void; history: (row: RentalAsset) => void; identifier: string;
}): ListCard<RentalAsset> {
  return { kind: "asset", title: row => row.assetNo, subtitle: row => row.itemGroupCode,
    media: row => photo(groups, row.itemGroupId, row.itemGroupName),
    status: row => <CardBadge tone={row.status === "available" ? "positive" : undefined} emphasis={["inspection", "maintenance"].includes(row.status)}>{statusLabel(row.status)}</CardBadge>,
    body: row => <><CardSecondary>{row.itemGroupName}</CardSecondary><CardHighlights items={[
      { label: t("履约地点"), value: row.locationName, icon: <MapPin aria-hidden="true" /> },
      ...(row.serialNo ? [{ label: t("序列号"), value: row.serialNo }] : [])
    ]} /></>,
    details: row => <CardSection title={t("基本资料")}><CardFacts items={[
      { label: identifier, value: row.assetNo }, { label: t("商品"), value: row.itemGroupName },
      { label: t("履约地点"), value: row.locationName }, { label: t("状态"), value: statusLabel(row.status) },
      ...(row.serialNo ? [{ label: t("序列号"), value: row.serialNo }] : [])
    ]} /></CardSection>,
    actions: (row, afterClose) => <>
      {canManage && <Button variant="secondary" size="sm" onClick={() => afterClose(() => edit(row))}>{t("编辑")}</Button>}
      {canView && <Button variant="secondary" size="sm" onClick={() => afterClose(() => history(row))}>{t("状态历史")}</Button>}
    </>
  };
}
export function stockCards({ t, groups, dispositions }: { t: Translate; groups: RentalItemGroup[]; dispositions: RentalStockDisposition[] }): ListCard<RentalStockBalance> {
  const restricted = (row: RentalStockBalance) => dispositions.filter(item => item.itemGroupId === row.itemGroupId && item.locationId === row.locationId && (item.status === "buffered" || item.status === "blocked"));
  return { kind: "stock", title: row => row.itemGroupName, subtitle: row => row.itemGroupCode,
    media: row => photo(groups, row.itemGroupId, row.itemGroupName),
    status: row => <CardBadge><MapPin aria-hidden="true" />{row.locationName}</CardBadge>,
    body: row => <><CardMetric value={row.availableQuantity} label={t("可用")} /><CardFacts items={[
      { label: t("在手"), value: row.onHandQuantity }, { label: t("已预占"), value: row.reservedQuantity }
    ]} /><CardFootnote>{t("维护/清洁")} {row.maintenanceQuantity}</CardFootnote>
      {restricted(row).slice(0, 2).map(item => <CardFootnote key={item.id}><CardBadge emphasis>{t(item.status === "blocked" ? "异常隔离" : "周转缓冲")}</CardBadge>{item.blockReason || t("养护处理中")}</CardFootnote>)}
    </>,
    details: row => <><CardSection title={t("库存与资产（当前快照）")}><CardFacts items={[
      { label: t("可用"), value: row.availableQuantity }, { label: t("在手"), value: row.onHandQuantity },
      { label: t("已预占"), value: row.reservedQuantity }, { label: t("维护/清洁"), value: row.maintenanceQuantity }
    ]} /></CardSection>{restricted(row).length > 0 && <CardSection title={t("不可用原因 / 预计恢复")}>
      {restricted(row).map(item => <div key={item.id}><CardBadge emphasis>{t(item.status === "blocked" ? "异常隔离" : "周转缓冲")}</CardBadge>
        <CardSecondary>{item.blockReason || t("养护处理中")}</CardSecondary>
        {item.status === "buffered" && item.bufferUntil && <CardSecondary>{new Date(item.bufferUntil).toLocaleString()}</CardSecondary>}
      </div>)}
    </CardSection>}</>
  };
}
