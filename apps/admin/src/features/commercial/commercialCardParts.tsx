/** Presentation-only pieces for commercial cards. Prices and rules are the saved facts passed in; nothing is recalculated here. */
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { RentalItemGroup } from "@rental-os/shared";
import { rentalCoreApi } from "@/api/rentalCore";
import groupStyles from "@/registry/components/avatar-group/avatar-group.module.css";
import styles from "./commercialCards.module.css";

export interface BoardRate { unit: string; label: string; amount: string }

/** Price board after UIArc Pro Pricing calculator: unit tabs swap the saved base price with a rolling transition. */
export function PriceBoard({ rates, initial, label, emptyText }: { rates: BoardRate[]; initial?: string; label: string; emptyText: string }) {
  const [unit, setUnit] = useState(initial ?? rates[0]?.unit), reduced = useReducedMotion();
  const current = rates.find(rate => rate.unit === unit), index = current ? rates.indexOf(current) : -1;
  const [direction, setDirection] = useState(1);
  return <div className={styles.board} data-empty={current ? undefined : ""}>
    <span className={styles.boardLabel}>{label}</span>
    {current ? <div className={styles.boardPrice} aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <motion.span key={current.unit} className={styles.boardValue} custom={direction}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: `${40 * direction}%`, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: `${-40 * direction}%`, filter: "blur(4px)" }} transition={{ type: "spring", stiffness: 420, damping: 34 }}>{current.amount}</motion.span>
      </AnimatePresence>
      <span className={styles.boardUnit}>/ {current.label}</span>
    </div> : <span className={styles.boardEmpty}>{emptyText}</span>}
    {(rates.length > 1 || (!current && rates.length > 0)) && <div className={styles.units} role="group" aria-label={label}>{rates.map((rate, position) => <button key={rate.unit} type="button" aria-pressed={rate === current}
      onClick={event => { event.stopPropagation(); setDirection(position >= index ? 1 : -1); setUnit(rate.unit); }} onKeyDown={event => event.stopPropagation()}>{rate.label}</button>)}</div>}
  </div>;
}

function ModelThumb({ member, model }: { member: { id: string; name: string }; model?: RentalItemGroup }) {
  const image = model?.images?.find(item => item.isCover) ?? model?.images?.[0];
  const { data } = useQuery({ queryKey: ["rental-core", "item-group-image", member.id, image?.id], enabled: Boolean(image), queryFn: () => rentalCoreApi.itemGroupImageBlob(member.id, image!.id), staleTime: 5 * 60_000 });
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!data) { setUrl(undefined); return; }
    const next = URL.createObjectURL(data);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [data]);
  return <span className={`${groupStyles.avatar} ${styles.modelThumb}`} role="img" aria-label={member.name}>{url ? <img src={url} alt="" /> : <span aria-hidden="true">{member.name.trim().slice(0, 1)}</span>}</span>;
}

/** Model thumbnails stacked with the UIArc Avatar group styles; images reuse the item-group image cache. */
export function ModelStack({ members, models, label }: { members: Array<{ id: string; name: string }>; models: RentalItemGroup[]; label: string }) {
  if (!members.length) return null;
  const visible = members.slice(0, 4), overflow = members.length - visible.length;
  return <div className={`${groupStyles.group} ${groupStyles.sm}`} role="group" aria-label={label} style={{ "--count": visible.length + (overflow > 0 ? 1 : 0) } as CSSProperties}>
    {visible.map((member, index) => <span key={member.id} className={groupStyles.slot} style={{ "--index": index } as CSSProperties}><span className={groupStyles.lift}>
      <ModelThumb member={member} model={models.find(item => item.id === member.id)} />
      <span className={groupStyles.tip} aria-hidden="true">{member.name}</span>
    </span></span>)}
    {overflow > 0 && <span className={groupStyles.slot} style={{ "--index": visible.length } as CSSProperties}><span className={`${groupStyles.lift} ${groupStyles.overflow} ${groupStyles.sm}`} role="img" aria-label={`+${overflow}`}>+{overflow}</span></span>}
  </div>;
}
/** Coupon face after UIArc Pro Ticket tear: the value stub and the terms are separated by a perforated cut. The tear gesture is not used. */
export function Ticket({ kind, value, cap, children, inactive }: { kind: string; value: string; cap?: ReactNode; children: ReactNode; inactive?: boolean }) {
  return <div className={styles.ticketWrap} data-inactive={inactive ? "" : undefined}>
    <div className={styles.ticket}>
      <div className={styles.ticketValue}><span>{kind}</span><strong>{value}</strong>{cap && <small>{cap}</small>}</div>
      <div className={styles.ticketTerms}>{children}</div>
    </div>
  </div>;
}

/** Proportional bar for parts that share one saved total; parts with no value are not drawn. */
export function SplitMeter({ parts, label, proportional = true }: { parts: Array<{ id: string; label: string; value: number; text: ReactNode }>; label: string; proportional?: boolean }) {
  return <div className={styles.meter}>
    <span className={styles.meterCaption}>{label}</span>
    {proportional && <div className={styles.meterTrack} role="img" aria-label={label}>{parts.filter(part => part.value > 0).map(part => <span key={part.id} data-part={part.id} style={{ flex: `${part.value} 1 0` }} />)}</div>}
    <dl className={styles.meterLegend} aria-label={proportional ? undefined : label}>{parts.map(part => <div key={part.id}><i data-part={part.id} aria-hidden="true" /><dt>{part.label}</dt><dd>{part.text}</dd></div>)}</dl>
  </div>;
}
