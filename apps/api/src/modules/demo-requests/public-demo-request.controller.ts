import { Body, Controller, Header, Post } from "@nestjs/common";
import { CreateDemoRequestDto } from "./demo-request.dto";
import { DemoRequestService } from "./demo-request.service";

/** 匿名只允许提交；不提供按联系方式查询或回显个人资料的接口。 */
@Controller("public/demo-requests")
export class PublicDemoRequestController {
  constructor(private readonly requests: DemoRequestService) {}

  @Post()
  @Header("Cache-Control", "no-store")
  create(@Body() body: CreateDemoRequestDto) {
    return this.requests.create(body);
  }
}
