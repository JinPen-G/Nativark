import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { AI_CLIENT_ENTRY_HTTP_DRAFT, aiClientTaskCancelReceiptSchema,
  aiClientTaskInputCancellationReceiptSchema, aiClientTaskInputReadResponseSchema, AI_TASK_INPUT_DRAFT_VERSION,
  aiClientTaskInputSubmissionRequestSchema, aiClientTaskInputSubmissionReceiptSchema,
  aiClientTaskInputReceiptReadResponseSchema, aiClientTaskModelControlResponseSchema, AI_TASK_DRAFT_VERSION } from '@rental-os/shared';
import { z } from 'zod';
import { AiClientEntryError } from './client-entry-action';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskTransitionResultUnknownError } from '../ai-task-transition.repository';
import { AiTaskInputResultUnknownError } from '../task-input/task-input.errors';
import { withRequestAbort, type AiRequestAbortSource } from './request-abort';
import type { AiClientApplicationRequest, composeRequestBoundClientApplication } from './client-request.application';

export const AI_CLIENT_ENTRY_APPLICATION = Symbol('AI_CLIENT_ENTRY_APPLICATION');
type Application = Pick<ReturnType<typeof composeRequestBoundClientApplication>,
  'readHostCapabilities' | 'issueAction' | 'createBookingDraft' | 'chooseBookingDraft' | 'readBookingDraft' |
  'handoffBookingDraft' | 'readBookingHandoff' | 'readBookingOperation' |
  'acceptBookingSubmission' | 'submitAcceptedBooking' | 'readBookingSubmission' | 'readTaskSnapshot' | 'readTaskEvents' |
  'readOrderExplanation' | 'readSource' | 'requestOriginalTaskCancellation' | 'reconcileOriginalTaskInputCancellation' |
  'readOriginalTaskModelInput' | 'submitOriginalTaskModelInput' | 'readOriginalTaskModelInputReceipt' |
  'startOriginalTaskModel' | 'recoverOriginalTaskModel' | 'reconcileOriginalTaskModel' | 'continueOriginalTaskModelInput'>;
type ClientModelHttpRequest = AiClientApplicationRequest & AiRequestAbortSource;

@Controller([AI_CLIENT_ENTRY_HTTP_DRAFT.basePath, AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedBasePath])
export class AiClientEntryController {
  constructor(@Inject(AI_CLIENT_ENTRY_APPLICATION) private readonly application: Application) {}

  private async respond<T>(work: () => Promise<T>, unknownAction = 'read_booking_operation'): Promise<T> {
    try { return await work(); }
    catch (error) {
      const aliases: Record<string, string> = {
        AI_CLIENT_INVALID_INPUT: 'AI_INVALID_INPUT', AI_CLIENT_CONTEXT_UNAVAILABLE: 'AI_ACCESS_DENIED',
        AI_CLIENT_CAPABILITY_UNAVAILABLE: 'AI_RESOURCE_UNAVAILABLE', AI_CLIENT_MATERIAL_STALE: 'AI_PROPOSAL_STALE',
        AI_CLIENT_REVISION_CONFLICT: 'AI_REVISION_CONFLICT', AI_CLIENT_RESULT_UNKNOWN: 'AI_RESULT_UNKNOWN'
      };
      const statuses: Record<string, number> = { AI_INVALID_INPUT: 400, AI_ACCESS_DENIED: 403,
        AI_RESOURCE_UNAVAILABLE: 503, AI_PROPOSAL_STALE: 409, AI_REVISION_CONFLICT: 409, AI_RESULT_UNKNOWN: 409 };
      let code = 'AI_RESOURCE_UNAVAILABLE';
      if (error instanceof z.ZodError) code = 'AI_INVALID_INPUT';
      else if (error instanceof AiTaskTransitionResultUnknownError || error instanceof AiTaskInputResultUnknownError) code = 'AI_RESULT_UNKNOWN';
      else if (error instanceof AiClientEntryError) code = error.code;
      else if (error instanceof AiTaskRepositoryError) code = error.code === 'AI_STORAGE_UNAVAILABLE' ? 'AI_RESOURCE_UNAVAILABLE' : error.code;
      else if (error instanceof Error && aliases[error.message]) code = aliases[error.message];
      else if (error instanceof HttpException) {
        if (error.getStatus() === 400) code = 'AI_INVALID_INPUT';
        else if ([401, 403, 404].includes(error.getStatus())) code = 'AI_ACCESS_DENIED';
        else if (error.getStatus() === 409) code = 'AI_REVISION_CONFLICT';
      }
      if (!Object.prototype.hasOwnProperty.call(statuses, code)) code = 'AI_RESOURCE_UNAVAILABLE';
      throw new HttpException({ code, retryable: false,
        ...(code === 'AI_RESULT_UNKNOWN' ? { nextAction: unknownAction } : {}) }, statuses[code]);
    }
  }
  private modelObservation(value: unknown) {
    const wrapped = value && typeof value === 'object' && 'execution' in value ? value.execution : value;
    const execution = wrapped && typeof wrapped === 'object' && 'kind' in wrapped && wrapped.kind === 'run_outcome'
      && 'outcome' in wrapped && wrapped.outcome && typeof wrapped.outcome === 'object'
      ? { kind: wrapped.kind, outcome: {
        status: 'status' in wrapped.outcome ? wrapped.outcome.status : undefined,
        completedSteps: 'completedSteps' in wrapped.outcome ? wrapped.outcome.completedSteps : undefined,
        cleanupFailed: 'cleanupFailed' in wrapped.outcome ? wrapped.outcome.cleanupFailed : undefined } }
      : wrapped && typeof wrapped === 'object' && 'kind' in wrapped && wrapped.kind === 'not_started'
        ? { kind: wrapped.kind, reason: 'reason' in wrapped ? wrapped.reason : undefined } : null;
    const response = aiClientTaskModelControlResponseSchema.safeParse({ contractVersion: AI_TASK_DRAFT_VERSION,
      execution, businessExecution: 'not_inferred_from_model_result', retryable: false, nextAction: 'read_original_task' });
    // A malformed post-execution observation does not prove no invocation.
    if (!response.success) throw new AiClientEntryError('AI_RESULT_UNKNOWN', 'client_model_observation_unknown');
    return response.data;
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.startTaskModel) @HttpCode(200) @Header('Cache-Control', 'no-store')
  startTaskModel(@Req() request: ClientModelHttpRequest, @Body() body: unknown) {
    return this.respond(() => withRequestAbort(request, async signal =>
      this.modelObservation(await this.application.startOriginalTaskModel(request, body, undefined, signal))), 'read_original_task');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.recoverTaskModel) @HttpCode(200) @Header('Cache-Control', 'no-store')
  recoverTaskModel(@Req() request: ClientModelHttpRequest, @Body() body: unknown) {
    return this.respond(() => withRequestAbort(request, async signal =>
      this.modelObservation(await this.application.recoverOriginalTaskModel(request, body, undefined, signal))), 'read_original_task');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.reconcileTaskModel) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcileTaskModel(@Req() request: ClientModelHttpRequest, @Body() body: unknown) {
    return this.respond(() => withRequestAbort(request, async signal =>
      this.modelObservation(await this.application.reconcileOriginalTaskModel(request, body, undefined, signal))), 'read_original_task');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.continueTaskInput) @HttpCode(200) @Header('Cache-Control', 'no-store')
  continueTaskInput(@Req() request: ClientModelHttpRequest, @Body() body: unknown) {
    return this.respond(() => withRequestAbort(request, async signal =>
      this.modelObservation(await this.application.continueOriginalTaskModelInput(request, body, undefined, signal))), 'read_original_task');
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskSnapshot) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskSnapshot(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readTaskSnapshot(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskEvents) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskEvents(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readTaskEvents(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInput) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskInput(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(async () => {
      const question = await this.application.readOriginalTaskModelInput(request, body);
      const response = aiClientTaskInputReadResponseSchema.safeParse({ contractVersion: AI_TASK_INPUT_DRAFT_VERSION,
        state: question === null ? 'not_pending' : 'pending', question,
        execution: 'not_authorized_by_observation' });
      if (!response.success || Buffer.byteLength(JSON.stringify(response.data), 'utf8') > 65536)
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return response.data;
    }, 'read_original_task');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.requestTaskCancellation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  requestTaskCancellation(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(async () => {
      const result = await this.application.requestOriginalTaskCancellation(request, body);
      const event = result.receipt.event;
      // Whitelist the public observation; no lease, holder, run revision,
      // financial evidence or internal transition payload escapes this route.
      const receipt = aiClientTaskCancelReceiptSchema.safeParse({ contractVersion: event.contractVersion,
        taskId: event.taskId, taskRevision: event.taskRevision, cursor: event.cursor,
        observedAt: event.occurredAt, status: 'cancel_requested', cancellation: result.cancellation,
        retryable: result.retryable, nextAction: result.nextAction });
      // A write may already have committed; malformed server observations
      // cannot be reported as invalid client input or permission to reissue.
      if (!receipt.success) throw new AiTaskTransitionResultUnknownError();
      return receipt.data;
    }, 'read_original_task');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.submitTaskInput) @HttpCode(200) @Header('Cache-Control', 'no-store')
  submitTaskInput(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(async () => {
      const result = await this.application.submitOriginalTaskModelInput(request, body);
      const receipt = aiClientTaskInputSubmissionReceiptSchema.safeParse({ status: result.status,
        taskId: result.taskId, requestId: result.requestId, receiptId: result.receiptId,
        taskRevision: result.taskRevision, replayed: result.replayed,
        contractVersion: AI_TASK_INPUT_DRAFT_VERSION, execution: 'not_inferred_from_receipt' });
      if (!receipt.success) throw new AiTaskInputResultUnknownError();
      return receipt.data;
    }, 'read_original_task_input_receipt');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInputReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskInputReceipt(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(async () => {
      const parsed = aiClientTaskInputSubmissionRequestSchema.parse(body);
      const { submission, ...command } = parsed;
      const result = await this.application.readOriginalTaskModelInputReceipt(request, command, submission);
      const receipt = result.state === 'observed' ? { taskId: result.taskId, requestId: result.requestId,
        receiptId: result.receiptId, taskRevision: result.taskRevision } : null;
      const response = aiClientTaskInputReceiptReadResponseSchema.safeParse({ state: result.state, receipt,
        contractVersion: AI_TASK_INPUT_DRAFT_VERSION, execution: 'not_inferred_from_receipt' });
      if (!response.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return response.data;
    }, 'read_original_task_input_receipt');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderExplanation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readOrderExplanation(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readOrderExplanation(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.reconcileTaskInputCancellation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcileTaskInputCancellation(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(async () => {
      const result = await this.application.reconcileOriginalTaskInputCancellation(request, body);
      const event = result.receipt.event;
      if (event.data.to !== 'cancelled') throw new AiTaskTransitionResultUnknownError();
      const receipt = aiClientTaskInputCancellationReceiptSchema.safeParse({ contractVersion: event.contractVersion,
        taskId: event.taskId, taskRevision: event.taskRevision, cursor: event.cursor, observedAt: event.occurredAt,
        status: 'cancelled', cancellation: result.cancellation, externalRollback: result.externalRollback,
        retryable: false, nextAction: 'read_original_task' });
      if (!receipt.success) throw new AiTaskTransitionResultUnknownError();
      return receipt.data;
    }, 'read_original_task');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readSource) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readSource(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readSource(request, body));
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readHostCapabilities)
  readHostCapabilities(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readHostCapabilities(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.issueAction)
  issueAction(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.issueAction(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.createBookingDraft)
  createBookingDraft(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.createBookingDraft(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.chooseBookingDraft)
  chooseBookingDraft(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.chooseBookingDraft(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingDraft)
  readBookingDraft(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readBookingDraft(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.handoffBookingDraft)
  handoffBookingDraft(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.handoffBookingDraft(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingHandoff)
  readBookingHandoff(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readBookingHandoff(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingOperation)
  readBookingOperation(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readBookingOperation(request, body));
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.acceptBookingSubmission)
  acceptBookingSubmission(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    // Same handoff re-read can recover an acceptance; it does not submit an order.
    return this.respond(() => this.application.acceptBookingSubmission(request, body), 'accept_booking_submission');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.submitAcceptedBooking)
  submitAcceptedBooking(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.submitAcceptedBooking(request, body), 'read_booking_submission');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingSubmission)
  readBookingSubmission(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readBookingSubmission(request, body), 'read_booking_submission');
  }
}
