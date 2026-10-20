import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { AI_CLIENT_ENTRY_HTTP_DRAFT, aiClientTaskCancelReceiptSchema,
  aiClientTaskUnstartedCancellationReceiptSchema, aiClientTaskCancellationObservationSchema,
  aiClientTaskInputCancellationReceiptSchema, aiClientTaskInputReadResponseSchema, AI_TASK_INPUT_DRAFT_VERSION,
  aiClientTaskInputSubmissionRequestSchema, aiClientTaskInputSubmissionReceiptSchema,
  aiClientTaskInputReceiptReadResponseSchema, aiClientTaskModelControlResponseSchema, AI_TASK_DRAFT_VERSION,
  AI_CLIENT_QUOTE_PREPARATION_VERSION, aiClientQuotePreparationRequestSchema, aiClientQuoteConfirmationRequestSchema,
  aiClientOrderMaterialRequestSchema, aiClientOrderMaterialReceiptSchema, AI_CLIENT_MATERIAL_RECEIPT_VERSION,
  aiClientTaskReadRequestSchema, aiClientTaskCreationReceiptSchema,
  aiClientTaskAccountingRequestSchema, aiClientTaskAccountingResponseSchema,
  aiClientQuotePreparationResponseSchema, aiClientQuotePreparationReadResponseSchema,
  aiClientQuoteResultReadResponseSchema, aiBookingAcceptanceReadRequestSchema, aiBookingAcceptanceReadResponseSchema } from '@rental-os/shared';
import { z } from 'zod';
import { AiClientEntryError } from './client-entry-action';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskTransitionResultUnknownError } from '../ai-task-transition.repository';
import { AiTaskInputResultUnknownError } from '../task-input/task-input.errors';
import { withRequestAbort, AiRequestWaitError, type AiRequestAbortSource } from './request-abort';
import type { AiClientApplicationRequest, composeRequestBoundClientApplication } from './client-request.application';
import { AiClientQuoteResultUnknownError } from '../client-quote-original.composition';
import { AiClientTaskUnknownError } from './prisma-client-task-input.repository';

export const AI_CLIENT_ENTRY_APPLICATION = Symbol('AI_CLIENT_ENTRY_APPLICATION');
export type AiClientEntryApplication = Pick<ReturnType<typeof composeRequestBoundClientApplication>,
  'readHostCapabilities' | 'issueAction' | 'createBookingDraft' | 'chooseBookingDraft' | 'readBookingDraft' |
  'handoffBookingDraft' | 'readBookingHandoff' | 'readBookingOperation' |
  'acceptBookingSubmission' | 'readBookingAcceptance' | 'submitAcceptedBooking' | 'readBookingSubmission' | 'readTaskSnapshot' | 'readTaskEvents' |
  'readOrderExplanation' | 'readSource' | 'requestOriginalTaskCancellation' | 'reconcileOriginalTaskInputCancellation' |
  'readOriginalTaskCancellationReceipt' | 'readOriginalTaskCancellationSettlementReceipt' | 'settleOriginalTaskUnstartedCancellation' |
  'readOriginalTaskModelInput' | 'submitOriginalTaskModelInput' | 'readOriginalTaskModelInputReceipt' |
  'startOriginalTaskModel' | 'recoverOriginalTaskModel' | 'reconcileOriginalTaskModel' | 'continueOriginalTaskModelInput' |
  'readOriginalTaskModelResult' | 'prepareQuoteParameters' | 'confirmQuoteParameters' |
  'readQuotePreparationOperation' | 'readPreparedQuoteOriginal' | 'prepare' | 'readOrderMaterialReceipt' | 'createTask' | 'readTaskCreation' |
  'readOriginalTaskAccounting' | 'reconcileOriginalTaskAccounting'>;
type ClientModelHttpRequest = AiClientApplicationRequest & AiRequestAbortSource;

@Controller([AI_CLIENT_ENTRY_HTTP_DRAFT.basePath, AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedBasePath])
export class AiClientEntryController {
  constructor(@Inject(AI_CLIENT_ENTRY_APPLICATION) private readonly application: AiClientEntryApplication) {}

  private async respond<T>(work: () => Promise<T>, unknownAction = 'read_booking_operation'): Promise<T> {
    try { return await work(); }
    catch (error) {
      const aliases: Record<string, string> = {
        AI_CLIENT_INVALID_INPUT: 'AI_INVALID_INPUT', AI_CLIENT_CONTEXT_UNAVAILABLE: 'AI_ACCESS_DENIED',
        AI_CLIENT_CAPABILITY_UNAVAILABLE: 'AI_RESOURCE_UNAVAILABLE', AI_CLIENT_MATERIAL_STALE: 'AI_PROPOSAL_STALE',
        AI_CLIENT_REVISION_CONFLICT: 'AI_REVISION_CONFLICT', AI_CLIENT_RESULT_UNKNOWN: 'AI_RESULT_UNKNOWN',
        AI_CLIENT_RESOURCE_ERASED: 'AI_RESOURCE_UNAVAILABLE'
      };
      const statuses: Record<string, number> = { AI_INVALID_INPUT: 400, AI_ACCESS_DENIED: 403,
        AI_RESOURCE_UNAVAILABLE: 503, AI_PROPOSAL_STALE: 409, AI_REVISION_CONFLICT: 409, AI_RESULT_UNKNOWN: 409 };
      let code = 'AI_RESOURCE_UNAVAILABLE';
      if (error instanceof z.ZodError) code = 'AI_INVALID_INPUT';
      else if (error instanceof AiRequestWaitError) code = error.code;
      else if (error instanceof AiTaskTransitionResultUnknownError || error instanceof AiTaskInputResultUnknownError
        || error instanceof AiClientQuoteResultUnknownError || error instanceof AiClientTaskUnknownError) code = 'AI_RESULT_UNKNOWN';
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
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.prepareOrderMaterial) @HttpCode(200) @Header('Cache-Control', 'no-store')
  prepareOrderMaterial(@Req() request: ClientModelHttpRequest, @Body() body: unknown) {
    const current = { headers: { authorization: request?.headers?.authorization }, ip: request.ip }, input = structuredClone(body);
    return this.respond(() => withRequestAbort(request, async signal => {
      const command = aiClientOrderMaterialRequestSchema.parse(input);
      const prepared = await this.application.prepare(current, { operationKey: command.operationKey,
        command: { kind: 'order', orderId: command.orderId } }, signal);
      const receipt = aiClientOrderMaterialReceiptSchema.safeParse({ contractVersion: AI_CLIENT_MATERIAL_RECEIPT_VERSION,
        operationKey: command.operationKey, state: 'observed', materialRef: prepared.materialRef,
        materialHash: prepared.materialHash, expiresAt: prepared.expiresAt, execution: 'not_attested',
        freshness: 'revalidate_before_execution', retryable: false, nextAction: 'read_original_material_receipt' });
      if (!receipt.success) throw new AiClientEntryError('AI_RESULT_UNKNOWN', 'client_material_observation_unknown');
      return receipt.data;
    }, { maxWaitMs: 15000 }), 'read_original_material_receipt');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderMaterialReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readOrderMaterialReceipt(@Req() request: ClientModelHttpRequest, @Body() body: unknown) {
    const current = { headers: { authorization: request?.headers?.authorization }, ip: request.ip }, input = structuredClone(body);
    return this.respond(() => withRequestAbort(request, signal => this.application.readOrderMaterialReceipt(current, input, signal),
      { maxWaitMs: 15000 }), 'read_original_material_receipt');
  }
  private taskCreation(request: ClientModelHttpRequest, body: unknown, create: boolean) {
    const current = { headers: { authorization: request?.headers?.authorization }, ip: request.ip }, input = structuredClone(body);
    return this.respond(() => withRequestAbort(request, async signal => {
      const command = aiClientTaskReadRequestSchema.parse(input);
      const result = await this.application[create ? 'createTask' : 'readTaskCreation'](current, command, signal);
      if (!('state' in result) || !('task' in result)) throw new AiClientEntryError('AI_RESULT_UNKNOWN', 'client_creation_observation_unknown');
      const response = aiClientTaskCreationReceiptSchema.safeParse({ contractVersion: AI_TASK_DRAFT_VERSION,
        ...command, state: result.state, task: result.task, inputRef: 'inputRef' in result ? result.inputRef : null,
        inputHash: 'inputHash' in result ? result.inputHash : null, execution: 'not_attested', retryable: false,
        nextAction: 'read_original_task_creation' });
      if (!response.success) throw new AiClientEntryError('AI_RESULT_UNKNOWN', 'client_creation_observation_unknown');
      return response.data;
    }, { maxWaitMs: 15000 }), 'read_original_task_creation');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.createTask) @HttpCode(200) @Header('Cache-Control', 'no-store')
  createTask(@Req() request: ClientModelHttpRequest, @Body() value: unknown) { return this.taskCreation(request, value, true); }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCreation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskCreation(@Req() request: ClientModelHttpRequest, @Body() value: unknown) { return this.taskCreation(request, value, false); }
  private accounting(request: ClientModelHttpRequest, body: unknown, reconcile: boolean) {
    const current = { headers: { authorization: request?.headers?.authorization }, ip: request.ip }, input = structuredClone(body);
    return this.respond(() => withRequestAbort(request, async signal => {
      const command = aiClientTaskAccountingRequestSchema.parse(input);
      const result = await this.application[reconcile ? 'reconcileOriginalTaskAccounting' : 'readOriginalTaskAccounting'](current, command, signal);
      const response = aiClientTaskAccountingResponseSchema.safeParse(result);
      if (!response.success) throw new AiClientEntryError('AI_RESULT_UNKNOWN', 'client_accounting_observation_unknown');
      return response.data;
    }, { maxWaitMs: 15000 }), 'read_original_accounting');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskAccounting) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskAccounting(@Req() request: ClientModelHttpRequest, @Body() value: unknown) { return this.accounting(request, value, false); }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.reconcileTaskAccounting) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcileTaskAccounting(@Req() request: ClientModelHttpRequest, @Body() value: unknown) { return this.accounting(request, value, true); }
  private preparedQuoteObservation(value: unknown) {
    const result = value as { state?: unknown; quote?: unknown; source?: unknown };
    const raw = result?.quote;
    let quote: unknown = null;
    if (raw !== null && raw !== undefined) {
      if (typeof raw !== 'object' || Array.isArray(raw)) throw new AiClientQuoteResultUnknownError();
      const facts = raw as Record<string, unknown>;
      const lines = facts.chargeLines;
      if (lines !== undefined && lines !== null && (!Array.isArray(lines) || lines.length > 100)) throw new AiClientQuoteResultUnknownError();
      quote = { quoteId: facts.id, currency: facts.currency ?? null, payableAmount: facts.payableAmount ?? null,
        depositAmount: facts.depositAmount ?? null, preAuthAmount: facts.preAuthAmount ?? null,
        pricingPlanVersion: facts.pricingPlanVersion ?? null, ruleVersion: facts.ruleVersion ?? null,
        priceVersionId: facts.priceVersionId ?? null, calendarVersion: facts.calendarVersion ?? null,
        categoryVersionId: facts.categoryVersionId ?? null, createdAt: facts.createdAt ?? null, expiresAt: facts.expiresAt ?? null,
        chargeLines: Array.isArray(lines) ? lines.map(line => {
          if (!line || typeof line !== 'object' || Array.isArray(line)) throw new AiClientQuoteResultUnknownError();
          const item = line as Record<string, unknown>;
          return { type: item.type, amount: item.amount, sourceId: item.sourceId ?? null, sourceVersion: item.sourceVersion ?? null };
        }) : null };
    }
    const response = aiClientQuoteResultReadResponseSchema.safeParse({ contractVersion: AI_CLIENT_QUOTE_PREPARATION_VERSION,
      state: quote === null ? 'unknown' : 'observed', source: result?.source, quote,
      quotePersistence: quote === null ? 'unknown' : 'saved', inventoryReservation: 'not_attempted',
      orderExecution: 'not_attempted', confirmation: 'parameters_only_not_order_approval', retryable: false,
      nextAction: 'read_original_quote' });
    if (!response.success || Buffer.byteLength(JSON.stringify(response.data), 'utf8') > 32768) throw new AiClientQuoteResultUnknownError();
    return response.data;
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.prepareQuoteParameters) @HttpCode(200) @Header('Cache-Control', 'no-store')
  prepareQuoteParameters(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(async () => {
      const value = await this.application.prepareQuoteParameters(request, aiClientQuotePreparationRequestSchema.parse(body));
      const response = aiClientQuotePreparationResponseSchema.safeParse({ ...value, contractVersion: AI_CLIENT_QUOTE_PREPARATION_VERSION });
      if (!response.success) throw new AiClientQuoteResultUnknownError();
      return response.data;
    }, 'read_quote_preparation_operation');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readQuotePreparationOperation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readQuotePreparationOperation(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(async () => {
      const value = await this.application.readQuotePreparationOperation(request, aiClientQuotePreparationRequestSchema.parse(body));
      const response = aiClientQuotePreparationReadResponseSchema.safeParse({ ...value, contractVersion: AI_CLIENT_QUOTE_PREPARATION_VERSION });
      if (!response.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return response.data;
    }, 'read_quote_preparation_operation');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.confirmQuoteParameters) @HttpCode(200) @Header('Cache-Control', 'no-store')
  confirmQuoteParameters(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(async () => this.preparedQuoteObservation(await this.application.confirmQuoteParameters(request,
      aiClientQuoteConfirmationRequestSchema.parse(body))), 'read_original_quote');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readPreparedQuoteOriginal) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readPreparedQuoteOriginal(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(async () => this.preparedQuoteObservation(await this.application.readPreparedQuoteOriginal(request,
      aiClientQuoteConfirmationRequestSchema.parse(body))), 'read_original_quote');
  }
  private modelObservation(value: unknown) {
    const wrapped = value && typeof value === 'object' && 'execution' in value ? value.execution : value;
    const execution = wrapped && typeof wrapped === 'object' && 'kind' in wrapped && wrapped.kind === 'run_outcome'
      && 'outcome' in wrapped && wrapped.outcome && typeof wrapped.outcome === 'object'
      ? { kind: wrapped.kind, outcome: {
        status: 'status' in wrapped.outcome ? wrapped.outcome.status : undefined,
        completedSteps: 'completedSteps' in wrapped.outcome ? wrapped.outcome.completedSteps : undefined,
        cleanupFailed: 'cleanupFailed' in wrapped.outcome ? wrapped.outcome.cleanupFailed : undefined,
        ...('errorCode' in wrapped.outcome ? { errorCode: wrapped.outcome.errorCode } : {}),
        ...('stopReason' in wrapped.outcome ? { stopReason: wrapped.outcome.stopReason } : {}),
        ...('nextAction' in wrapped.outcome ? { nextAction: wrapped.outcome.nextAction } : {}) } }
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
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskModelResult) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskModelResult(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readOriginalTaskModelResult(request, body), 'read_original_task');
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
  private observeCancellation(request: ClientModelHttpRequest, body: unknown, settled: boolean) {
    const current = { headers: { authorization: request?.headers?.authorization } }, input = structuredClone(body);
    return this.respond(() => withRequestAbort(request, async signal => {
      const result = await (settled ? this.application.readOriginalTaskCancellationSettlementReceipt(current, input, signal)
        : this.application.readOriginalTaskCancellationReceipt(current, input, signal));
      const event = result.event;
      if (event && event.data.to !== (settled ? 'cancelled' : 'cancel_requested'))
        throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
      const response = aiClientTaskCancellationObservationSchema.safeParse({ contractVersion: AI_TASK_DRAFT_VERSION,
        taskId: result.taskId, expectedRevision: result.expectedRevision, state: event ? 'observed' : 'unknown',
        transition: event ? { taskRevision: event.taskRevision, cursor: event.cursor,
          observedAt: event.occurredAt, status: event.data.to } : null,
        execution: 'not_authorized_by_observation', externalRollback: 'not_claimed',
        retryable: false, nextAction: 'read_original_task' });
      if (!response.success) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
      return response.data;
    }, { maxWaitMs: 15000 }), 'read_original_task');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCancellationReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskCancellationReceipt(@Req() request: ClientModelHttpRequest, @Body() body: unknown) {
    return this.observeCancellation(request, body, false);
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCancellationSettlementReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskCancellationSettlementReceipt(@Req() request: ClientModelHttpRequest, @Body() body: unknown) {
    return this.observeCancellation(request, body, true);
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.settleTaskUnstartedCancellation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  settleTaskUnstartedCancellation(@Req() request: ClientModelHttpRequest, @Body() body: unknown) {
    const current = { headers: { authorization: request?.headers?.authorization } }, input = structuredClone(body);
    return this.respond(() => withRequestAbort(request, async signal => {
      const result = await this.application.settleOriginalTaskUnstartedCancellation(current, input, signal), event = result.receipt.event;
      if (event.data.to !== 'cancelled') throw new AiTaskTransitionResultUnknownError();
      const response = aiClientTaskUnstartedCancellationReceiptSchema.safeParse({ contractVersion: event.contractVersion,
        taskId: event.taskId, taskRevision: event.taskRevision, cursor: event.cursor, observedAt: event.occurredAt,
        status: 'cancelled', cancellation: result.cancellation, externalRollback: result.externalRollback,
        retryable: false, nextAction: 'read_original_task' });
      if (!response.success) throw new AiTaskTransitionResultUnknownError();
      return response.data;
    }, { maxWaitMs: 15000 }), 'read_original_task');
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
  readTaskInputReceipt(@Req() request: ClientModelHttpRequest, @Body() body: unknown) {
    const current = { headers: { authorization: request?.headers?.authorization } }, input = structuredClone(body);
    return this.respond(() => withRequestAbort(request, async signal => {
      const parsed = aiClientTaskInputSubmissionRequestSchema.parse(input);
      const { submission, ...command } = parsed;
      const result = await this.application.readOriginalTaskModelInputReceipt(current, command, submission, undefined, signal);
      const receipt = result.state === 'observed' ? { taskId: result.taskId, requestId: result.requestId,
        receiptId: result.receiptId, taskRevision: result.taskRevision } : null;
      const response = aiClientTaskInputReceiptReadResponseSchema.safeParse({ state: result.state, receipt,
        contractVersion: AI_TASK_INPUT_DRAFT_VERSION, execution: 'not_inferred_from_receipt' });
      if (!response.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return response.data;
    }, { maxWaitMs: 15000 }), 'read_original_task_input_receipt');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderExplanation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readOrderExplanation(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readOrderExplanation(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.reconcileTaskInputCancellation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcileTaskInputCancellation(@Req() request: ClientModelHttpRequest, @Body() body: unknown) {
    const current = { headers: { authorization: request?.headers?.authorization } }, input = structuredClone(body);
    return this.respond(() => withRequestAbort(request, async signal => {
      const result = await this.application.reconcileOriginalTaskInputCancellation(current, input, undefined, signal);
      const event = result.receipt.event;
      if (event.data.to !== 'cancelled') throw new AiTaskTransitionResultUnknownError();
      const receipt = aiClientTaskInputCancellationReceiptSchema.safeParse({ contractVersion: event.contractVersion,
        taskId: event.taskId, taskRevision: event.taskRevision, cursor: event.cursor, observedAt: event.occurredAt,
        status: 'cancelled', cancellation: result.cancellation, externalRollback: result.externalRollback,
        retryable: false, nextAction: 'read_original_task' });
      if (!receipt.success) throw new AiTaskTransitionResultUnknownError();
      return receipt.data;
    }, { maxWaitMs: 15000 }), 'read_original_task');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readSource) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readSource(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readSource(request, body));
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readHostCapabilities)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  readHostCapabilities(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readHostCapabilities(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.issueAction)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  issueAction(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.issueAction(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.createBookingDraft)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  createBookingDraft(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.createBookingDraft(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.chooseBookingDraft)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  chooseBookingDraft(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.chooseBookingDraft(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingDraft)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  readBookingDraft(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readBookingDraft(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.handoffBookingDraft)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  handoffBookingDraft(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.handoffBookingDraft(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingHandoff)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  readBookingHandoff(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readBookingHandoff(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingOperation)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  readBookingOperation(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readBookingOperation(request, body));
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingAcceptance) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readBookingAcceptance(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(async () => {
      const value = await this.application.readBookingAcceptance(request, aiBookingAcceptanceReadRequestSchema.parse(body));
      const result = aiBookingAcceptanceReadResponseSchema.safeParse(value);
      if (!result.success || Buffer.byteLength(JSON.stringify(result.data), 'utf8') > 8192) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return result.data;
    }, 'read_booking_acceptance');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.acceptBookingSubmission)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  acceptBookingSubmission(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    // Same handoff re-read can recover an acceptance; it does not submit an order.
    return this.respond(() => this.application.acceptBookingSubmission(request, body), 'read_booking_acceptance');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.submitAcceptedBooking)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  submitAcceptedBooking(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.submitAcceptedBooking(request, body), 'read_booking_submission');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingSubmission)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  readBookingSubmission(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readBookingSubmission(request, body), 'read_booking_submission');
  }
}
