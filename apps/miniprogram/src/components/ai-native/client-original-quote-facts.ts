/** Original Core quote display only. Local strings never fill missing quote
 * facts, calculate totals or authorize booking, payment or stock reservation. */
import type { AiClientQuoteFacts } from '@rental-os/shared';
import { formatMoney } from '../../core/money';
import { boundedText, displayTime } from './display-format';
import { RENTAL_PRICING_UNIT_LABELS } from '../../vendor/shared-ai-client';
import { zonedParts, zoneSupported } from '../../core/time';

export function projectClientOriginalQuoteFacts(quote: AiClientQuoteFacts | null, observedAt?: string | null, english = false) {
  if (!quote) return null;
  const text = (chinese: string, englishText: string) => english ? englishText : chinese;
  const missing = text('未记录', 'Not recorded');
  const label = (value: unknown) => typeof value === 'string' && value.trim() ? boundedText(value, 255) : missing;
  const currency = typeof quote.currency === 'string' && /^[A-Z]{3}$/u.test(quote.currency) ? quote.currency : null;
  const money = (value: unknown) => typeof value !== 'number' || !Number.isFinite(value) ? missing
    : currency ? `${formatMoney(value, currency)} ${currency}` : text('币种未记录', 'Currency not recorded');
  const measurement = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? String(value) : missing;
  const time = (value: unknown) => {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return missing;
    const original = displayTime(value);
    if (quote.timeZone && zoneSupported(quote.timeZone)) {
      const parts = zonedParts(new Date(value), quote.timeZone), pad = (part: number) => String(part).padStart(2, '0');
      return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)} (${quote.timeZone}) · ${value}`;
    }
    return `${original} · ${text('原带偏移时间；报价时区未记录或不可用', 'Original time with offset; quote time zone not recorded or unavailable')}`;
  };
  const units: Record<string, string> = english ? { hour: 'Hour', shift: 'Shift', day_24h: '24 hours', calendar_day: 'Calendar day',
    night: 'Night', week: 'Week', month: '30-day month', usage: 'Usage', package: 'Package' } : RENTAL_PRICING_UNIT_LABELS;
  return {
    title: text('原报价', 'Original quote'), quoteId: label(quote.quoteId), currency: currency ?? missing,
    timeZone: label(quote.timeZone),
    amounts: [
      { key: 'payable', label: text('应付', 'Payable'), value: money(quote.payableAmount) },
      { key: 'deposit', label: text('押金', 'Deposit'), value: money(quote.depositAmount) },
      { key: 'preauth', label: text('预授权', 'Preauthorization'), value: money(quote.preAuthAmount) },
    ],
    references: [
      { key: 'pricing', label: text('原价格方案版本', 'Original pricing-plan version'), value: label(quote.pricingPlanVersion) },
      { key: 'price', label: text('原价格版本', 'Original price version'), value: label(quote.priceVersionId) },
      { key: 'rule', label: text('原规则版本', 'Original rule version'), value: label(quote.ruleVersion) },
      { key: 'calendar', label: text('原计价日历版本', 'Original pricing-calendar version'), value: label(quote.calendarVersion) },
      { key: 'category', label: text('原品类版本', 'Original category version'), value: label(quote.categoryVersionId) },
    ],
    times: [
      { key: 'observed', label: text('本次查询时间', 'Observed at'), value: time(observedAt) },
      { key: 'created', label: text('报价创建时间', 'Quote created at'), value: time(quote.createdAt) },
      { key: 'expires', label: text('报价有效至', 'Quote expires at'), value: time(quote.expiresAt) },
    ],
    pricingTitle: text('原报价计费单位', 'Original quote pricing units'), pricingMissing: text('计费单位未记录', 'Pricing units not recorded'),
    pricingLines: quote.lineUnits?.map(line => ({ key: String(line.lineIndex), itemGroupId: label(line.itemGroupId),
      quantity: measurement(line.quantity), unit: line.pricingUnit ? units[line.pricingUnit] ?? missing : missing,
      usageQuantity: measurement(line.usageQuantity) })) ?? [],
    chargesTitle: text('原费用分项及优惠来源', 'Original charges and discount sources'),
    chargesMissing: text('费用分项未记录', 'Charge lines not recorded'),
    charges: quote.chargeLines?.map((line, index) => ({ key: String(index), label: label(line.name), type: label(line.type), amount: money(line.amount),
      sourceId: label(line.sourceId), sourceVersion: label(line.sourceVersion) })) ?? [],
    note: text('原报价不代表建单、付款或资源预占；预约提交请核对原收据。',
      'The original quote does not attest order creation, payment or resource reservation. Check submission through its original receipt.'),
  };
}
