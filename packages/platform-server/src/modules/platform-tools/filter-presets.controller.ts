/** 原四个筛选预设 HTTP 操作。原 Guard 建立 operator ALS，服务复验当前主体及本租户。 */
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import type { PlatformFilterPresetQuery } from "@rental-os/platform-contracts";
import { SavePlatformFilterPresetDto, SetPlatformFilterPresetDefaultDto } from "./filter-presets.dto";
import { PlatformFilterPresetService } from "./filter-presets.service";

@Controller("platform")
export class PlatformFilterPresetController {
  constructor(private readonly presets: PlatformFilterPresetService) {}

  @Get("filter-presets")
  filterPresets(@Query() query: PlatformFilterPresetQuery) { return this.presets.listFilterPresets(query); }

  @Post("filter-presets")
  saveFilterPreset(@Body() body: SavePlatformFilterPresetDto) { return this.presets.saveFilterPreset(body); }

  @Put("filter-presets/:id/default")
  setDefaultFilterPreset(@Param("id") id: string, @Body() body: SetPlatformFilterPresetDefaultDto) {
    return this.presets.setDefaultFilterPreset(id, body.operator);
  }

  @Delete("filter-presets/:id")
  deleteFilterPreset(@Param("id") id: string, @Query("operator") operator?: string) {
    return this.presets.deleteFilterPreset(id, operator);
  }
}
