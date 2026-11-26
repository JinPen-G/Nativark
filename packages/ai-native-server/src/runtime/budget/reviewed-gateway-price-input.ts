import { z } from 'zod';
import { gatewayPriceBillingSchema } from './gateway-pricing-evidence';

const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
export const reviewedGatewayPriceInput = z.object({ sceneCode: key, operationKey: key, configId: key.max(36),
  expectedConfigRevision: z.number().int().min(1).max(4294967295), priceVersion: key.max(64),
  validFrom: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }),
  billing: gatewayPriceBillingSchema, confirmReviewedRate: z.literal(true) }).strict();
export const reviewedGatewayPriceReadInput = z.object({ sceneCode: key, operationKey: key }).strict();
