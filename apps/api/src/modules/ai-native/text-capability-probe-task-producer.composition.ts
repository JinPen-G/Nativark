import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/shared';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError, type AiTaskRepository } from './ai-task.repository';
import { AiTaskCreationRepository, type AiTaskCreationAuthority } from './ai-task-creation.repository';
import { textProbeCommandSchema, TEXT_CAPABILITY_PROBE_TOOL } from './text-capability-probe';
import { aiTaskRunnerLimitsSchema } from './runner/prisma-task-run-evidence.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const probeScene = z.literal('ai.capability.text');
const inputRef = id.max(191);
const creationCommand = z.object({ creationKey: id.max(128), inputRef }).strict();
const originalSchema = z.object({
  context: z.unknown(),
  sceneCode: probeScene,
  sceneVersion: id.max(64),
  inputRef,
  inputRevision: z.number().int().positive().max(4294967295),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
  command: textProbeCommandSchema,
  registrationRef: id,
  priceVersion: id.max(64),
  limits: aiTaskRunnerLimitsSchema
}).strict();
type OriginalProbe = z.infer<typeof originalSchema>;

export interface TextCapabilityProbeOriginalInputSource {
  /** Reads the immutable original probe request by its server-created inputRef.
   * The implementation must reauthorize current identity/scope and verify the
   * stored revision/hash before returning. No caller/model fields are trusted. */
  read(inputRef: string): Promise<OriginalProbe>;
}

export type TextCapabilityProbeTaskProducerDependencies = {
  db: Pick<PrismaClient, '$transaction' | 'aiScope' | 'aiTask'>;
  source: TextCapabilityProbeOriginalInputSource;
  clock?: () => Date;
};

const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

/** Creates or reads the only persisted task/run for an immutable text-probe
 * request. The source is deliberately injected: this composition does not
 * seed policy, invent a platform identity, store a command in process memory,
 * or create a second task state machine. */
export function composeTextCapabilityProbeTaskProducer(input: TextCapabilityProbeTaskProducerDependencies) {
  if (typeof input?.source?.read !== 'function') throw unavailable();
  const source = {
    async read(ref: string) {
      const parsedRef = inputRef.safeParse(ref);
      if (!parsedRef.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      let first: unknown, second: unknown;
      try { first = await input.source.read(parsedRef.data); second = await input.source.read(parsedRef.data); } catch { throw unavailable(); }
      const parsed = originalSchema.safeParse(structuredClone(first));
      const current = originalSchema.safeParse(structuredClone(second));
      if (!parsed.success || !current.success || parsed.data.inputRef !== parsedRef.data || current.data.inputRef !== parsedRef.data) throw denied();
      if (requestFingerprint(parsed.data) !== requestFingerprint(current.data)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      return parsed.data;
    }
  };
  const authority: AiTaskCreationAuthority = {
    async resolve(sceneCode, ref) {
      if (sceneCode !== probeScene.value) throw unavailable();
      const original = await source.read(ref);
      const context = original.context as AiExecutionContext;
      return { context, creationAllowed: true as const, sceneCode: original.sceneCode,
        sceneVersion: original.sceneVersion, inputRef: original.inputRef,
        inputRevision: original.inputRevision, inputHash: original.inputHash };
    }
  };
  const creation = new AiTaskCreationRepository(input.db, authority, input.clock);
  const task = async (ref: string, result: { taskId: string; runId: string }) => {
    const original = await source.read(ref);
    return { ...result, registrationRef: original.registrationRef, command: structuredClone(original.command),
      priceVersion: original.priceVersion, limits: structuredClone(original.limits), toolCode: TEXT_CAPABILITY_PROBE_TOOL };
  };
  return Object.freeze({
    async create(value: unknown) {
      const parsed = creationCommand.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const result = await creation.create({ ...parsed.data, sceneCode: probeScene.value });
      return task(parsed.data.inputRef, result);
    },
    async readCreation(value: unknown) {
      const parsed = creationCommand.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const result = await creation.readCreation({ ...parsed.data, sceneCode: probeScene.value });
      if (!result.task) return result;
      return { ...result, task: await task(parsed.data.inputRef, result.task) };
    },
    creation
  });
}
