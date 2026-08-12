import { Body, Controller, Get, Param, Post, Query, Req, Res, StreamableFile } from "@nestjs/common";
import type {
  BillingMode,
  StoreRentalReportExportRequest,
  StoreRentalReportPeriod,
  StoreRentalReportQuery
} from "@store-rental/shared";
import type { SystemUserRow } from "@store-rental/shared";
import { ReportsService } from "./reports.service";

@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get("dashboard")
  dashboard(@Query() query: ReportQueryDto, @Req() req: AuthenticatedRequest) {
    return this.reportsService.getDashboard(toReportQuery(query, req.user.tenantId));
  }

  @Get("orders")
  orders(@Query() query: ReportQueryDto, @Req() req: AuthenticatedRequest) {
    return this.reportsService.getOrdersReport(toReportQuery(query, req.user.tenantId));
  }

  @Get("vehicles")
  vehicles(@Query() query: ReportQueryDto, @Req() req: AuthenticatedRequest) {
    return this.reportsService.getVehiclesReport(toReportQuery(query, req.user.tenantId));
  }

  @Get("finance")
  finance(@Query() query: ReportQueryDto, @Req() req: AuthenticatedRequest) {
    return this.reportsService.getFinanceReport(toReportQuery(query, req.user.tenantId));
  }

  @Get("risk")
  risk(@Query() query: ReportQueryDto, @Req() req: AuthenticatedRequest) {
    return this.reportsService.getRiskReport(toReportQuery(query, req.user.tenantId));
  }

  @Post("exports")
  createExport(@Body() body: StoreRentalReportExportRequest, @Req() req: AuthenticatedRequest) {
    return this.reportsService.createExportJob({
      ...body,
      filters: { ...body.filters, tenantId: req.user.tenantId },
      operator: req.user.displayName
    });
  }

  @Get("exports")
  exports(@Query() query: ReportQueryDto, @Req() req: AuthenticatedRequest) {
    return this.reportsService.listExportJobs(toReportQuery(query, req.user.tenantId));
  }

  @Get("exports/:fileName")
  async downloadExport(
    @Param("fileName") fileName: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true })
    response: { setHeader: (name: string, value: string) => void }
  ) {
    const file = await this.reportsService.getExportFile(fileName, req.user.tenantId);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.fileName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`
    );
    return new StreamableFile(file.content);
  }

  @Get("ops/health")
  opsHealth(@Query() query: ReportQueryDto, @Req() req: AuthenticatedRequest) {
    return this.reportsService.getOpsHealth(toReportQuery(query, req.user.tenantId));
  }

  @Get("ops/logs")
  opsLogs(@Query() query: ReportQueryDto, @Req() req: AuthenticatedRequest) {
    return this.reportsService.listOpsLogs(toReportQuery(query, req.user.tenantId));
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

interface AuthenticatedRequest {
  user: SystemUserRow;
}

function toReportQuery(query: ReportQueryDto, tenantId: string): StoreRentalReportQuery {
  return {
    tenantId,
    from: query.from,
    to: query.to,
    period: query.period,
    storeName: query.storeName,
    vehicleGroupName: query.vehicleGroupName,
    billingMode: query.billingMode,
    riskCategory: query.riskCategory
  };
}
