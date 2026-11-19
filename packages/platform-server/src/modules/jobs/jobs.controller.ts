/** 原六项作业 HTTP 复用台账与宿主执行入口，缺打印参加者时在调用前明确拒绝。 */
import { Body, Controller, Get, Inject, Param, Post, ServiceUnavailableException } from "@nestjs/common";
import type { CreateAsyncJobRequest, CreatePrintJobRequest } from "@rental-os/platform-contracts/jobs";
import { JOBS_HTTP_APPLICATION, type JobHttpApplication } from "./jobs-http.application";

@Controller("jobs")
export class JobsController {
  constructor(@Inject(JOBS_HTTP_APPLICATION) private readonly jobsApplication: JobHttpApplication) {}

  @Get()
  jobs() {
    return this.jobsApplication.listJobs();
  }

  @Post()
  createJob(@Body() body: CreateAsyncJobRequest) {
    return this.jobsApplication.createJob(body);
  }

  @Post("run-due")
  runDueJobs() {
    return this.jobsApplication.runDueJobs();
  }

  @Post(":id/run")
  runJob(@Param("id") id: string) {
    return this.jobsApplication.runJob(id);
  }

  @Get("print")
  printJobs() {
    if (typeof this.jobsApplication.listPrintJobs !== "function") {
      throw new ServiceUnavailableException("宿主未提供打印参加者");
    }
    return this.jobsApplication.listPrintJobs();
  }

  @Post("print")
  createPrintJob(@Body() body: CreatePrintJobRequest) {
    if (typeof this.jobsApplication.createPrintJob !== "function") {
      throw new ServiceUnavailableException("宿主未提供打印参加者");
    }
    return this.jobsApplication.createPrintJob(body);
  }
}
