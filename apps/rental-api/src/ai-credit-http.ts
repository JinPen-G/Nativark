/** 原租户额度及调用记录消费者。平台审批由平台宿主独立授权，
 * 申请、空间上限和原收据继续使用同一服务与账本。 */
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { AI_CREDIT_HTTP } from "@rental-os/shared";
import { AiCreditController } from "@rental-os/ai-native-server/runtime/budget/ai-credit.controller";
import { AiCreditService } from "@rental-os/ai-native-server/runtime/budget/ai-credit.service";

type Request = Parameters<AiCreditController["read"]>[0];
const routes = AI_CREDIT_HTTP;

@Controller(routes.basePath)
export class RentalTenantCreditController {
  private readonly original: AiCreditController;
  constructor(@Inject(AiCreditService) service: AiCreditService) {
    this.original = new AiCreditController(service);
  }
  @Post(routes.read) @HttpCode(200) @Header("Cache-Control", "no-store")
  read(@Req() request: Request, @Body() body: unknown) { return this.original.read(request, body); }
  @Post(routes.request) @HttpCode(200) @Header("Cache-Control", "no-store")
  request(@Req() request: Request, @Body() body: unknown) { return this.original.request(request, body); }
  @Post(routes.receipt) @HttpCode(200) @Header("Cache-Control", "no-store")
  receipt(@Req() request: Request, @Body() body: unknown) { return this.original.receipt(request, body); }
  @Post(routes.allocate) @HttpCode(200) @Header("Cache-Control", "no-store")
  allocate(@Req() request: Request, @Body() body: unknown) { return this.original.allocate(request, body); }
  @Post(routes.allocationReceipt) @HttpCode(200) @Header("Cache-Control", "no-store")
  allocationReceipt(@Req() request: Request, @Body() body: unknown) { return this.original.allocationReceipt(request, body); }
  @Post(routes.calls) @HttpCode(200) @Header("Cache-Control", "no-store")
  calls(@Req() request: Request, @Body() body: unknown) { return this.original.calls(request, body); }
}
