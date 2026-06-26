import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile } from "@nestjs/common";
import type {
  BillingMode,
  StoreRentalReportExportRequest,
  StoreRentalReportPeriod,
  StoreRentalReportQuery
} from "@store-rental/shared";
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

  @Get("risk")
  risk(@Query() query: ReportQueryDto) {
    return this.reportsService.getRiskReport(toReportQuery(query));
  }

  @Post("exports")
  createExport(@Body() body: StoreRentalReportExportRequest) {
    return this.reportsService.createExportJob(body);
  }

  @Get("exports")
  exports(@Query() query: ReportQueryDto) {
    return this.reportsService.listExportJobs(toReportQuery(query));
  }

  @Get("exports/:fileName")
  async downloadExport(
    @Param("fileName") fileName: string,
    @Res({ passthrough: true })
    response: { setHeader: (name: string, value: string) => void }
  ) {
    const file = await this.reportsService.getExportFile(fileName);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.fileName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`
    );
    return new StreamableFile(file.content);
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
  riskCategory?: string;
}

function toReportQuery(query: ReportQueryDto): StoreRentalReportQuery {
  return {
    tenantId: query.tenantId,
    from: query.from,
    to: query.to,
    period: query.period,
    storeName: query.storeName,
    vehicleGroupName: query.vehicleGroupName,
    billingMode: query.billingMode,
    riskCategory: query.riskCategory
  };
}
