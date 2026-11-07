/** Actionable maintenance lanes. Stage changes require the existing command/approval, never a local card move. */
import type { CSSProperties, ReactNode } from "react";
import { motion } from "motion/react";
import { Clock3, UserRound } from "lucide-react";
import type { RentalWorkOrder } from "@rental-os/shared";
import { AnimatedNumber, Button, ListFilterBar } from "@/components/ui";
import { useListControls } from "@/components/ui/ListSection";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { useLocale } from "@/app/locale";
import classes from "./work-order-board-source/classes.json";
import "./work-order-board-source/original.css";
import styles from "./WorkOrderBoard.module.css";

const lanes = [
  {key:"pending",label:"待处理",statuses:["pending","rejected"]},
  {key:"in_progress",label:"处理中",statuses:["in_progress"]},
  {key:"pending_review",label:"待验收",statuses:["pending_review"]},
  {key:"closed",label:"已结束",statuses:["completed","cancelled"]},
];
export function WorkOrderBoard({rows, statusLabel, typeLabel, actions, onOpen, onShowList}:{
  rows:RentalWorkOrder[]; statusLabel:(status:string)=>string; typeLabel:(type:string)=>string;
  actions:(row:RentalWorkOrder)=>ReactNode; onOpen:(row:RentalWorkOrder)=>void; onShowList:()=>void;
}){
  const {t,locale}=useLocale(), controls=useListControls(), reduced=usePrefersReducedMotion();
  return <><ListFilterBar>{controls}</ListFilterBar><div className={`${classes.frame} ${styles.frame}`}>
    <div className={classes.scroller}><div className={classes.board} style={{"--cols":lanes.length} as CSSProperties}>
      <div className={classes.headRow}>{lanes.map(lane=><div key={lane.key} className={classes.columnHead}><span className={classes.columnName}>{t(lane.label)}</span><span className={classes.count}><AnimatedNumber value={rows.filter(row=>lane.statuses.includes(row.status)).length}/></span></div>)}</div>
      <div className={classes.row}>{lanes.map(lane=>{const items=rows.filter(row=>lane.statuses.includes(row.status));return <section key={lane.key} className={classes.cell} aria-label={t(lane.label)}>
        {items.slice(0,30).map(row=><motion.article layout={reduced?false:"position"} transition={{duration:.2}} key={row.id} className={`${classes.card} ${styles.card}`}>
          <div className={classes.cardInner}>
          <div className={classes.cardTop}><span className={classes.cardId}>{row.workNo}</span><span className={classes.label}>{typeLabel(row.type)}</span></div>
          <button className={styles.title} onClick={()=>onOpen(row)}>{row.reason||row.workNo}</button>
          <div className={classes.cardMeta}><span className={classes.metaItem}><UserRound size={13}/>{row.assigneeName||t("未派工")}</span><span className={classes.metaItem}><Clock3 size={13}/>{new Date(row.updatedAt).toLocaleDateString(locale)}</span></div>
          <div className={styles.actions}><span>{statusLabel(row.status)}</span>{actions(row)}</div>
          </div>
        </motion.article>)}
        {!items.length&&<p className={styles.empty}>{t("暂无工单")}</p>}
        {items.length>30&&<Button type="text" onClick={onShowList}>{t("在列表查看全部")}</Button>}
      </section>;})}</div>
    </div></div>
  </div></>;
}
