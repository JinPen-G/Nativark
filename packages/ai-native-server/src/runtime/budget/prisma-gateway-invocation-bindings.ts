/** Rental and existing platform probes keep their original frozen-material and
 * media checks. The shared store owns all Invocation writes and recovery. */
import { withAiTaskTransaction } from '../task-transaction-authority';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/platform-contracts/ai-task';
import { prepareGatewayTextIntent } from '../gateway-intent';
import { TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL, parseTaskModelInput, taskModelFingerprint, taskModelIdentity, taskModelPolicy, type TaskModelPolicy } from '../model-input/task-model-input';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { BudgetError } from './budget.ports';
import { textProbeCommandSchema, textProbeIntent, textProbeCapability, textProbeMode, TEXT_CAPABILITY_PROBE_TOOL, TEXT_PROBE_SCENE } from '../text-capability-probe';
import { capabilityProfileFingerprint } from '../capability-verification';
import { PrismaProviderProfileRepository } from '../provider-profile.repository';
import type { AiStep } from '@prisma/client';
import { GatewayInvocationStore, type GatewayInvocationChecks, type GatewayInvocationReader } from './prisma-gateway-invocation.store';
export type { RegisterGatewayInvocation } from './prisma-gateway-invocation.store';

async function probeInput(db: GatewayInvocationReader, step: AiStep, clock: () => Date) {
  if (step.toolCode !== TEXT_CAPABILITY_PROBE_TOOL || step.toolVersion !== AI_TOOL_DRAFT_VERSION || !step.inputRef
    || typeof db.aiTaskActionInput?.findFirst !== 'function') throw new BudgetError('FORBIDDEN');
  const saved = await db.aiTaskActionInput.findFirst({ where: { id: step.inputRef, scopeId: step.scopeId,
    taskId: step.taskId, runId: step.runId, toolCode: step.toolCode, toolVersion: step.toolVersion } });
  const command = textProbeCommandSchema.safeParse(saved?.payload);
  if (!saved || !command.success || saved.id !== step.inputRef || saved.scopeId !== step.scopeId
    || saved.taskId !== step.taskId || saved.runId !== step.runId || saved.toolCode !== step.toolCode
    || saved.toolVersion !== step.toolVersion || saved.fingerprint !== step.requestFingerprint
    || requestFingerprint(command.data) !== step.requestFingerprint || !(saved.expiresAt instanceof Date)
    || !Number.isFinite(saved.expiresAt.getTime()) || saved.expiresAt <= clock()) throw new BudgetError('FORBIDDEN');
  return { command: command.data, prepared: textProbeIntent(command.data.operationId, step.scopeId, textProbeCapability(command.data)) };
}

function checks(clock: () => Date, modelPolicy?: TaskModelPolicy): GatewayInvocationChecks {
  const policy = modelPolicy && taskModelPolicy(modelPolicy);
  return {
    async prepare(tx, step, context, input) {
      const hasMedia = input.intent.messages.some(message => message.content.some(part => part.kind !== 'text'));
      let intentHash: string;
      if (step.toolCode === TEXT_CAPABILITY_PROBE_TOOL) {
        const frozen = await probeInput(tx, step, clock);
        if (input.mode !== textProbeMode(frozen.command)
          || requestFingerprint(input.intent) !== requestFingerprint(frozen.prepared.intent)) throw new BudgetError('FORBIDDEN');
        intentHash = frozen.prepared.intentHash;
      } else if (step.toolCode === TASK_TEXT_MODEL_TOOL && policy) {
        // Explicit server scene policy, not a flag inferred from Agent input.
        // Original publication/plan permission remains the execution gate.
        // A server-registered native result selector is not media. The closed
        // parser below validates its frozen selector contract and features;
        // even a native policy cannot admit images/audio on this text step.
        if (hasMedia && policy.nativeToolResults !== true
          || !step.inputRef || input.mode !== 'invoke' || !tx.aiTaskActionInput) throw new BudgetError('FORBIDDEN');
        const saved = await tx.aiTaskActionInput.findFirst({ where: { id: step.inputRef, scopeId: step.scopeId,
          taskId: step.taskId, runId: step.runId, toolCode: step.toolCode, toolVersion: step.toolVersion,
          fingerprint: step.requestFingerprint } });
        if (!saved || saved.id !== step.inputRef || saved.scopeId !== step.scopeId || saved.taskId !== step.taskId
          || saved.runId !== step.runId || saved.toolCode !== step.toolCode || saved.toolVersion !== step.toolVersion
          || saved.fingerprint !== step.requestFingerprint || saved.expiresAt <= clock()) throw new BudgetError('FORBIDDEN');
        const frozen = parseTaskModelInput(saved.payload, policy);
        // A matching frozen hash certifies contents, not another task/run's
        // authority. Reject foreign selectors before CAS locks or INSERT.
        for (const message of frozen.intent.messages) for (const part of message.content) {
          if (part.kind === 'tool_result_reference' && (part.reference.taskId !== step.taskId
            || part.reference.runId !== step.runId)) throw new BudgetError('FORBIDDEN');
        }
        if (frozen.identityHash !== taskModelIdentity(context)
          || requestFingerprint(frozen.intent) !== requestFingerprint(input.intent)
          || requestFingerprint(frozen.configuration) !== requestFingerprint(input.configuration)
          || frozen.priceVersion !== input.priceVersion) throw new BudgetError('FORBIDDEN');
        intentHash = taskModelFingerprint(frozen, policy);
      } else if (hasMedia) {
        if (![TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL].includes(step.toolCode as typeof TASK_IMAGE_MODEL_TOOL | typeof TASK_AUDIO_MODEL_TOOL) || !step.inputRef || input.mode !== 'invoke'
          || typeof tx.aiTaskActionInput?.findFirst !== 'function') throw new BudgetError('FORBIDDEN');
        const mediaTool = step.toolCode === TASK_AUDIO_MODEL_TOOL ? TASK_AUDIO_MODEL_TOOL : TASK_IMAGE_MODEL_TOOL;
        const saved = await tx.aiTaskActionInput.findFirst({ where: { id: step.inputRef, scopeId: step.scopeId,
          taskId: step.taskId, runId: step.runId, toolCode: mediaTool, fingerprint: step.requestFingerprint } });
        if (!saved || saved.expiresAt <= clock()) throw new BudgetError('FORBIDDEN');
        const policy = { sceneCode: input.intent.sceneCode, maxOutputTokens: input.intent.maxOutputTokens,
          kind: mediaTool === TASK_AUDIO_MODEL_TOOL ? 'audio' as const : 'image' as const };
        const frozen = parseTaskModelInput(saved.payload, policy);
        if (frozen.identityHash !== taskModelIdentity(context)
          || requestFingerprint(frozen.intent) !== requestFingerprint(input.intent)
          || requestFingerprint(frozen.configuration) !== requestFingerprint(input.configuration)
          || frozen.priceVersion !== input.priceVersion) throw new BudgetError('FORBIDDEN');
        intentHash = taskModelFingerprint(frozen, policy);
      } else {
        intentHash = prepareGatewayTextIntent(input.intent, { sceneCode: input.intent.sceneCode,
          maxOutputTokens: input.intent.maxOutputTokens }, input.mode).intentHash;
      }
      return intentHash;
    },
    async verify(db, step, row, audience) {
      if (step.toolCode === TEXT_CAPABILITY_PROBE_TOOL) {
        if (audience === 'client') throw new BudgetError('FORBIDDEN');
        const frozen = await probeInput(db, step, clock);
        if (row.sceneCode !== TEXT_PROBE_SCENE || row.intentHash !== frozen.prepared.intentHash) throw new BudgetError('FORBIDDEN');
      } else if (step.requestFingerprint !== row.intentHash) throw new BudgetError('FORBIDDEN');
    },
    async profile(tx, step, input, profile) {
      if (step.toolCode === TEXT_CAPABILITY_PROBE_TOOL) {
        const frozen = await probeInput(tx, step, clock);
        if (input.mode !== textProbeMode(frozen.command)
          || requestFingerprint(input.intent) !== requestFingerprint(frozen.prepared.intent)) throw new BudgetError('FORBIDDEN');
        const originalProfile = await new PrismaProviderProfileRepository(tx).get({ id: profile.scopeId,
          kind: profile.scopeKind as 'PLATFORM' | 'TENANT' | 'WORKSPACE' }, frozen.command.profileKey);
        if (!originalProfile || originalProfile.id !== input.configuration.configId
          || capabilityProfileFingerprint(originalProfile) !== frozen.command.profileFingerprint) throw new BudgetError('FORBIDDEN');
      }
    }
  };
}

export class PrismaGatewayInvocationBindings extends GatewayInvocationStore {
  constructor(db: ConstructorParameters<typeof GatewayInvocationStore>[0], scopes: ConstructorParameters<typeof GatewayInvocationStore>[1],
    clock: () => Date = () => new Date(), modelPolicy?: TaskModelPolicy) {
    super(db, scopes, clock, { withAiTaskTransaction }, checks(clock, modelPolicy));
  }
}
