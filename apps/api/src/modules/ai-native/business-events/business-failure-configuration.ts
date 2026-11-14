/** Current server capture publication. No HTTP input, default near window,
 * automation grant or model execution is inferred from this configuration. */
import type { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { readRuntimePublication } from '../runtime-publication.configuration';
import { coreFulfillmentNearPolicySchema, type CoreFulfillmentNearPolicySource } from './core-business-failure-resource.source';

const configurationSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), automation: z.union([
    z.object({ policyId: z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict(),
    z.object({ selection: z.literal('current_workspace') }).strict()
  ]).optional(),
    fulfillmentNear: coreFulfillmentNearPolicySchema.optional() }).strict()
]);

export function readFailureConfiguration(value: unknown) {
  const parsed = configurationSchema.safeParse(structuredClone(value ?? { enabled: false }));
  if (!parsed.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  return parsed.data;
}

export class RuntimeBusinessFailureConfigurationSource implements CoreFulfillmentNearPolicySource {
  constructor(private readonly source: Pick<ConfigService, 'get'>) {}

  current() {
    return readFailureConfiguration(readRuntimePublication(this.source).configurations.businessFailure);
  }

  /** The original resource reader validates this publication's scope, revision
   * and current window on both sides of its Core observations. */
  async read(): Promise<unknown> {
    const current = this.current();
    return current.enabled ? current.fulfillmentNear ?? { enabled: false } : { enabled: false };
  }
}
