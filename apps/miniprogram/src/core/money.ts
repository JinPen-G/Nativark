/**
 * 金额展示。金额与币种永远一起出现（需求 §4.3）；不同币种不能相加，所以这里不提供求和函数。
 * 服务端给的是数值金额（不是分），按币种小数位格式化。
 */
const SYMBOLS: Record<string, string> = {
  CNY: "¥",
  HKD: "HK$",
  MOP: "MOP$",
  TWD: "NT$",
  SGD: "S$",
  USD: "US$",
  EUR: "€"
};

// 零小数位币种（ISO 4217 无小数），接入日/韩/越等币种时按整数显示，避免出现 ¥100.00 式错误。
const ZERO_DECIMAL = new Set<string>(["JPY", "KRW", "VND", "CLP", "ISK", "XOF", "XAF", "PYG", "RWF", "UGX", "KMF"]);

function groupThousands(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatAmount(amount: number, currency?: string): string {
  const decimals = currency && ZERO_DECIMAL.has(currency) ? 0 : 2;
  const fixed = Math.abs(amount).toFixed(decimals);
  const [integer, fraction] = fixed.split(".");
  return fraction ? `${groupThousands(integer)}.${fraction}` : groupThousands(integer);
}

export interface MoneyOptions {
  /** 正数也显示 “+”，用于差额展示。 */
  signed?: boolean;
  /** 金额缺失时的占位文案。 */
  missing?: string;
}

/**
 * formatMoney(120.5, "CNY") → "¥120.50"；formatMoney(-30, "CNY", { signed: true }) → "-¥30.00"；
 * 币种缺失时明确标注，不默认成人民币。
 */
export function formatMoney(amount: number | undefined | null, currency?: string, options: MoneyOptions = {}): string {
  if (amount === undefined || amount === null || !Number.isFinite(amount)) return options.missing ?? "金额待提供";
  const symbol = currency ? SYMBOLS[currency] ?? `${currency} ` : "";
  const body = `${symbol}${formatAmount(amount, currency)}`;
  const sign = amount < 0 ? "-" : options.signed && amount > 0 ? "+" : "";
  return currency ? `${sign}${body}` : `${sign}${body}（币种待确认）`;
}

/** 供列表卡片使用：币种符号与数字分开排版。 */
export function moneyParts(amount: number | undefined | null, currency?: string): { symbol: string; number: string; negative: boolean } {
  if (amount === undefined || amount === null || !Number.isFinite(amount)) return { symbol: "", number: "待提供", negative: false };
  return {
    symbol: currency ? SYMBOLS[currency] ?? currency : "",
    number: formatAmount(amount, currency),
    negative: amount < 0
  };
}

/** 差额语义：正数补款、零无差额、负数待退。 */
export function describeDelta(amount: number | undefined | null, currency?: string): string {
  if (amount === undefined || amount === null || !Number.isFinite(amount)) return "金额待提供";
  if (amount > 0) return `需补款 ${formatMoney(amount, currency)}`;
  if (amount < 0) return `预计待退 ${formatMoney(Math.abs(amount), currency)}`;
  return "无差额";
}

/** 参考起价的展示拆分：符号、数字、单位后缀（“/天”）。缺价时给出“选租期查看报价”。 */
export function startingPriceParts(price: { amount: number; unit: string; currency: string } | undefined, unitLabel: (unit: string) => string): { symbol: string; number: string; unit: string; available: boolean } {
  if (!price || !Number.isFinite(price.amount)) return { symbol: "", number: "", unit: "", available: false };
  const parts = moneyParts(price.amount, price.currency);
  const trimmed = parts.number.endsWith(".00") ? parts.number.slice(0, -3) : parts.number;
  return { symbol: parts.symbol, number: trimmed, unit: `/${unitLabel(price.unit)}`, available: true };
}
