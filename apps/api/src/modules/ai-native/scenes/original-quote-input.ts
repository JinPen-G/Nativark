import { AI_TASK_INPUT_DRAFT_VERSION, AI_TASK_INPUT_QUOTE_ROW_TARGET_VERSION, RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES,
  isAiTaskInputContractDraft, validateAiTaskInputAnswersDraft, parseAiTaskUsageQuantityDraft,
  type AiTaskInputContractDraft, type AiTaskInputAnswerDraft, type AiTaskInputFieldDraft, type AiTaskInputQuoteRowTargetDraft } from '@rental-os/shared';
import { aiQuoteCandidateInputSchema, AI_QUOTE_CANDIDATE_LIMITS } from '../tools/quote-candidate-preparation.service';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

/** Only persisted, server-validated answer lineage may call this adapter.
 * Row targets bind the pre-round candidate, never a label, model choice or grant.
 * No defaults, approval, Core calculation or business execution occurs here. */
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
    const before = structuredClone(candidate), fingerprint = requestFingerprint(before);
    // Validate the whole persisted round before changing any line/global field.
    // A reordered/edited candidate or structurally valid out-of-range target is
    // not the original question, even when its field/option IDs still match.
    for (const field of round.contract.fields) {
      if (field.target && (!/^[a-f0-9]{64}$/u.test(round.contract.version)
        || field.target.candidateInputFingerprint !== fingerprint || !before.items
        || field.target.rowIndex >= before.items.length)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
    const rowIndex = (fieldId: string) => {
      const target = round.contract.fields.find(field => field.fieldId === fieldId)?.target;
      if (target) return target.rowIndex;
      if (before.items && before.items.length !== 1) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return 0; // Exact legacy single-line shape only, never a multi-row default.
    };
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
    if (selectedItem !== undefined) {
      const index = rowIndex('item_selection'), line = candidate.items?.[index];
      const actualQuantity = quantity !== undefined && rowIndex('quantity') === index ? quantity : line?.quantity;
      if (typeof selectedItem !== 'string' || typeof actualQuantity !== 'number' || !Number.isSafeInteger(actualQuantity)
        || actualQuantity < 1 || actualQuantity > AI_QUOTE_CANDIDATE_LIMITS.quantity) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const selected = { ...line, quantity: actualQuantity, itemGroupId: selectedItem };
      delete selected.productName;
      if (!candidate.items) candidate.items = [selected];
      else candidate.items[index] = selected;
    }
    if (quantity !== undefined) {
      const index = rowIndex('quantity'), line = candidate.items?.[index];
      if (!line || typeof quantity !== 'number' || !Number.isSafeInteger(quantity)
        || quantity < 1 || quantity > AI_QUOTE_CANDIDATE_LIMITS.quantity) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      line.quantity = quantity;
    }
    const pricing = answers.get('pricing_unit_selection');
    if (pricing !== undefined) {
      const index = rowIndex('pricing_unit_selection'), unit = RENTAL_PRICING_UNIT_CODES.find(value => value === pricing);
      const line = candidate.items?.[index];
      if (!unit || !line) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      line.pricingUnit = unit;
      if (unit !== 'usage') delete line.usageQuantity;
    }
    const usage = answers.get('usage_quantity');
    if (usage !== undefined) {
      const index = rowIndex('usage_quantity'), line = candidate.items?.[index], parsedUsage = parseAiTaskUsageQuantityDraft(usage);
      if (parsedUsage === null || !line || line.pricingUnit !== 'usage') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      line.usageQuantity = parsedUsage;
    }
    for (const [field, property] of [['starts_at', 'start'], ['ends_at', 'end']] as const) {
      const answer = answers.get(field);
      if (typeof answer === 'string') candidate[property] = answer;
    }
    const fulfillment = answers.get('fulfillment_selection');
    if (fulfillment !== undefined) {
      const mode = RENTAL_FULFILLMENT_MODES.find(value => value === fulfillment);
      if (!mode) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      // Explicit pickup cannot use a customer delivery address, even when it
      // reconfirms the same mode after an inconsistent candidate was supplied.
      // Same-mode delivery reconfirmation keeps its previously chosen address.
      if (candidate.fulfillmentMode !== mode || ['store_pickup_return', 'partner_pickup_return',
        'warehouse_pickup_return', 'locker_pickup_return'].includes(mode)) delete candidate.deliveryAddressId;
      candidate.fulfillmentMode = mode;
    }
    for (const [field, property, oldName] of [['customer_selection', 'customerId', 'customerName'],
      ['pickup_location', 'locationId', 'locationName'], ['return_location', 'returnLocationId', 'returnLocationName']] as const) {
      const answer = answers.get(field);
      if (typeof answer === 'string') {
        // Same-customer reconfirmation keeps the original confirmed address.
        const customerChanged = field === 'customer_selection' && candidate[property] !== answer;
        candidate[property] = answer; delete candidate[oldName];
        if (customerChanged) delete candidate.deliveryAddressId;
      }
    }
    const deliveryAddress = answers.get('delivery_address_selection');
    if (typeof deliveryAddress === 'string') candidate.deliveryAddressId = deliveryAddress;
    if (round.answers.some(answer => ['customer_selection', 'item_selection', 'pickup_location', 'return_location', 'fulfillment_selection', 'delivery_address_selection', 'pricing_unit_selection', 'enterprise_selection', 'enterprise_payer_selection'].includes(answer.fieldId))) {
      if (!/^[a-f0-9]{64}$/u.test(round.contract.version)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      // The revision is the persisted offer, not a new caller/configuration grant.
      candidate.selectionRevision = round.contract.version;
    }
    candidate = aiQuoteCandidateInputSchema.parse(candidate);
  }
  return candidate;
}

/** Scheduling key only, never a field/option ID or authorization token. The
 * fingerprint still binds consumption; keeping it out of this key lets another
 * row rotate into a bounded later round when earlier answers edit the candidate. */
export function originalQuoteFieldOfferKey(field: AiTaskInputFieldDraft): string {
  return field.target ? `${field.fieldId}@quote_item:${field.target.rowIndex}` : field.fieldId;
}

/** Actual server-prepared line fields share the closed public vocabulary.
 * A round keeps unique field IDs/eight answers; repeated IDs for different rows
 * are asked in subsequent rounds. Unsupported qualification stays a human flow. */
export function originalQuoteAnswerContract(candidate: ReturnType<typeof applyOriginalQuoteAnswers>, preparation: unknown,
  fallbackLabel: string, alreadyOffered?: ReadonlySet<string>): AiTaskInputContractDraft {
  const result = preparation as { selectionRevision?: string; clarifications?: Array<{
    field: string; candidates?: Array<{ id: string; label: string }>
  }> };
  const fields: AiTaskInputFieldDraft[] = [], single = !candidate.items || candidate.items.length === 1;
  const hasRevision = /^[a-f0-9]{64}$/u.test(result.selectionRevision ?? '');
  const candidateInputFingerprint = requestFingerprint(aiQuoteCandidateInputSchema.parse(structuredClone(candidate)));
  for (const clarification of result.clarifications ?? []) {
    const row = /^items\.(0|[1-9][0-9]*)(?:\.(pricingUnit|usageQuantity))?$/u.exec(clarification.field);
    const index = row ? Number(row[1]) : undefined;
    if (index !== undefined && (!candidate.items || index >= candidate.items.length)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const target: AiTaskInputQuoteRowTargetDraft | undefined = !single && index !== undefined ? {
      bindingVersion: AI_TASK_INPUT_QUOTE_ROW_TARGET_VERSION, kind: 'quote_item', rowIndex: index, candidateInputFingerprint
    } : undefined;
    // Re-select a row's unit before its usage, without suppressing another row's
    // independently applicable usage question in this same bounded round.
    if (row?.[2] === 'usageQuantity' && index !== undefined && candidate.items?.[index].pricingUnit === 'usage'
      && !result.clarifications?.some(other => other.field === `items.${index}.pricingUnit` && other.candidates?.length)) {
      if (target && !hasRevision) continue;
      fields.push({ fieldId: 'usage_quantity', kind: 'text', required: true, maxLength: 32,
        label: '明确计划用量（普通十进制，例如1.5；不是价格或批准）', ...(target ? { target } : {}) });
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
      : row?.[2] === 'pricingUnit' ? 'pricing_unit_selection'
      : clarification.field === 'deliveryAddressId' ? 'delivery_address_selection'
      : clarification.field === 'location' ? 'pickup_location' : clarification.field === 'returnLocation' ? 'return_location'
      : row && !row[2] || single && clarification.field === 'items' ? 'item_selection' : undefined;
    if (!fieldId || !hasRevision || !clarification.candidates?.length) continue;
    const options = clarification.candidates.slice(0, 50).map(option => ({ value: option.id, label: option.label }));
    const label = `明确选择：${clarification.field}`;
    if (target && (fieldId === 'item_selection' || fieldId === 'pricing_unit_selection')) {
      fields.push({ fieldId, kind: 'choice', required: true, label, options, target });
    } else fields.push({ fieldId, kind: 'choice', required: true, label, options });
    if (fieldId === 'item_selection' && !candidate.items) fields.push({ fieldId: 'quantity', kind: 'integer', required: true,
      label: '明确商品数量', minimum: 1, maximum: AI_QUOTE_CANDIDATE_LIMITS.quantity });
  }
  // Rotate rows BEFORE de-duplicating the public field IDs, or row zero would
  // win every time regardless of already-offered rows. This is ordering only.
  const ordered = alreadyOffered?.size ? [...fields].sort((left, right) =>
    (alreadyOffered.has(originalQuoteFieldOfferKey(left)) ? 1 : 0) - (alreadyOffered.has(originalQuoteFieldOfferKey(right)) ? 1 : 0)) : fields;
  const unique = ordered.filter((field, index) => ordered.findIndex(other => other.fieldId === field.fieldId) === index);
  const contract: AiTaskInputContractDraft = { draftVersion: AI_TASK_INPUT_DRAFT_VERSION,
    code: unique.length ? 'original_quote_parameters' : 'original_quote_context', version: result.selectionRevision ?? '1',
    fields: unique.length >= 8 ? unique.slice(0, 8) : [...unique, { fieldId: 'clarification_text', kind: 'text', required: unique.length === 0, maxLength: 2048, label: fallbackLabel }] };
  if (!isAiTaskInputContractDraft(contract)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  return contract;
}
