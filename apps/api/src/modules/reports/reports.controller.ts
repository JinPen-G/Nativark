import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import type {
  BillingMode,
  StoreRentalReportExportRequest,
  StoreRentalReportPeriod,
  StoreRentalReportQuery
} from "@rimo/shared";
import { ReportsService } from "./reports.service";

@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get("dashboard")
  dashboard(@Query() query: ReportQueryDto) {
    return this.reportsService.getDashboard(toReportQuery(query));
  }

  @Get("orders")
  orders(@Query() query: ReportQueryDto) {
    return this.reportsService.getOrdersReport(toReportQuery(query));
  }

  @Get("vehicles")
  vehicles(@Query() query: ReportQueryDto) {
    return this.reportsService.getVehiclesReport(toReportQuery(query));
  }

  @Get("finance")
  finance(@Query() query: ReportQueryDto) {
    return this.reportsService.getFinanceReport(toReportQuery(query));
  }

  @Post("exports")
  createExport(@Body() body: StoreRentalReportExportRequest) {
    return this.reportsService.createExportJob(body);
  }

  @Get("exports")
  exports(@Query() query: ReportQueryDto) {
    return this.reportsService.listExportJobs(toReportQuery(query));
  }

  @Get("ops/health")
  opsHealth(@Query() query: ReportQueryDto) {
    return this.reportsService.getOpsHealth(toReportQuery(query));
  }

  @Get("ops/logs")
  opsLogs(@Query() query: ReportQueryDto) {
    return this.reportsService.listOpsLogs(toReportQuery(query));
  }
}

interface ReportQueryDto {
  tenantId?: string;
  from?: string;
  to?: string;
  period?: StoreRentalReportPeriod;
  storeName?: string;
  vehicleGroupName?: string;
  billingMode?: BillingMode | "all";
}

function toReportQuery(query: ReportQueryDto): StoreRentalReportQuery {
  return {
    tenantId: query.tenantId,
    from: query.from,
    to: query.to,
    period: query.period,
    storeName: query.storeName,
    vehicleGroupName: query.vehicleGroupName,
    billingMode: query.billingMode
  };
}
