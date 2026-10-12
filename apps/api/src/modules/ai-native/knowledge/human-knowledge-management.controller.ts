import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { AI_KNOWLEDGE_MANAGEMENT_HTTP_DRAFT as paths, type AiKnowledgeManagementHttpErrorDraft } from '../../../../../../packages/shared/src/ai-knowledge-management-http-draft';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { HumanKnowledgeManagementRequestFactory, type HumanKnowledgeManagementHttpRequest,
  type HumanKnowledgeManagementRequest } from './human-knowledge-management.composition';
import { KnowledgeError } from './knowledge-errors';

@Controller(paths.basePath)
export class HumanKnowledgeManagementController {
  constructor(@Inject(HumanKnowledgeManagementRequestFactory) private readonly requests: HumanKnowledgeManagementRequestFactory) {}

  private async call<T>(request: HumanKnowledgeManagementHttpRequest,
    action: (scoped: HumanKnowledgeManagementRequest) => Promise<T>): Promise<T> {
    try {
      return await runWithRequestIdentity({}, async () => {
        const scoped = this.requests.open(request);
        try { return await action(scoped); }
        finally { scoped.close(); }
      });
    } catch (error) {
      const code = error instanceof KnowledgeError ? error.code : 'unavailable';
      const response: AiKnowledgeManagementHttpErrorDraft = {
        code: code === 'invalid_input' || code === 'limit_exceeded' ? 'AI_INVALID_INPUT'
          : code === 'conflict' ? 'AI_REVISION_CONFLICT' : code === 'not_ready' ? 'AI_NOT_READY'
            : code === 'result_unknown' ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE',
        retryable: false, nextAction: 'read_original_operation',
      };
      throw new HttpException(response, response.code === 'AI_INVALID_INPUT' ? 400
        : response.code === 'AI_REVISION_CONFLICT' || response.code === 'AI_NOT_READY' ? 409 : 503);
    }
  }

  @Post(paths.observeUpload)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  observeUpload(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.observeUpload(value)); }

  @Post(paths.observeRevisionUpload)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  observeRevisionUpload(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.observeRevisionUpload(value)); }

  @Post(paths.beginUpload)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  beginUpload(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.beginUpload(value)); }

  @Post(paths.completeUpload)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  completeUpload(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.completeUpload(value)); }

  @Post(paths.beginRevisionUpload)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  beginRevisionUpload(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.beginRevisionUpload(value)); }

  @Post(paths.completeRevisionUpload)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  completeRevisionUpload(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.completeRevisionUpload(value)); }

  @Post(paths.prepareCreate)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  prepareCreate(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.prepareCreate(value)); }

  @Post(paths.create)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  create(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.create(value)); }

  @Post(paths.parse)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  parse(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.parse(value)); }

  @Post(paths.reconcileParse)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  reconcileParse(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.reconcileParse(value)); }

  @Post(paths.revise)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  revise(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.revise(value)); }

  @Post(paths.publish)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  publish(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.publish(value)); }

  @Post(paths.withdraw)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  withdraw(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.withdraw(value)); }

  @Post(paths.delete)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  delete(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.delete(value)); }

  @Post(paths.operationStatus)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  operationStatus(@Req() request: HumanKnowledgeManagementHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.operationStatus(value)); }
}
