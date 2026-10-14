import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { composePersistedTaskCenter } from '../task-center.composition';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import { composeRequestBoundSettingsTaskCreation, type AiSceneHttpRequest,
  type AiSceneRequestOptions } from './request-bound-scenes.application';

const key = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const reference = z.object({ creationKey: key, changeKey: key }).strict();
const events = reference.extend({ after: z.string().regex(/^(0|[1-9][0-9]{0,19})$/u),
  limit: z.number().int().min(1).max(100) }).strict();
const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);

/** Original owner reference -> existing persistent snapshot/event readers.
 * No current plan, Gateway, admission, lease or execution driver is constructed.
 * Each request must still pass current original-change AND task action access. */
export function composeRequestBoundSettingsTaskReads(
  dependencies: Parameters<typeof composeRequestBoundSettingsTaskCreation>[0], options: AiSceneRequestOptions) {
  const selected = z.object({ enabled: z.boolean(), audience: z.literal('operator') }).strict().safeParse(structuredClone(options));
  if (!selected.success || 'credentials' in dependencies) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const server = { ...dependencies, scene: freezeOriginalInput(structuredClone(dependencies.scene)) };
  const creation = selected.data.enabled ? composeRequestBoundSettingsTaskCreation(server, selected.data) : undefined;
  const clock = dependencies.clock ?? (() => new Date());
  const consume = async <T>(request: AiSceneHttpRequest, original: z.infer<typeof reference>,
    read: (center: ReturnType<typeof composePersistedTaskCenter>, taskId: string) => Promise<T>) => {
    if (!creation) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const authorization = bearer.safeParse(request?.headers?.authorization);
    if (!authorization.success) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const boundRequest = { headers: { authorization: authorization.data } };
    const credential = Object.freeze({ authorization: authorization.data, audience: 'operator' as const, requestId: randomUUID() });
    let active = true;
    const credentials = { current: async () => {
      if (!active) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return { ...credential };
    } };
    try {
      return await runWithRequestIdentity({}, async () => {
        const identity = new AiTaskCurrentIdentityAuthority(server.auth, credentials, clock);
        const before = await identity.resolve();
        const initial = structuredClone(await creation.read(boundRequest, original));
        if (!('state' in initial.receipt)) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        if (initial.receipt.state === 'unknown') throw Object.assign(new Error('AI_RESULT_UNKNOWN'), { code: 'AI_RESULT_UNKNOWN' });
        if (initial.receipt.state !== 'observed' || !initial.receipt.task) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const center = composePersistedTaskCenter({ db: server.db, auth: server.auth, credentials, clock });
        const result = structuredClone(await read(center, initial.receipt.task.taskId));
        const latest = await creation.read(boundRequest, original);
        const after = await identity.resolve();
        if (originalIdentityHash(before) !== originalIdentityHash(after)
          || !('state' in latest.receipt) || latest.receipt.state !== 'observed' || !latest.receipt.task
          || latest.receipt.task.taskId !== initial.receipt.task.taskId || latest.receipt.task.runId !== initial.receipt.task.runId
          || latest.original.changeId !== initial.original.changeId || latest.original.changeHash !== initial.original.changeHash) {
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        }
        // Legitimate concurrent task transitions do not invalidate an already
        // consistent repository snapshot. Its exact watermark remains intact.
        return freezeOriginalInput(result);
      });
    } finally { active = false; }
  };
  return Object.freeze({
    readSnapshot(request: AiSceneHttpRequest, value: unknown) {
      const parsed = reference.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return consume(request, freezeOriginalInput(parsed.data), (center, taskId) => center.events.readSnapshot({ taskId }));
    },
    readEvents(request: AiSceneHttpRequest, value: unknown) {
      const parsed = events.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const command = freezeOriginalInput(parsed.data);
      return consume(request, { creationKey: command.creationKey, changeKey: command.changeKey },
        (center, taskId) => center.events.readPage({ taskId, after: command.after, limit: command.limit }));
    }
  });
}
