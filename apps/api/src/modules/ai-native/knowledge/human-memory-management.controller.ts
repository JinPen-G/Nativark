import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { AI_MEMORY_MANAGEMENT_HTTP_DRAFT as paths, type AiMemoryManagementErrorDraft } from '../../../../../../packages/shared/src/ai-memory-management-http-draft';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { HumanMemoryManagementRequestFactory, type HumanMemoryManagementRequest } from './human-memory-management.composition';
import { KnowledgeError } from './knowledge-errors';
type Request = { headers: { authorization?: unknown } };

@Controller(paths.basePath)
export class HumanMemoryManagementController {
  constructor(@Inject(HumanMemoryManagementRequestFactory) private readonly requests: HumanMemoryManagementRequestFactory) {}
  private async call<T>(request: Request, action: (scoped: HumanMemoryManagementRequest) => Promise<T>): Promise<T> {
    try {
      return await runWithRequestIdentity({}, async () => {
        const scoped = this.requests.open(request);
        try { return await action(scoped); } finally { scoped.close(); }
      });
    } catch (error) {
      const code = error instanceof KnowledgeError ? error.code : 'unavailable';
      const response: AiMemoryManagementErrorDraft = {
        code: code === 'invalid_input' || code === 'limit_exceeded' ? 'AI_INVALID_INPUT'
          : code === 'conflict' ? 'AI_REVISION_CONFLICT' : code === 'not_ready' ? 'AI_NOT_READY'
            : code === 'result_unknown' ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE',
        retryable: false, nextAction: 'read_original_memory_operation' };
      throw new HttpException(response, response.code === 'AI_INVALID_INPUT' ? 400
        : response.code === 'AI_REVISION_CONFLICT' || response.code === 'AI_NOT_READY' ? 409 : 503);
    }
  }
  @Post(paths.list) @HttpCode(200) @Header('Cache-Control', 'no-store')
  list(@Req() request: Request, @Body() value: unknown) { return this.call(request, scoped => scoped.list(value)); }
  @Post(paths.state) @HttpCode(200) @Header('Cache-Control', 'no-store')
  state(@Req() request: Request, @Body() value: unknown) { return this.call(request, scoped => scoped.state(value)); }
  @Post(paths.read) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: Request, @Body() value: unknown) { return this.call(request, scoped => scoped.read(value)); }
  @Post(paths.propose) @HttpCode(200) @Header('Cache-Control', 'no-store')
  propose(@Req() request: Request, @Body() value: unknown) { return this.call(request, scoped => scoped.propose(value)); }
  @Post(paths.confirm) @HttpCode(200) @Header('Cache-Control', 'no-store')
  confirm(@Req() request: Request, @Body() value: unknown) { return this.call(request, scoped => scoped.confirm(value)); }
  @Post(paths.resumeConfirmation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  resumeConfirmation(@Req() request: Request, @Body() value: unknown) { return this.call(request, scoped => scoped.resumeConfirmation(value)); }
  @Post(paths.confirmation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  confirmation(@Req() request: Request, @Body() value: unknown) { return this.call(request, scoped => scoped.confirmation(value)); }
  @Post(paths.change) @HttpCode(200) @Header('Cache-Control', 'no-store')
  change(@Req() request: Request, @Body() value: unknown) { return this.call(request, scoped => scoped.change(value)); }
  @Post(paths.changeStatus) @HttpCode(200) @Header('Cache-Control', 'no-store')
  changeStatus(@Req() request: Request, @Body() value: unknown) { return this.call(request, scoped => scoped.changeStatus(value)); }
  @Post(paths.revoke) @HttpCode(200) @Header('Cache-Control', 'no-store')
  revoke(@Req() request: Request, @Body() value: unknown) { return this.call(request, scoped => scoped.revoke(value)); }
  @Post(paths.operation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  operation(@Req() request: Request, @Body() value: unknown) { return this.call(request, scoped => scoped.operation(value)); }
}
