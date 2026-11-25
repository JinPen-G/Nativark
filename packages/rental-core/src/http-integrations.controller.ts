/** Rental 原运营集成 HTTP。宿主供给同一业务应用及当前 Auth、Guard、ALS。 */
import { Body, Controller, Get, Inject, Param, Post, Put } from "@nestjs/common";
import type {
  BindTBoxDeviceRequest,
  CreateDataExchangeJobRequest,
  InvokeMockAdapterRequest,
  SaveTBoxDeviceRequest
} from "./integration-contracts";
import type { RentalIntegrationApplication } from "./integration-runtime";

export const RENTAL_INTEGRATIONS_HTTP_APPLICATION = Symbol("rental.http.integrations");

export type RentalIntegrationsHttpApplication = Pick<RentalIntegrationApplication,
  "getDashboard" | "listAdapterLogs" | "invokeMockAdapter" | "listDataExchangeTemplates"
  | "createDataExchangeJob" | "listTBoxDevices" | "saveTBoxDevice" | "bindTBoxDevice"
>;

@Controller("integrations")
export class IntegrationsController {
  constructor(
    @Inject(RENTAL_INTEGRATIONS_HTTP_APPLICATION)
    private readonly integrationsService: RentalIntegrationsHttpApplication
  ) {}

  @Get("dashboard")
  dashboard() {
    return this.integrationsService.getDashboard();
  }

  @Get("adapter-logs")
  adapterLogs() {
    return this.integrationsService.listAdapterLogs();
  }

  @Post("adapters/mock-call")
  mockCall(@Body() body: InvokeMockAdapterRequest) {
    return this.integrationsService.invokeMockAdapter(body);
  }

  @Get("data-exchange/templates")
  dataExchangeTemplates() {
    return this.integrationsService.listDataExchangeTemplates();
  }

  @Post("data-exchange/jobs")
  createDataExchangeJob(@Body() body: CreateDataExchangeJobRequest) {
    return this.integrationsService.createDataExchangeJob(body);
  }

  @Get("tbox-devices")
  tboxDevices() {
    return this.integrationsService.listTBoxDevices();
  }

  @Post("tbox-devices")
  createTBoxDevice(@Body() body: SaveTBoxDeviceRequest) {
    return this.integrationsService.saveTBoxDevice(body);
  }

  @Put("tbox-devices/:id")
  updateTBoxDevice(
    @Param("id") id: string,
    @Body() body: SaveTBoxDeviceRequest
  ) {
    return this.integrationsService.saveTBoxDevice({ ...body, id });
  }

  @Post("tbox-devices/:id/bind")
  bindTBoxDevice(@Param("id") id: string, @Body() body: BindTBoxDeviceRequest) {
    return this.integrationsService.bindTBoxDevice(id, body);
  }
}
