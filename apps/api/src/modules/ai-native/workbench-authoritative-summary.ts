/** Deterministic, minimal business text from an already reauthorized display
 * original. This leaf neither reads sources nor grants display/business access;
 * the caller binds its text to the exact material and model result. Model prose,
 * customer names, contact details and free-form business descriptions stay out. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS, AI_SCOPE_DRAFT_SCHEMAS,
  type AiOpeningBusinessMaterialDraft, type AiQuoteBusinessMaterialDraft, type AiSceneCode, type AiSceneRequestBody } from '@rental-os/shared';
import { AiTaskRepositoryError } from './ai-task.repository';
import type { AiWorkbenchDisplayOriginalMaterial } from './workbench-display-original.reader';
import { orderAnswerSnapshotSchema } from './order-answer-display.adapter';
import { buildOrderExplanation, renderOrderReadAnswer } from './tools/order-explanation-renderer';
import { buildOpeningDiagnosisText } from './scenes/opening-diagnosis-renderer';
import { applyOriginalQuoteAnswers } from './scenes/original-quote-input';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

const definitions = JSON.parse(JSON.stringify({ ...AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS, ...AI_SCOPE_DRAFT_SCHEMAS })
  .replaceAll('#/components/schemas/', '#/$defs/'));
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const quoteMaterial = ajv.compile<AiQuoteBusinessMaterialDraft>({ $ref: '#/$defs/AiQuoteBusinessMaterialDraft', $defs: definitions });
const openingMaterial = ajv.compile<AiOpeningBusinessMaterialDraft>({ $ref: '#/$defs/AiOpeningBusinessMaterialDraft', $defs: definitions });
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const same = (a: unknown, b: unknown) => requestFingerprint(a) === requestFingerprint(b);
const code = (value: string) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value)) throw unavailable();
  return value;
};
const time = z.string().max(40).datetime({ offset: true });
const candidateTime = (value: string | undefined) => value === undefined ? '未提供'
  : time.safeParse(value).success ? value : '尚未形成正式绝对时间，请在原输入控件核对';
const fieldLabel = (field: string) => {
  const labels: Record<string, string> = { customerId: '客户选择', customerType: '客户身份', bookingIdentity: '下单身份',
    'bookingIdentity.corporateCustomerId': '企业关系', 'bookingIdentity.enterpriseContractAndPayer': '企业付款身份',
    items: '商品与数量', start: '开始时间', end: '结束时间', fulfillmentMode: '履约方式',
    location: '取货/履约地点', returnLocation: '归还地点', deliveryAddressId: '原地址选择', selectionRevision: '选择修订' };
  const row = /^items\.(0|[1-4]?[0-9])(?:\.(quantity|pricingUnit|usageQuantity))?$/u.exec(field);
  return Object.hasOwn(labels, field) ? labels[field] : (row ? `第${Number(row[1]) + 1}行${row[2] === 'quantity' ? '数量'
    : row[2] === 'pricingUnit' ? '计价单位' : row[2] === 'usageQuantity' ? '使用量' : '商品选择'}` : '其他原输入字段');
};

function openingSummary(value: unknown) {
  const material = structuredClone(value);
  if (!openingMaterial(material)) throw unavailable();
  code(material.configVersion);
  // Core readiness notes and titles can contain free text. Keep original
  // statuses/versions, and use their registered section identifiers as labels.
  const names: Record<string, string> = { workspace_profile: '空间资料', accounts_roles: '账号与角色', fulfillment_network: '履约网络',
    business_rule: '营业规则', business_calendar: '营业日历', item_groups: '商品组', pricing_groups_rates: '计价组与费率',
    price_version: '价格版本', membership_base: '会员基础' };
  const sections = material.sections.map(({ title: _title, summary: _summary, issue: _issue, ...section }) => {
    code(section.key); code(section.evidence.resourceId); code(section.evidence.version);
    return { ...section, title: Object.hasOwn(names, section.key) ? names[section.key] : section.key };
  });
  for (const row of material.calendarSource?.years ?? []) if (row.status === 'adopted') {
    code(row.binding.id); code(row.binding.version);
    if (row.binding.officialSource.versionId !== null) code(row.binding.officialSource.versionId);
    if (row.binding.officialSource.version !== null) code(row.binding.officialSource.version);
  }
  const targets = material.sections.map(section => `${code(section.key)}：${code(section.candidate.currentVersion)}`);
  return buildOpeningDiagnosisText({ ...material, sections })
    + `\n原分区目标版本：${targets.join('；')}。`
    + '\n原分区自由文本说明未在本摘要展开，请通过原受权入口核对。';
}

/** Shared by the source-revalidated result reader and display preparation.
 * A valid schema grants no authority; the caller owns original/current source
 * equivalence and persisted human-answer lineage. No model text is accepted. */
export function buildQuotePreparationSummary(input: {
  request: AiSceneRequestBody; material: unknown; history: Parameters<typeof applyOriginalQuoteAnswers>[1];
}): string {
  const material = structuredClone(input.material);
  if (input.request.sceneCode !== 'quote_clarification' || !quoteMaterial(material)
    || material.payloadFingerprint !== requestFingerprint(material.payload)
    || material.payloadBytes !== Buffer.byteLength(JSON.stringify(material.payload), 'utf8')
    || !same(material.payload.facts.scope, material.payload.scope)
    || material.payload.facts.audience !== material.payload.audience) throw unavailable();
  const facts = material.payload.facts;
  const states = { ready: '原条件已准备，仍需人类明确核对', missing_input: '缺少必要输入', ambiguous: '存在歧义，须明确选择',
    qualification_required: '须完成原资格流程', unavailable: '当前条件不可用于报价' };
  const lines = ['原报价条件摘要（不是已保存报价）', `准备状态：${states[facts.status]}。`,
    `原材料来源观察时间：${facts.observedAt}。`];
  if ('request' in facts) {
    const request = facts.request;
    lines.push('以下为正式准备返回的待核对参数，不代表已经明确选择、批准或核价。');
    for (const [index, line] of request.lines.entries()) lines.push(`第${index + 1}行：商品标识 ${code(line.itemGroupId)}；数量 ${line.quantity}；计价单位 ${code(line.pricingUnit)}`
      + (line.usageQuantity === undefined ? '。' : `；原计划使用量 ${line.usageQuantity}。`));
    lines.push(`租期：${request.startAt} → ${request.endAt}。`,
      `履约方式：${code(request.fulfillmentMode)}；取货/履约地点标识：${code(request.fulfillmentLocationId)}。`,
      `归还地点标识：${request.returnLocationId === undefined ? '未单独提供，不推定为取货地点' : code(request.returnLocationId)}。`,
      `配置版本：${code(facts.configVersion)}；选择修订：${facts.selectionRevision}。`,
      `库存观察时间：${facts.availability.observedAt}；原结果：${facts.availability.result.available ? '本次查询可用' : '本次查询不足'}，不代表锁定库存。`);
  } else {
    // A failed preparation has no formal request. Preserve only safe values
    // from the same original candidate plus its already verified human lineage;
    // never fill missing conditions from model text or another quotation.
    const candidate = applyOriginalQuoteAnswers(input.request.input.candidate, input.history);
    lines.push('尚未形成完整正式报价参数；以下仅为原输入候选，不代表资源已选定或规则已通过。');
    if (!candidate.items) lines.push('商品与数量：尚缺明确输入。');
    for (const [index, line] of (candidate.items ?? []).entries()) lines.push(`第${index + 1}行：商品${line.itemGroupId ? `标识 ${code(line.itemGroupId)}` : '尚待明确选择'}；候选数量 ${line.quantity}`
      + (line.pricingUnit ? `；候选计价单位 ${code(line.pricingUnit)}` : '；计价单位未选')
      + (line.usageQuantity === undefined ? '。' : `；候选使用量 ${line.usageQuantity}。`));
    lines.push(`候选租期：${candidateTime(candidate.start)} → ${candidateTime(candidate.end)}。`,
      `候选履约方式：${candidate.fulfillmentMode ? code(candidate.fulfillmentMode) : '未选'}。`,
      `候选取货/履约地点标识：${candidate.locationId ? code(candidate.locationId) : '尚待明确选择'}。`,
      `候选归还地点标识：${candidate.returnLocationId ? code(candidate.returnLocationId) : '未单独提供，不推定为取货地点'}。`);
    if ('missingFields' in facts && facts.missingFields?.length)
      lines.push(`待补充：${[...new Set(facts.missingFields.map(fieldLabel))].join('、')}。`);
    if ('ambiguousFields' in facts && facts.ambiguousFields?.length)
      lines.push(`待消除歧义：${[...new Set(facts.ambiguousFields.map(fieldLabel))].join('、')}。`);
  }
  lines.push('币种、租金、押金及其他金额：本材料未核价；缺金额不等于零，不拼接旧报价金额。',
    '该原材料仅作只读准备：报价保存未尝试、库存未预占、订单创建与批准未执行。',
    '后续报价、订单和支付状态未包含在此摘要；须读取各自原收据，unknown 不换键重做。');
  const text = lines.join('\n');
  if (Buffer.byteLength(text, 'utf8') > 16384) throw unavailable();
  return text;
}

export function buildWorkbenchAuthoritativeSummary(original: AiWorkbenchDisplayOriginalMaterial): { scene: AiSceneCode; text: string; observedAt: string } {
  const observation = original.observation, scene = original.request.sceneCode;
  if (observation.status !== 'available' || observation.sceneCode !== scene || observation.taskId !== original.task.taskId
    || observation.runId !== original.model.step.runId || observation.resultId !== original.model.result.id
    || observation.materialHash !== original.envelope.materialHash || original.context.audience !== 'operator'
    || original.context.scope.kind !== 'workspace' || requestFingerprint(original.envelope.facts) !== original.envelope.materialHash) throw unavailable();
  // The original reader has compared these frozen facts with current sources.
  // Keep their saved observation time: a normal reread must not rewrite text
  // under the same material revision merely because its query clock advances.
  let text: string, observedAt: string;
  if (scene === 'order_explanation') {
    // The checked public observation may withhold structured funding/lifecycle
    // fields. The original renderer still owns their safe deterministic prose;
    // use the same verified frozen envelope, not a second reduced fact set.
    const facts = original.envelope.facts;
    if (facts && typeof facts === 'object' && 'version' in facts && facts.version === 'model-order-answer-snapshot-1') {
      const snapshot = orderAnswerSnapshotSchema.parse(facts);
      if (snapshot.orderId !== original.request.input.orderId || snapshot.originalHash !== original.original.contentHash
        || !same(snapshot.facts.scope, original.context.scope)) throw unavailable();
      text = renderOrderReadAnswer(snapshot.facts, snapshot.observedAt, original.request.input.question);
      observedAt = snapshot.observedAt;
    } else {
      text = buildOrderExplanation(facts, 16384).text;
      observedAt = z.object({ payload: z.object({ observedAt: time }).passthrough() }).passthrough().parse(facts).payload.observedAt;
    }
  } else if (scene === 'opening_diagnosis') {
    text = openingSummary(original.envelope.facts);
    observedAt = z.object({ observedAt: time }).passthrough().parse(original.envelope.facts).observedAt;
  } else if (scene === 'quote_clarification') {
    text = buildQuotePreparationSummary({ request: original.request, material: original.envelope.facts, history: original.lineage.history });
    observedAt = z.object({ payload: z.object({ facts: z.object({ observedAt: time }).passthrough() }).passthrough() })
      .passthrough().parse(original.envelope.facts).payload.facts.observedAt;
  }
  else throw unavailable();
  // Reject oversized summaries instead of cutting money, source versions or
  // uncertainty qualifications away from their statements.
  if (!text || Buffer.byteLength(text, 'utf8') > 16384) throw unavailable();
  return { scene, text, observedAt };
}
