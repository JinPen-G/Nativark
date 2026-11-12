/** Frozen display purpose and source provenance, never display admission.
 * The witness is stored before plan publication and its marker participates in
 * the original Gateway intent hash. Ordinary results cannot be signed later. */
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { AiWorkbenchContextDraft, AiWorkbenchFieldMaterialDraft, AiWorkbenchMaterialBindingDraft } from '@rental-os/shared';
import { inspectAiWorkbenchContext, inspectAiWorkbenchFieldMaterial } from '../workbench-display.contract';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const time = z.string().max(40).datetime({ offset: true });
export const TASK_MODEL_DISPLAY_WITNESS_MARKER = 'rental-os:workbench-display-witness:';
const FIELD_CONTRACT_MARKER = 'rental-os:workbench-field-contract:';
export const taskModelDisplayWitnessSchema = z.object({
  version: z.literal('ain-workbench-generation-witness-1'), purpose: z.literal('display'),
  binding: z.custom<AiWorkbenchMaterialBindingDraft>(),
  context: z.custom<AiWorkbenchContextDraft>(),
  fieldMaterial: z.custom<AiWorkbenchFieldMaterialDraft>().nullable(),
  presentationRevision: z.number().int().min(1).max(4294967294),
  prompt: z.object({ referenceId: id, version: id, sha256: hash }).strict(),
  displayApiVersion: id, isolationVersion: z.literal('opaque-html-static-1'),
  sourceExpiresAt: time, aclRevision: id, policyVersion: id,
}).strict().superRefine((value, issue) => {
  try {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 65536) throw Error();
    const context = value.context, sourceExpiry = Date.parse(value.sourceExpiresAt);
    // Parsing retained input is structural, not a renewal of its lifetime.
    // Mount/read authorities enforce current time and recheck every source.
    const immediatelyBeforeExpiry = new Date(sourceExpiry - 1).toISOString();
    inspectAiWorkbenchContext(context, context, immediatelyBeforeExpiry);
    if (context.purpose !== 'display' || context.authority !== 'none_reauthorize_before_consumption'
      || requestFingerprint(context.binding) !== requestFingerprint(value.binding)
      || context.history.aclRevision !== value.aclRevision || context.history.policyVersion !== value.policyVersion
      || sourceExpiry > Date.parse(context.history.expiresAt)
      || context.capability.prompt.status !== 'recorded'
      || context.capability.prompt.source !== 'original_registered_plan'
      || context.capability.prompt.referenceId !== value.prompt.referenceId
      || context.capability.prompt.version !== value.prompt.version
      || context.capability.prompt.sha256 !== value.prompt.sha256) throw Error();
    if (value.fieldMaterial !== null) {
      const fields = value.fieldMaterial;
      inspectAiWorkbenchFieldMaterial(fields, fields, immediatelyBeforeExpiry);
      if (requestFingerprint(fields.binding) !== requestFingerprint(value.binding)
        || fields.retention.aclRevision !== value.aclRevision || fields.retention.policyVersion !== value.policyVersion
        || sourceExpiry > Date.parse(fields.retention.expiresAt)) throw Error();
    }
  } catch { issue.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid original display witness' }); }
});
export type TaskModelDisplayWitness = z.infer<typeof taskModelDisplayWitnessSchema>;
export function parseTaskModelDisplayWitness(value: unknown): TaskModelDisplayWitness {
  return taskModelDisplayWitnessSchema.parse(structuredClone(value));
}
export const taskModelDisplayWitnessMarker = (value: TaskModelDisplayWitness) =>
  `${TASK_MODEL_DISPLAY_WITNESS_MARKER}${requestFingerprint(parseTaskModelDisplayWitness(value))}`;

/** Only the safe original field projection reaches the model. Identity,
 * configuration bodies and source credentials stay outside this contract. */
export function taskModelDisplayFieldContract(value: TaskModelDisplayWitness): string | null {
  const fields = parseTaskModelDisplayWitness(value).fieldMaterial;
  if (!fields) return null;
  return `${FIELD_CONTRACT_MARKER}${JSON.stringify({ fieldRevision: fields.fieldRevision,
    contract: fields.contract, fields: fields.fields.map(({ fieldId, editable, defaultValue }) => ({ fieldId, editable, defaultValue })),
    rendering: { bindingAttribute: 'data-field-id', textAndIntegerElement: 'input', choiceElement: 'select',
      instructions: 'Bind each offered control by its exact fieldId. The host supplies labels, bounds and choices. Do not add other fields, submission buttons or human-origin claims.' },
    inputOrigin: 'candidate_not_human_attested' })}`;
}

/** A human-answer successor changes input/material. It cannot inherit the
 * previous display witness or its registered display-only system message. */
export function withoutTaskModelDisplayMessages<T extends { role: string; content: readonly { kind: string; text?: string }[] }>(messages: readonly T[]) {
  return messages.filter(message => !(message.role === 'system' && message.content.some(part =>
    part.kind === 'text' && part.text?.startsWith(TASK_MODEL_DISPLAY_WITNESS_MARKER))));
}

/** The normal intent hash includes these original system parts; the Gateway
 * needs no parallel fingerprint, invocation, accounting or Provider format. */
export function inspectTaskModelDisplayInput(input: {
  displayWitness?: TaskModelDisplayWitness;
  intent: { sceneCode: string; messages: readonly { role: string; content: readonly { kind: string; text?: string }[] }[] };
}) {
  const systemTexts = input.intent.messages.filter(message => message.role === 'system')
    .flatMap(message => message.content.filter(part => part.kind === 'text').map(part => part.text ?? ''));
  const markers = systemTexts.filter(text => text.startsWith(TASK_MODEL_DISPLAY_WITNESS_MARKER));
  const fieldContracts = systemTexts.filter(text => text.startsWith(FIELD_CONTRACT_MARKER));
  if (!input.displayWitness) {
    if (markers.length || fieldContracts.length) throw Error('Display marker has no frozen witness');
    return;
  }
  const witness = parseTaskModelDisplayWitness(input.displayWitness);
  const fields = taskModelDisplayFieldContract(witness);
  if (witness.binding.capabilityCode !== input.intent.sceneCode || markers.length !== 1
    || markers[0] !== taskModelDisplayWitnessMarker(witness)
    || (fields === null ? fieldContracts.length !== 0 : fieldContracts.length !== 1 || fieldContracts[0] !== fields)
    || systemTexts.filter(text => createHash('sha256').update(text, 'utf8').digest('hex') === witness.prompt.sha256).length !== 1)
    throw Error('Display witness does not bind the original intent');
}
