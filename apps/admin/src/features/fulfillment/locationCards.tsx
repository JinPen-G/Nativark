import { ArrowDownToLine, ArrowUpFromLine, Building2, Clock, Construction, Globe, MapPin, Package, Store, Truck, Warehouse, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { RentalFulfillmentLocation } from "@rental-os/shared";
import type { ListCard } from "@/components/ui";
import { Button } from "@/registry/components/button/button";
import { CardBadge, CardFacts, CardSecondary, CardSection } from "@/components/ui/data-table/RecordCard";
import styles from "./locationCards.module.css";

const capabilitySlots: Array<{ code: RentalFulfillmentLocation["capabilities"][number]; icon: LucideIcon }> = [
  { code: "pickup", icon: ArrowUpFromLine }, { code: "return", icon: ArrowDownToLine }, { code: "storage", icon: Warehouse }, { code: "delivery", icon: Truck },
];
const typeIcons: Record<string, LucideIcon> = { store: Store, warehouse: Warehouse, station: MapPin, locker: Package, delivery_hub: Truck, project_site: Construction };

/** Open status is only derived from a single daily "HH:mm-HH:mm" range or an explicit all-day text; other free-text hours are shown as-is. */
function dailyRange(hours?: string): [number, number] | "always" | undefined {
  if (!hours) return undefined;
  const text = hours.trim();
  if (/^(全天|24\s*小时|24h|00:00\s*[-–~至]\s*24:00)$/i.test(text)) return "always";
  const match = /^(?:每天|每日|周一至周日|全年)\s*(\d{1,2}):(\d{2})\s*[-–~至]\s*(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return undefined;
  const [startHour, startMinute, endHour, endMinute] = match.slice(1).map(Number);
  if (startHour > 23 || startMinute > 59 || endHour > 24 || endMinute > 59 || (endHour === 24 && endMinute !== 0)) return undefined;
  const start = startHour * 60 + startMinute, end = endHour * 60 + endMinute;
  return start === end ? undefined : [start, end];
}
function localClock(zone: string, now: Date) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const hour = Number(parts.find(part => part.type === "hour")?.value), minute = Number(parts.find(part => part.type === "minute")?.value);
    return Number.isFinite(hour) && Number.isFinite(minute) ? { label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, minutes: hour * 60 + minute } : undefined;
  } catch { return undefined; }
}
function LocationSign({ row, t, typeLabel }: { row: RentalFulfillmentLocation; t: (key: string) => string; typeLabel: string }) {
  const [now, setNow] = useState<Date>();
  useEffect(() => { setNow(new Date()); const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer); }, []);
  const clock = row.timezone && now ? localClock(row.timezone, now) : undefined, range = dailyRange(row.businessHours), TypeIcon = typeIcons[row.type] ?? MapPin;
  const open = row.status !== "enabled" || !clock || !range ? undefined : range === "always" ? true
    : range[0] <= range[1] ? clock.minutes >= range[0] && clock.minutes < range[1] : clock.minutes >= range[0] || clock.minutes < range[1];
  const openText = row.status !== "enabled" ? t("已停用") : open === undefined ? (row.businessHours || t("营业时间未配置")) : t(open ? "营业中" : "已打烊");
  return <div className={styles.sign} data-disabled={row.status === "enabled" ? undefined : ""}>
    <span className={styles.pin} aria-hidden="true"><TypeIcon /></span>
    <div className={styles.signTop}>
      <span className={styles.type}><TypeIcon aria-hidden="true" />{typeLabel}</span>
      <span className={styles.open} data-open={open ? "" : undefined}><span className={styles.dot} aria-hidden="true" />{openText}</span>
    </div>
    <div className={styles.clock}>
      <span className={styles.time} data-unset={clock ? undefined : ""}>{clock?.label ?? t(row.timezone ? "当地时间不可用" : "未设置时区")}</span>
      <span className={styles.zone}>{clock ? <><Globe aria-hidden="true" />{t("当地时间")} · {row.timezone}</> : null}{open !== undefined && row.businessHours ? <><Clock aria-hidden="true" />{row.businessHours}</> : null}</span>
    </div>
  </div>;
}

export function locationCards({ t, typeLabels, capabilityLabels, canManage, edit }: {
  t: (key: string) => string; typeLabels: Record<string, string>; capabilityLabels: Record<string, string>;
  canManage: boolean; edit: (row: RentalFulfillmentLocation) => void;
}): ListCard<RentalFulfillmentLocation> {
  return { kind: "location", title: row => row.name, subtitle: row => row.code,
    media: row => <LocationSign row={row} t={t} typeLabel={t(typeLabels[row.type] ?? row.type)} />,
    body: row => { const place = row.address || [row.province, row.city, row.district].filter((part, index, parts): part is string => Boolean(part) && part !== parts[index - 1]).join(" ");
      return <>
        <address className={styles.address} data-empty={place ? undefined : ""}><MapPin aria-hidden="true" /><span>{place || t("地址未配置")}</span></address>
        <ul className={styles.capabilities} aria-label={row.capabilities.length ? t("履约能力") : `${t("履约能力")}: ${t("未配置")}`}>{capabilitySlots.map(({ code, icon: Icon }) => { const on = row.capabilities.includes(code);
          return <li key={code} data-off={on ? undefined : ""} aria-hidden={on ? undefined : true}><Icon aria-hidden="true" /><span>{t(capabilityLabels[code] ?? code)}</span></li>;
        })}</ul>
        <div className={styles.operator}><Building2 aria-hidden="true" /><span>{row.operatorName || `${t("经营主体")} · ${t("未配置")}`}</span></div>
      </>;
    },
    details: row => <CardSection title={t("履约地点")}><CardFacts items={[
      { label: t("经营主体"), value: row.operatorName || t("未配置") },
      { label: t("地点类型"), value: t(typeLabels[row.type] ?? row.type) },
      { label: t("联系人"), value: row.contactName || "—" }, { label: t("联系电话"), value: row.contactPhone || "—" },
      { label: t("营业时间"), value: row.businessHours || "—" }, { label: t("时区"), value: row.timezone || "—" }
    ]} />{row.address && <CardSecondary>{row.address}</CardSecondary>}</CardSection>,
    actions: (row, afterClose) => canManage ? <Button variant="secondary" size="sm" onClick={() => afterClose(() => edit(row))}>{t("编辑")}</Button> : null
  };
}
