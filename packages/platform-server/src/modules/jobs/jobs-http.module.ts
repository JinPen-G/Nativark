/** 公共作业 HTTP 装配，宿主供给同一台账及所选 Core 的打印和执行能力。 */
import { Module, type DynamicModule, type FactoryProvider, type ModuleMetadata } from "@nestjs/common";
import { JobsController } from "./jobs.controller";
import { JOBS_HTTP_APPLICATION, type JobHttpApplication } from "./jobs-http.application";

@Module({})
export class JobsHttpModule {
  static register<Dependencies extends unknown[]>(options: {
    imports?: ModuleMetadata["imports"];
    inject?: FactoryProvider["inject"];
    useFactory: (...dependencies: Dependencies) => JobHttpApplication | Promise<JobHttpApplication>;
  }): DynamicModule {
    return {
      module: JobsHttpModule,
      imports: options.imports ?? [],
      controllers: [JobsController],
      providers: [{
        provide: JOBS_HTTP_APPLICATION,
        inject: options.inject ?? [],
        useFactory: options.useFactory
      }],
      exports: [JOBS_HTTP_APPLICATION]
    };
  }
}
