import type { IncomingMessage } from 'node:http';
import { Body, Controller, HttpException, Inject, Post, Req } from '@nestjs/common';
import { AI_QUOTE_SELECTION_HTTP_DRAFT, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT, AI_SELECTED_QUOTE_TASK_HTTP_DRAFT } from '@rental-os/shared';
import type { composeRequestBoundQuoteSelections, composeRequestBoundHumanQuoteOrder, composeRequestBoundSelectedQuoteTask, AiSceneHttpRequest } from '../scenes/request-bound-scenes.application';

export const AI_HUMAN_QUOTE_SELECTIONS = Symbol('AI_HUMAN_QUOTE_SELECTIONS');
export const AI_HUMAN_QUOTE_SELECTION_REQUESTS = Symbol('AI_HUMAN_QUOTE_SELECTION_REQUESTS');
export const AI_HUMAN_QUOTE_ORDER_REQUESTS = Symbol('AI_HUMAN_QUOTE_ORDER_REQUESTS');
export const AI_SELECTED_QUOTE_TASK_REQUESTS = Symbol('AI_SELECTED_QUOTE_TASK_REQUESTS');

type QuoteTaskHttpRequest = AiSceneHttpRequest & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
async function runQuoteTask<T>(request: QuoteTaskHttpRequest, work: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController(), abort = () => controller.abort();
  const listens = typeof request?.once === 'function' && typeof request?.removeListener === 'function';
  if (request?.aborted) abort();
  else if (listens) request.once!('aborted', abort);
  try { return await work(controller.signal); }
  finally { if (listens) request.removeListener!('aborted', abort); }
}

@Controller(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.basePath)
export class AiSelectedQuoteTaskController {
  constructor(@Inject(AI_SELECTED_QUOTE_TASK_REQUESTS) private readonly tasks: ReturnType<typeof composeRequestBoundSelectedQuoteTask>) {}
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.readTaskPage)
  readTaskPage(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => this.tasks.readTaskPage(request, body));
  }
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.readTaskEvents)
  readTaskEvents(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => this.tasks.readTaskEvents(request, body));
  }
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.start)
  start(@Req() request: QuoteTaskHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => runQuoteTask(request, signal => this.tasks.start(request, body, signal)));
  }
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.readConfirmation)
  readConfirmation(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => this.tasks.readConfirmation(request, body));
  }
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.continueConfirmation)
  continueConfirmation(@Req() request: QuoteTaskHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => runQuoteTask(request, signal => this.tasks.continueConfirmation(request, body, signal)));
  }
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.reconcile)
  reconcile(@Req() request: QuoteTaskHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => runQuoteTask(request, signal => this.tasks.reconcile(request, body, signal)));
  }
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.readScene)
  readScene(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => this.tasks.readScene(request, body));
  }
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.readResult)
  readResult(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => this.tasks.readResult(request, body));
  }
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.requestCancel)
  requestCancel(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => this.tasks.requestCancel(request, body));
  }
}


async function respondHumanQuote<T>(work: () => Promise<T>, unknownAction = 'reconcile') {
  try { return await work(); }
  catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    const statuses: Record<string, number> = { AI_INVALID_INPUT: 400, AI_ACCESS_DENIED: 403,
      AI_SCOPE_CHANGED: 403, AI_RESOURCE_UNAVAILABLE: 404, AI_REVISION_CONFLICT: 409,
      AI_STORAGE_UNAVAILABLE: 503, AI_RESULT_UNKNOWN: 409 };
    const known = typeof code === 'string' && Object.prototype.hasOwnProperty.call(statuses, code) ? code : 'AI_STORAGE_UNAVAILABLE';
    throw new HttpException({ code: known, retryable: false,
      ...(known === 'AI_RESULT_UNKNOWN' ? { nextAction: unknownAction } : {}) }, statuses[known]);
  }
}

/** Opt-in transport. Every operation resolves current server identity and the
 * original business Guard inside the repository; no caller scope or authority.
 * Runner leases/publication and approval are deliberately not HTTP endpoints.
 */
@Controller(AI_QUOTE_SELECTION_HTTP_DRAFT.basePath)
export class AiHumanQuoteSelectionController {
  constructor(@Inject(AI_HUMAN_QUOTE_SELECTION_REQUESTS) private readonly selections: ReturnType<typeof composeRequestBoundQuoteSelections>) {}
  private readonly respond = respondHumanQuote;
  @Post()
  select(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.selections.select(request, body)); }
  @Post('read')
  read(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.selections.read(request, body)); }
  @Post('reconcile')
  reconcile(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.selections.reconcile(request, body)); }
}

/** Explicit human consumer. No lease claim, selected-input publication or
 * submitSelectedOrder endpoint; a decision never attests an executed order. */
@Controller(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.basePath)
export class AiHumanQuoteOrderController {
  constructor(@Inject(AI_HUMAN_QUOTE_ORDER_REQUESTS)
    private readonly orders: ReturnType<typeof composeRequestBoundHumanQuoteOrder>) {}
  @Post(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.readSelectedProposal)
  readSelectedProposal(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondHumanQuote(() => this.orders.readSelectedProposal(request, body)); }
  @Post(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.decideSelectedProposal)
  decideSelectedProposal(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondHumanQuote(() => this.orders.decideSelectedProposal(request, body), 'read_decision_receipt'); }
  @Post(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.readSelectedDecisionReceipt)
  readSelectedDecisionReceipt(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondHumanQuote(() => this.orders.readSelectedDecisionReceipt(request, body)); }
  @Post(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.readSelectedOrderResult)
  readSelectedOrderResult(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondHumanQuote(() => this.orders.readSelectedOrderResult(request, body)); }
  @Post(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.readSelectedReprepareEligibility)
  readSelectedReprepareEligibility(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondHumanQuote(() => this.orders.readSelectedReprepareEligibility(request, body)); }
  @Post(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.reprepareSelectedProposal)
  reprepareSelectedProposal(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondHumanQuote(() => this.orders.reprepareSelectedProposal(request, body), 'read_reprepare_receipt'); }
  @Post(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.readSelectedReprepareReceipt)
  readSelectedReprepareReceipt(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondHumanQuote(() => this.orders.readSelectedReprepareReceipt(request, body)); }
}
