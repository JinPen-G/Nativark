/** Standard operator read-only host over the original task center. Current
 * Auth/owner/action policies are mandatory; no Gateway, runner or quota writes. */
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { AI_TASK_CENTER_HTTP_DRAFT, AI_TASK_CENTER_ENTRY_PERMISSIONS, AI_TASK_STATUSES_DRAFT } from '@rental-os/shared';
import { runWithRequestIdentity } from '../../common/request-identity';
import { AiTaskRepositoryError } from './ai-task.repository';
import { composePersistedTaskCenter } from './task-center.composition';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { originalIdentityHash } from './task-request/original-request.authority';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { withRequestAbort } from './scenes/request-abort';
import { respondAiScene } from './scenes/original-scenes.controller';

export const AI_NATIVE_TASK_CENTER_REQUESTS = Symbol('AI_NATIVE_TASK_CENTER_REQUESTS');
type Request = { headers: { authorization?: unknown } } & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
type Dependencies = Omit<Parameters<typeof composePersistedTaskCenter>[0], 'credentials' | 'usageDb' | 'performanceDb'>;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const schemas = {
  list: z.object({ limit: z.number().int().min(1).max(50).optional(), cursor: z.string().max(512).optional(),
    status: z.enum(AI_TASK_STATUSES_DRAFT).optional(), sceneCode: id.optional() }).strict(),
  snapshot: z.object({ taskId: id }).strict(),
  events: z.object({ taskId: id, after: z.string().max(20).regex(/^(0|[1-9][0-9]*)$/u), limit: z.number().int().min(1).max(100) }).strict()
};

export function composeRequestBoundTaskCenter(input: Dependencies) {
  const call = async (request: Request, value: unknown, action: keyof typeof schemas, signal?: AbortSignal) => {
    const header = z.string().max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u).safeParse(request?.headers?.authorization);
    if (!header.success) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    let command: unknown;
    try { command = structuredClone(value); if (Buffer.byteLength(JSON.stringify(command) ?? '', 'utf8') > 8192) throw Error(); }
    catch { throw new AiTaskRepositoryError('AI_INVALID_INPUT'); }
    if (!schemas[action].safeParse(command).success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const requestId = randomUUID();
    let active = true;
    const close = () => { active = false; };
    const credentials = { current: async () => {
      if (!active) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return { authorization: header.data, requestId, audience: 'operator' as const };
    } };
    signal?.addEventListener('abort', close, { once: true });
    if (signal?.aborted) close();
    try {
      return await waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
        const identity = new AiTaskCurrentIdentityAuthority(input.auth, credentials, input.clock);
        const before = await identity.resolve();
        if (before.audience !== 'operator' || !('access' in before)
          || !AI_TASK_CENTER_ENTRY_PERMISSIONS.some(permission => before.access.permissions.includes(permission)))
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const root = composePersistedTaskCenter({ ...input, credentials });
        const result = action === 'list' ? await root.list.readPage(command) : action === 'snapshot'
          ? await root.events.readSnapshot(command) : await root.events.readPage(command);
        if (!active || originalIdentityHash(await identity.resolve()) !== originalIdentityHash(before))
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return structuredClone(result);
      }), false, signal);
    } finally { close(); signal?.removeEventListener('abort', close); }
  };
  return Object.freeze({ list: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'list', signal),
    snapshot: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'snapshot', signal),
    events: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'events', signal) });
}

@Controller(AI_TASK_CENTER_HTTP_DRAFT.basePath)
export class AiTaskCenterController {
  constructor(@Inject(AI_NATIVE_TASK_CENTER_REQUESTS) private readonly center: ReturnType<typeof composeRequestBoundTaskCenter>) {}
  private respond(request: Request, value: unknown, action: 'list' | 'snapshot' | 'events') {
    return respondAiScene(() => withRequestAbort(request, signal => this.center[action](request, value, signal)));
  }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.list) @HttpCode(200) @Header('Cache-Control', 'no-store')
  list(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'list'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.snapshot) @HttpCode(200) @Header('Cache-Control', 'no-store')
  snapshot(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'snapshot'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.events) @HttpCode(200) @Header('Cache-Control', 'no-store')
  events(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'events'); }
}
