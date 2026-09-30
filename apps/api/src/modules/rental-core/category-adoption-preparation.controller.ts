import { Body, Controller, Get, Param, Put, Query, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import { CategoryAdoptionPreparationService } from "./category-adoption-preparation.service";
import { SaveCategoryPreparationDto } from "./category-adoption-request.dto";
@Controller("rental/v1/category-adoption")
export class CategoryAdoptionPreparationController {
  constructor(private readonly preparations: CategoryAdoptionPreparationService) {}
  @Get("candidates") candidates(@Req() req: { user: SystemUserRow }, @Query("operation") operation = "upgrade") { return this.preparations.candidates(req.user, operation); }
  @Get(":targetId/preparation") preview(@Req() req: { user: SystemUserRow }, @Param("targetId") targetId: string, @Query("operation") operation = "upgrade") { return this.preparations.preview(req.user, targetId, operation); }
  @Put(":targetId/preparation") save(@Req() req: { user: SystemUserRow }, @Param("targetId") targetId: string, @Body() body: SaveCategoryPreparationDto) { return this.preparations.save(req.user, targetId, body); }
}
