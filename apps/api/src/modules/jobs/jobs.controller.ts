import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type { CreateAsyncJobRequest, CreatePrintJobRequest } from "@rental-os/shared";
import { IntegrationsService } from "../integrations/integrations.service";

@Controller("jobs")
export class JobsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  jobs() {
    return this.integrationsService.listJobs();
  }

  @Post()
  createJob(@Body() body: CreateAsyncJobRequest) {
    return this.integrationsService.createJob(body);
  }

  @Post("run-due")
  runDueJobs() {
    return this.integrationsService.runDueJobs();
  }

  @Post(":id/run")
  runJob(@Param("id") id: string) {
    return this.integrationsService.runJob(id);
  }

  @Get("print")
  printJobs() {
    return this.integrationsService.listPrintJobs();
  }

  @Post("print")
  createPrintJob(@Body() body: CreatePrintJobRequest) {
    return this.integrationsService.createPrintJob(body);
  }
}
