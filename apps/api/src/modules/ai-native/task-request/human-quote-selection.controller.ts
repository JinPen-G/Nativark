import { Body, Controller, HttpException, Inject, Post } from '@nestjs/common';
import { AI_QUOTE_SELECTION_HTTP_DRAFT } from '@rental-os/shared';
import type { PrismaQuoteSelectionRepository } from './prisma-quote-selection.repository';

export const AI_HUMAN_QUOTE_SELECTIONS = Symbol('AI_HUMAN_QUOTE_SELECTIONS');

/** Opt-in transport. Every operation resolves current server identity and the
 * original business Guard inside the repository; no caller scope or authority.
 * Runner leases/publication and approval are deliberately not HTTP endpoints.
 */
@Controller(AI_QUOTE_SELECTION_HTTP_DRAFT.basePath)
export class AiHumanQuoteSelectionController {
  constructor(@Inject(AI_HUMAN_QUOTE_SELECTIONS) private readonly selections: PrismaQuoteSelectionRepository) {}
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
  select(@Body() body: unknown) { return this.respond(() => this.selections.select(body)); }
  @Post('read')
  read(@Body() body: unknown) { return this.respond(() => this.selections.read(body)); }
  @Post('reconcile')
  reconcile(@Body() body: unknown) { return this.respond(() => this.selections.reconcile(body)); }
}
