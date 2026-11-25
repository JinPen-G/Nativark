/** Closed transport validation around the original operator policy services.
 * Auth/Guard owns scope and scene; this only binds the response to the command.
 * A damaged write response is unknown, never evidence of rollback or retry. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_CLIENT_POLICY_HTTP_CONTRACTS, AI_CLIENT_POLICY_HTTP_SCHEMAS,
  type AiClientPolicyHttpRequestsDraft, type AiClientPolicyHttpResponsesDraft,
  type AiClientPolicyChangeDraft, type AiClientModelPlanChangeDraft } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { InspectionAssistError } from '../inspection-assist/inspection-assist.validation';

type Action = keyof typeof AI_CLIENT_POLICY_HTTP_CONTRACTS;
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
// Local component references remain identical in the public schema and OpenAPI.
for (const [name, schema] of Object.entries(AI_CLIENT_POLICY_HTTP_SCHEMAS))
  ajv.addSchema(schema, `#/components/schemas/${name}`);
const contracts = Object.fromEntries(Object.entries(AI_CLIENT_POLICY_HTTP_CONTRACTS).map(([action, names]) => [action, {
  request: ajv.getSchema(`#/components/schemas/${names.request}`)!,
  response: ajv.getSchema(`#/components/schemas/${names.response}`)!,
}]));
export function clientPolicyRequest<A extends Action>(action: A, value: unknown): AiClientPolicyHttpRequestsDraft[A] {
  try {
    const copy = structuredClone(value);
    if (!contracts[action].request(copy)) throw Error();
    if (action === 'changeModelPlan') {
      const plan = copy as AiClientModelPlanChangeDraft;
      if (plan.limits.maxStepMs > plan.limits.maxTotalMs) throw Error();
    }
    return copy as AiClientPolicyHttpRequestsDraft[A];
  } catch { throw new AiTaskRepositoryError('AI_INVALID_INPUT'); }
}
export function clientPolicyResponse<A extends Action>(action: A, value: unknown,
  command: AiClientPolicyHttpRequestsDraft[A]): AiClientPolicyHttpResponsesDraft[A] {
  try {
    const copy = structuredClone(value) as AiClientPolicyHttpResponsesDraft[Action];
    if (!contracts[action].response(copy) || Buffer.byteLength(JSON.stringify(copy), 'utf8') > 131072) throw Error();
    if ('operationKey' in copy && (!('operationKey' in command) || copy.operationKey !== command.operationKey)) throw Error();
    const policy = 'policy' in copy ? copy.policy : 'result' in copy ? copy.result : null;
    if (policy && (!('channel' in command) || policy.channel !== command.channel || policy.customerType !== command.customerType)) throw Error();
    if (action === 'change' && policy) {
      const expected = command as AiClientPolicyChangeDraft;
      if (policy.revision !== expected.expectedRevision + 1 || Date.parse(policy.expiresAt) !== Date.parse(expected.expiresAt)
        || policy.enabled !== expected.enabled || policy.allowCreate !== expected.allowCreate
        || policy.allowRead !== expected.allowRead || policy.allowExecute !== expected.allowExecute) throw Error();
      // Legacy commands omit these flags. The original producer defaults them;
      // do not insert defaults into the command or change its idempotency hash.
      for (const flag of ['allowRequestInput', 'allowSubmitInput', 'allowResumeInput', 'allowCancel'] as const)
        if (policy[flag] !== (expected[flag] ?? false)) throw Error();
    }
    if ('limits' in copy) {
      if (copy.limits.maxStepMs > copy.limits.maxTotalMs) throw Error();
      if (action === 'changeModelPlan') {
        const expected = command as AiClientModelPlanChangeDraft;
        if (copy.revision !== (expected.expectedRevision ?? 0) + 1 || copy.enabled !== expected.enabled
          || Date.parse(copy.expiresAt) !== Date.parse(expected.expiresAt)
          || Object.entries(expected.limits).some(([key, value]) => copy.limits[key as keyof typeof copy.limits] !== value)) throw Error();
      }
    }
    return copy as AiClientPolicyHttpResponsesDraft[A];
  } catch {
    if (AI_CLIENT_POLICY_HTTP_CONTRACTS[action].write) throw new InspectionAssistError('RECONCILIATION_REQUIRED');
    throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
  }
}
