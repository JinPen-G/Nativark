import { Coffee, Timer } from "lucide-react";
import { useRef, useState } from "react";
import { useLocale } from "@/app/locale";
import { Button, Tooltip } from "@/components/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/registry/components/popover/popover";
import { useRest } from "./RestContext";
import { formatMediaTime, REST_MINUTES } from "./restSession";
import styles from "./rest.module.css";

export function RestEntry() {
  const rest = useRest();
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const starting = useRef(false);
  if (!rest.available && !rest.session) return null;
  if (rest.session) return <Tooltip title={`${t("打开休息播放器")} · ${rest.remaining ? formatMediaTime(rest.remaining) : t("休息结束")}`}>
    <Button ref={rest.entryRef} type="text" className={styles.entry} icon={<Coffee size={17} aria-hidden />}
      aria-label={t("打开休息播放器")} aria-controls="rental-rest-player" aria-expanded={rest.expanded} onClick={rest.expand} data-sound-silent />
  </Tooltip>;
  return <Popover open={open} onOpenChange={next => { starting.current = false; setOpen(next); }}>
    <Tooltip title={t("休息一下")}><PopoverTrigger asChild><Button ref={rest.entryRef} type="text" className={styles.entry} icon={<Coffee size={17} aria-hidden />}
      aria-label={t("休息一下")} data-sound-silent /></PopoverTrigger></Tooltip>
    <PopoverContent align="end" className={styles.chooser} aria-label={t("选择休息时长")} onCloseAutoFocus={event => {
      // Starting opens a new focus owner; the closing popover must not pull focus
      // out of the player after the duration button's click.
      if (starting.current) event.preventDefault();
    }}>
      <h2>{t("休息一下")}</h2>
      <p>{t("让音乐陪你放松片刻。")}</p>
      <div className={styles.durations}>{REST_MINUTES.map(minutes => <Button key={minutes} icon={<Timer size={16} aria-hidden />}
        onClick={() => { starting.current = true; setOpen(false); rest.start(minutes); }} data-sound-silent>{t("休息 {minutes} 分钟", { minutes })}</Button>)}</div>
      <span className={styles.chooserNote}>Taylor Swift · All Too Well</span>
      <span className={styles.chooserNote}>{t("十分钟版 · 10:13；休息到时自动停止")}</span>
    </PopoverContent>
  </Popover>;
}
