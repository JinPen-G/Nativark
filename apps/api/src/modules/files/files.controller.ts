import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { CreateFileAssetRequest, FileAssetQuery } from "@rental-os/shared";
import { IntegrationsService } from "../integrations/integrations.service";
import { FileStorageRuntimeService } from "../integrations/file-storage.runtime.service";
import { CompleteFileUploadDto, CreateFileUploadSessionDto } from "../integrations/file-upload.dto";
import type { SystemUserRow } from "@rental-os/shared";

interface AuthenticatedRequest { user: SystemUserRow; }

@Controller("files")
export class FilesController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly storage: FileStorageRuntimeService
  ) {}

  @Get()
  files(@Query() query: FileAssetQuery) {
    return this.integrationsService.listFiles(query);
  }

  @Post()
  createFile(@Body() body: CreateFileAssetRequest) {
    return this.integrationsService.createFile(body);
  }

  @Post("upload-sessions")
  createUploadSession(@Req() req: AuthenticatedRequest, @Body() body: CreateFileUploadSessionDto) {
    return this.storage.createUploadSession(req.user.tenantId, body);
  }

  @Post("upload-sessions/:id/complete")
  completeUpload(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: CompleteFileUploadDto) {
    return this.storage.completeUpload(req.user.tenantId, id, body);
  }

  @Get(":id/download-url")
  downloadUrl(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.storage.downloadUrl(req.user.tenantId, id);
  }
}
