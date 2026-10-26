import type { IncomingMessage } from 'node:http';
import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { AI_QUOTE_SELECTION_HTTP_DRAFT, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT, AI_SELECTED_QUOTE_TASK_HTTP_DRAFT,
  AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT, AI_SELECTED_QUOTE_TASK_HTTP_CONTRACTS as taskContracts,
  AI_HUMAN_QUOTE_ORDER_HTTP_CONTRACTS as approvalContracts } from '@rental-os/shared';
import { parseClarifiedQuoteSelection, validateQuoteSelectionResponse, validateQuoteSelectionHttpRequest } from './quote-selection.validation';
import type { composeClarifiedQuoteSelectionRequests, composeRequestBoundQuoteSelections, composeRequestBoundHumanQuoteOrder, composeRequestBoundSelectedQuoteTask, AiSceneHttpRequest } from '../scenes/request-bound-scenes.application';

export const AI_HUMAN_QUOTE_SELECTIONS = Symbol('AI_HUMAN_QUOTE_SELECTIONS');
export const AI_HUMAN_QUOTE_SELECTION_REQUESTS = Symbol('AI_HUMAN_QUOTE_SELECTION_REQUESTS');
export const AI_HUMAN_QUOTE_ORDER_REQUESTS = Symbol('AI_HUMAN_QUOTE_ORDER_REQUESTS');
export const AI_SELECTED_QUOTE_TASK_REQUESTS = Symbol('AI_SELECTED_QUOTE_TASK_REQUESTS');
export const AI_CLARIFIED_QUOTE_SELECTION_HTTP_REQUESTS = Symbol('AI_CLARIFIED_QUOTE_SELECTION_HTTP_REQUESTS');

/** Explicit human handoff, not an approval or order execution endpoint. The
 * exact original quote receipt and unplanned successor are checked server-side. */
@Controller(AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT.basePath)
export class AiClarifiedQuoteSelectionController {
  constructor(@Inject(AI_CLARIFIED_QUOTE_SELECTION_HTTP_REQUESTS)
    private readonly selections: ReturnType<typeof composeClarifiedQuoteSelectionRequests>) {}
  @Post(AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT.select) @HttpCode(200) @Header('Cache-Control', 'no-store')
  select(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(async () => {
      const command = parseClarifiedQuoteSelection(body);
      return validateQuoteSelectionResponse('AiQuoteSelectionSelectResponseDraft',
        await this.selections.select(request, command.selection, command.clarification), true);
    }, 'read_clarified_selection_operation');
  }
  @Post(AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT.readOperation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readOperation(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(async () => {
      const command = parseClarifiedQuoteSelection(body);
      return validateQuoteSelectionResponse('AiQuoteSelectionReconcileResponseDraft',
        await this.selections.readOperation(request, command.selection, command.clarification));
    });
  }
}

type QuoteTaskHttpRequest = AiSceneHttpRequest & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
async function quoteHttpContract(contract: { request: string; response: Parameters<typeof validateQuoteSelectionResponse>[0] },
  body: unknown, work: (command: unknown) => Promise<unknown>, writing = false) {
  const command = validateQuoteSelectionHttpRequest(contract.request, body);
  return validateQuoteSelectionResponse(contract.response, await work(command), writing);
}
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
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.readTaskPage) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskPage(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => this.tasks.readTaskPage(request, body));
  }
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.readTaskEvents) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskEvents(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => this.tasks.readTaskEvents(request, body));
  }
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.start) @HttpCode(200) @Header('Cache-Control', 'no-store')
  start(@Req() request: QuoteTaskHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => runQuoteTask(request, signal => quoteHttpContract(taskContracts.start, body,
      command => this.tasks.start(request, command, signal), true)));
  }
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.readConfirmation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readConfirmation(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => quoteHttpContract(taskContracts.readConfirmation, body,
      command => this.tasks.readConfirmation(request, command)));
  }
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.continueConfirmation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  continueConfirmation(@Req() request: QuoteTaskHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => runQuoteTask(request, signal => quoteHttpContract(taskContracts.continueConfirmation, body,
      command => this.tasks.continueConfirmation(request, command, signal), true)));
  }
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.reconcile) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcile(@Req() request: QuoteTaskHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => runQuoteTask(request, signal => quoteHttpContract(taskContracts.reconcile, body,
      command => this.tasks.reconcile(request, command, signal), true)));
  }
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.readScene) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readScene(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => this.tasks.readScene(request, body));
  }
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.readResult) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readResult(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => quoteHttpContract(taskContracts.readResult, body, command => this.tasks.readResult(request, command)));
  }
  @Post(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.requestCancel) @HttpCode(200) @Header('Cache-Control', 'no-store')
  requestCancel(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => quoteHttpContract(taskContracts.requestCancel, body, command => this.tasks.requestCancel(request, command), true));
  }
}


async function respondHumanQuote<T>(work: () => Promise<T>, unknownAction = 'reconcile') {
  try { return await work(); }
  catch (error) {
    const payload = error instanceof HttpException ? error.getResponse() : null;
    const code = payload && typeof payload === 'object' && 'code' in payload ? payload.code
      : error instanceof Error && 'code' in error ? error.code : undefined;
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
  @Post() @HttpCode(200) @Header('Cache-Control', 'no-store')
  select(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return this.respond(async () => validateQuoteSelectionResponse('AiQuoteSelectionSelectResponseDraft',
      await this.selections.select(request, body), true));
  }
  @Post('read') @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return this.respond(async () => validateQuoteSelectionResponse('AiQuoteSelectionReceiptDraft',
      await this.selections.read(request, body)));
  }
  @Post('reconcile') @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcile(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return this.respond(async () => validateQuoteSelectionResponse('AiQuoteSelectionReconcileResponseDraft',
      await this.selections.reconcile(request, body)));
  }
}

/** Explicit human consumer. No lease claim, selected-input publication or
 * submitSelectedOrder endpoint; a decision never attests an executed order. */
@Controller(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.basePath)
export class AiHumanQuoteOrderController {
  constructor(@Inject(AI_HUMAN_QUOTE_ORDER_REQUESTS)
    private readonly orders: ReturnType<typeof composeRequestBoundHumanQuoteOrder>) {}
  @Post(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.readSelectedProposal) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readSelectedProposal(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => quoteHttpContract(approvalContracts.readSelectedProposal, body, command => this.orders.readSelectedProposal(request, command)));
  }
  @Post(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.decideSelectedProposal) @HttpCode(200) @Header('Cache-Control', 'no-store')
  decideSelectedProposal(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => quoteHttpContract(approvalContracts.decideSelectedProposal, body,
      command => this.orders.decideSelectedProposal(request, command), true), 'read_decision_receipt');
  }
  @Post(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.readSelectedDecisionReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readSelectedDecisionReceipt(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => quoteHttpContract(approvalContracts.readSelectedDecisionReceipt, body, command => this.orders.readSelectedDecisionReceipt(request, command)));
  }
  @Post(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.readSelectedOrderResult) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readSelectedOrderResult(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondHumanQuote(() => this.orders.readSelectedOrderResult(request, body)); }
  @Post(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.readSelectedReprepareEligibility) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readSelectedReprepareEligibility(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => quoteHttpContract(approvalContracts.readSelectedReprepareEligibility, body, command => this.orders.readSelectedReprepareEligibility(request, command)));
  }
  @Post(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.reprepareSelectedProposal) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reprepareSelectedProposal(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => quoteHttpContract(approvalContracts.reprepareSelectedProposal, body,
      command => this.orders.reprepareSelectedProposal(request, command), true), 'read_reprepare_receipt');
  }
  @Post(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.readSelectedReprepareReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readSelectedReprepareReceipt(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondHumanQuote(() => quoteHttpContract(approvalContracts.readSelectedReprepareReceipt, body, command => this.orders.readSelectedReprepareReceipt(request, command)));
  }
}
