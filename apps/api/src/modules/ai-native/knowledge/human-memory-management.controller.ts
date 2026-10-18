import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { AI_MEMORY_MANAGEMENT_HTTP_DRAFT as paths, type AiMemoryManagementErrorDraft } from '@rental-os/shared';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { HumanMemoryManagementRequestFactory, type HumanMemoryManagementRequest } from './human-memory-management.composition';
import { KnowledgeError } from './knowledge-errors';
import type { IncomingMessage } from 'node:http';
import { waitForTaskApplicationDependency } from '../runner/prisma-task-application';
import { withRequestAbort } from '../scenes/request-abort';
type Request = { headers: { authorization?: unknown } } & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;

@Controller(paths.basePath)
export class HumanMemoryManagementController {
  constructor(@Inject(HumanMemoryManagementRequestFactory) private readonly requests: HumanMemoryManagementRequestFactory) {}
  private async call<T>(request: Request, value: unknown, write: boolean,
    action: (scoped: HumanMemoryManagementRequest, command: unknown) => Promise<T>): Promise<T> {
    try {
      let command: unknown;
      try {
        command = structuredClone(value);
        if (Buffer.byteLength(JSON.stringify(command) ?? '', 'utf8') > 65536) throw Error();
      } catch { throw new KnowledgeError('invalid_input'); }
      return await withRequestAbort(request, signal => runWithRequestIdentity({}, async () => {
        const scoped = this.requests.open(request);
        const close = () => scoped.close();
        signal.addEventListener('abort', close, { once: true });
        if (signal.aborted) close();
        try { return await waitForTaskApplicationDependency(() => action(scoped, command), write, signal); }
        finally { close(); signal.removeEventListener('abort', close); }
      }));
    } catch (error) {
      const code = error instanceof KnowledgeError ? error.code
        : write && error instanceof Error && 'code' in error && error.code === 'AI_RESULT_UNKNOWN' ? 'result_unknown' : 'unavailable';
      const response: AiMemoryManagementErrorDraft = {
        code: code === 'invalid_input' || code === 'limit_exceeded' ? 'AI_INVALID_INPUT'
          : code === 'conflict' ? 'AI_REVISION_CONFLICT' : code === 'not_ready' ? 'AI_NOT_READY'
            : code === 'result_unknown' ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE',
        retryable: false, nextAction: 'read_original_memory_operation' };
      throw new HttpException(response, response.code === 'AI_INVALID_INPUT' ? 400
        : response.code === 'AI_REVISION_CONFLICT' || response.code === 'AI_NOT_READY' || response.code === 'AI_RESULT_UNKNOWN' ? 409 : 503);
    }
  }
  @Post(paths.list) @HttpCode(200) @Header('Cache-Control', 'no-store')
  list(@Req() request: Request, @Body() value: unknown) { return this.call(request, value, false, (scoped, command) => scoped.list(command)); }
  @Post(paths.state) @HttpCode(200) @Header('Cache-Control', 'no-store')
  state(@Req() request: Request, @Body() value: unknown) { return this.call(request, value, false, (scoped, command) => scoped.state(command)); }
  @Post(paths.read) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: Request, @Body() value: unknown) { return this.call(request, value, false, (scoped, command) => scoped.read(command)); }
  @Post(paths.propose) @HttpCode(200) @Header('Cache-Control', 'no-store')
  propose(@Req() request: Request, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.propose(command)); }
  @Post(paths.confirm) @HttpCode(200) @Header('Cache-Control', 'no-store')
  confirm(@Req() request: Request, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.confirm(command)); }
  @Post(paths.resumeConfirmation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  resumeConfirmation(@Req() request: Request, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.resumeConfirmation(command)); }
  @Post(paths.confirmation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  confirmation(@Req() request: Request, @Body() value: unknown) { return this.call(request, value, false, (scoped, command) => scoped.confirmation(command)); }
  @Post(paths.change) @HttpCode(200) @Header('Cache-Control', 'no-store')
  change(@Req() request: Request, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.change(command)); }
  @Post(paths.changeStatus) @HttpCode(200) @Header('Cache-Control', 'no-store')
  changeStatus(@Req() request: Request, @Body() value: unknown) { return this.call(request, value, false, (scoped, command) => scoped.changeStatus(command)); }
  @Post(paths.revoke) @HttpCode(200) @Header('Cache-Control', 'no-store')
  revoke(@Req() request: Request, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.revoke(command)); }
  @Post(paths.operation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  operation(@Req() request: Request, @Body() value: unknown) { return this.call(request, value, false, (scoped, command) => scoped.operation(command)); }
}
