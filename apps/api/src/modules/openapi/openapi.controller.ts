import { Controller, Get } from "@nestjs/common";
import { OPENAPI_DOCUMENT } from "../../contracts/openapi-document";

@Controller()
export class OpenApiController {
  @Get("openapi.json")
  openApiDocument() {
    return OPENAPI_DOCUMENT;
  }
}
