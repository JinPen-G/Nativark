// 官网时间处理小工具：datetime-local 输入值与 ISO 互转，供首页搜索、商品详情、下单与报价共用。

const pad = (value: number) => String(value).padStart(2, '0');

/** Date → datetime-local 输入值 'YYYY-MM-DDTHH:mm'（本地时区）。 */
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 从今天起 +days 天的某个整点，作为取还时间默认值（datetime-local 字符串）。 */
export function offsetDaysInput(days: number, hour = 10): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return toLocalInput(date);
}

/** 当前时刻（datetime-local 字符串），用作输入的 min。 */
export function nowInput(): string {
  return toLocalInput(new Date());
}

/** datetime-local 或纯日期字符串 → ISO 字符串；无时间部分则补 fallbackHour:00。解析失败回退当前时刻。 */
export function toIsoDateTime(value: string, fallbackHour = 10): string {
  const normalized = value.includes('T') ? value : `${value}T${pad(fallbackHour)}:00`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
