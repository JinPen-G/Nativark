/** 四端目录只读传输。每个注入工厂固定surface，客户端只给有界游标；
 * 原始请求做闭合校验，不以DTO剥离字段恢复有效。不启动Task／模型／Core。 */
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { AI_ENTRY_SCENE_CATALOG_HTTP, isAiEntrySceneCatalogRequest, isAiEntrySceneCatalogResponse,
  type AiEntrySceneCatalogRequest, type AiEntrySceneCatalogResponse } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { respondAiScene } from './original-scenes.controller';
import { withRequestAbort, type AiRequestAbortSource } from './request-abort';

export const AI_OPERATOR_SCENE_CATALOG = Symbol('AI_OPERATOR_SCENE_CATALOG');
export const AI_STAFF_SCENE_CATALOG = Symbol('AI_STAFF_SCENE_CATALOG');
export const AI_WEBSITE_SCENE_CATALOG = Symbol('AI_WEBSITE_SCENE_CATALOG');
export const AI_WECHAT_SCENE_CATALOG = Symbol('AI_WECHAT_SCENE_CATALOG');
export type EntrySceneCatalogHttpRequest = AiRequestAbortSource & { headers: { authorization?: unknown }; ip?: string; body?: unknown };
export type EntrySceneCatalogRequestFactory = (request: EntrySceneCatalogHttpRequest) => {
  read(value: AiEntrySceneCatalogRequest, signal?: AbortSignal): Promise<AiEntrySceneCatalogResponse>;
  close(): void;
};

@Controller(AI_ENTRY_SCENE_CATALOG_HTTP.operatorBasePath)
export class OperatorEntrySceneCatalogController {
  constructor(@Inject(AI_OPERATOR_SCENE_CATALOG) private readonly create: EntrySceneCatalogRequestFactory) {}
  @Post(AI_ENTRY_SCENE_CATALOG_HTTP.read) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: EntrySceneCatalogHttpRequest, @Body() value: unknown) {
    return respondAiScene(() => withRequestAbort(request, async signal => {
      const command = structuredClone(request.body ?? value);
      if (!isAiEntrySceneCatalogRequest(command)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const reader = this.create(request), close = () => reader.close();
      signal.addEventListener('abort', close, { once: true });
      try {
        if (signal.aborted) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const result = await reader.read(command, signal);
        if (!isAiEntrySceneCatalogResponse(result)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        return result;
      } finally { close(); signal.removeEventListener('abort', close); }
    }, { maxWaitMs: 15000 }));
  }
}
@Controller(AI_ENTRY_SCENE_CATALOG_HTTP.staffBasePath)
export class StaffEntrySceneCatalogController extends OperatorEntrySceneCatalogController {
  constructor(@Inject(AI_STAFF_SCENE_CATALOG) create: EntrySceneCatalogRequestFactory) { super(create); }
}
@Controller(AI_ENTRY_SCENE_CATALOG_HTTP.websiteBasePath)
export class WebsiteEntrySceneCatalogController extends OperatorEntrySceneCatalogController {
  constructor(@Inject(AI_WEBSITE_SCENE_CATALOG) create: EntrySceneCatalogRequestFactory) { super(create); }
}
@Controller(AI_ENTRY_SCENE_CATALOG_HTTP.wechatBasePath)
export class WechatEntrySceneCatalogController extends OperatorEntrySceneCatalogController {
  constructor(@Inject(AI_WECHAT_SCENE_CATALOG) create: EntrySceneCatalogRequestFactory) { super(create); }
}
