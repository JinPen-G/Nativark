/** 公共匿名提交入口。宿主限流成功后进入原幂等创建，不提供个人资料读取或回显。 */
import { Body, Controller, Header, Inject, Optional, Post, Req, UnauthorizedException } from "@nestjs/common";
import { CreateDemoRequestDto } from "./demo-request.dto";
import { DemoRequestService } from "./demo-request.service";
import { DEMO_REQUEST_RATE_LIMIT, type DemoRequestRateLimit } from "./demo-request.store";

@Controller("public/demo-requests")
export class PublicDemoRequestController {
  constructor(private readonly requests: DemoRequestService,
    @Optional() @Inject(DEMO_REQUEST_RATE_LIMIT) private readonly rateLimit?: DemoRequestRateLimit) {}

  @Post()
  @Header("Cache-Control", "no-store")
  async create(@Body() body: CreateDemoRequestDto, @Req() request: { ip?: string; socket?: { remoteAddress?: string } }) {
    if (!this.rateLimit) throw new UnauthorizedException("预约提交安全策略未就绪");
    await this.rateLimit.assertAllowed({ method: "POST", path: "/public/demo-requests", ip: request.ip, socket: request.socket });
    return this.requests.create(body);
  }
}
