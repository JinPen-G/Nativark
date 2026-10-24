import { AI_TASK_INPUT_DRAFT_VERSION, RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES, isAiTaskInputContractDraft, validateAiTaskInputAnswersDraft, parseAiTaskUsageQuantityDraft,
  type AiTaskInputContractDraft, type AiTaskInputAnswerDraft, type AiTaskInputFieldDraft } from '@rental-os/shared';
import { aiQuoteCandidateInputSchema, AI_QUOTE_CANDIDATE_LIMITS } from '../tools/quote-candidate-preparation.service';
import { AiTaskRepositoryError } from '../ai-task.repository';

/** Only the persisted, server-validated answer lineage may call this adapter.
 * No model extraction, defaults, approval or Core calculation occurs here. */
export function applyOriginalQuoteAnswers(value: unknown, rounds: readonly {
  contract: AiTaskInputContractDraft; answers: readonly AiTaskInputAnswerDraft[]
}[]) {
  let candidate = aiQuoteCandidateInputSchema.parse(structuredClone(value));
  if (rounds.length > 31) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  for (const round of rounds) {
    if (!validateAiTaskInputAnswersDraft(round.contract, round.answers)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    if (round.contract.code !== 'original_quote_parameters') {
      if (round.answers.some(answer => answer.fieldId !== 'clarification_text')) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      continue;
    }
    const answers = new Map(round.answers.map(answer => [answer.fieldId, answer.value]));
    const enterprise = answers.get('enterprise_selection'), payer = answers.get('enterprise_payer_selection');
    if (enterprise !== undefined || payer !== undefined) {
      if (candidate.bookingIdentity?.bookingIdentity !== 'enterprise_employee') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      if (typeof enterprise === 'string') candidate.bookingIdentity.corporateCustomerId = enterprise;
      if (payer !== undefined) {
        if (!['personal_payer', 'enterprise_payer'].includes(String(payer))) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
        candidate.bookingIdentity.enterpriseContractAndPayer = payer === 'enterprise_payer';
      }
    }
    const selectedItem = answers.get('item_selection'), quantity = answers.get('quantity');
    if (selectedItem !== undefined || quantity !== undefined) {
      if (candidate.items && candidate.items.length !== 1) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const line = candidate.items?.[0];
      const actualQuantity = quantity ?? line?.quantity;
      if (typeof actualQuantity !== 'number' || !Number.isSafeInteger(actualQuantity)
        || actualQuantity < 1 || actualQuantity > AI_QUOTE_CANDIDATE_LIMITS.quantity) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      if (!line && typeof selectedItem !== 'string') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      candidate.items = [{ ...line, quantity: actualQuantity,
        ...(typeof selectedItem === 'string' ? { itemGroupId: selectedItem } : {}) }];
      if (selectedItem !== undefined) delete candidate.items[0].productName;
    }
    const pricing = answers.get('pricing_unit_selection');
    if (pricing !== undefined) {
      const unit = RENTAL_PRICING_UNIT_CODES.find(value => value === pricing);
      if (!unit || candidate.items?.length !== 1) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      candidate.items[0].pricingUnit = unit;
      if (unit !== 'usage') delete candidate.items[0].usageQuantity;
    }
    const usage = answers.get('usage_quantity');
    if (usage !== undefined) {
      const parsedUsage = parseAiTaskUsageQuantityDraft(usage);
      if (parsedUsage === null || candidate.items?.length !== 1 || candidate.items[0].pricingUnit !== 'usage') {
        throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      }
      candidate.items[0].usageQuantity = parsedUsage;
    }
    for (const [field, property] of [['starts_at', 'start'], ['ends_at', 'end']] as const) {
      const answer = answers.get(field);
      if (typeof answer === 'string') candidate[property] = answer;
    }
    const fulfillment = answers.get('fulfillment_selection');
    if (fulfillment !== undefined) {
      const mode = RENTAL_FULFILLMENT_MODES.find(value => value === fulfillment);
      if (!mode) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      // Only a mode change releases the delivery address. The reconfirmation
      // design re-offers the current choices so a repeated same-mode answer
      // re-binds the round; clearing it there would make a delivery candidate
      // lose its already-confirmed address and never converge with it.
      if (candidate.fulfillmentMode !== mode) delete candidate.deliveryAddressId;
      candidate.fulfillmentMode = mode;
    }
    for (const [field, property, oldName] of [['customer_selection', 'customerId', 'customerName'],
      ['pickup_location', 'locationId', 'locationName'], ['return_location', 'returnLocationId', 'returnLocationName']] as const) {
      const answer = answers.get(field);
      if (typeof answer === 'string') {
        // Only a customer change releases the delivery address (it belongs to
        // the selected customer); a repeated same-customer reconfirmation must
        // keep the already-confirmed address.
        const customerChanged = field === 'customer_selection' && candidate[property] !== answer;
        candidate[property] = answer; delete candidate[oldName];
        if (customerChanged) delete candidate.deliveryAddressId;
      }
    }
    const deliveryAddress = answers.get('delivery_address_selection');
    if (typeof deliveryAddress === 'string') candidate.deliveryAddressId = deliveryAddress;
    if (round.answers.some(answer => ['customer_selection', 'item_selection', 'pickup_location', 'return_location', 'fulfillment_selection', 'delivery_address_selection', 'pricing_unit_selection', 'enterprise_selection', 'enterprise_payer_selection'].includes(answer.fieldId))) {
      if (!/^[a-f0-9]{64}$/u.test(round.contract.version)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      // Revision belongs to the persisted offered candidates, not the caller
      // or the newer configuration discovered during subsequent preparation.
      candidate.selectionRevision = round.contract.version;
    }
    candidate = aiQuoteCandidateInputSchema.parse(candidate);
  }
  return candidate;
}

/** Existing shared field vocabulary only. Unsupported multi-line edits,
 * qualification changes remain the original human flow. Fulfillment choices
 * come exclusively from the current authorized Core configuration. */
export function originalQuoteAnswerContract(candidate: ReturnType<typeof applyOriginalQuoteAnswers>, preparation: unknown,
  fallbackLabel: string): AiTaskInputContractDraft {
  const result = preparation as { selectionRevision?: string; clarifications?: Array<{
    field: string; candidates?: Array<{ id: string; label: string }>
  }> };
  const fields: AiTaskInputFieldDraft[] = [];
  const single = !candidate.items || candidate.items.length === 1;
  for (const clarification of result.clarifications ?? []) {
    // Re-select the unit first; a person switching away from usage must not be
    // forced to answer an inapplicable usage quantity in the same round.
    if (single && clarification.field === 'items.0.usageQuantity' && candidate.items?.[0].pricingUnit === 'usage'
      && !result.clarifications?.some(row => row.field === 'items.0.pricingUnit' && row.candidates?.length)) {
      fields.push({ fieldId: 'usage_quantity', kind: 'text', required: true, maxLength: 32,
        label: '明确计划用量（普通十进制，例如1.5；不是价格或批准）' });
      continue;
    }
    if (clarification.field === 'start' || clarification.field === 'end') {
      fields.push({ fieldId: clarification.field === 'start' ? 'starts_at' : 'ends_at', kind: 'text', required: true,
        maxLength: 80, label: clarification.field === 'start' ? '明确开始时间（带时区的绝对时间）' : '明确结束时间（带时区的绝对时间）' });
      continue;
    }
    const fieldId = clarification.field === 'customerId' ? 'customer_selection'
      : clarification.field === 'bookingIdentity.corporateCustomerId' ? 'enterprise_selection'
      : clarification.field === 'bookingIdentity.enterpriseContractAndPayer' ? 'enterprise_payer_selection'
      : clarification.field === 'fulfillmentMode' ? 'fulfillment_selection'
      : single && clarification.field === 'items.0.pricingUnit' ? 'pricing_unit_selection'
      : clarification.field === 'deliveryAddressId' ? 'delivery_address_selection'
      : clarification.field === 'location' ? 'pickup_location' : clarification.field === 'returnLocation' ? 'return_location'
      : single && ['items', 'items.0'].includes(clarification.field) ? 'item_selection' : undefined;
    if (!fieldId || !/^[a-f0-9]{64}$/u.test(result.selectionRevision ?? '') || !clarification.candidates?.length) continue;
    fields.push({ fieldId, kind: 'choice', required: true, label: `明确选择：${clarification.field}`,
      options: clarification.candidates.slice(0, 50).map(row => ({ value: row.id, label: row.label })) });
    if (fieldId === 'item_selection' && !candidate.items) fields.push({ fieldId: 'quantity', kind: 'integer', required: true,
      label: '明确商品数量', minimum: 1, maximum: AI_QUOTE_CANDIDATE_LIMITS.quantity });
  }
  const unique = fields.filter((field, index) => fields.findIndex(row => row.fieldId === field.fieldId) === index);
  const contract: AiTaskInputContractDraft = { draftVersion: AI_TASK_INPUT_DRAFT_VERSION,
    code: unique.length ? 'original_quote_parameters' : 'original_quote_context', version: result.selectionRevision ?? '1',
    // Keep the original eight-answer bound. Business choices take priority over
    // optional free text; unsupported extra fields never use a JSON text escape.
    fields: unique.length >= 8 ? unique.slice(0, 8) : [...unique, { fieldId: 'clarification_text', kind: 'text', required: unique.length === 0, maxLength: 2048, label: fallbackLabel }] };
  if (!isAiTaskInputContractDraft(contract)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  return contract;
}
