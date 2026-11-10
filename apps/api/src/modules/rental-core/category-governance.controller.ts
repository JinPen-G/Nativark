import { Body, Controller, Get, Param, Patch, Post, Put, Req, UseGuards } from "@nestjs/common";
import { CategoryGovernancePreviewGuard } from "./category-governance-preview.guard";
import type { CategoryDraftSection, SystemUserRow } from "@rental-os/shared";
import { CategoryGovernanceService } from "./category-governance.service";
import { ArchiveCategoryDraftDto, CreateCategoryDraftDto, CreateRentalCategoryDto, PreviewRentalCategoryCreationDto, PatchCategoryDraftDto, PublishCategoryDraftDto, SaveCategoryOpeningDto, SaveCategoryVersionPolicyDto } from "./category-governance-request.dto";
interface PlatformRequest { user: SystemUserRow }

@Controller("platform/rental-categories")
@UseGuards(CategoryGovernancePreviewGuard)
export class CategoryGovernanceController {
  constructor(private readonly governance: CategoryGovernanceService) {}
  @Get() list(@Req() req: PlatformRequest) { return this.governance.list(req.user); }
  @Get("capability-catalog") catalog(@Req() req: PlatformRequest) { return this.governance.catalog(req.user); }
  @Get("tenant-directory") tenants(@Req() req: PlatformRequest) { return this.governance.tenantDirectory(req.user); }
  @Post() createCategory(@Body() body: CreateRentalCategoryDto, @Req() req: PlatformRequest) { return this.governance.createCategory(body, req.user); }
  @Post("creation-preview") previewCreation(@Body() body: PreviewRentalCategoryCreationDto, @Req() req: PlatformRequest) { return this.governance.previewCreation(body, req.user); }
  @Get("creation-requests/:key") creationReceipt(@Param("key") key: string, @Req() req: PlatformRequest) { return this.governance.readCreationReceipt(key, req.user); }
  @Get(":code") detail(@Param("code") code: string, @Req() req: PlatformRequest) { return this.governance.detail(code, req.user); }
  @Get(":code/candidates/:tenantId/:operation") candidates(@Param("code") code: string, @Param("tenantId") tenantId: string, @Param("operation") operation: string, @Req() req: PlatformRequest) { return this.governance.candidates(code, tenantId, operation, req.user); }
  @Post(":code/drafts") create(@Param("code") code: string, @Body() body: CreateCategoryDraftDto, @Req() req: PlatformRequest) { return this.governance.createDraft(code, body, req.user); }
  @Patch(":code/versions/:id/sections/:section") patch(@Param("code") code: string, @Param("id") id: string, @Param("section") section: CategoryDraftSection, @Body() body: PatchCategoryDraftDto, @Req() req: PlatformRequest) { return this.governance.patchDraft(code, id, section, body, req.user); }
  @Post(":code/versions/:id/validate") validate(@Param("code") code: string, @Param("id") id: string, @Req() req: PlatformRequest) { return this.governance.validate(code, id, req.user); }
  @Get(":code/versions/:id/preview") preview(@Param("code") code: string, @Param("id") id: string, @Req() req: PlatformRequest) { return this.governance.preview(code, id, req.user); }
  @Post(":code/versions/:id/publish") publish(@Param("code") code: string, @Param("id") id: string, @Body() body: PublishCategoryDraftDto, @Req() req: PlatformRequest) { return this.governance.publish(code, id, body, req.user); }
  @Post(":code/versions/:id/archive") archive(@Param("code") code: string, @Param("id") id: string, @Body() body: ArchiveCategoryDraftDto, @Req() req: PlatformRequest) { return this.governance.archive(code, id, body, req.user); }
  @Put(":code/opening-policy") opening(@Param("code") code: string, @Body() body: SaveCategoryOpeningDto, @Req() req: PlatformRequest) { return this.governance.opening(code, body, req.user); }
  @Put(":code/versions/:id/adoption-policy") policy(@Param("code") code: string, @Param("id") id: string, @Body() body: SaveCategoryVersionPolicyDto, @Req() req: PlatformRequest) { return this.governance.policy(code, id, body, req.user); }
  @Get(":code/audits") audits(@Param("code") code: string, @Req() req: PlatformRequest) { return this.governance.audits(code, req.user); }
}
