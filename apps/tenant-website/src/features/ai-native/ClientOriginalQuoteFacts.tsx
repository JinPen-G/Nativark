/** Display the original Core quote already read by the current session. This
 * view never recomputes charges, fills historical defaults or grants booking. */
import { formatRentalMoney, type AiClientQuoteFacts } from '@rental-os/shared';
import { handoffLocalInput, originalBookingUnitLabel } from './booking-handoff';

const wrap = { overflowWrap: 'anywhere' as const, minWidth: 0 };
export function ClientOriginalQuoteFacts({ quote, observedAt, english }: {
  quote: AiClientQuoteFacts | null; observedAt?: string | null; english: boolean;
}) {
  if (!quote) return null;
  const text = (chinese: string, englishText: string) => english ? englishText : chinese;
  const missing = text('未记录', 'Not recorded');
  const label = (value: unknown) => typeof value === 'string' && value.trim()
    ? Array.from(value).slice(0, 255).join('').replace(/[\u202A-\u202E\u2066-\u2069]/g, '') : missing;
  const currency = typeof quote.currency === 'string' && /^[A-Z]{3}$/u.test(quote.currency) ? quote.currency : null;
  const money = (value: unknown) => typeof value !== 'number' || !Number.isFinite(value) ? missing
    : currency ? `${formatRentalMoney(value, currency)} ${currency}` : text('币种未记录', 'Currency not recorded');
  const measurement = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? String(value) : missing;
  const time = (value: string | null | undefined) => {
    if (!value || !Number.isFinite(Date.parse(value))) return missing;
    if (quote.timeZone) {
      try { return `${handoffLocalInput(value, quote.timeZone).replace('T', ' ')} (${quote.timeZone})`; } catch { /* Preserve the original instant. */ }
    }
    return `${value} · ${text('原带偏移时间；报价时区未记录或不可用', 'Original time with offset; quote time zone not recorded or unavailable')}`;
  };
  const references = [
    { key: 'pricing', label: text('原价格方案版本', 'Original pricing-plan version'), value: quote.pricingPlanVersion },
    { key: 'price', label: text('原价格版本', 'Original price version'), value: quote.priceVersionId },
    { key: 'rule', label: text('原规则版本', 'Original rule version'), value: quote.ruleVersion },
    { key: 'calendar', label: text('原计价日历版本', 'Original pricing-calendar version'), value: quote.calendarVersion },
    { key: 'category', label: text('原品类版本', 'Original category version'), value: quote.categoryVersionId },
  ];
  const times = [
    { key: 'observed', label: text('本次查询时间', 'Observed at'), value: observedAt },
    { key: 'created', label: text('报价创建时间', 'Quote created at'), value: quote.createdAt },
    { key: 'expires', label: text('报价有效至', 'Quote expires at'), value: quote.expiresAt },
  ];
  return <section style={wrap} aria-label={text('原报价事实与来源', 'Original quote facts and sources')}>
    <h4>{text('原报价', 'Original quote')}</h4>
    <dl>
      <dt>{text('报价编号', 'Quote reference')}</dt><dd>{label(quote.quoteId)}</dd>
      <dt>{text('币种', 'Currency')}</dt><dd>{currency ?? missing}</dd>
      <dt>{text('原报价时区', 'Original quote time zone')}</dt><dd>{label(quote.timeZone)}</dd>
      <dt>{text('应付', 'Payable')}</dt><dd>{money(quote.payableAmount)}</dd>
      <dt>{text('押金', 'Deposit')}</dt><dd>{money(quote.depositAmount)}</dd>
      <dt>{text('预授权', 'Preauthorization')}</dt><dd>{money(quote.preAuthAmount)}</dd>
      {references.map(row => <div key={row.key}><dt>{row.label}</dt><dd>{label(row.value)}</dd></div>)}
      {times.map(row => <div key={row.key}><dt>{row.label}</dt><dd>{row.value && Number.isFinite(Date.parse(row.value))
        ? <><time dateTime={row.value}>{time(row.value)}</time>{quote.timeZone && <small style={{ display: 'block' }}>{row.value}</small>}</> : missing}</dd></div>)}
    </dl>
    <h4>{text('原报价计费单位', 'Original quote pricing units')}</h4>
    {quote.lineUnits?.length ? <ol>{quote.lineUnits.map(line => <li key={line.lineIndex} style={wrap}>
      <dl><dt>{text('商品引用', 'Item reference')}</dt><dd>{label(line.itemGroupId)}</dd>
        <dt>{text('数量', 'Quantity')}</dt><dd>{measurement(line.quantity)}</dd>
        <dt>{text('计费单位', 'Pricing unit')}</dt><dd>{line.pricingUnit ? originalBookingUnitLabel(line.pricingUnit, english) : missing}</dd>
        <dt>{text('使用量', 'Usage quantity')}</dt><dd>{measurement(line.usageQuantity)}</dd></dl>
    </li>)}</ol> : <p>{text('计费单位未记录', 'Pricing units not recorded')}</p>}
    <h4>{text('原费用分项及优惠来源', 'Original charges and discount sources')}</h4>
    {quote.chargeLines?.length ? <ol>{quote.chargeLines.map((line, index) => <li key={index} style={wrap}>
      <p>{label(line.name)} · {money(line.amount)}</p>
      <p>{text('分项类型', 'Charge type')}：{label(line.type)}</p>
      <dl><dt>{text('来源引用', 'Source reference')}</dt><dd>{label(line.sourceId)}</dd>
        <dt>{text('来源版本', 'Source version')}</dt><dd>{label(line.sourceVersion)}</dd></dl>
    </li>)}</ol> : <p>{text('费用分项未记录', 'Charge lines not recorded')}</p>}
    <p>{text('原报价不代表建单、付款或资源预占；预约提交请核对原收据。',
      'The original quote does not attest order creation, payment or resource reservation. Check submission through its original receipt.')}</p>
  </section>;
}
