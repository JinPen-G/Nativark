import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  health() {
    return {
      service: "store-rental-api",
      status: "ok",
      time: new Date().toISOString()
    };
  }
}
