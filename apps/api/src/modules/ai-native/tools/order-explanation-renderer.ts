import { z } from 'zod';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION, AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS, AI_SCOPE_DRAFT_SCHEMAS,
  type AiOrderExplanationMaterialV2, type AiOrderSourceReopenRequestV2, type AiOrderSourceReadV2 } from '@rental-os/shared';
import { ModelGatewayError } from '../model-gateway.ports';
import { sealBusinessScenario } from './business-scenario-input';
import { aiOrderFundingFactsSchema } from './order-funding-facts.service';
import { aiOrderCalendarFactsSchema } from '../order-read-facts.service';
import { aiOrderFrozenInspectionBasisSchema } from './order-inspection-facts.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

/** Deterministic display of authorized evidence, never a price/ledger calculator.
 * Model prose and customer descriptions cannot supply claims or success states.
 * Existing wire trust labels remain conservative; no new public contract. */
const scalar = z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]);
export interface OrderExplanationClaim { field: string; sourceId: string; value: z.infer<typeof scalar> }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const rows = (value: unknown) => Array.isArray(value) ? value.map(record) : [];
const shown = (value: unknown) => JSON.stringify(value);
function assertFrozenInspectionParent(value: z.infer<typeof aiOrderFrozenInspectionBasisSchema>, parent: Record<string, unknown>) {
  if (value.status !== 'available') return;
  const scope = record(parent.scope), basis = value.value;
  if (basis.orderId !== parent.orderId || basis.tenantId !== scope.tenantId || basis.workspaceId !== scope.workspaceId
    || basis.sourceOrderUpdatedAt !== (parent.sourceOrderUpdatedAt ?? parent.orderVersion)) throw new ModelGatewayError('INVALID_RESPONSE');
}
const moneyLabels: Record<string, string> = { rental: '订单租金', service: '订单服务费', discount: '订单优惠', coupon: '订单券减免',
  deposit: '应收押金（不是已收押金）', preAuthorization: '要求的预授权额度（不是现金实收）', finalPayable: '订单最终应收（不是实收总额）' };
const orderStates: Record<string, string> = { draft: '草稿', reserved: '已预约', pickup_overdue: '取货逾期', ready_for_pickup: '待取货',
  renting: '租赁中', return_inspection: '归还检查中', settling: '待结算', completed: '订单已完成', cancelled: '订单已取消', no_show: '未到店' };
const paymentStates: Record<string, string> = { pending: '待处理，不代表已支付', paid: '本支付单记录已支付，不代表全单实收总额',
  failed: '支付失败', funding_failed: '内部资金入账失败', closed: '支付单关闭' };
const refundStates: Record<string, string> = { pending: '退款申请待处理', accepted: '退款已受理，尚未证明退款成功',
  funding_pending: '第三方退款成功，内部资金待入账', succeeded: '退款记录成功', failed: '退款失败', closed: '退款单关闭' };
// Aggregates arrive after optional event rows, but remain mandatory display
// evidence. A byte cap cannot turn verified cash/deposit totals into missing
// claims or hide the explicit unavailable preauthorization/legacy basis.
const requiredFundingFields = new Set(['funding.currency', 'funding.rentalCash.collected', 'funding.rentalCash.refunded',
  'funding.rentalCash.netReceived', 'funding.deposit.collected', 'funding.deposit.captured', 'funding.deposit.refunded',
  'funding.deposit.balance', 'funding.legacySecurity.unverified', 'funding.legacySecurity.unverifiedAmount',
  'funding.preauthorization.coverage']);
// Missing or reference-only historical basis is itself necessary evidence.
// Removing its coverage claim must not leave a version looking like full pricing.
const requiredHistoryFields = new Set(['history.savedQuote.status', 'history.savedQuote.ratesStatus',
  'history.rule.status', 'history.price.status', 'history.calendar.status']);
// Displayed result and inspection decision states must survive optional detail
// reduction. Otherwise change/dispute prose can outlive its original citation.
// A recorded state still grants no liability, payment or execution authority.
const recordedResultStateField = /^(?:(?:payments|refunds|allocations|changes|extensions)\..+\.status|inspections\..+\.(?:reviewStatus|customerResponseStatus))$/u;
// A displayed money record must retain its instrument, direction and accounting
// classification. If these cannot fit, omit that whole optional record instead.
const financialRecordMeaningField = /^(?:payments\..+\.instrument|refunds\..+\.paymentIntentId|funding\..+\.(?:instrument|action|amount|accounting)|offline\..+\.(?:status|amount))$/u;
const allocationStates: Record<string, string> = {
  pre_assigned: '原分配记录为预分配，不证明已锁定、已领取或在途。',
  locked: '原分配记录为锁定，不证明已领取、在途或订单已完成。',
  allocated: '原分配记录已分配，不证明已领取、全单交付或在途。',
  picked_up: '原分配记录已领取，不证明已归还、全单交付或结算完成。',
  returned: '原分配记录已归还，不证明全单归还、检查齐全、结算完成或库存可租。',
  released: '原分配记录已释放，不证明资源已可租或资金/退款成功。',
  consumed: '原分配记录已消耗，不作为待归还记录；不据此推断全单归还、结算或库存可租。'
};
const extensionStates: Record<string, string> = {
  pending_payment: '续租申请待付款，不证明申请的新结束时间已生效。',
  effective: '原续租记录标为已生效，不表示已归还、已结算或库存可租。',
  cancelled: '续租记录已取消，不表示原订单取消或退款成功。',
  expired: '续租记录已过期，不证明未消耗或可以重发。'
};

export function buildOrderExplanation(material: unknown, maxOutputBytes?: number) {
  if (maxOutputBytes !== undefined && (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 131072))
    throw new ModelGatewayError('CONFIG_INVALID');
  const payload = record(record(material).payload), facts = record(payload.facts), orderFact = record(facts.order);
  const order = record(orderFact.value), orderId = z.string().min(1).max(191).parse(order.id ?? payload.orderId);
  const claims: OrderExplanationClaim[] = [], claimLineIndexes: number[] = [],
    lines = ['订单解释：以下是受权来源的事实摘要，不是资金操作或动作批准。'];
  const add = (field: string, sourceId: string, value: unknown, label: string) => {
    const parsed = scalar.safeParse(value);
    if (!parsed.success) { lines.push(`${label}：缺少证据，不能推断。`); return; }
    claims.push({ field, sourceId, value: parsed.data });
    claimLineIndexes.push(lines.length);
    lines.push(`${label}：${shown(parsed.data)}${parsed.data === null ? '（缺少证据，不等于零）' : ''}。`);
  };
  const financialRows: Array<{ fields: Set<string>; extraLineIndexes: number[]; optionalWholeRow: boolean }> = [];
  const beginFinancialRow = (optionalWholeRow = true) => ({ claimStart: claims.length, lineStart: lines.length, optionalWholeRow });
  const endFinancialRow = (start: ReturnType<typeof beginFinancialRow>) => {
    const claimLines = new Set(claimLineIndexes.slice(start.claimStart));
    financialRows.push({ fields: new Set(claims.slice(start.claimStart).map(row => row.field)), optionalWholeRow: start.optionalWholeRow,
      extraLineIndexes: Array.from({ length: lines.length - start.lineStart }, (_, i) => start.lineStart + i)
        .filter(index => !claimLines.has(index)) });
  };
  add('order.status', orderId, order.status, '原订单业务状态（不代替支付凭证）');
  if (orderStates[String(order.status)]) lines.push(`状态名称：${orderStates[String(order.status)]}；不证明资金或退款完成。`);
  add('order.updatedAt', orderId, order.updatedAt, '订单来源版本');
  lines.push(`查询时点：${shown(payload.observedAt ?? record(orderFact.source).observedAt ?? null)}。来源：订单 ${shown(orderId)}。`);
  const amounts = record(facts.amounts);
  if ('value' in amounts) {
    for (const [field, label] of Object.entries(moneyLabels)) add(`amounts.${field}`, orderId, record(amounts.value)[field], label);
    add('amounts.currency', orderId, amounts.currency, '原订单币种');
    lines.push('应收、押金和预授权分开；不相加，不重算费用，不把缺金额补成零。');
  }
  const fulfillment = record(record(facts.fulfillment).value);
  for (const [field, label] of [['startAt', '原租期起点'], ['originalEndAt', '原约定结束'],
    ['effectiveEndAt', '订单投影结束时点（未推断承运实际计租时点）'], ['effectiveEndBasis', '结束时点的原来源字段']] as const) {
    if (field in fulfillment) add(`fulfillment.${field}`, orderId, fulfillment[field], label);
  }
  if ('effectiveEndBasis' in fulfillment) {
    if (fulfillment.effectiveEndBasis === 'endAt_fallback') lines.push('原读取未提供 effectiveEndAt；结束显示回退到原 endAt，不证明没有续租。');
    else if (fulfillment.effectiveEndBasis === 'effectiveEndAt') lines.push('原读取提供 effectiveEndAt；只展示这个原字段，不用申请的新结束时点替代。');
    lines.push('结束字段来源不是续租原因、承运计租时点或动作批准；不从续租列表、当前规则或价格重新计算订单结束与费用。');
  }
  // The source budget may reduce only later display detail, never the original
  // order/version, amounts/currency or supplied period evidence above.
  const requiredClaimCount = claims.length;
  const paymentFact = record(facts.payments), payments = record(paymentFact.value);
  if ('value' in paymentFact) {
    lines.push(`支付来源：原支付运行时本地记录；查询时点 ${shown(payments.observedAt ?? null)}，未刷新第三方。`);
    for (const row of rows(payments.intents)) {
      const start = beginFinancialRow(false);
      const id = z.string().min(1).max(191).parse(row.intentId);
      add(`payments.${id}.status`, id, row.status, `支付单 ${shown(id)} 状态`);
      add(`payments.${id}.amount`, id, row.amount, '该支付单金额');
      add(`payments.${id}.currency`, id, row.currency, '该支付单币种');
      add(`payments.${id}.instrument`, id, row.instrument, '该支付单资金类别（租金/押金/预授权不可互换）');
      lines.push(`支付单 ${shown(id)}：${paymentStates[String(row.status)] ?? '未支持的支付状态，须由原财务入口核对。'}`);
      endFinancialRow(start);
    }
    const refunds = rows(payments.refunds);
    if (refunds.length > 20) lines.push('退款明细仅展示前20项；完整有界记录保留在原受权支付来源中，此摘要不是全部退款历史。');
    for (const row of refunds.slice(0, 20)) {
      const start = beginFinancialRow(false);
      const id = z.string().min(1).max(191).parse(row.refundId);
      add(`refunds.${id}.status`, id, row.status, `退款单 ${shown(id)} 状态`);
      add(`refunds.${id}.amount`, id, row.amount, '该退款单金额');
      add(`refunds.${id}.currency`, id, row.currency, '该退款单币种');
      add(`refunds.${id}.paymentIntentId`, id, row.paymentIntentId, '该退款单原支付关联');
      for (const [field, label] of [['acceptedAt', '原受理时点（不证明退回）'], ['succeededAt', '本地记录的第三方成功时点（不证明内部入账）'],
        ['fundedAt', '原内部退款入账时点']] as const)
        add(`refunds.${id}.${field}`, id, row[field] ?? null, label);
      lines.push(`退款单 ${shown(id)}：${refundStates[String(row.status)] ?? '未支持的退款状态，须核对原退款单。'}`);
      endFinancialRow(start);
    }
    if (!rows(payments.intents).length) lines.push('本次有界支付查询未返回记录；不证明订单未付款。');
    if (!rows(payments.refunds).length) lines.push('本次有界退款查询未返回记录；不证明没有退款申请或已完成退款。');
    if (payments.truncated) lines.push('支付或退款记录有截断；该页不能表示完整资金历史。');
  } else if (payload.question === 'payments') lines.push('支付来源不可用或未加载；不披露不可见记录的存在、数量或原因，不推断已付/未付。');
  if (payload.question === 'payments') {
    lines.push('value' in record(facts.fundingLedger)
      ? '全资金实收总额未聚合；原资金域分别展示租赁现金与押金，不跨账相加，不由支付单或订单状态推断。'
      : '实收总额：未加载原资金总账；不能由应收、支付单金额或订单状态推断。');
    const ledger = record(facts.fundingLedger);
    if ('value' in ledger) {
      const funding = aiOrderFundingFactsSchema.parse(ledger.value);
      lines.push(`资金来源：原资金域持久事件；查询时点 ${shown(funding.observedAt)}。有界完整记录快照，不是第三方刷新或银行余额。`);
      add('funding.currency', orderId, funding.currency, '原关联订单资金币种');
      // The complete bounded source stays in facts; only display detail is
      // capped. This preserves original totals and the existing claim budget.
      const displayLimit = 20;
      if (funding.events.length > displayLimit || funding.offlineRegistrations.length > displayLimit)
        lines.push('资金明细显示有上限：事件与登记各展示前20项；聚合仍由原域完整有界读源计算，此摘要不是全部明细。');
      for (const row of funding.events.slice(0, displayLimit)) {
        const start = beginFinancialRow();
        add(`funding.${row.id}.instrument`, row.id, row.instrument, '原资金类别');
        add(`funding.${row.id}.action`, row.id, row.action, `资金事件 ${shown(row.id)} 原动作`);
        add(`funding.${row.id}.amount`, row.id, row.amount, '该事件原金额（失败不改变余额）');
        add(`funding.${row.id}.accounting`, row.id, row.accounting, '实际入账与模拟/未核验分开');
        add(`funding.${row.id}.at`, row.id, row.at, '原事件发生时点');
        endFinancialRow(start);
      }
      for (const row of funding.offlineRegistrations.slice(0, displayLimit)) {
        const start = beginFinancialRow();
        add(`offline.${row.id}.status`, row.id, row.status, '原线下登记状态（pending 不代表已入账）');
        add(`offline.${row.id}.amount`, row.id, row.amount, '该登记原金额');
        add(`offline.${row.id}.confirmedAt`, row.id, row.confirmedAt, '原确认时点');
        endFinancialRow(start);
      }
      if (funding.rentalCash.coverage === 'available') {
        add('funding.rentalCash.collected', orderId, funding.rentalCash.collected, '租赁及费用已确认收款（不是含押金的全资金总额）');
        add('funding.rentalCash.refunded', orderId, funding.rentalCash.refunded, '租赁款已记录实际退回');
        add('funding.rentalCash.netReceived', orderId, funding.rentalCash.netReceived, '租赁款净实收（押金抵扣、企业核销不重复算现金）');
      } else lines.push('租赁实收来源未能完整核实；旧确认缺失不等于未付款，不补零。');
      if (funding.deposit.coverage === 'available') {
        for (const [field, label] of [['collected', '押金已确认收取'], ['captured', '押金已确认抵扣'], ['refunded', '押金已确认退回'], ['balance', '原事件推导的已收押金尚持有余额']] as const)
          add(`funding.deposit.${field}`, orderId, funding.deposit[field], label);
      } else lines.push('押金持有余额无法完整核实；存量保证金归属或原确认缺失，不把未知余额补成零。');
      add('funding.legacySecurity.unverified', orderId, funding.legacySecurity.unverified, '存量保证金归属待核验标记');
      add('funding.legacySecurity.unverifiedAmount', orderId, funding.legacySecurity.unverifiedAmount, '存量未分类保证金原值（不并入押金或预授权）');
      add('funding.preauthorization.coverage', orderId, funding.preauthorization.coverage, '实际预授权证据覆盖');
      lines.push('真实预授权冻结/释放/转扣：原供应商核验端口不可用；内部/模拟事件不是实际冻结证据。');
      lines.push('企业回款核销不是另一笔现金实收；未计算全单结算余额，不据此允许结算或资金处置。');
      if (!funding.events.length) lines.push('该快照没有资金事件；不证明订单未付款或保证金已经全部退还。');
    } else lines.push('已收押金余额、实际预授权冻结/释放及完整退款资金入账：原资金来源不可用或未加载，不推断成功。');
  }
  const historyFact = record(facts.history), history = record(historyFact.value);
  if (payload.question === 'fees') {
    const quote = record(history.savedQuote), rule = record(history.rule), price = record(history.price);
    for (const [field, value, label] of [['history.savedQuote.status', quote.status, '原关联报价证据状态'],
      ['history.rule.status', rule.status, '原订单规则证据状态'], ['history.price.status', price.status, '原价格依据覆盖']] as const) {
      add(field, orderId, value, label);
    }
    if (quote.status === 'available') {
      add('history.savedQuote.quoteId', orderId, quote.quoteId, '原关联报价 ID');
      for (const [field, label] of [['createdAt', '原报价生成时点'], ['currency', '原报价币种'], ['ruleVersion', '原报价规则版本'],
        ['pricingPlanVersion', '原报价价格计划版本'], ['priceVersionId', '原价格版本对象'], ['priceVersion', '原价格版本'],
        ['calendarVersion', '原年度日历版本引用'], ['timeZone', '原报价营业时区'], ['ratesStatus', '原基础费率证据状态']] as const)
        add(`history.savedQuote.${field}`, orderId, quote[field] ?? null, label);
      const rates = rows(quote.rates);
      if (rates.length > 20) lines.push('原费率明细仅展示前20项；完整有界快照保留在受权来源中。');
      for (const rate of rates.slice(0, 20)) for (const [field, label] of [['itemGroupId', '原费率商品组'], ['unit', '原计费单位'],
        ['baseAmount', '原基础单位价（不是完整行租金）']] as const)
        add(`history.rates.${rate.id}.${field}`, String(rate.id), rate[field], label);
    }
    if (rule.status === 'available') {
      add('history.rule.version', orderId, rule.version, '原订单规则版本');
      add('history.rule.pickupInspectionRequired', orderId, rule.pickupInspectionRequired, '原领取检查要求');
      add('history.rule.returnInspectionRequired', orderId, rule.returnInspectionRequired, '原归还检查要求');
    }
    if (price.pricingPlanVersion) add('history.price.pricingPlanVersion', orderId, price.pricingPlanVersion, '原价格方案版本引用');
    const templates = rows(record(history.inspection).templates);
    if (templates.length > 20) lines.push('原检查模板明细仅展示前20项；完整有界模板引用保留在受权来源中。');
    for (const template of templates.slice(0, 20)) for (const [field, label] of [['code', '原检查模板代码'], ['stage', '原检查阶段'], ['version', '原检查模板版本']] as const)
      add(`history.templates.${template.id}.${field}`, String(template.id), template[field], label);
    const calendar = aiOrderCalendarFactsSchema.parse(history.calendar ?? { status: 'missing' });
    add('history.calendar.status', orderId, calendar.status, '原订单实际应用的逐日计价快照状态');
    if (calendar.status === 'available') {
      add('history.calendar.rowCount', orderId, calendar.rows.length, '原有界日历事实行数（不是计费总额）');
      if (calendar.rows.length > 20) lines.push('原日历明细仅展示前20项；完整有界快照保留在受权来源中，不将显示上限当缺失。');
      for (const [index, day] of calendar.rows.slice(0, 20).entries()) {
        for (const [field, label] of [['date', '原营业日期'], ['year', '原年度'], ['itemGroupId', '原日历事实商品组'],
          ['dayType', '原日期类型'], ['businessStatus', '原营业状态'], ['source', '原日期依据来源'], ['calendarVersion', '该日期原日历版本'],
          ['unitCount', '原计费单位数'], ['unitAmount', '原实际单位价'], ['multiplier', '原实际系数'],
          ['amount', '原已保存单位计价结果（未乘商品数量、未封顶，不是行租金）'],
          ['priceAt', '原取价时点'], ['hitLayer', '原取价命中层'], ['pricingPlanVersion', '该计价单位原价格计划版本']] as const)
          add(`history.calendar.${index}.${field}`, orderId, day[field] ?? null, label);
      }
      lines.push('逐日结果直接来自原订单，不用基础费率或年度倍率重新计算；完整年度日历、阶梯及行分摊仍不由此推断。');
    } else lines.push('原订单逐日计价内容缺失或不可用；不从版本串、当前日历或当前价格重建。');
    lines.push('仅引用原订单或原关联报价快照；版本引用不等于完整计价证据，缺历史不使用当前配置补造费用原因。');
  }
  const inspectionFact = record(facts.inspections), inspection = record(inspectionFact.value);
  const frozenInspection = aiOrderFrozenInspectionBasisSchema.parse(inspection.frozenBasis ?? { status: 'unavailable' });
  assertFrozenInspectionParent(frozenInspection, payload);
  if (frozenInspection.status === 'available') {
    const basis = frozenInspection.value;
    add('inspectionBasis.contractVersion', orderId, basis.contractVersion, '原Core冻结检查依据版本');
    add('inspectionBasis.recordResourceCoverage', orderId, basis.recordResourceCoverage, '逐检查记录资源覆盖（未投影，不借异常或旧基线推断）');
    add('inspectionBasis.applicableCount', orderId, basis.applicableTemplateRefs.length, '原Core有界适用模板引用数（不等于已检查数量）');
    if (basis.applicableTemplateRefs.length > 20) lines.push('适用模板摘要仅展示前20项，完整有界关系保留在原检查来源中。');
    for (const [index, template] of basis.applicableTemplateRefs.slice(0, 20).entries()) {
      const label = template.exchangeId ? '原换货冻结检查模板' : '原订单冻结检查模板';
      for (const [field, value, name] of [['projectionId', template.id, '展示投影ID（不是原模板外键）'], ['sourceTemplateId', template.sourceTemplateId, '真实原模板引用'],
        ['code', template.code, label + '代码'], ['stage', template.stage, label + '阶段'], ['version', template.version, label + '版本'],
        ['enabled', template.enabled, '原保存的启用标记'], ['exchangeId', template.exchangeId ?? null, '原换货关联（缺省不造关联）']] as const)
        add(`inspectionBasis.applicable.${index}.${field}`, template.sourceTemplateId, value, name);
      if (template.allocationIds === undefined) lines.push('原Core没有限定该模板的allocationIds；不自行补成全单资源人口或推断已完成检查。');
      else {
        add(`inspectionBasis.applicable.${index}.allocationCount`, template.sourceTemplateId, template.allocationIds.length, '原Core明确限定的资源引用数');
        for (const [allocationIndex, allocationId] of template.allocationIds.slice(0, 20).entries())
          add(`inspectionBasis.applicable.${index}.allocationIds.${allocationIndex}`, template.sourceTemplateId, allocationId, '原Core适用分配引用');
        if (template.allocationIds.length > 20) lines.push('资源引用摘要仅展示前20项，完整限定仍保留在受权来源中。');
      }
    }
    for (const exchange of basis.exchanges.slice(0, 20)) {
      add(`inspectionBasis.exchanges.${exchange.id}.status`, exchange.id, exchange.status, '原换货采用状态（不是检查或资金结果）');
      add(`inspectionBasis.exchanges.${exchange.id}.templatesLoaded`, exchange.id, exchange.templateRefs !== undefined, '该原换货冻结模板引用是否存在');
      if (exchange.templateRefs === undefined) lines.push('该历史换货的冻结模板引用缺失；不套当前或原商品模板补造。');
    }
    lines.push('模板适用关系由原Core决定，只读取原订单及已采用换货的冻结引用；不表示检查已完成、责任成立或允许执行业务动作。');
  } else if (payload.question === 'fees') lines.push('冻结检查模板适用依据不可用或未加载；原订单模板引用不代表所有商品的当前适用关系，需人工核验，不补造已完成检查或收费原因。');
  if ('value' in inspectionFact) {
    const recorded = rows(inspection.records), displayLimit = 20;
    lines.push(`检查来源：原Core已保存记录；查询时点 ${shown(inspection.observedAt ?? null)}。记录存在不证明全单检查完成、全单归还或库存可租。`);
    if (!recorded.length) lines.push('本次有界检查页未返回记录；不证明未检查或没有争议。');
    if (recorded.length > displayLimit) lines.push('检查记录摘要仅展示前20项；完整有界记录保留在原受权检查来源中。');
    // Keep clean records visible, too. Metadata comes from each saved record,
    // not the current template or an inferred pickup/exchange baseline. A shared
    // exception budget prevents a nested page from exhausting the material cap;
    // only display is bounded, never the source or citation reopening.
    let exceptionBudget = displayLimit, exceptionsTruncated = false;
    for (const row of recorded.slice(0, displayLimit)) {
      const id = String(row.id);
      for (const [field, label] of [['stage', '原检查阶段（不是完成状态）'], ['createdAt', '原检查记录保存时点'],
        ['templateId', '该记录原模板关联'], ['templateCode', '该记录原模板代码'], ['templateVersion', '该记录原模板版本'],
        ['exchangeId', '该记录原换货关联（缺省不推断）'], ['baselineInspectionId', '该记录原基线关联（缺省不借当前记录补造）']] as const)
        add(`inspections.${id}.${field}`, id, row[field] ?? null, label);
      const exceptions = rows(row.exceptions), displayed = exceptions.slice(0, exceptionBudget);
      if (displayed.length < exceptions.length) exceptionsTruncated = true;
      exceptionBudget -= displayed.length;
      for (const [index, exception] of displayed.entries()) {
        add(`inspections.${id}.${index}.code`, id, exception.code, '原记录异常代码（不是责任裁定）');
        add(`inspections.${id}.${index}.allocationId`, id, exception.allocationId ?? null, '原异常资源关联（缺省不推定全单资源）');
        add(`inspections.${id}.${index}.reviewStatus`, id, exception.reviewStatus, `检查 ${shown(id)} 异常审核状态`);
        add(`inspections.${id}.${index}.customerResponseStatus`, id, exception.customerResponseStatus ?? null, '客户确认/争议状态（缺失不等于无需确认或已确认）');
        if (exception.customerResponseStatus === 'disputed') lines.push('已记录客户争议；不代表责任成立、争议解决或费用已结算。');
      }
    }
    if (exceptionsTruncated) lines.push('检查异常摘要最多展示20项；完整异常保留在原有界检查来源中，此摘要不是全部争议历史。');
    lines.push('异常审核通过不代表收费已核准、已收款或已结算；审核拒绝也不证明没有损坏。原基线/换货关联仅按记录展示，不判定资源适用关系或检查是否齐全。');
    if (inspection.truncated) lines.push('检查记录只是一页，不能表示完整争议或检查历史。');
  } else if (payload.question === 'fees') lines.push('检查/争议来源不可用或未加载；不能补造责任或损坏收费原因。');
  const lifecycleFact = record(order.lifecycle), lifecycle = record(lifecycleFact.value);
  if ('value' in lifecycleFact) {
    const allocations = rows(lifecycle.allocations), changes = rows(lifecycle.changes), extensions = rows(lifecycle.extensions);
    // Core's full bounded source remains in facts/citation reopening. Expanding
    // every row into claims/text can overflow the unchanged material budget.
    const displayLimit = 20;
    if ([allocations, changes, extensions].some(values => values.length > displayLimit))
      lines.push('履约分配、变更和续租明细每类仅展示前20项；完整有界记录保留在原受权生命周期来源，此摘要不是全量履约或结算证据。');
    if (allocations.some(row => row.status === 'returned') && allocations.some(row => ['picked_up', 'allocated', 'locked', 'pre_assigned'].includes(String(row.status))))
      lines.push('分配事实中部分记录已归还、另有预分配/锁定/已分配或已领取的记录；其中未领取的记录不表示在途，不据此宣称全单归还、结算完成或库存已可租。');
    for (const row of allocations.slice(0, displayLimit)) {
      add(`allocations.${row.id}.status`, String(row.id), row.status, `分配 ${shown(row.id)} 原状态`);
      add(`allocations.${row.id}.quantity`, String(row.id), row.quantity, '该分配原数量（不推全单归还）');
      // Translate this recorded status only. No order/resource transition,
      // transport location, return requirement or allowed action is calculated.
      lines.push(`分配 ${shown(row.id)}：${allocationStates[String(row.status)] ?? '未支持的原分配状态，须由原受权入口核对，不推断履约成功。'}`);
    }
    for (const row of changes.slice(0, displayLimit)) {
      add(`changes.${row.id}.type`, String(row.id), row.type, '原变更类型');
      add(`changes.${row.id}.status`, String(row.id), row.status, '原变更记录状态（不是退款结果）');
    }
    if (payload.question === 'fees' && rows(lifecycle.changes).some(row => row.type === 'post_pickup_exchange' && row.status === 'applied')) {
      // Lifecycle alone cannot promote original-order references into replacement
      // evidence. The Core projection covers linked resources, not all history.
      if (frozenInspection.status === 'unavailable') lines.push('已记录采用换货，但换货商品的冻结检查模板及资源适用关系未读取；原订单模板引用不能证明换货商品的适用依据，需人工核对，不套用原商品或当前模板。');
      else for (const change of rows(lifecycle.changes).filter(row => row.type === 'post_pickup_exchange' && row.status === 'applied')) {
        if (!frozenInspection.value.exchanges.some(row => row.id === change.id))
          lines.push(`已采用变更 ${shown(change.id)} 未包含在当前资源的冻结模板关联投影中；不补造该历史变更的模板或资源适用关系。`);
      }
    }
    for (const row of extensions.slice(0, displayLimit)) {
      add(`extensions.${row.id}.status`, String(row.id), row.status, `续租单 ${shown(row.id)} 原状态`);
      add(`extensions.${row.id}.originalEndAt`, String(row.id), row.originalEndAt, '该续租记录原结束时点（不代替订单当前结束）');
      add(`extensions.${row.id}.newEndAt`, String(row.id), row.newEndAt, '该续租申请结束时点（仅 effective 表示已生效）');
      lines.push(`续租单 ${shown(row.id)}：${extensionStates[String(row.status)] ?? '未支持的续租状态，须由原业务入口核对，不推断已生效。'}`);
    }
    if (record(lifecycle.truncated).changes || record(lifecycle.truncated).extensions) lines.push('变更/续租历史有截断；不补造未投影的差额和计价依据。');
  } else if (payload.question === 'status' || payload.question === 'fees') lines.push('归还分配、变更和续租来源不可用或未加载；订单状态不能替代完整生命周期事实。');
  if (payload.question === 'next_steps') {
    lines.push('下一步建议：只回到原订单人工入口或已注册只读工具；原 Core 当前允许动作未加载，不表示可以续租、退款或处置资金。');
    // Consume only the handoff supplied by this authorized preparation. The
    // older frozen read-answer wire has no such material: do not manufacture a
    // candidate or route from the order ID. Inventory is not allowed-actions.
    if (payload.handoff === undefined) lines.push('本原读答案没有候选及人工导航材料；需重新受权读取下一步材料，不补造工具或路径。');
    else {
      const handoff = record(payload.handoff), manual = record(handoff.resource);
      if (handoff.status !== 'manual_review_only' || handoff.execution !== 'not_attempted'
        || !['unavailable', 'not_queried'].includes(String(handoff.allowedActions))
        || manual.kind !== 'order_resource' || manual.orderId !== orderId || !manual.scope || !payload.scope
        || requestFingerprint(manual.scope) !== requestFingerprint(payload.scope)
        || !Array.isArray(handoff.candidates) || handoff.candidates.length > 4
        || handoff.operatorRouteKey !== undefined && (handoff.operatorRouteKey !== 'APP_ROUTES.orderDetail' || payload.audience !== 'operator'))
        throw new ModelGatewayError('INVALID_RESPONSE');
      add('handoff.allowedActions', orderId, handoff.allowedActions, '原 Core 当前允许动作覆盖（不是动作授权）');
      add('handoff.execution', orderId, handoff.execution, '本材料的业务执行状态');
      if (handoff.operatorRouteKey !== undefined) {
        add('handoff.operatorRouteKey', orderId, handoff.operatorRouteKey, '本端登记的原订单人工入口键（不是可执行URL）');
        lines.push('人工入口由宿主解析登记键；目的页仍须重新校验当前权限，不借本材料的订单引用绕过原授权。');
      } else lines.push('本端没有提供已登记页面键；只保留原订单引用，不补造URL或跨端导航。');
      const candidates = rows(handoff.candidates);
      if (!candidates.length) lines.push('本次材料没有已核定只读候选；不根据订单状态或工具目录补造默认动作。');
      for (const [index, candidate] of candidates.entries()) {
        const source = record(candidate.source);
        // The current source proves exactly this original R0 reader. Display
        // does not broaden its closed mapping to preview, commit or funds tools;
        // retain the saved inventory version, never consult current config.
        if (candidate.code !== 'rental.order.explain' || candidate.risk !== 'R0' || candidate.kind !== 'readonly'
          || candidate.executable !== false || candidate.permission !== 'original_route_must_revalidate'
          || typeof candidate.version !== 'string' || source.kind !== 'tool_inventory'
          || source.code !== candidate.code || source.version !== candidate.version)
          throw new ModelGatewayError('INVALID_RESPONSE');
        for (const [field, label] of [['code', '本次原只读候选代码'], ['version', '该候选原目录版本'],
          ['risk', '该候选影响等级'], ['maturity', 'AI目录成熟度（不代替原业务读口或调度授权）'],
          ['kind', '该候选原类型'], ['executable', '该候选可执行标记（不是批准）'],
          ['permission', '该候选的原路由权限复核要求']] as const)
          add(`handoff.candidates.${index}.${field}`, candidate.code, candidate[field], label);
        add(`handoff.candidates.${index}.source.kind`, candidate.code, source.kind, '候选来源类别（不是Core允许动作收据）');
      }
      lines.push('以上是原受权读取后的目录候选，不是当前订单允许动作；完整前置条目保留在原材料，目录成熟度与版本不授予执行权。');
    }
  }
  lines.push('未执行、未确认、未批准任何业务动作；unknown 只核对原操作，不换键或自动重做。');
  const display = () => ({ text: lines.join('\n'), claims, generation: 'deterministic_authorized_facts' as const,
    modelProse: 'not_used' as const, executionAllowed: false as const });
  if (maxOutputBytes !== undefined) {
    let limited = false, rowsOmitted = false, result = display();
    const exceeds = () => claims.length > 1024 || Buffer.byteLength(JSON.stringify(result), 'utf8') > maxOutputBytes;
    const removeLine = (index: number) => {
      lines.splice(index, 1);
      // Whole-row omission may later remove protected claims after an earlier
      // optional line. Keep those positions too, rather than deleting a neighbour.
      for (let i = 0; i < claimLineIndexes.length; i++) if (claimLineIndexes[i] > index) claimLineIndexes[i]--;
      for (const row of financialRows) row.extraLineIndexes = row.extraLineIndexes
        .filter(value => value !== index).map(value => value > index ? value - 1 : value);
    };
    const removeClaim = (index: number) => {
      const line = claimLineIndexes[index];
      claimLineIndexes.splice(index, 1); claims.splice(index, 1); removeLine(line);
    };
    // Parsing and complete sources remain unchanged. Payment/refund state and
    // local prose stay mandatory; an optional amount/currency shrinks together.
    // Funding events/registrations may instead disappear as whole optional rows,
    // never leave an amount without its direction/accounting interpretation.
    while (exceeds() && claims.length > requiredClaimCount) {
      let removable = claims.length - 1;
      while (removable >= requiredClaimCount && (requiredFundingFields.has(claims[removable].field)
        || requiredHistoryFields.has(claims[removable].field) || recordedResultStateField.test(claims[removable].field)
        || financialRecordMeaningField.test(claims[removable].field))) removable--;
      let optionalRowIndex = financialRows.length - 1;
      while (optionalRowIndex >= 0 && !financialRows[optionalRowIndex].optionalWholeRow) optionalRowIndex--;
      if (removable < requiredClaimCount && optionalRowIndex < 0) break;
      if (!limited) {
        lines.push('显示预算达到上限，部分可选字段未在摘要展开；完整有界事实保留在原材料及受权来源重开中，此摘要不是全部明细。');
        limited = true;
      }
      if (removable >= requiredClaimCount) {
        const field = claims[removable].field;
        if (/^(?:payments|refunds)\..+\.(?:amount|currency)$/u.test(field)) {
          // An omitted amount is not zero; remove its local currency line with
          // it. Original payment/refund status, parent and prose still remain.
          const prefix = field.slice(0, field.lastIndexOf('.') + 1);
          for (let i = claims.length - 1; i >= requiredClaimCount; i--)
            if (claims[i].field === prefix + 'amount' || claims[i].field === prefix + 'currency') removeClaim(i);
        } else removeClaim(removable);
      } else {
        if (!rowsOmitted) {
          lines.push('部分可选金融明细按整条记录省略；未展示不等于不存在，保留记录的金额、状态、资金类别与入账性质不可拆开解释。');
          rowsOmitted = true;
        }
        const row = financialRows[optionalRowIndex];
        for (let i = claims.length - 1; i >= requiredClaimCount; i--) if (row.fields.has(claims[i].field)) removeClaim(i);
        for (const index of [...row.extraLineIndexes].sort((a, b) => b - a)) removeLine(index);
        financialRows.splice(optionalRowIndex, 1);
      }
      result = display();
    }
    if (exceeds()) throw new Error('AI_RESOURCE_UNAVAILABLE');
    return result;
  }
  const result = display();
  if (Buffer.byteLength(result.text, 'utf8') > 131072 || claims.length > 1024) throw new Error('AI_RESOURCE_UNAVAILABLE');
  return result;
}

/** Remaining space in the original packet, not an input/resource allowance.
 * Reserve fixed-size hash/max-length byte metadata locally; actual sealing
 * recomputes both. Only the recognized display is excluded from measurement. */
function remainingOrderExplanationDisplaySpace(value: unknown, version: string): number {
  const { explanation: _display, ...payload } = record(value);
  const frame = { version, scenario: 'order_explanation', payload, payloadFingerprint: '0'.repeat(64), payloadBytes: 131072,
    trust: 'source_text_is_data_not_instructions', authority: 'none_reauthorize_before_consumption' };
  return 131072 - Buffer.byteLength(JSON.stringify(frame), 'utf8') - Buffer.byteLength(',"explanation":', 'utf8');
}

/** Pure packet-size predicate for the existing optional-source fallback. It
 * distinguishes an oversized source combination from duplicated display; no
 * exception message, source fault or permission failure is downgraded here. */
export function orderExplanationSourcesFit(value: unknown, version = 'lane-a-business-content-1'): boolean {
  return remainingOrderExplanationDisplaySpace(value, version) > 0;
}

export function orderExplanationDisplayBudget(value: unknown, version = 'lane-a-business-content-1'): number {
  const remaining = remainingOrderExplanationDisplaySpace(value, version);
  if (remaining < 1) throw new Error('AI_RESOURCE_UNAVAILABLE');
  return remaining;
}

/** The old published history schema has no daily-calendar field. Validate the
 * recognized internal addition before withholding it; do not reseal corrupt facts.
 * New public calendar/source exposure belongs to the shared contract owner. */
export function projectOrderHistoryFacts(value: unknown) {
  const history = structuredClone(record(value));
  if ('calendar' in history) aiOrderCalendarFactsSchema.parse(history.calendar);
  delete history.calendar;
  return history;
}

/** Withhold only the recognized v2 Core-basis field from the old wire. Validate
 * it and its original parent first; never sanitize corrupt provenance to green. */
export function projectOrderInspectionEvidence(value: unknown) {
  const inspection = structuredClone(record(value));
  if ('frozenBasis' in inspection) {
    const frozen = aiOrderFrozenInspectionBasisSchema.parse(inspection.frozenBasis);
    assertFrozenInspectionParent(frozen, inspection);
  }
  delete inspection.frozenBasis;
  return inspection;
}

/** Preserve the frozen public material contract without widening its schema.
 * Lifecycle and deterministic display remain internal; the result's original
 * materialHash still identifies the full frozen model input, not this projection.
 * Public structured lifecycle/source expansion requires shared-owner integration. */
export function projectOrderExplanationMaterial(material: unknown) {
  const packet = record(material), rawPayload = record(packet.payload);
  const bytes = Buffer.byteLength(JSON.stringify(rawPayload), 'utf8');
  // Verify the source seal before deriving another one. Projection must not
  // turn a corrupted acknowledgement into a newly valid public packet.
  if (packet.version !== 'lane-a-business-content-1' || packet.scenario !== 'order_explanation'
    || packet.payloadFingerprint !== requestFingerprint(rawPayload) || packet.payloadBytes !== bytes || bytes > 131072)
    throw new Error('AI_RESOURCE_UNAVAILABLE');
  const payload = structuredClone(rawPayload);
  delete payload.explanation;
  const order = record(record(record(payload.facts).order).value);
  delete order.lifecycle;
  if (payload.question === 'fees') {
    const history = record(record(payload.facts).history);
    if (history.coverage === 'partial') history.value = projectOrderHistoryFacts(history.value);
    const inspections = record(record(payload.facts).inspections);
    if (inspections.coverage === 'partial') inspections.value = projectOrderInspectionEvidence(inspections.value);
  }
  if (payload.question === 'payments') {
    const facts = record(payload.facts), funding = record(facts.fundingLedger);
    // This version publishes no structured funds port. Validate the recognized
    // internal projection before withholding it; unknown fields are not deleted
    // to make a corrupted packet pass. Model-input hash remains untouched.
    if (funding.coverage === 'partial') {
      z.object({ coverage: z.literal('partial'), value: aiOrderFundingFactsSchema }).strict().parse(funding);
    } else z.object({ coverage: z.enum(['unavailable', 'not_loaded']) }).strict().parse(funding);
    facts.fundingLedger = { coverage: 'not_loaded' };
    for (const gap of rows(payload.gaps)) if (gap.field === 'fundingLedger') gap.status = 'not_loaded';
  }
  return sealBusinessScenario('order_explanation', payload);
}

/** The fixed answer wire still carries only its original minimal order snapshot.
 * Reuse its saved period fields for fees; never fetch present state or attach
 * finance/extension/history that were absent from this frozen read. */
export function renderOrderReadAnswer(facts: unknown, observedAt: string, question: string) {
  const current = record(facts), order = record(current.order);
  return buildOrderExplanation({ payload: { orderId: order.id, observedAt, question, facts: {
    order: { value: order }, ...(question === 'fees' || question === 'payments'
      ? { amounts: { value: order.amounts, currency: order.currency } } : {}),
    ...(question === 'fees' ? { fulfillment: { value: { startAt: order.startAt, originalEndAt: order.originalEndAt,
      effectiveEndAt: order.effectiveEndAt, effectiveEndBasis: order.effectiveEndBasis } } } : {})
  } } }).text;
}

function createOrderV2Validators() {
  // An older published shared artifact must still load the unchanged v1 path.
  // Opting into v2 with missing runtime exports fails closed, never downcasts.
  if (!AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION || !AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS.AiOrderExplanationMaterialV2
    || !AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS.AiOrderSourceReopenRequestV2 || !AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS.AiOrderSourceReadV2)
    throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
  addFormats(ajv);
  const definitions = JSON.parse(JSON.stringify({ ...AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS, ...AI_SCOPE_DRAFT_SCHEMAS })
    .replaceAll('#/components/schemas/', '#/$defs/'));
  return {
    material: ajv.compile<AiOrderExplanationMaterialV2>({ $ref: '#/$defs/AiOrderExplanationMaterialV2', $defs: definitions }),
    request: ajv.compile<AiOrderSourceReopenRequestV2>({ $ref: '#/$defs/AiOrderSourceReopenRequestV2', $defs: definitions }),
    response: ajv.compile<AiOrderSourceReadV2>({ $ref: '#/$defs/AiOrderSourceReadV2', $defs: definitions })
  };
}
let orderV2Validators: ReturnType<typeof createOrderV2Validators> | undefined;
const orderV2Contracts = () => orderV2Validators ??= createOrderV2Validators();
const sameOrderV2 = (left: unknown, right: unknown) => requestFingerprint(left) === requestFingerprint(right);
function freezeOrderV2<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeOrderV2); Object.freeze(value);
  }
  return value;
}
function assertOrderV2Source(value: unknown, scope: unknown, orderId: string, version: string, field?: string) {
  const fact = record(value), source = record(fact.source), data = record(fact.value), scoped = record(scope);
  if (fact.coverage !== 'partial') return;
  if (!sameOrderV2(source.scope, scope) || source.resourceType !== 'order' || source.resourceId !== orderId
    || source.version !== version || field !== undefined && source.field !== field) throw new ModelGatewayError('INVALID_RESPONSE');
  if (data.id !== undefined && source.field === 'order' && (data.id !== orderId || data.updatedAt !== version)
    || data.orderId !== undefined && data.orderId !== orderId
    || data.scope !== undefined && !sameOrderV2(data.scope, scope)
    || data.tenantId !== undefined && data.tenantId !== scoped.tenantId
    || data.workspaceId !== undefined && data.workspaceId !== scoped.workspaceId
    || data.sourceOrderUpdatedAt !== undefined && data.sourceOrderUpdatedAt !== version) throw new ModelGatewayError('INVALID_RESPONSE');
  if (source.field === 'saved_basis') aiOrderCalendarFactsSchema.parse(data.calendar);
  if (source.field === 'inspection_records' && 'frozenBasis' in data) {
    const frozen = aiOrderFrozenInspectionBasisSchema.parse(data.frozenBasis);
    assertFrozenInspectionParent(frozen, { scope, orderId, sourceOrderUpdatedAt: version });
  }
}

/** Derive a NEW read-only public packet from a valid internal source seal. This
 * is never substituted for stored v1 input/model materialHash. New fields are
 * checked against the normative shared schema; no unknown field is stripped. */
export function projectOrderExplanationMaterialV2(material: unknown): AiOrderExplanationMaterialV2 {
  const packet = record(material), original = record(packet.payload), bytes = Buffer.byteLength(JSON.stringify(original), 'utf8');
  if (packet.version !== 'lane-a-business-content-1' || packet.scenario !== 'order_explanation'
    || packet.payloadFingerprint !== requestFingerprint(original) || packet.payloadBytes !== bytes || bytes > 131072
    || packet.trust !== 'source_text_is_data_not_instructions' || packet.authority !== 'none_reauthorize_before_consumption'
    || Object.keys(packet).some(key => !['version', 'scenario', 'payload', 'payloadFingerprint', 'payloadBytes', 'trust', 'authority'].includes(key)))
    throw new ModelGatewayError('INVALID_RESPONSE');
  const payload = structuredClone(original), facts = record(payload.facts), order = record(record(facts.order).value);
  const lifecycle = order.lifecycle; delete order.lifecycle;
  const reference = (field: string, observedAt: unknown = payload.observedAt) => ({ scope: payload.scope, resourceType: 'order',
    resourceId: payload.orderId, version: payload.orderVersion, field, observedAt });
  if (payload.question === 'status' || payload.question === 'fees') {
    const saved = record(lifecycle);
    facts.lifecycle = saved.coverage === 'partial' ? { ...saved, source: reference('lifecycle_records') }
      : lifecycle ?? { coverage: 'not_loaded' };
    const gaps = Array.isArray(payload.gaps) ? payload.gaps : [];
    payload.gaps = [...gaps, { field: 'lifecycle', status: record(facts.lifecycle).coverage }];
  }
  if (payload.question === 'payments') {
    const saved = record(facts.fundingLedger);
    if (saved.coverage === 'partial') {
      const funding = aiOrderFundingFactsSchema.parse(saved.value);
      facts.fundingLedger = { ...saved, source: reference('funding_records', funding.observedAt) };
      if (funding.currency !== record(facts.amounts).currency) throw new ModelGatewayError('INVALID_RESPONSE');
    }
  }
  // Display is regenerated from the original authorized facts, not relayed prose.
  payload.consistency = 'revalidated_reads_not_atomic_snapshot';
  record(payload.handoff).informationNeeded = rows(payload.gaps).map(gap => gap.field);
  payload.explanation = buildOrderExplanation({ payload: original }, payload.question === 'fees' || payload.question === 'payments'
    ? orderExplanationDisplayBudget(payload, AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION) : undefined);
  const copy: unknown = JSON.parse(JSON.stringify({ ...packet, version: AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION,
    payload, payloadFingerprint: requestFingerprint(payload), payloadBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8') }));
  if (!orderV2Contracts().material(copy) || Buffer.byteLength(JSON.stringify(copy), 'utf8') > 131072) throw new ModelGatewayError('INVALID_RESPONSE');
  const current = copy.payload;
  for (const [name, fact] of Object.entries(current.facts)) {
    const fields: Record<string, string> = { order: 'order', amounts: 'amounts', fulfillment: 'rental_period',
      history: 'saved_basis', payments: 'payment_records', inspections: 'inspection_records', fundingLedger: 'funding_records', lifecycle: 'lifecycle_records' };
    assertOrderV2Source(fact, current.scope, current.orderId, current.orderVersion, fields[name]);
  }
  return freezeOrderV2(copy);
}

export function assertOrderPublicationV2Available(): void { orderV2Contracts(); }
export function parseOrderSourceReopenV2(value: unknown): AiOrderSourceReopenRequestV2 {
  const validate = orderV2Contracts().request;
  try {
    const copy: unknown = structuredClone(value);
    if (Buffer.byteLength(JSON.stringify(copy), 'utf8') <= 4096 && validate(copy)) return freezeOrderV2(copy);
  } catch { /* Uniform invalid command, never a caller-selected URL or query. */ }
  throw new ModelGatewayError('INVALID_REQUEST');
}
export function validateOrderSourceReadV2(value: unknown, command: AiOrderSourceReopenRequestV2): AiOrderSourceReadV2 {
  const copy: unknown = JSON.parse(JSON.stringify(value));
  if (!orderV2Contracts().response(copy) || Buffer.byteLength(JSON.stringify(copy), 'utf8') > 131072
    || copy.materialVersion !== command.materialVersion || copy.orderId !== command.resourceId
    || copy.field !== command.field || !sameOrderV2(copy.scope, command.scope)) throw new ModelGatewayError('INVALID_RESPONSE');
  if (copy.status === 'available') assertOrderV2Source(copy.value, command.scope, command.resourceId, command.version, command.field);
  return freezeOrderV2(copy);
}
