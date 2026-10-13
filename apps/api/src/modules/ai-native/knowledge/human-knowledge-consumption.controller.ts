import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { AI_KNOWLEDGE_CONSUMPTION_HTTP_DRAFT as paths, type AiKnowledgeConsumptionHttpErrorDraft } from '@rental-os/shared';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { HumanKnowledgeConsumptionRequestFactory, type HumanKnowledgeConsumptionHttpRequest,
  type HumanKnowledgeConsumptionRequest } from './human-knowledge-consumption.composition';
import { KnowledgeError } from './knowledge-errors';

@Controller(paths.basePath)
export class HumanKnowledgeConsumptionController {
  constructor(@Inject(HumanKnowledgeConsumptionRequestFactory) private readonly requests: HumanKnowledgeConsumptionRequestFactory) {}

  private async call<T>(request: HumanKnowledgeConsumptionHttpRequest,
    read: (scoped: HumanKnowledgeConsumptionRequest) => Promise<T>): Promise<T> {
    try {
      return await runWithRequestIdentity({}, async () => {
        const scoped = this.requests.open(request);
        try { return await read(scoped); }
        finally { scoped.close(); }
      });
    } catch (error) {
      const code = error instanceof KnowledgeError ? error.code : 'unavailable';
      const response: AiKnowledgeConsumptionHttpErrorDraft = {
        code: code === 'invalid_input' || code === 'limit_exceeded' ? 'AI_INVALID_INPUT'
          : code === 'conflict' ? 'AI_REVISION_CONFLICT' : 'AI_RESOURCE_UNAVAILABLE',
        retryable: false,
      };
      throw new HttpException(response, response.code === 'AI_INVALID_INPUT' ? 400 : response.code === 'AI_REVISION_CONFLICT' ? 409 : 503);
    }
  }

  @Post(paths.readDocument)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  readDocument(@Req() request: HumanKnowledgeConsumptionHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.readDocument(value)); }

  @Post(paths.openSource)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  openSource(@Req() request: HumanKnowledgeConsumptionHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.openSource(value)); }

  @Post(paths.readMemory)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  readMemory(@Req() request: HumanKnowledgeConsumptionHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.readMemory(value)); }

  @Post(paths.readPreferences)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  readPreferences(@Req() request: HumanKnowledgeConsumptionHttpRequest, @Body() value: unknown) { return this.call(request, scoped => scoped.readPreferences(value)); }
}
