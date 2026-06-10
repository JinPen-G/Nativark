import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  StoreRentalReportExportRequest,
  StoreRentalReportQuery,
  StoreRentalReportType
} from "@rimo/shared";
import { ReportsRepository } from "./reports.repository";

@Injectable()
export class ReportsService {
  constructor(private readonly reportsRepository: ReportsRepository) {}

  getDashboard(query: StoreRentalReportQuery) {
    return this.reportsRepository.getDashboard(query);
  }

  getOrdersReport(query: StoreRentalReportQuery) {
    return this.reportsRepository.getOrdersReport(query);
  }

  getVehiclesReport(query: StoreRentalReportQuery) {
    return this.reportsRepository.getVehiclesReport(query);
  }

  getFinanceReport(query: StoreRentalReportQuery) {
    return this.reportsRepository.getFinanceReport(query);
  }

  createExportJob(input: StoreRentalReportExportRequest) {
    if (!this.isReportType(input.reportType)) {
      throw new BadRequestException("报表类型不存在");
    }
    return this.reportsRepository.createExportJob({
      reportType: input.reportType,
      filters: input.filters ?? {},
      operator: input.operator
    });
  }

  listExportJobs(query: StoreRentalReportQuery) {
    return this.reportsRepository.listExportJobs(query);
  }

  getOpsHealth(query: StoreRentalReportQuery) {
    return this.reportsRepository.getOpsHealth(query);
  }

  listOpsLogs(query: StoreRentalReportQuery) {
    return this.reportsRepository.listOpsLogs(query);
  }

  private isReportType(value: StoreRentalReportType | string): value is StoreRentalReportType {
    return ["overview", "orders", "vehicles", "finance", "ops"].includes(value);
  }
}
