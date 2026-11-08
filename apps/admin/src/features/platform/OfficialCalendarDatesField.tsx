/** Two editors for one unsaved payload. UIArc owns the fields and popovers;
 * switching input modes never submits, invents dates or overwrites malformed JSON. */
import { useId, useRef, useState, type FocusEventHandler } from "react";
import { ConfigProvider } from "antd";
import dayjs from "dayjs";
import { Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/app/locale";
import { Alert, Button, DatePicker, Input, Segmented, Select } from "@/components/ui";
import { NativeFieldFeedbackContext } from "@/components/ui/Form";
import { ContentTransition } from "@/components/workspace/ContentTransition";
import { decodeOfficialCalendarDates, updateOfficialCalendarDate } from "./official-calendar-dates";
import styles from "./OfficialCalendarDatesField.module.css";

export function OfficialCalendarDatesField({ id, value = "[]", onChange, onBlur, year, disabled }: {
  id?: string; value?: string; onChange?: (value: string) => void; onBlur?: FocusEventHandler<HTMLDivElement>; year?: number; disabled?: boolean;
}) {
  const { t } = useLocale();
  const { componentDisabled } = ConfigProvider.useConfig();
  const locked = disabled ?? componentDisabled;
  const [mode, setMode] = useState<"rows" | "json">("rows");
  const uid = useId();
  const root = useRef<HTMLDivElement>(null);
  const nextKey = useRef(0);
  const rowKeys = useRef<number[]>([]);
  const rows = decodeOfficialCalendarDates(value);
  rowKeys.current = rows?.map((_, index) => rowKeys.current[index] ?? nextKey.current++) ?? [];
  const validYear = Number.isInteger(year) && year! >= 2000 && year! <= 2999;
  const write = (next: NonNullable<typeof rows>) => { if (!locked) onChange?.(JSON.stringify(next, null, 2)); };
  const edit = (index: number, field: "date" | "dayType" | "name", next: string) => { if (rows) write(updateOfficialCalendarDate(rows, index, field, next)); };
  const add = () => {
    if (!rows || locked) return;
    write([...rows, { date: "", dayType: "statutory_holiday", name: "" }]);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-official-date-row="${rows.length}"] button[aria-haspopup="dialog"]`)?.focus());
  };
  return <NativeFieldFeedbackContext.Provider value={false}><div ref={root} id={id} className={styles.root} onBlur={event => {
    // One composite field has one validation message; moving between its controls
    // must not validate an unfinished row or repeat the message under every input.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onBlur?.(event);
  }}>
    <div className={styles.toolbar}>
      <Segmented aria-label={t("日期录入方式")} value={mode} disabled={locked} onChange={next => setMode(next as typeof mode)} options={[
        { value: "rows", label: t("逐条录入") }, { value: "json", label: t("批量粘贴") },
      ]} />
      {mode === "rows" && <Button disabled={locked || !rows} icon={<Plus size={14} aria-hidden />} onClick={add}>{t("添加日期")}</Button>}
    </div>
    <ContentTransition value={mode}>
      {mode === "json" ? <div className={styles.raw}>
        <label htmlFor={`${uid}-json`}>{t("官方日期（JSON 数组）")}</label>
        <Input.TextArea id={`${uid}-json`} value={value} disabled={locked} spellCheck={false} rows={12} onChange={event => { if (!locked) { rowKeys.current = []; onChange?.(event.target.value); } }} />
        <p className={styles.hint}>{t("粘贴 date、dayType、name 数组后，可切回逐条录入核对；尚未登记到服务器。")}</p>
      </div> : rows ? <>
        {rows.length ? <ol className={styles.list} aria-label={t("官方日期")}>
          {rows.map((row, index) => {
            const date = typeof row.date === "string" ? dayjs(row.date) : null;
            const extra = Object.fromEntries(Object.entries(row).filter(([key]) => !["date", "dayType", "name"].includes(key)));
            return <li key={rowKeys.current[index]} className={styles.row} data-official-date-row={index}>
              <div className={styles.fields}>
                <div className={styles.field}><label htmlFor={`${uid}-${index}-date`}>{t("日期")}</label>
                  <DatePicker id={`${uid}-${index}-date`} value={date?.isValid() && date.format("YYYY-MM-DD") === row.date ? date : null} disabled={locked || !validYear} allowClear={false} showToday={false}
                    minDate={validYear ? dayjs(`${year}-01-01`) : undefined} maxDate={validYear ? dayjs(`${year}-12-31`) : undefined}
                    onChange={next => edit(index, "date", next?.format("YYYY-MM-DD") ?? "")} />
                </div>
                <div className={styles.field}><label htmlFor={`${uid}-${index}-type`}>{t("日期类型")}</label>
                  <Select id={`${uid}-${index}-type`} status="" value={typeof row.dayType === "string" ? row.dayType : undefined} disabled={locked}
                    options={[{ value: "statutory_holiday", label: t("法定节假日") }, { value: "makeup_workday", label: t("调休工作日") }]}
                    onChange={next => edit(index, "dayType", String(next))} />
                </div>
                <div className={`${styles.field} ${styles.name}`}><label htmlFor={`${uid}-${index}-name`}>{t("节日或调休名称")}</label>
                  <Input id={`${uid}-${index}-name`} value={typeof row.name === "string" ? row.name : ""} disabled={locked} onChange={event => edit(index, "name", event.target.value)} />
                </div>
              </div>
              <Button className={styles.remove} type="text" disabled={locked} icon={<Trash2 size={16} aria-hidden />} aria-label={t("移除第 {row} 条日期", { row: index + 1 })}
                onClick={() => { if (locked) return; rowKeys.current = rowKeys.current.filter((_, position) => position !== index); write(rows.filter((_, position) => position !== index)); }} />
              {!!Object.keys(extra).length && <details className={styles.extras}><summary>{t("查看已有补充字段")}</summary><pre>{JSON.stringify(extra, null, 2)}</pre></details>}
            </li>;
          })}
        </ol> : <div className={styles.empty}><p>{t("尚未填写官方日期")}</p><span>{t("添加日期后，选择日期类型并填写公告中的名称。")}</span></div>}
      </> : <Alert type="error" showIcon title={t("日期格式暂不可读取，请切到批量粘贴修正。原内容已保留。")}/>}</ContentTransition>
  </div></NativeFieldFeedbackContext.Provider>;
}
