import { Body, Controller, HttpException, Inject, Post, Req } from '@nestjs/common';
import { AI_QUOTE_SELECTION_HTTP_DRAFT } from '@rental-os/shared';
import type { composeRequestBoundQuoteSelections, AiSceneHttpRequest } from '../scenes/request-bound-scenes.application';

export const AI_HUMAN_QUOTE_SELECTIONS = Symbol('AI_HUMAN_QUOTE_SELECTIONS');
export const AI_HUMAN_QUOTE_SELECTION_REQUESTS = Symbol('AI_HUMAN_QUOTE_SELECTION_REQUESTS');

/** Opt-in transport. Every operation resolves current server identity and the
 * original business Guard inside the repository; no caller scope or authority.
 * Runner leases/publication and approval are deliberately not HTTP endpoints.
 */
@Controller(AI_QUOTE_SELECTION_HTTP_DRAFT.basePath)
export class AiHumanQuoteSelectionController {
  constructor(@Inject(AI_HUMAN_QUOTE_SELECTION_REQUESTS) private readonly selections: ReturnType<typeof composeRequestBoundQuoteSelections>) {}
  private async respond<T>(work: () => Promise<T>) {
    try { return await work(); }
    catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      const statuses: Record<string, number> = { AI_INVALID_INPUT: 400, AI_ACCESS_DENIED: 403,
        AI_SCOPE_CHANGED: 403, AI_RESOURCE_UNAVAILABLE: 404, AI_REVISION_CONFLICT: 409,
        AI_STORAGE_UNAVAILABLE: 503, AI_RESULT_UNKNOWN: 409 };
      const known = typeof code === 'string' && Object.prototype.hasOwnProperty.call(statuses, code)
        ? code : 'AI_STORAGE_UNAVAILABLE';
      throw new HttpException({ code: known, retryable: false,
        ...(known === 'AI_RESULT_UNKNOWN' ? { nextAction: 'reconcile' } : {}) }, statuses[known]);
    }
  }
  @Post()
  select(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.selections.select(request, body)); }
  @Post('read')
  read(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.selections.read(request, body)); }
  @Post('reconcile')
  reconcile(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.selections.reconcile(request, body)); }
}
