import { Clock, MapPin } from "lucide-react";
import type { RentalFulfillmentLocation } from "@rental-os/shared";
import type { ListCard } from "@/components/ui";
import { Button } from "@/registry/components/button/button";
import { CardBadge, CardFacts, CardFootnote, CardSecondary, CardSection } from "@/components/ui/data-table/RecordCard";

export function locationCards({ t, typeLabels, capabilityLabels, canManage, edit }: {
  t: (key: string) => string; typeLabels: Record<string, string>; capabilityLabels: Record<string, string>;
  canManage: boolean; edit: (row: RentalFulfillmentLocation) => void;
}): ListCard<RentalFulfillmentLocation> {
  return { kind: "location", title: row => row.name, subtitle: row => row.code,
    status: row => <><CardBadge tone={row.status === "enabled" ? "positive" : undefined}>{t(row.status === "enabled" ? "已启用" : "已停用")}</CardBadge><CardBadge><MapPin aria-hidden="true" />{t(typeLabels[row.type] ?? row.type)}</CardBadge></>,
    body: row => <><CardFacts items={[
      { label: t("经营主体"), value: row.operatorName || t("未配置") },
      { label: t("履约能力"), value: row.capabilities.map(value => t(capabilityLabels[value] ?? value)).join(" · ") || "—" }
    ]} />{row.businessHours && <CardFootnote><Clock size={14} aria-hidden="true" />{row.businessHours}</CardFootnote>}</>,
    details: row => <CardSection title={t("履约地点")}><CardFacts items={[
      { label: t("经营主体"), value: row.operatorName || t("未配置") },
      { label: t("地点类型"), value: t(typeLabels[row.type] ?? row.type) },
      { label: t("联系人"), value: row.contactName || "—" }, { label: t("联系电话"), value: row.contactPhone || "—" },
      { label: t("营业时间"), value: row.businessHours || "—" }, { label: t("时区"), value: row.timezone || "—" }
    ]} />{row.address && <CardSecondary>{row.address}</CardSecondary>}</CardSection>,
    actions: (row, afterClose) => canManage ? <Button variant="secondary" size="sm" onClick={() => afterClose(() => edit(row))}>{t("编辑")}</Button> : null
  };
}
