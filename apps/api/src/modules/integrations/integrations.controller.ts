import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import type {
  BindTBoxDeviceRequest,
  CreateDataExchangeJobRequest,
  InvokeMockAdapterRequest,
  SaveTBoxDeviceRequest
} from "@rental-os/shared";
import { IntegrationsService } from "./integrations.service";

@Controller("integrations")
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

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
