/** Standard original-scene counting host. Only explicit server configuration
 * enables counting/publication; history keeps its original current read policy.
 * Construction reads no credentials, seeds no budget and starts no transport. */
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { SecretBox } from '../../../common/secret-box';
import type { PrismaClient } from '@prisma/client';
import { BudgetError } from '../budget/budget.ports';
import { GatewayPricingRequestFactory } from '../budget/gateway-pricing-request.composition';
import { InputCountingRequestFactory, type InputCountingRequestDependencies } from './input-counting-request.factory';

export const AI_NATIVE_INPUT_COUNTING_CONFIGURATION = Symbol('AI_NATIVE_INPUT_COUNTING_CONFIGURATION');
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u);
const configurationSchema = z.discriminatedUnion('enabled', [z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), sceneCode: z.enum(['order_explanation', 'opening_diagnosis', 'quote_clarification']),
    sceneMaxOutputTokens: z.number().int().min(1).max(32768), countingPriceVersion: identifier,
    platformProfileId: identifier.max(36), timeoutMs: z.number().int().min(1000).max(30000) }).strict()]);
type Dependencies = Pick<InputCountingRequestDependencies, 'auth' | 'guard' | 'subscriptions' | 'clock'> & {
  db: PrismaClient; secrets: SecretBox;
};

export function composeStandardInputCounting(input: Dependencies, value?: unknown): Pick<InputCountingRequestFactory, 'call'> {
  let configuration: z.infer<typeof configurationSchema>;
  try { configuration = configurationSchema.parse(structuredClone(value ?? { enabled: false })); }
  catch { throw new BudgetError('UNAVAILABLE'); }
  const { db, auth, guard, subscriptions, clock } = input;
  const reads = new InputCountingRequestFactory({ db, auth, guard, subscriptions, clock });
  const pricing = GatewayPricingRequestFactory.history({ db, auth, guard, subscriptions, clock });
  const writes = configuration.enabled ? new InputCountingRequestFactory({ db, auth, guard, subscriptions, clock,
    connectionConfiguration: { db, secrets: input.secrets, platformProfileId: configuration.platformProfileId },
    configuration: { sceneCode: configuration.sceneCode, sceneMaxOutputTokens: configuration.sceneMaxOutputTokens,
      countingPriceVersion: configuration.countingPriceVersion, timeoutMs: configuration.timeoutMs,
      // Match the standard original-scene native adapter registration exactly.
      toolPolicy: configuration.sceneCode === 'order_explanation'
        ? { orderExplainTool: { name: 'rental_order_explain', version: AI_TOOL_DRAFT_VERSION } } : {} }
  }) : undefined;
  return Object.freeze({ call: (request, action, command, signal) => {
    if (action === 'count' || action === 'publishInputBound') {
      if (!writes) return Promise.reject(new BudgetError('UNAVAILABLE'));
      return writes.call(request, action, command, signal);
    }
    if (action === 'readInputBound' || action === 'readPublication') return pricing.call(request, action, command, signal);
    return reads.call(request, action, command, signal);
  } });
}
