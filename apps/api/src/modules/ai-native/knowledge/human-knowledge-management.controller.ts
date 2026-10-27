import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { AI_KNOWLEDGE_MANAGEMENT_HTTP_DRAFT as paths, type AiKnowledgeManagementHttpErrorDraft } from '@rental-os/shared';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { HumanKnowledgeManagementRequestFactory, type HumanKnowledgeManagementHttpRequest,
  type HumanKnowledgeManagementRequest } from './human-knowledge-management.composition';
import { KnowledgeError } from './knowledge-errors';
import { withRequestAbort } from '../scenes/request-abort';
import { waitForTaskApplicationDependency } from '../runner/prisma-task-application';

@Controller(paths.basePath)
export class HumanKnowledgeManagementController {
  constructor(@Inject(HumanKnowledgeManagementRequestFactory) private readonly requests: HumanKnowledgeManagementRequestFactory) {}

  private async call<T>(request: HumanKnowledgeManagementHttpRequest, value: unknown, write: boolean,
    action: (scoped: HumanKnowledgeManagementRequest, command: unknown) => Promise<T>,
    nextAction: AiKnowledgeManagementHttpErrorDraft['nextAction'] = 'read_original_operation'): Promise<T> {
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
      const response: AiKnowledgeManagementHttpErrorDraft = {
        code: code === 'invalid_input' || code === 'limit_exceeded' ? 'AI_INVALID_INPUT'
          : code === 'conflict' ? 'AI_REVISION_CONFLICT' : code === 'not_ready' ? 'AI_NOT_READY'
            : code === 'result_unknown' ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE',
        retryable: false, nextAction,
      };
      throw new HttpException(response, response.code === 'AI_INVALID_INPUT' ? 400
        : response.code === 'AI_REVISION_CONFLICT' || response.code === 'AI_NOT_READY' || response.code === 'AI_RESULT_UNKNOWN' ? 409 : 503);
    }
  }

  @Post(paths.observeUpload)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  observeUpload(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, false, (scoped, command) => scoped.observeUpload(command)); }

  @Post(paths.observeRevisionUpload)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  observeRevisionUpload(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, false, (scoped, command) => scoped.observeRevisionUpload(command)); }

  @Post(paths.beginUpload)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  beginUpload(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.beginUpload(command), 'read_original_upload_intent'); }

  @Post(paths.completeUpload)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  completeUpload(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.completeUpload(command), 'read_original_upload_intent'); }

  @Post(paths.beginRevisionUpload)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  beginRevisionUpload(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.beginRevisionUpload(command), 'read_original_revision_upload_intent'); }

  @Post(paths.completeRevisionUpload)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  completeRevisionUpload(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.completeRevisionUpload(command), 'read_original_revision_upload_intent'); }

  @Post(paths.prepareCreate)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  prepareCreate(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, false, (scoped, command) => scoped.prepareCreate(command)); }

  @Post(paths.create)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  create(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.create(command)); }

  @Post(paths.parse)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  parse(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.parse(command)); }

  @Post(paths.reconcileParse)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  reconcileParse(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.reconcileParse(command)); }

  @Post(paths.revise)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  revise(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.revise(command)); }

  @Post(paths.publish)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  publish(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.publish(command)); }

  @Post(paths.withdraw)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  withdraw(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.withdraw(command)); }

  @Post(paths.delete)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  delete(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.delete(command)); }

  @Post(paths.operationStatus)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  operationStatus(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, false, (scoped, command) => scoped.operationStatus(command)); }

  @Post(paths.indexRead) @HttpCode(200) @Header('Cache-Control', 'no-store')
  indexRead(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, false, (scoped, command) => scoped.indexRead(command)); }
  @Post(paths.indexRequest) @HttpCode(200) @Header('Cache-Control', 'no-store')
  indexRequest(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.indexRequest(command)); }
  @Post(paths.indexResume) @HttpCode(200) @Header('Cache-Control', 'no-store')
  indexResume(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, true, (scoped, command) => scoped.indexResume(command)); }
  @Post(paths.indexOperationRead) @HttpCode(200) @Header('Cache-Control', 'no-store')
  indexOperationRead(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, false, (scoped, command) => scoped.indexOperationRead(command)); }
  @Post(paths.findOriginalUpload) @HttpCode(200) @Header('Cache-Control', 'no-store')
  findOriginalUpload(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, false, (scoped, command) => scoped.findOriginalUpload(command)); }
  @Post(paths.findOriginalRevisionUpload) @HttpCode(200) @Header('Cache-Control', 'no-store')
  findOriginalRevisionUpload(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, value, false, (scoped, command) => scoped.findOriginalRevisionUpload(command)); }
}
