/** Selected client material, task creation and original order-model HTTP. Each channel delegates to
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
