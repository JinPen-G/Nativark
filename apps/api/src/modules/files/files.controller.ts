import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import type { CreateFileAssetRequest, FileAssetQuery } from "@rimo/shared";
import { IntegrationsService } from "../integrations/integrations.service";

@Controller("files")
export class FilesController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  files(@Query() query: FileAssetQuery) {
    return this.integrationsService.listFiles(query);
  }

  @Post()
  createFile(@Body() body: CreateFileAssetRequest) {
    return this.integrationsService.createFile(body);
  }
}
