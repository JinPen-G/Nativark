import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  health() {
    return {
      service: "rental-os-api",
      status: "ok",
      time: new Date().toISOString()
    };
  }
}
