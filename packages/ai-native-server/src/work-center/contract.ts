/** HTTP and MCP read the same closed public result schemas. The validators
 * accept locators only; no actor, scope, prompt or provider is caller supplied. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_PUBLIC_WORK_CENTER_OPERATIONS, AI_PUBLIC_WORK_CENTER_SCHEMAS, type AiPublicWorkCenterOperation } from '@rental-os/platform-contracts/ai-work-center';
import { AiTaskRepositoryError } from '../task-errors';
import { WorkCenterUnknownError } from './scene';

const prefix = 'urn:zelo:public-work-center:';
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
for (const [name, schema] of Object.entries(AI_PUBLIC_WORK_CENTER_SCHEMAS))
  ajv.addSchema(JSON.parse(JSON.stringify(schema).replaceAll('#/components/schemas/', prefix)), prefix + name);

const methods = Object.keys(AI_PUBLIC_WORK_CENTER_OPERATIONS) as AiPublicWorkCenterOperation[];
const validation = new Map(methods.map(action => {
  const [, , request, response, write] = AI_PUBLIC_WORK_CENTER_OPERATIONS[action];
  const input = ajv.getSchema(prefix + request), output = ajv.getSchema(prefix + response);
  if (!input || !output) throw Error('Public work-center operation is missing its contract');
  return [action, { input, output, write }] as const;
}));

export function workCenterInput(action: AiPublicWorkCenterOperation, value: unknown): unknown {
  const contract = validation.get(action);
  try {
    const snapshot = structuredClone(value);
    if (contract && Buffer.byteLength(JSON.stringify(snapshot) ?? '') <= 32768 && contract.input(snapshot)) return snapshot;
  } catch { /* No rejected request or nested value is reflected to the caller. */ }
  throw new AiTaskRepositoryError('AI_INVALID_INPUT');
}

export function workCenterOutput(action: AiPublicWorkCenterOperation, value: unknown) {
  const contract = validation.get(action);
  if (contract?.output(value)) return value;
  if (contract?.write) throw new WorkCenterUnknownError();
  throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
}
