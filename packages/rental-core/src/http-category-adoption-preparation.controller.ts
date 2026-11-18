/** Session-scoped HTTP entry for preparation, explicit adoption and original
 * receipts. Rental services own authorization/transactions; the preview guard
 * only limits environment exposure and grants no business permission. */
import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { CategoryGovernancePreviewGuard } from "./http-category-preview.guard";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { RENTAL_HTTP_CATEGORY_PREPARATIONS, RENTAL_HTTP_CATEGORY_ADOPTIONS, type RentalCategoryHttpApplications } from "./http-category-applications";
import { AdoptRentalCategoryDto, CategoryPreparationEntitiesQueryDto, SaveCategoryPreparationBatchDto, SaveCategoryPreparationDto } from "./http-category-adoption.dto";
@Controller("rental/v1/category-adoption")
@UseGuards(CategoryGovernancePreviewGuard)
export class CategoryAdoptionPreparationController {
  constructor(@Inject(RENTAL_HTTP_CATEGORY_PREPARATIONS) private readonly preparations: RentalCategoryHttpApplications["preparations"], @Inject(RENTAL_HTTP_CATEGORY_ADOPTIONS) private readonly adoptions: RentalCategoryHttpApplications["adoptions"]) {}
  @Get("candidates") candidates(@Req() req: { user: SystemUserRow }, @Query("operation") operation = "upgrade") { return this.preparations.candidates(req.user, operation); }
  @Get("operations/:operationKey") receipt(@Req() req: { user: SystemUserRow }, @Param("operationKey") key: string) { return this.adoptions.readOriginal(req.user, key); }
  @Post(":targetId/adopt") adopt(@Req() req: { user: SystemUserRow }, @Param("targetId") targetId: string, @Body() body: AdoptRentalCategoryDto) { return this.adoptions.adopt(req.user, targetId, body); }
  @Get(":targetId/preparation") preview(@Req() req: { user: SystemUserRow }, @Param("targetId") targetId: string, @Query("operation") operation = "upgrade", @Query("metadataOnly") metadataOnly?: string) {
    if (metadataOnly !== undefined && !["true", "false"].includes(metadataOnly)) throw new BadRequestException("元数据读取参数无效");
    return this.preparations.preview(req.user, targetId, operation, metadataOnly === "true");
  }
  @Get(":targetId/preparation/entities") entities(@Req() req: { user: SystemUserRow }, @Param("targetId") targetId: string, @Query() query: CategoryPreparationEntitiesQueryDto) { return this.preparations.entities(req.user, targetId, query); }
  @Get(":targetId/preparation/batches/:batchId") readBatch(@Req() req: { user: SystemUserRow }, @Param("targetId") targetId: string, @Param("batchId") batchId: string) { return this.preparations.readBatch(req.user, targetId, batchId); }
  @Put(":targetId/preparation") save(@Req() req: { user: SystemUserRow }, @Param("targetId") targetId: string, @Body() body: SaveCategoryPreparationDto) { return this.preparations.save(req.user, targetId, body); }
  @Patch(":targetId/preparation") saveBatch(@Req() req: { user: SystemUserRow }, @Param("targetId") targetId: string, @Body() body: SaveCategoryPreparationBatchDto) { return this.preparations.saveBatch(req.user, targetId, body); }
}
