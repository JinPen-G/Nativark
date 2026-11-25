/** 公共健康入口，没有Core依赖；可用数据库/业务状态由相应探针和业务准入单独核验。 */
import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class PlatformHealthController {
  @Get()
  health() { return { service: "nativark-platform-api", status: "ok", time: new Date().toISOString() }; }
}
