/** Rental品类治理HTTP只委托当前业务服务；预览开关不授予管理权限。
 * 返回类型引用同一应用端口，发行声明不展开宿主生成Client的私有路径。
 */
import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Req, UseGuards } from "@nestjs/common";
import { CategoryGovernancePreviewGuard } from "./http-category-preview.guard";
import type { CategoryDraftSection } from "./category-governance";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { RENTAL_HTTP_CATEGORY_GOVERNANCE, type RentalCategoryHttpApplications } from "./http-category-applications";
import { ArchiveCategoryDraftDto, CreateCategoryDraftDto, CreateRentalCategoryDto, PreviewRentalCategoryCreationDto, PatchCategoryDraftDto, PublishCategoryDraftDto, SaveCategoryOpeningDto, SaveCategoryVersionPolicyDto } from "./http-category-governance.dto";
interface PlatformRequest { user: SystemUserRow; headers?: { authorization?: string } }

@Controller("platform/rental-categories")
@UseGuards(CategoryGovernancePreviewGuard)
export class CategoryGovernanceController {
  constructor(@Inject(RENTAL_HTTP_CATEGORY_GOVERNANCE) private readonly governance: RentalCategoryHttpApplications["governance"]) {}
  @Get() list(@Req() req: PlatformRequest): ReturnType<RentalCategoryHttpApplications["governance"]["list"]> { return this.governance.list(req.user); }
  @Get("capability-catalog") catalog(@Req() req: PlatformRequest) { return this.governance.catalog(req.user); }
  @Get("tenant-directory") tenants(@Req() req: PlatformRequest) { return this.governance.tenantDirectory(req.user); }
  @Post() createCategory(@Body() body: CreateRentalCategoryDto, @Req() req: PlatformRequest) { return this.governance.createCategory(body, req.user, req.headers?.authorization); }
  @Post("creation-preview") previewCreation(@Body() body: PreviewRentalCategoryCreationDto, @Req() req: PlatformRequest) { return this.governance.previewCreation(body, req.user); }
  @Get("creation-requests/:key") creationReceipt(@Param("key") key: string, @Req() req: PlatformRequest) { return this.governance.readCreationReceipt(key, req.user, req.headers?.authorization); }
  @Get(":code") detail(@Param("code") code: string, @Req() req: PlatformRequest): ReturnType<RentalCategoryHttpApplications["governance"]["detail"]> { return this.governance.detail(code, req.user); }
  @Get(":code/candidates/:tenantId/:operation") candidates(@Param("code") code: string, @Param("tenantId") tenantId: string, @Param("operation") operation: string, @Req() req: PlatformRequest) { return this.governance.candidates(code, tenantId, operation, req.user); }
  @Post(":code/drafts") create(@Param("code") code: string, @Body() body: CreateCategoryDraftDto, @Req() req: PlatformRequest): ReturnType<RentalCategoryHttpApplications["governance"]["createDraft"]> { return this.governance.createDraft(code, body, req.user, req.headers?.authorization); }
  @Patch(":code/versions/:id/sections/:section") patch(@Param("code") code: string, @Param("id") id: string, @Param("section") section: CategoryDraftSection, @Body() body: PatchCategoryDraftDto, @Req() req: PlatformRequest): ReturnType<RentalCategoryHttpApplications["governance"]["patchDraft"]> { return this.governance.patchDraft(code, id, section, body, req.user, req.headers?.authorization); }
  @Post(":code/versions/:id/validate") validate(@Param("code") code: string, @Param("id") id: string, @Req() req: PlatformRequest) { return this.governance.validate(code, id, req.user); }
  @Get(":code/versions/:id/preview") preview(@Param("code") code: string, @Param("id") id: string, @Req() req: PlatformRequest) { return this.governance.preview(code, id, req.user); }
  @Post(":code/versions/:id/publish") publish(@Param("code") code: string, @Param("id") id: string, @Body() body: PublishCategoryDraftDto, @Req() req: PlatformRequest): ReturnType<RentalCategoryHttpApplications["governance"]["publish"]> { return this.governance.publish(code, id, body, req.user, req.headers?.authorization); }
  @Post(":code/versions/:id/archive") archive(@Param("code") code: string, @Param("id") id: string, @Body() body: ArchiveCategoryDraftDto, @Req() req: PlatformRequest): ReturnType<RentalCategoryHttpApplications["governance"]["archive"]> { return this.governance.archive(code, id, body, req.user, req.headers?.authorization); }
  @Put(":code/opening-policy") opening(@Param("code") code: string, @Body() body: SaveCategoryOpeningDto, @Req() req: PlatformRequest) { return this.governance.opening(code, body, req.user, req.headers?.authorization); }
  @Put(":code/versions/:id/adoption-policy") policy(@Param("code") code: string, @Param("id") id: string, @Body() body: SaveCategoryVersionPolicyDto, @Req() req: PlatformRequest): ReturnType<RentalCategoryHttpApplications["governance"]["policy"]> { return this.governance.policy(code, id, body, req.user, req.headers?.authorization); }
  @Get(":code/audits") audits(@Param("code") code: string, @Req() req: PlatformRequest): ReturnType<RentalCategoryHttpApplications["governance"]["audits"]> { return this.governance.audits(code, req.user); }
}
