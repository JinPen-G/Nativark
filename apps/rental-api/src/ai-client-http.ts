/** Selected client goal/quote/Booking/order material, navigation, Task and original model HTTP. Each channel delegates to
 * the original controller and application, preserving schemas, refusal audit,
 * abort handling and unknown receipts. Other client actions are not inherited. */
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { AI_CLIENT_ENTRY_HTTP_DRAFT } from "@rental-os/shared";
import { AiClientEntryController, type AiClientEntryApplication } from "@rental-os/ai-native-server/runtime/scenes/client-entry.controller";
import { AI_WEBSITE_ENTRY, AI_WECHAT_ENTRY } from "@rental-os/ai-native-server/runtime/scenes/standard-client-entry.application";

type ClientEntryRequest = Parameters<AiClientEntryController["prepareOrderMaterial"]>[0];

abstract class RentalClientMaterialHttp {
  private readonly original: AiClientEntryController;

  protected constructor(application: AiClientEntryApplication) {
    this.original = new AiClientEntryController(application);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.prepareGoal) @HttpCode(200) @Header("Cache-Control", "no-store")
  prepareGoal(@Req() request: ClientEntryRequest & { body?: unknown }) {
    return this.original.prepareGoal(request);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readGoalPreparation) @HttpCode(200) @Header("Cache-Control", "no-store")
  readGoalPreparation(@Req() request: ClientEntryRequest & { body?: unknown }) {
    return this.original.readGoalPreparation(request);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readGoalCandidates) @HttpCode(200) @Header("Cache-Control", "no-store")
  readGoalCandidates(@Req() request: ClientEntryRequest & { body?: unknown }) {
    return this.original.readGoalCandidates(request);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.prepareGoalQuote) @HttpCode(200) @Header("Cache-Control", "no-store")
  prepareGoalQuote(@Req() request: ClientEntryRequest & { body?: unknown }) {
    return this.original.prepareGoalQuote(request);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readGoalQuotePreparation) @HttpCode(200) @Header("Cache-Control", "no-store")
  readGoalQuotePreparation(@Req() request: ClientEntryRequest & { body?: unknown }) {
    return this.original.readGoalQuotePreparation(request);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.prepareQuoteParameters) @HttpCode(200) @Header("Cache-Control", "no-store")
  prepareQuoteParameters(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.prepareQuoteParameters(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readQuotePreparationOperation) @HttpCode(200) @Header("Cache-Control", "no-store")
  readQuotePreparationOperation(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readQuotePreparationOperation(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.confirmQuoteParameters) @HttpCode(200) @Header("Cache-Control", "no-store")
  confirmQuoteParameters(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.confirmQuoteParameters(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readPreparedQuoteOriginal) @HttpCode(200) @Header("Cache-Control", "no-store")
  readPreparedQuoteOriginal(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readPreparedQuoteOriginal(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.prepareOriginalQuoteBooking) @HttpCode(200) @Header("Cache-Control", "no-store")
  prepareOriginalQuoteBooking(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.prepareOriginalQuoteBooking(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readOriginalQuoteBookingOperation) @HttpCode(200) @Header("Cache-Control", "no-store")
  readOriginalQuoteBookingOperation(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readOriginalQuoteBookingOperation(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.issueAction) @HttpCode(200) @Header("Cache-Control", "no-store")
  issueAction(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.issueAction(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.createBookingDraft) @HttpCode(200) @Header("Cache-Control", "no-store")
  createBookingDraft(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.createBookingDraft(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.chooseBookingDraft) @HttpCode(200) @Header("Cache-Control", "no-store")
  chooseBookingDraft(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.chooseBookingDraft(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingDraft) @HttpCode(200) @Header("Cache-Control", "no-store")
  readBookingDraft(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readBookingDraft(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.handoffBookingDraft) @HttpCode(200) @Header("Cache-Control", "no-store")
  handoffBookingDraft(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.handoffBookingDraft(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingHandoff) @HttpCode(200) @Header("Cache-Control", "no-store")
  readBookingHandoff(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readBookingHandoff(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingOperation) @HttpCode(200) @Header("Cache-Control", "no-store")
  readBookingOperation(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readBookingOperation(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingAcceptance) @HttpCode(200) @Header("Cache-Control", "no-store")
  readBookingAcceptance(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readBookingAcceptance(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.issueBookingTransfer) @HttpCode(200) @Header("Cache-Control", "no-store")
  issueBookingTransfer(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.issueBookingTransfer(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingTransferIssue) @HttpCode(200) @Header("Cache-Control", "no-store")
  readBookingTransferIssue(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readBookingTransferIssue(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.consumeBookingTransfer) @HttpCode(200) @Header("Cache-Control", "no-store")
  consumeBookingTransfer(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.consumeBookingTransfer(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingTransferReceipt) @HttpCode(200) @Header("Cache-Control", "no-store")
  readBookingTransferReceipt(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readBookingTransferReceipt(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.acceptBookingSubmission) @HttpCode(200) @Header("Cache-Control", "no-store")
  acceptBookingSubmission(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.acceptBookingSubmission(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.submitAcceptedBooking) @HttpCode(200) @Header("Cache-Control", "no-store")
  submitAcceptedBooking(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.submitAcceptedBooking(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingSubmission) @HttpCode(200) @Header("Cache-Control", "no-store")
  readBookingSubmission(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readBookingSubmission(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readHostCapabilities) @HttpCode(200) @Header("Cache-Control", "no-store")
  readHostCapabilities(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readHostCapabilities(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderTaskHostCapabilities) @HttpCode(200) @Header("Cache-Control", "no-store")
  readOrderTaskHostCapabilities(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readOrderTaskHostCapabilities(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderAction) @HttpCode(200) @Header("Cache-Control", "no-store")
  readOrderAction(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readOrderAction(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.revalidateOrderAction) @HttpCode(200) @Header("Cache-Control", "no-store")
  revalidateOrderAction(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.revalidateOrderAction(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskSnapshot) @HttpCode(200) @Header("Cache-Control", "no-store")
  readTaskSnapshot(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readTaskSnapshot(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskEvents) @HttpCode(200) @Header("Cache-Control", "no-store")
  readTaskEvents(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readTaskEvents(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderExplanation) @HttpCode(200) @Header("Cache-Control", "no-store")
  readOrderExplanation(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readOrderExplanation(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readSource) @HttpCode(200) @Header("Cache-Control", "no-store")
  readSource(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readSource(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.requestTaskCancellation) @HttpCode(200) @Header("Cache-Control", "no-store")
  requestTaskCancellation(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.requestTaskCancellation(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCancellationReceipt) @HttpCode(200) @Header("Cache-Control", "no-store")
  readTaskCancellationReceipt(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readTaskCancellationReceipt(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCancellationSettlementReceipt) @HttpCode(200) @Header("Cache-Control", "no-store")
  readTaskCancellationSettlementReceipt(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readTaskCancellationSettlementReceipt(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.settleTaskUnstartedCancellation) @HttpCode(200) @Header("Cache-Control", "no-store")
  settleTaskUnstartedCancellation(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.settleTaskUnstartedCancellation(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.reconcileTaskInputCancellation) @HttpCode(200) @Header("Cache-Control", "no-store")
  reconcileTaskInputCancellation(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.reconcileTaskInputCancellation(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.prepareOrderMaterial) @HttpCode(200) @Header("Cache-Control", "no-store")
  prepareOrderMaterial(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.prepareOrderMaterial(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderMaterialReceipt) @HttpCode(200) @Header("Cache-Control", "no-store")
  readOrderMaterialReceipt(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readOrderMaterialReceipt(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.createTask) @HttpCode(200) @Header("Cache-Control", "no-store")
  createTask(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.createTask(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCreation) @HttpCode(200) @Header("Cache-Control", "no-store")
  readTaskCreation(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readTaskCreation(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.startTaskModel) @HttpCode(200) @Header("Cache-Control", "no-store")
  startTaskModel(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.startTaskModel(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.submitTaskInput) @HttpCode(200) @Header("Cache-Control", "no-store")
  submitTaskInput(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.submitTaskInput(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.continueTaskInput) @HttpCode(200) @Header("Cache-Control", "no-store")
  continueTaskInput(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.continueTaskInput(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.recoverTaskModel) @HttpCode(200) @Header("Cache-Control", "no-store")
  recoverTaskModel(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.recoverTaskModel(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.reconcileTaskModel) @HttpCode(200) @Header("Cache-Control", "no-store")
  reconcileTaskModel(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.reconcileTaskModel(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInput) @HttpCode(200) @Header("Cache-Control", "no-store")
  readTaskInput(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readTaskInput(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInputReceipt) @HttpCode(200) @Header("Cache-Control", "no-store")
  readTaskInputReceipt(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readTaskInputReceipt(request, body);
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskModelResult) @HttpCode(200) @Header("Cache-Control", "no-store")
  readTaskModelResult(@Req() request: ClientEntryRequest, @Body() body: unknown) {
    return this.original.readTaskModelResult(request, body);
  }
}

@Controller(AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedBasePath)
export class RentalWebsiteClientEntryController extends RentalClientMaterialHttp {
  constructor(@Inject(AI_WEBSITE_ENTRY) application: AiClientEntryApplication) { super(application); }
}

@Controller(AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedWechatBasePath)
export class RentalWechatClientEntryController extends RentalClientMaterialHttp {
  constructor(@Inject(AI_WECHAT_ENTRY) application: AiClientEntryApplication) { super(application); }
}
