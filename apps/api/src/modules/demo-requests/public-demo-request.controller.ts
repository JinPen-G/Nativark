import { Body, Controller, Header, Post } from "@nestjs/common";
import { CreateDemoRequestDto } from "./demo-request.dto";
import { DemoRequestService } from "./demo-request.service";

/** 原组合 Guard 已执行真实限流，继续只转接公共创建，保持单次扣额及 no-store。 */
@Controller("public/demo-requests")
export class PublicDemoRequestController {
  constructor(private readonly requests: DemoRequestService) {}

  @Post()
  @Header("Cache-Control", "no-store")
  create(@Body() body: CreateDemoRequestDto) {
    return this.requests.create(body);
  }
}
