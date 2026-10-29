/** Original policy transport only. Snapshot before dependency calls and bind the
 * result to the original command; current Auth/Guard and repositories still own
 * permission, CAS and storage. Damaged writes stay unknown, never safe retries. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_ORIGINAL_POLICY_HTTP_CONTRACTS, AI_ORIGINAL_POLICY_HTTP_SCHEMAS, AI_SCENE_REQUEST_DRAFT_SCHEMAS,
  type AiOriginalPolicyHttpRequestsDraft, type AiOriginalPolicyHttpResponsesDraft } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiOriginalRequestResultUnknownError } from '../task-request/prisma-original-request.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

type Action = keyof typeof AI_ORIGINAL_POLICY_HTTP_CONTRACTS;
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
for (const [name, schema] of Object.entries({ ...AI_ORIGINAL_POLICY_HTTP_SCHEMAS,
  AiSceneRequestReadDraft: AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReadDraft })) ajv.addSchema(schema, `#/components/schemas/${name}`);
const same = (left: unknown, right: unknown) => requestFingerprint(left) === requestFingerprint(right);
export function originalPolicyRequest<A extends Action>(action: A, value: unknown): AiOriginalPolicyHttpRequestsDraft[A] {
  try {
    const copy = structuredClone(value) as AiOriginalPolicyHttpRequestsDraft[Action];
    if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > 32768
      || !ajv.getSchema(`#/components/schemas/${AI_ORIGINAL_POLICY_HTTP_CONTRACTS[action].request}`)!(copy)) throw Error();
    if ('change' in copy && copy.change.limits.maxStepMs > copy.change.limits.maxTotalMs) throw Error();
    return copy as AiOriginalPolicyHttpRequestsDraft[A];
  } catch { throw new AiTaskRepositoryError('AI_INVALID_INPUT'); }
}
export function originalPolicyResponse<A extends Action>(action: A, value: unknown,
  command: AiOriginalPolicyHttpRequestsDraft[A]): AiOriginalPolicyHttpResponsesDraft[A] {
  try {
    const copy = structuredClone(value) as AiOriginalPolicyHttpResponsesDraft[Action];
    if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > 131072
      || !ajv.getSchema(`#/components/schemas/${AI_ORIGINAL_POLICY_HTTP_CONTRACTS[action].response}`)!(copy)) throw Error();
    if ('original' in copy) {
      if (!('original' in command) || !same(copy.original, command.original)) throw Error();
      if (copy.policy && (!('operation' in command) || copy.policy.operation !== command.operation)) throw Error();
      if (action !== 'taskRead') {
        if (!copy.policy || !('expectedRevision' in command)
          || copy.policy.revision !== (command.expectedRevision ?? 0) + 1) throw Error();
      }
    } else {
      if (!('sceneCode' in command) || copy.sceneCode !== command.sceneCode) throw Error();
      if ('limits' in copy) {
        if (copy.limits.maxStepMs > copy.limits.maxTotalMs) throw Error();
        if ('change' in command && (copy.revision !== (command.change.expectedRevision ?? 0) + 1
          || copy.enabled !== command.change.enabled || Date.parse(copy.expiresAt) !== Date.parse(command.change.expiresAt)
          || !same(copy.limits, command.change.limits))) throw Error();
      }
    }
    return copy as AiOriginalPolicyHttpResponsesDraft[A];
  } catch {
    if (AI_ORIGINAL_POLICY_HTTP_CONTRACTS[action].write) throw new AiOriginalRequestResultUnknownError();
    throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
  }
}
