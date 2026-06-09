import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import type {
  CreateVehicleConditionPhotoRecordRequest,
  CreatePriceAdjustmentScheduleRequest,
  CreateVehicleLocationEventRequest,
  CreateVehicleAccidentRecordRequest,
  CreateVehicleMaintenanceRecordRequest,
  CreateVehicleTransferTaskRequest,
  MemberReviewTask,
  CreateStoreRentalFeeRequest,
  CreateStoreRentalContractRequest,
  CreateStoreRentalNotificationRequest,
  CreateStoreRentalOperationLockRequest,
  CreateStoreRentalOrderRequest,
  CreateStoreRentalRemarkRequest,
  CreateStoreRentalTransactionRequest,
  StoreRentalDispatchApplyRequest,
  StoreRentalDispatchEventQuery,
  StoreRentalDispatchHardLockRequest,
  StoreRentalDispatchManualReassignRequest,
  StoreRentalDispatchOptimizeRequest,
  StoreRentalDispatchTaskQuery,
  StoreRentalDispatchVehicleUnavailableRequest,
  StoreRentalAiDispatchAnalyzeRequest,
  MembershipPlanSummary,
  PricingQuoteRequest,
  ProcessFinanceManualAdjustmentRequest,
  ProcessMemberReviewRequest,
  ProcessMemberRiskRequest,
  CorporateDetail,
  CorporateListQuery,
  CorporateSummary,
  CreateCorporateContractAttachmentRequest,
  MemberDetail,
  MemberListQuery,
  SaveCorporateRequest,
  SaveFinanceDocumentRequest,
  SaveFinanceManualAdjustmentRequest,
  SaveFinancePreAuthorizationRequest,
  SaveMarketingPlanRequest,
  SaveMemberRequest,
  SaveMembershipPlanRequest,
  SavePricingPlanRequest,
  SaveStoreRentalRuleConfigRequest,
  SaveStationCalendarDayRequest,
  SaveVehicleCredentialRequest,
  SaveVehicleOnboardItemRequest,
  SettleCorporateMonthlyBillRequest,
  StoreRentalAvailabilityRequest,
  StoreStationListQuery,
  StoreStationSummary,
  StoreValueAddedServiceSummary,
  UpdateVehicleAccidentRecordRequest,
  UpdateVehicleLocationEventRequest,
  UpdateVehicleMaintenanceRecordRequest,
  BindTboxDeviceRequest,
  RunTboxCommandRequest,
  WaiveStoreRentalFeeRequest,
  VehicleGroupMaster,
  VehicleInstanceSummary,
  VehicleListQuery
} from "@rimo/shared";
import { StoreRentalService } from "./store-rental.service";

@Controller("store-rental")
export class StoreRentalController {
  constructor(private readonly storeRentalService: StoreRentalService) {}

  @Get("rules")
  rules() {
    return this.storeRentalService.getRuleConfig();
  }

  @Get("rules/versions")
  ruleVersions() {
    return this.storeRentalService.listRuleVersions();
  }

  @Get("rules/versions/:version")
  ruleVersion(@Param("version") version: string) {
    return this.storeRentalService.getRuleVersion(version);
  }

  @Put("rules")
  saveRules(@Body() body: SaveStoreRentalRuleConfigRequest) {
    return this.storeRentalService.saveRuleConfig(body);
  }

  @Get("pricing/plans")
  pricingPlans() {
    return this.storeRentalService.listPricingPlans();
  }

  @Get("pricing/plans/:id")
  pricingPlan(@Param("id") id: string) {
    return this.storeRentalService.getPricingPlan(id);
  }

  @Put("pricing/plans/:id")
  savePricingPlan(@Param("id") id: string, @Body() body: SavePricingPlanRequest) {
    return this.storeRentalService.savePricingPlan(id, body);
  }

  @Post("pricing/schedules")
  createPriceSchedule(@Body() body: CreatePriceAdjustmentScheduleRequest) {
    return this.storeRentalService.createPriceSchedule(body);
  }

  @Patch("pricing/schedules/:id/cancel")
  cancelPriceSchedule(@Param("id") id: string) {
    return this.storeRentalService.cancelPriceSchedule(id);
  }

  @Post("pricing/quote")
  quote(@Body() body: PricingQuoteRequest) {
    return this.storeRentalService.quote(body);
  }

  @Get("marketing/plans")
  marketingPlans() {
    return this.storeRentalService.listMarketingPlans();
  }

  @Get("marketing/plans/:id")
  marketingPlan(@Param("id") id: string) {
    return this.storeRentalService.getMarketingPlan(id);
  }

  @Post("marketing/plans")
  createMarketingPlan(@Body() body: SaveMarketingPlanRequest) {
    return this.storeRentalService.saveMarketingPlan(body);
  }

  @Put("marketing/plans/:id")
  updateMarketingPlan(@Param("id") id: string, @Body() body: SaveMarketingPlanRequest) {
    return this.storeRentalService.saveMarketingPlan({ ...body, id });
  }

  @Post("availability")
  availability(@Body() body: StoreRentalAvailabilityRequest) {
    return this.storeRentalService.checkAvailability(body);
  }

  @Get("workflow")
  workflow() {
    return this.storeRentalService.getWorkflow();
  }

  @Get("dispatch/board")
  dispatchBoard(
    @Query("windowDays") windowDays?: string,
    @Query("referenceDate") referenceDate?: string,
    @Query("storeName") storeName?: string,
    @Query("vehicleGroupName") vehicleGroupName?: string
  ) {
    return this.storeRentalService.getDispatchBoard({
      windowDays: Number(windowDays || 7) as StoreRentalDispatchOptimizeRequest["windowDays"],
      referenceDate,
      storeName,
      vehicleGroupName
    });
  }

  @Get("dispatch/tasks")
  dispatchTasks(
    @Query("windowDays") windowDays?: string,
    @Query("referenceDate") referenceDate?: string,
    @Query("storeName") storeName?: string,
    @Query("vehicleGroupName") vehicleGroupName?: string
  ) {
    return this.storeRentalService.listDispatchTasks({
      windowDays: windowDays
        ? (Number(windowDays) as StoreRentalDispatchTaskQuery["windowDays"])
        : undefined,
      referenceDate,
      storeName,
      vehicleGroupName
    });
  }

  @Get("dispatch/events")
  dispatchEvents(
    @Query("orderId") orderId?: string,
    @Query("planId") planId?: string,
    @Query("limit") limit?: string
  ) {
    return this.storeRentalService.listDispatchEvents({
      orderId,
      planId,
      limit: limit ? Number(limit) : undefined
    } as StoreRentalDispatchEventQuery);
  }

  @Post("dispatch/optimize")
  dispatchOptimize(@Body() body: StoreRentalDispatchOptimizeRequest) {
    return this.storeRentalService.previewDispatchOptimization(body);
  }

  @Post("dispatch/apply")
  dispatchApply(@Body() body: StoreRentalDispatchApplyRequest) {
    return this.storeRentalService.applyDispatchOptimization(body);
  }

  @Post("dispatch/hard-lock")
  dispatchHardLock(@Body() body: StoreRentalDispatchHardLockRequest) {
    return this.storeRentalService.hardLockDispatchOrders(body);
  }

  @Post("dispatch/manual-reassign")
  dispatchManualReassign(@Body() body: StoreRentalDispatchManualReassignRequest) {
    return this.storeRentalService.manualReassignFromDispatch(body);
  }

  @Post("dispatch/vehicle-unavailable")
  dispatchVehicleUnavailable(
    @Body() body: StoreRentalDispatchVehicleUnavailableRequest
  ) {
    return this.storeRentalService.processDispatchVehicleUnavailable(body);
  }

  @Post("dispatch/ai-analysis")
  dispatchAiAnalysis(@Body() body: StoreRentalAiDispatchAnalyzeRequest) {
    return this.storeRentalService.analyzeDispatchWithAi(body);
  }

  @Get("stations")
  stations(
    @Query("keyword") keyword?: string,
    @Query("serviceCapability") serviceCapability?: string,
    @Query("serviceStatus") serviceStatus?: StoreStationListQuery["serviceStatus"],
    @Query("status") status?: StoreStationListQuery["status"],
    @Query("scopeType") scopeType?: StoreStationListQuery["scopeType"],
    @Query("scopeLabel") scopeLabel?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    const query: StoreStationListQuery = {
      keyword,
      serviceCapability,
      serviceStatus,
      status,
      scopeType,
      scopeLabel,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    };
    const hasQuery = Object.values(query).some((value) => value !== undefined && value !== "");
    return hasQuery
      ? this.storeRentalService.listStationPage(query)
      : this.storeRentalService.listStations();
  }

  @Get("stations/hierarchy")
  stationHierarchy() {
    return this.storeRentalService.listStationHierarchy();
  }

  @Get("stations/capacity-snapshots")
  stationCapacitySnapshots(@Query("stationId") stationId?: string) {
    return this.storeRentalService.listStationCapacitySnapshots(stationId);
  }

  @Post("stations/capacity-snapshots/refresh")
  refreshStationCapacitySnapshots(@Body("stationId") stationId?: string) {
    return this.storeRentalService.refreshStationCapacitySnapshots(stationId);
  }

  @Get("stations/:id/calendar")
  stationCalendar(@Param("id") id: string) {
    return this.storeRentalService.listStationCalendar(id);
  }

  @Put("stations/:id/calendar")
  saveStationCalendar(
    @Param("id") id: string,
    @Body() body: SaveStationCalendarDayRequest
  ) {
    return this.storeRentalService.saveStationCalendarDay(id, body);
  }

  @Post("stations")
  createStation(@Body() body: StoreStationSummary) {
    return this.storeRentalService.saveStation(body);
  }

  @Put("stations/:id")
  updateStation(@Param("id") id: string, @Body() body: StoreStationSummary) {
    return this.storeRentalService.saveStation({ ...body, id });
  }

  @Get("vehicle-groups")
  vehicleGroups() {
    return this.storeRentalService.listVehicleGroups();
  }

  @Post("vehicle-groups")
  createVehicleGroup(@Body() body: VehicleGroupMaster) {
    return this.storeRentalService.saveVehicleGroup(body);
  }

  @Put("vehicle-groups/:id")
  updateVehicleGroup(@Param("id") id: string, @Body() body: VehicleGroupMaster) {
    return this.storeRentalService.saveVehicleGroup({ ...body, id });
  }

  @Delete("vehicle-groups/:id")
  deleteVehicleGroup(@Param("id") id: string) {
    return this.storeRentalService.deleteVehicleGroup(id);
  }

  @Get("vehicles")
  vehicles(
    @Query("keyword") keyword?: string,
    @Query("operationStatus") operationStatus?: VehicleListQuery["operationStatus"],
    @Query("serviceType") serviceType?: VehicleListQuery["serviceType"],
    @Query("storeName") storeName?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    const query: VehicleListQuery = {
      keyword,
      operationStatus,
      serviceType,
      storeName,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    };
    const hasQuery = Object.values(query).some((value) => value !== undefined && value !== "");
    return hasQuery
      ? this.storeRentalService.listVehiclePage(query)
      : this.storeRentalService.listVehicles();
  }

  @Get("vehicles/transfer-tasks")
  vehicleTransferTasks() {
    return this.storeRentalService.listVehicleTransferTasks();
  }

  @Post("vehicles/transfer-tasks")
  createVehicleTransferTask(@Body() body: CreateVehicleTransferTaskRequest) {
    return this.storeRentalService.createVehicleTransferTask(body);
  }

  @Get("tbox-devices")
  tboxDevices() {
    return this.storeRentalService.listTboxDevices();
  }

  @Put("tbox-devices/:id/binding")
  bindTboxDevice(@Param("id") id: string, @Body() body: BindTboxDeviceRequest) {
    return this.storeRentalService.bindTboxDevice(id, body);
  }

  @Post("tbox-devices/:id/commands")
  runTboxCommand(@Param("id") id: string, @Body() body: RunTboxCommandRequest) {
    return this.storeRentalService.runTboxCommand(id, body);
  }

  @Get("vehicles/:id")
  vehicleDetail(@Param("id") id: string) {
    return this.storeRentalService.getVehicleDetail(id);
  }

  @Post("vehicles/:id/location-events")
  createVehicleLocationEvent(
    @Param("id") id: string,
    @Body() body: CreateVehicleLocationEventRequest
  ) {
    return this.storeRentalService.createVehicleLocationEvent(id, body);
  }

  @Patch("vehicles/:id/location-events/:recordId")
  updateVehicleLocationEvent(
    @Param("id") id: string,
    @Param("recordId") recordId: string,
    @Body() body: UpdateVehicleLocationEventRequest
  ) {
    return this.storeRentalService.updateVehicleLocationEvent(id, recordId, body);
  }

  @Post("vehicles/:id/condition-photos")
  createVehicleConditionPhotoRecord(
    @Param("id") id: string,
    @Body() body: CreateVehicleConditionPhotoRecordRequest
  ) {
    return this.storeRentalService.createVehicleConditionPhotoRecord(id, body);
  }

  @Post("vehicles/:id/maintenance-records")
  createVehicleMaintenanceRecord(
    @Param("id") id: string,
    @Body() body: CreateVehicleMaintenanceRecordRequest
  ) {
    return this.storeRentalService.createVehicleMaintenanceRecord(id, body);
  }

  @Get("vehicles/:id/credentials")
  vehicleCredentials(@Param("id") id: string) {
    return this.storeRentalService.listVehicleCredentials(id);
  }

  @Put("vehicles/:id/credentials")
  saveVehicleCredential(
    @Param("id") id: string,
    @Body() body: SaveVehicleCredentialRequest
  ) {
    return this.storeRentalService.saveVehicleCredential(id, body);
  }

  @Get("vehicles/:id/onboard-items")
  vehicleOnboardItems(@Param("id") id: string) {
    return this.storeRentalService.listVehicleOnboardItems(id);
  }

  @Put("vehicles/:id/onboard-items")
  saveVehicleOnboardItem(
    @Param("id") id: string,
    @Body() body: SaveVehicleOnboardItemRequest
  ) {
    return this.storeRentalService.saveVehicleOnboardItem(id, body);
  }

  @Patch("vehicles/:id/maintenance-records/:recordId")
  updateVehicleMaintenanceRecord(
    @Param("id") id: string,
    @Param("recordId") recordId: string,
    @Body() body: UpdateVehicleMaintenanceRecordRequest
  ) {
    return this.storeRentalService.updateVehicleMaintenanceRecord(id, recordId, body);
  }

  @Post("vehicles/:id/accident-records")
  createVehicleAccidentRecord(
    @Param("id") id: string,
    @Body() body: CreateVehicleAccidentRecordRequest
  ) {
    return this.storeRentalService.createVehicleAccidentRecord(id, body);
  }

  @Patch("vehicles/:id/accident-records/:recordId")
  updateVehicleAccidentRecord(
    @Param("id") id: string,
    @Param("recordId") recordId: string,
    @Body() body: UpdateVehicleAccidentRecordRequest
  ) {
    return this.storeRentalService.updateVehicleAccidentRecord(id, recordId, body);
  }

  @Get("members")
  members(
    @Query("keyword") keyword?: string,
    @Query("status") status?: MemberListQuery["status"],
    @Query("reviewStatus") reviewStatus?: MemberListQuery["reviewStatus"],
    @Query("tag") tag?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    return this.storeRentalService.listMembers({
      keyword,
      status,
      reviewStatus,
      tag,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    });
  }

  @Get("members/:id")
  memberDetail(@Param("id") id: string) {
    return this.storeRentalService.getMemberDetail(id);
  }

  @Post("members")
  createMember(@Body() body: SaveMemberRequest) {
    return this.storeRentalService.saveMember(body);
  }

  @Put("members/:id")
  updateMember(@Param("id") id: string, @Body() body: SaveMemberRequest) {
    return this.storeRentalService.saveMember({ ...body, id });
  }

  @Post("members/:id/risk-actions")
  processMemberRisk(
    @Param("id") id: string,
    @Body() body: ProcessMemberRiskRequest
  ) {
    return this.storeRentalService.processMemberRisk(id, body);
  }

  @Get("member-reviews")
  memberReviews() {
    return this.storeRentalService.listMemberReviews();
  }

  @Post("member-reviews/:id/process")
  processMemberReview(
    @Param("id") id: string,
    @Body() body: ProcessMemberReviewRequest
  ) {
    return this.storeRentalService.processMemberReview(id, body);
  }

  @Get("membership-plans")
  membershipPlans() {
    return this.storeRentalService.listMembershipPlans();
  }

  @Post("membership-plans")
  createMembershipPlan(@Body() body: SaveMembershipPlanRequest) {
    return this.storeRentalService.saveMembershipPlan(body);
  }

  @Put("membership-plans/:id")
  updateMembershipPlan(
    @Param("id") id: string,
    @Body() body: SaveMembershipPlanRequest
  ) {
    return this.storeRentalService.saveMembershipPlan({ ...body, id });
  }

  @Get("corporates")
  corporates(@Query() query: CorporateListQuery) {
    const hasQuery = Object.values(query).some((value) => value !== undefined && value !== "");
    return hasQuery
      ? this.storeRentalService.listCorporatePage(query)
      : this.storeRentalService.listCorporates();
  }

  @Get("corporates/:id/monthly-bills")
  corporateMonthlyBills(@Param("id") id: string) {
    return this.storeRentalService.listCorporateMonthlyBills(id);
  }

  @Post("corporates/:id/monthly-bills/:billId/settle")
  settleCorporateMonthlyBill(
    @Param("id") id: string,
    @Param("billId") billId: string,
    @Body() body: SettleCorporateMonthlyBillRequest
  ) {
    return this.storeRentalService.settleCorporateMonthlyBill(id, billId, body);
  }

  @Get("corporates/:id/contracts/:contractId/attachments")
  corporateContractAttachments(
    @Param("id") id: string,
    @Param("contractId") contractId: string
  ) {
    return this.storeRentalService.listCorporateContractAttachments(id, contractId);
  }

  @Post("corporates/:id/contracts/:contractId/attachments")
  createCorporateContractAttachment(
    @Param("id") id: string,
    @Param("contractId") contractId: string,
    @Body() body: CreateCorporateContractAttachmentRequest
  ) {
    return this.storeRentalService.createCorporateContractAttachment(
      id,
      contractId,
      body
    );
  }

  @Get("finance/overview")
  financeOverview() {
    return this.storeRentalService.getFinanceOverview();
  }

  @Get("finance/transactions")
  financeTransactions() {
    return this.storeRentalService.listFinanceTransactions();
  }

  @Get("finance/documents")
  financeDocuments() {
    return this.storeRentalService.listFinanceDocuments();
  }

  @Post("finance/documents")
  createFinanceDocument(@Body() body: SaveFinanceDocumentRequest) {
    return this.storeRentalService.saveFinanceDocument(body);
  }

  @Put("finance/documents/:id")
  updateFinanceDocument(
    @Param("id") id: string,
    @Body() body: SaveFinanceDocumentRequest
  ) {
    return this.storeRentalService.saveFinanceDocument({ ...body, id });
  }

  @Get("finance/pre-authorizations")
  financePreAuthorizations() {
    return this.storeRentalService.listFinancePreAuthorizations();
  }

  @Post("finance/pre-authorizations")
  createFinancePreAuthorization(@Body() body: SaveFinancePreAuthorizationRequest) {
    return this.storeRentalService.saveFinancePreAuthorization(body);
  }

  @Put("finance/pre-authorizations/:id")
  updateFinancePreAuthorization(
    @Param("id") id: string,
    @Body() body: SaveFinancePreAuthorizationRequest
  ) {
    return this.storeRentalService.saveFinancePreAuthorization({ ...body, id });
  }

  @Get("finance/manual-adjustments")
  financeManualAdjustments() {
    return this.storeRentalService.listFinanceManualAdjustments();
  }

  @Post("finance/manual-adjustments")
  createFinanceManualAdjustment(@Body() body: SaveFinanceManualAdjustmentRequest) {
    return this.storeRentalService.createFinanceManualAdjustment(body);
  }

  @Post("finance/manual-adjustments/:id/process")
  processFinanceManualAdjustment(
    @Param("id") id: string,
    @Body() body: ProcessFinanceManualAdjustmentRequest
  ) {
    return this.storeRentalService.processFinanceManualAdjustment(id, body);
  }

  @Get("finance/reconciliation")
  financeReconciliation() {
    return this.storeRentalService.listFinanceReconciliationRows();
  }

  @Get("corporates/:id")
  corporateDetail(@Param("id") id: string) {
    return this.storeRentalService.getCorporateDetail(id);
  }

  @Post("corporates")
  createCorporate(@Body() body: SaveCorporateRequest) {
    return this.storeRentalService.saveCorporate(body);
  }

  @Put("corporates/:id")
  updateCorporate(@Param("id") id: string, @Body() body: SaveCorporateRequest) {
    return this.storeRentalService.saveCorporate({ ...body, id });
  }

  @Post("vehicles")
  createVehicle(@Body() body: VehicleInstanceSummary) {
    return this.storeRentalService.saveVehicle(body);
  }

  @Put("vehicles/:id")
  updateVehicle(@Param("id") id: string, @Body() body: VehicleInstanceSummary) {
    return this.storeRentalService.saveVehicle({ ...body, id });
  }

  @Patch("vehicles/:id/status")
  updateVehicleStatus(@Param("id") id: string, @Body() body: any) {
    return this.storeRentalService.updateVehicleStatus(id, body);
  }

  @Get("value-added-services")
  valueAddedServices() {
    return this.storeRentalService.listValueAddedServices();
  }

  @Post("value-added-services")
  createValueAddedService(@Body() body: StoreValueAddedServiceSummary) {
    return this.storeRentalService.saveValueAddedService(body);
  }

  @Put("value-added-services/:id")
  updateValueAddedService(
    @Param("id") id: string,
    @Body() body: StoreValueAddedServiceSummary
  ) {
    return this.storeRentalService.saveValueAddedService({ ...body, id });
  }

  @Get("orders")
  orders(@Query("keyword") keyword?: string, @Query("status") status?: string) {
    return this.storeRentalService.listOrders({ keyword, status });
  }

  @Get("orders/:id")
  orderDetail(@Param("id") id: string) {
    return this.storeRentalService.getOrderDetail(id);
  }

  @Get("orders/:id/fees")
  orderFeeCenter(@Param("id") id: string) {
    return this.storeRentalService.getOrderFeeCenter(id);
  }

  @Get("orders/:id/fulfillment")
  orderFulfillmentRecords(@Param("id") id: string) {
    return this.storeRentalService.getOrderFulfillmentRecords(id);
  }

  @Post("orders/:id/contracts")
  createOrderContract(
    @Param("id") id: string,
    @Body() body: CreateStoreRentalContractRequest
  ) {
    return this.storeRentalService.createOrderContract(id, body);
  }

  @Post("orders/:id/notifications")
  createOrderNotification(
    @Param("id") id: string,
    @Body() body: CreateStoreRentalNotificationRequest
  ) {
    return this.storeRentalService.createOrderNotification(id, body);
  }

  @Post("orders/:id/remarks")
  createOrderRemark(
    @Param("id") id: string,
    @Body() body: CreateStoreRentalRemarkRequest
  ) {
    return this.storeRentalService.createOrderRemark(id, body);
  }

  @Post("orders/:id/operation-locks")
  createOrderOperationLock(
    @Param("id") id: string,
    @Body() body: CreateStoreRentalOperationLockRequest
  ) {
    return this.storeRentalService.createOrderOperationLock(id, body);
  }

  @Post("orders/:id/fees")
  createOrderFee(
    @Param("id") id: string,
    @Body() body: CreateStoreRentalFeeRequest
  ) {
    return this.storeRentalService.createOrderFee(id, body);
  }

  @Post("orders/:id/fees/:feeId/waive")
  waiveOrderFee(
    @Param("id") id: string,
    @Param("feeId") feeId: string,
    @Body() body: WaiveStoreRentalFeeRequest
  ) {
    return this.storeRentalService.waiveOrderFee(id, feeId, body);
  }

  @Post("orders/:id/transactions")
  createOrderTransaction(
    @Param("id") id: string,
    @Body() body: CreateStoreRentalTransactionRequest
  ) {
    return this.storeRentalService.createOrderTransaction(id, body);
  }

  @Post("orders")
  createOrder(@Body() body: CreateStoreRentalOrderRequest) {
    return this.storeRentalService.createOrder(body);
  }

  @Post("orders/:id/actions/:action")
  runOrderAction(
    @Param("id") id: string,
    @Param("action") action: string,
    @Body() body: Record<string, unknown>
  ) {
    return this.storeRentalService.runOrderAction(id, action, body);
  }

  @Get("integrations")
  integrations() {
    return this.storeRentalService.getIntegrationPlaceholders();
  }

  @Get("client-endpoints")
  clientEndpoints() {
    return this.storeRentalService.getReservedClientEndpoints();
  }
}
