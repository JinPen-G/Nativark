import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { AI_KNOWLEDGE_CONSUMPTION_HTTP_DRAFT as paths, type AiKnowledgeConsumptionHttpErrorDraft } from '@rental-os/shared';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { HumanKnowledgeConsumptionRequestFactory, type HumanKnowledgeConsumptionHttpRequest,
  type HumanKnowledgeConsumptionRequest } from './human-knowledge-consumption.composition';
import { KnowledgeError } from './knowledge-errors';
import { withRequestAbort } from '../scenes/request-abort';
import { waitForTaskApplicationDependency } from '../runner/prisma-task-application';

@Controller(paths.basePath)
export class HumanKnowledgeConsumptionController {
  constructor(@Inject(HumanKnowledgeConsumptionRequestFactory) private readonly requests: HumanKnowledgeConsumptionRequestFactory) {}

  private async call<T>(request: HumanKnowledgeConsumptionHttpRequest, value: unknown,
    read: (scoped: HumanKnowledgeConsumptionRequest, command: unknown) => Promise<T>): Promise<T> {
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
        try { return await waitForTaskApplicationDependency(() => read(scoped, command), false, signal); }
        finally { close(); signal.removeEventListener('abort', close); }
      }), { maxWaitMs: 15000 });
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
  readDocument(@Req() request: HumanKnowledgeConsumptionHttpRequest, @Body() value: unknown) { return this.call(request, value, (scoped, command) => scoped.readDocument(command)); }

  @Post(paths.openSource)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  openSource(@Req() request: HumanKnowledgeConsumptionHttpRequest, @Body() value: unknown) { return this.call(request, value, (scoped, command) => scoped.openSource(command)); }

  @Post(paths.readMemory)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  readMemory(@Req() request: HumanKnowledgeConsumptionHttpRequest, @Body() value: unknown) { return this.call(request, value, (scoped, command) => scoped.readMemory(command)); }

  @Post(paths.readPreferences)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  readPreferences(@Req() request: HumanKnowledgeConsumptionHttpRequest, @Body() value: unknown) { return this.call(request, value, (scoped, command) => scoped.readPreferences(command)); }
}
