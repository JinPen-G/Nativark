/** 租户预算管理的原 Controller 消费者。只声明租户方法，平台方法由独立平台授权宿主装配。
 * DTO、配置与原操作收据继续由原 Controller 校验，保存不授予模型执行权限。 */
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { AI_BUDGET_MANAGEMENT_HTTP_DRAFT } from "@rental-os/shared";
import { AiBudgetManagementController, AI_BUDGET_MANAGEMENT }
  from "@rental-os/ai-native-server/runtime/budget/budget-management.module";

type Application = ConstructorParameters<typeof AiBudgetManagementController>[0];
type Request = Parameters<AiBudgetManagementController["read"]>[0];
const routes = AI_BUDGET_MANAGEMENT_HTTP_DRAFT;

@Controller(routes.basePath)
export class RentalTenantBudgetController {
  private readonly original: AiBudgetManagementController;
  constructor(@Inject(AI_BUDGET_MANAGEMENT) application: Application) {
    this.original = new AiBudgetManagementController(application);
  }
  @Post(routes.read) @HttpCode(200) @Header("Cache-Control", "no-store")
  read(@Req() request: Request, @Body() body: unknown) { return this.original.read(request, body); }
  @Post(routes.readOperation) @HttpCode(200) @Header("Cache-Control", "no-store")
  readOperation(@Req() request: Request, @Body() body: unknown) { return this.original.readOperation(request, body); }
  @Post(routes.initialize) @HttpCode(200) @Header("Cache-Control", "no-store")
  initialize(@Req() request: Request, @Body() body: unknown) { return this.original.initialize(request, body); }
  @Post(routes.change) @HttpCode(200) @Header("Cache-Control", "no-store")
  change(@Req() request: Request, @Body() body: unknown) { return this.original.change(request, body); }
  @Post(routes.refreshConfiguration) @HttpCode(200) @Header("Cache-Control", "no-store")
  refreshConfiguration(@Req() request: Request, @Body() body: unknown) { return this.original.refreshConfiguration(request, body); }
  @Post(routes.readPriceConfiguration) @HttpCode(200) @Header("Cache-Control", "no-store")
  readPriceConfiguration(@Req() request: Request, @Body() body: unknown) { return this.original.readPriceConfiguration(request, body); }
  @Post(routes.reviewPrice) @HttpCode(200) @Header("Cache-Control", "no-store")
  reviewPrice(@Req() request: Request, @Body() body: unknown) { return this.original.reviewPrice(request, body); }
  @Post(routes.readPriceReview) @HttpCode(200) @Header("Cache-Control", "no-store")
  readPriceReview(@Req() request: Request, @Body() body: unknown) { return this.original.readPriceReview(request, body); }
  @Post(routes.previewPlatformPrice) @HttpCode(200) @Header("Cache-Control", "no-store")
  previewPlatformPrice(@Req() request: Request, @Body() body: unknown) { return this.original.previewPlatformPrice(request, body); }
  @Post(routes.adoptPlatformPrice) @HttpCode(200) @Header("Cache-Control", "no-store")
  adoptPlatformPrice(@Req() request: Request, @Body() body: unknown) { return this.original.adoptPlatformPrice(request, body); }
  @Post(routes.readPlatformPriceAdoption) @HttpCode(200) @Header("Cache-Control", "no-store")
  readPlatformPriceAdoption(@Req() request: Request, @Body() body: unknown) { return this.original.readPlatformPriceAdoption(request, body); }
}
