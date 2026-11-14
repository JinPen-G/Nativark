/** Original goal candidates and persisted human answers -> original quote
 * parameters. Model names are hints; IDs, customer type and quantities require
 * their real human question receipts. No quote, authority or approval is made. */
import { AI_TASK_INPUT_DRAFT_VERSION, AI_TASK_INPUT_QUOTE_ROW_TARGET_VERSION, validateAiTaskInputAnswersDraft,
  parseAiTaskUsageQuantityDraft,
  type AiQuoteGoalConditionsDraft, type AiQuoteGoalProjectionDraft, type AiSceneRequestBody,
  type AiTaskInputAnswerDraft, type AiTaskInputContractDraft, type AiTaskInputFieldDraft } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { isGatewayResult } from '../gateway-contract-validation';
import { aiQuoteCandidateInputSchema } from '../tools/quote-candidate-preparation.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { parseQuoteGoalModelOutput } from './quote-goal-input';
import { applyOriginalQuoteAnswers } from './original-quote-input';

export const ORIGINAL_QUOTE_GOAL_PARAMETER_CODE = 'original_quote_goal_parameters';
type Round = { contract: AiTaskInputContractDraft; answers: readonly AiTaskInputAnswerDraft[]; result: unknown };
type PartialCandidate = Omit<AiQuoteGoalConditionsDraft, 'items' | 'customerType'> & {
  customerType?: 'personal' | 'corporate'; customerId?: string; locationId?: string; returnLocationId?: string;
  deliveryAddressId?: string; selectionRevision?: string;
  bookingIdentity?: { bookingIdentity: 'enterprise_employee'; corporateCustomerId?: string; enterpriseContractAndPayer?: boolean };
  items?: Array<NonNullable<AiQuoteGoalConditionsDraft['items']>[number] & { itemGroupId?: string }>;
};
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const conditions = (value: unknown) => {
  if (!isGatewayResult(value) || value.status !== 'completed' || value.usage.kind !== 'reported' || value.toolRequests.length) throw denied();
  return structuredClone(parseQuoteGoalModelOutput(value.text).conditions);
};

const mergeHints = (previous: AiQuoteGoalConditionsDraft, current: AiQuoteGoalConditionsDraft) => {
  const next = { ...structuredClone(previous), ...structuredClone(current) };
  const count = Math.max(previous.items?.length ?? 0, current.items?.length ?? 0);
  // An extraction omission is not a human deletion. Retained words remain
  // unconfirmed hints; only the original answer receipts supply IDs/quantities.
  if (count) next.items = Array.from({ length: count }, (_, index) => ({
    ...previous.items?.[index], ...current.items?.[index]
  }));
  return next;
};

/** Current bounded lookups use the same original result history as questions.
 * This preserves omitted names for clarification, without selecting an object
 * or changing the publicly returned, exact current model candidate. */
export function originalQuoteGoalHints(current: AiQuoteGoalConditionsDraft, rounds: readonly Round[]) {
  if (rounds.length > 31) throw unavailable();
  let hints: AiQuoteGoalConditionsDraft = {};
  for (const round of rounds) hints = mergeHints(hints, conditions(round.result));
  return mergeHints(hints, current);
}

/** Only server-verified original Run histories reach this function. Human
 * fields persist across later extraction; a changed name withdraws its old ID
 * and requires a fresh choice, rather than silently selecting a replacement. */
export function originalQuoteGoalParameters(current: AiQuoteGoalConditionsDraft, rounds: readonly Round[]): PartialCandidate {
  if (rounds.length > 31) throw unavailable();
  const selected: PartialCandidate = {}, anchors = new Map<string, string | undefined>();
  const quantityAnchors = new Map<number, number | undefined>();
  const quantityAnswerEpochs = new Map<number, number>();
  let clarificationEpoch = 0;
  let hints: AiQuoteGoalConditionsDraft = {};
  const merged = (words: AiQuoteGoalConditionsDraft): PartialCandidate => {
    hints = mergeHints(hints, words);
    const next: PartialCandidate = structuredClone(hints);
    // Model-inferred identity/quantity cannot enter the original Core request.
    delete next.customerType;
    for (const [property, value] of Object.entries(selected)) if (property !== 'items') (next as Record<string, unknown>)[property] = structuredClone(value);
    const count = Math.max(next.items?.length ?? 0, selected.items?.length ?? 0);
    if (count) next.items = Array.from({ length: count }, (_, index) => {
      const item = hints.items?.[index] ?? {};
      const kept = selected.items?.[index];
      if (kept?.itemGroupId && item.productName !== undefined && anchors.get(`item:${index}`) !== item.productName) {
        delete kept.itemGroupId; delete kept.pricingUnit; delete kept.usageQuantity;
      }
      // A repeated model suggestion may differ from an explicit human choice.
      // A NEW conflicting suggestion withdraws the old quantity until another
      // real integer answer; neither the model nor the old value can confirm it.
      if (kept?.quantity !== undefined && item.quantity !== undefined && kept.quantity !== item.quantity
        && (quantityAnchors.get(index) !== item.quantity || quantityAnswerEpochs.get(index) !== clarificationEpoch)) delete kept.quantity;
      const line = { ...item, ...kept };
      if (line.itemGroupId) delete line.productName;
      else line.productName = item.productName;
      if (kept?.quantity === undefined) delete line.quantity;
      return line;
    });
    if (next.customerId && hints.customerName !== undefined && anchors.get('customer') !== hints.customerName) {
      delete selected.customerId; delete selected.deliveryAddressId;
      delete next.customerId; delete next.deliveryAddressId;
    }
    if (next.customerId) delete next.customerName; else next.customerName = hints.customerName;
    if (next.locationId) delete next.locationName;
    if (next.returnLocationId) delete next.returnLocationName;
    return next;
  };
  const recordClarification = (round: Round) => {
    // Returning to a previously suggested number is still a NEW human change.
    // The old model hint alone cannot distinguish it from harmless repetition.
    if (round.answers.some(answer => answer.fieldId === 'clarification_text'
      && typeof answer.value === 'string' && answer.value.trim())) clarificationEpoch++;
  };
  for (const round of rounds) {
    if (!validateAiTaskInputAnswersDraft(round.contract, round.answers)) throw denied();
    const originalWords = conditions(round.result), before = merged(originalWords);
    if (round.contract.code !== ORIGINAL_QUOTE_GOAL_PARAMETER_CODE) {
      if (round.contract.code === 'original_quote_context') { recordClarification(round); continue; }
      const changed = applyOriginalQuoteAnswers(aiQuoteCandidateInputSchema.parse(before), [round]);
      Object.assign(selected, changed);
      if (round.answers.some(answer => answer.fieldId === 'customer_selection')) anchors.set('customer', hints.customerName ?? anchors.get('customer'));
      for (const field of round.contract.fields) if (field.fieldId === 'item_selection'
        && round.answers.some(answer => answer.fieldId === field.fieldId)) {
        const index = field.target?.rowIndex ?? (before.items?.length === 1 ? 0 : -1);
        if (index < 0 || !before.items?.[index]) throw denied();
        anchors.set(`item:${index}`, hints.items?.[index]?.productName ?? anchors.get(`item:${index}`));
      }
      for (const field of round.contract.fields) if (field.fieldId === 'quantity'
        && round.answers.some(answer => answer.fieldId === 'quantity')) {
        const index = field.target?.rowIndex ?? (before.items?.length === 1 ? 0 : -1);
        if (index < 0 || !before.items?.[index]) throw denied();
        quantityAnchors.set(index, hints.items?.[index]?.quantity);
        quantityAnswerEpochs.set(index, clarificationEpoch);
      }
      recordClarification(round);
      continue;
    }
    for (const answer of round.answers) {
      const field = round.contract.fields.find(row => row.fieldId === answer.fieldId)!;
      if (field.target && (field.target.candidateInputFingerprint !== requestFingerprint(before)
        || !before.items || field.target.rowIndex >= before.items.length)) throw denied();
      if (answer.fieldId === 'clarification_text') continue;
      if (answer.fieldId === 'customer_type_selection') {
        if (answer.value !== 'personal' && answer.value !== 'corporate') throw denied();
        selected.customerType = answer.value;
      } else if (['item_selection', 'quantity', 'pricing_unit_selection', 'usage_quantity'].includes(answer.fieldId)) {
        const index = field.target?.rowIndex ?? (before.items?.length === 1 ? 0 : -1);
        if (index < 0 || !before.items?.[index]) throw denied();
        selected.items ??= before.items.map(() => ({}));
        const line = selected.items[index] ??= {};
        if (answer.fieldId === 'item_selection') { line.itemGroupId = String(answer.value); anchors.set(`item:${index}`, hints.items?.[index]?.productName); }
        else if (answer.fieldId === 'quantity') { line.quantity = Number(answer.value); quantityAnchors.set(index, hints.items?.[index]?.quantity);
          quantityAnswerEpochs.set(index, clarificationEpoch); }
        else if (answer.fieldId === 'pricing_unit_selection') line.pricingUnit = answer.value as typeof line.pricingUnit;
        else {
          const quantity = parseAiTaskUsageQuantityDraft(answer.value);
          if (quantity === null || line.pricingUnit !== 'usage') throw denied();
          line.usageQuantity = quantity;
        }
      } else {
        const properties: Partial<Record<AiTaskInputAnswerDraft['fieldId'], keyof PartialCandidate>> = {
          customer_selection: 'customerId', starts_at: 'start', ends_at: 'end', fulfillment_selection: 'fulfillmentMode',
          pickup_location: 'locationId', return_location: 'returnLocationId', delivery_address_selection: 'deliveryAddressId' };
        const property = properties[answer.fieldId];
        if (!property || typeof answer.value !== 'string') throw denied();
        (selected as Record<string, unknown>)[property] = answer.value;
        if (property === 'customerId') anchors.set('customer', before.customerName);
      }
    }
    recordClarification(round);
  }
  return merged(current);
}

/** The caller supplies an original source plus its verified consumed answer
 * history. A missing goal answer remains unavailable, never a default candidate. */
export function originalQuoteCandidateFromAnswers(request: AiSceneRequestBody, rounds: readonly Round[], currentResult?: unknown) {
  if (request.sceneCode !== 'quote_clarification') throw denied();
  if (request.input.kind !== 'quote_goal') return applyOriginalQuoteAnswers(request.input.candidate, rounds);
  const last = rounds.at(-1);
  if (!last) throw unavailable();
  const parsed = aiQuoteCandidateInputSchema.safeParse(originalQuoteGoalParameters(conditions(currentResult ?? last.result), rounds));
  if (!parsed.success) throw unavailable();
  return parsed.data;
}

/** New questions are created only by the existing afterSucceeded transaction.
 * Current bounded choices stay tied to this result and partial input; a schema
 * or an option label is neither an object selection nor business authorization. */
export function originalQuoteGoalContract(projection: AiQuoteGoalProjectionDraft, candidate: PartialCandidate): AiTaskInputContractDraft {
  if (projection.status !== 'requires_input' || !projection.candidates || !projection.configuration) throw unavailable();
  const fingerprint = requestFingerprint(candidate), fields: AiTaskInputFieldDraft[] = [];
  const choice = (fieldId: Extract<AiTaskInputFieldDraft, { kind: 'choice' }>['fieldId'], field: string, label: string,
    target?: Extract<AiTaskInputFieldDraft, { fieldId: 'quantity' }>['target']) => {
    const group = projection.choices.find(row => row.field === field);
    const options = group?.choices.map(row => ({ value: row.id, label: row.phoneMasked ? `${row.label} · ${row.phoneMasked}` : row.label })) ?? [];
    if (options.length) fields.push({ fieldId, kind: 'choice', required: true, label, options,
      ...(target ? { target } : {}) } as AiTaskInputFieldDraft);
  };
  if (!candidate.customerType) fields.push({ fieldId: 'customer_type_selection', kind: 'choice', required: true,
    label: '明确使用人身份（不授企业签约或付款权）', options: [{ value: 'personal', label: '个人使用人；企业权益须原资格流程' }] });
  if (!candidate.customerId) choice('customer_selection', 'customerId', '明确选择当前受权客户');
  for (const [index, item] of (candidate.items ?? []).entries()) {
    const target = { bindingVersion: AI_TASK_INPUT_QUOTE_ROW_TARGET_VERSION, kind: 'quote_item' as const, rowIndex: index,
      candidateInputFingerprint: fingerprint };
    if (!item.itemGroupId) choice('item_selection', `items.${index}.itemGroupId`, `明确选择第${index + 1}行商品`, target);
    if (item.quantity === undefined) fields.push({ fieldId: 'quantity', kind: 'integer', required: true, minimum: 1, maximum: 10000,
      label: `明确第${index + 1}行数量（模型建议不是确认）`, target });
  }
  if (!candidate.start) fields.push({ fieldId: 'starts_at', kind: 'text', required: true, maxLength: 80, label: '明确开始时间（带时区的绝对时间）' });
  if (!candidate.end) fields.push({ fieldId: 'ends_at', kind: 'text', required: true, maxLength: 80, label: '明确结束时间（带时区的绝对时间）' });
  const unique = fields.filter((field, index) => fields.findIndex(row => row.fieldId === field.fieldId) === index).slice(0, 7);
  return { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, code: ORIGINAL_QUOTE_GOAL_PARAMETER_CODE,
    version: requestFingerprint({ goalHash: projection.goalHash, original: projection.original, model: { ...projection.model, observedAt: undefined },
      configuration: projection.configuration.version, choices: projection.choices.map(row => ({ ...row, source: { ...row.source, observedAt: undefined } })), candidate }),
    fields: [...unique, { fieldId: 'clarification_text', kind: 'text', required: !unique.length, maxLength: 2048,
      label: '补充原需求中的客户、商品或日期；不会批准报价或订单' }] };
}
