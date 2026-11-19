/** 原平台客户管理 35 条路径，字段/DTO/参数及敏感资料审计入口保持。
 * 当前租户、经营空间与具体动作仍由同一门面及原 Guard/事务核定。
 */
import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { ChangeCustomerAccountStatusDto, ChangeCustomerMembershipStatusDto, CreateCustomerRiskRecordDto,
  ReviewCustomerRiskRecordDto, SaveCustomerProfileAddressDto, SaveCustomerIdentityVerificationDto } from "./http-customer-operations.dto";
import { RecordCustomerCorporateCreditPaymentDto, ReverseCustomerCorporateCreditPaymentDto,
  RecordCustomerCorporateCreditMaturityDto, SaveCustomerContractDto, SaveCustomerCreditDto,
  SaveCustomerInvoiceProfileDto } from "./http-customer-corporate.dto";
import { MergeCustomersDto } from "./http-customer-merge.dto";
import { SaveSharedCustomerDto } from "./http-customer-registration.dto";
import type { RentalCustomerManagementApplication } from "./application-customer-management";

export const RENTAL_CUSTOMERS_HTTP_APPLICATION = Symbol("rental.http.customer-management");
export type RentalCustomersHttpApplication = Pick<RentalCustomerManagementApplication,
  "listSharedCustomers" | "getCustomerDetail" | "getCustomerProfileOverview" | "saveCustomerProfileAddress" | "removeCustomerProfileAddress" | "ensureCustomerAccount" | "changeCustomerAccountStatus" | "changeCustomerMembershipStatus" | "listCustomerStatusHistory" | "listCustomerIdentityVerifications" | "saveCustomerIdentityVerification" | "listCustomerRiskRecords" | "createCustomerRiskRecord" | "reviewCustomerRiskRecord" | "listCustomerSensitiveAccess" | "findCustomerDuplicates" | "previewCustomerMerge" | "mergeCustomers" | "getCustomerClosability" | "getCustomerMembershipClosability" | "getCustomerTransactability" | "listCustomerInvoiceProfiles" | "saveCustomerInvoiceProfile" | "listCustomerContracts" | "saveCustomerContract" | "getCustomerCredit" | "saveCustomerCredit" | "registerSharedCustomer" | "getCustomerCreditAccount" | "listCustomerCreditLedger" | "recordCustomerCreditMaturity" | "readCustomerCreditMaturity" | "readCustomerCreditPaymentReversal" | "reverseCustomerCreditPayment" | "recordCustomerCreditPayment">;
interface RequestWithUser { user?: SystemUserRow; }

@Controller("platform")
export class RentalCustomersController {
  constructor(@Inject(RENTAL_CUSTOMERS_HTTP_APPLICATION) private readonly customers: RentalCustomersHttpApplication) {}



  /**
   * SPACE-04 的最小管理面：租户共享客户主档 + 空间接入。
   *
   * 两个列表接口的隔离口径**刻意不同**，不是疏漏：
   * - `customers` 按租户列全部主档，跨空间可见——这正是「同一客户无需重复注册」
   *   所要求的：运营在露营空间必须能查到他已在摄影空间注册过。
   * - `workspace-customers` 只列当前空间的业务关系，空间取自会话。
   *
   * 不提供跨空间的订单/权益汇总（需求明确排除本阶段建设）。
   */
  @Get("customers")
  sharedCustomers(@Req() req: RequestWithUser) {
    return this.customers.listSharedCustomers(req.user);
  }


  @Post("customers")
  registerCustomer(@Body() body: SaveSharedCustomerDto, @Req() req: RequestWithUser) {
    return this.customers.registerSharedCustomer(body, req.user);
  }


  /**
   * CUSTOMER-01B：客户详情。
   *
   * 敏感字段按权限脱敏，且每次读取都写访问审计（需求 4.8.5 / 4.8.14）。
   * 审计在服务层写，不在这里——绕过控制器的内部调用同样要留痕。
   */
  @Get("customers/:customerId")
  customerDetail(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.customers.getCustomerDetail(customerId, req.user);
  }


  /** CUSTOMER-PROFILE-01：资料页聚合读取。订单只返回轻量摘要，完整订单仍走订单中心权限。 */
  @Get("customers/:customerId/profile")
  customerProfileOverview(
    @Param("customerId") customerId: string,
    @Query("page") page: string | undefined,
    @Query("pageSize") pageSize: string | undefined,
    @Req() req: RequestWithUser
  ) {
    const parse = (value: string | undefined) => {
      if (value === undefined || value.trim() === "") return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    return this.customers.getCustomerProfileOverview(customerId, { page: parse(page), pageSize: parse(pageSize) }, req.user);
  }


  @Get("customers/:customerId/identity-verifications")
  customerIdentityVerifications(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.customers.listCustomerIdentityVerifications(customerId, req.user);
  }


  @Post("customers/:customerId/identity-verifications")
  saveCustomerIdentityVerification(
    @Param("customerId") customerId: string,
    @Body() body: SaveCustomerIdentityVerificationDto,
    @Req() req: RequestWithUser
  ) {
    return this.customers.saveCustomerIdentityVerification(customerId, body, req.user);
  }


  /** 客户资料页维护配送地址；电话缺省表示保留原值，服务端始终只返回脱敏电话。 */
  @Put("customers/:customerId/addresses")
  saveCustomerProfileAddress(
    @Param("customerId") customerId: string,
    @Body() body: SaveCustomerProfileAddressDto,
    @Req() req: RequestWithUser
  ) {
    return this.customers.saveCustomerProfileAddress(customerId, body, req.user);
  }


  @Delete("customers/:customerId/addresses/:addressId")
  removeCustomerProfileAddress(
    @Param("customerId") customerId: string,
    @Param("addressId") addressId: string,
    @Req() req: RequestWithUser
  ) {
    return this.customers.removeCustomerProfileAddress(customerId, addressId, req.user);
  }


  /** CUSTOMER-01B：为客户开通登录账号。幂等，已有账号直接返回。 */
  @Post("customers/:customerId/account")
  ensureCustomerAccount(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.customers.ensureCustomerAccount(customerId, req.user);
  }


  /**
   * CUSTOMER-01B：改**账号**状态。影响该客户在全部经营空间的登录。
   * 与下面的空间会员状态是两个入口，刻意不合并——合并就无法表达
   * 「只停这个空间」与「停掉全部空间的登录」的区别。
   */
  @Put("customers/:customerId/account-status")
  changeCustomerAccountStatus(
    @Param("customerId") customerId: string,
    @Body() body: ChangeCustomerAccountStatusDto,
    @Req() req: RequestWithUser
  ) {
    return this.customers.changeCustomerAccountStatus(customerId, body, req.user);
  }


  @Put("customers/:customerId/membership-status")
  changeCustomerMembershipStatus(
    @Param("customerId") customerId: string,
    @Body() body: ChangeCustomerMembershipStatusDto,
    @Req() req: RequestWithUser
  ) {
    return this.customers.changeCustomerMembershipStatus(customerId, body, req.user);
  }


  @Get("customers/:customerId/risk-records")
  customerRiskRecords(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.customers.listCustomerRiskRecords(customerId, req.user);
  }


  @Post("customers/:customerId/risk-records")
  createCustomerRiskRecord(
    @Param("customerId") customerId: string,
    @Body() body: CreateCustomerRiskRecordDto,
    @Req() req: RequestWithUser
  ) {
    return this.customers.createCustomerRiskRecord(customerId, body, req.user);
  }


  @Post("customers/:customerId/risk-records/:riskRecordId/decision")
  reviewCustomerRiskRecord(
    @Param("customerId") customerId: string,
    @Param("riskRecordId") riskRecordId: string,
    @Body() body: ReviewCustomerRiskRecordDto,
    @Req() req: RequestWithUser
  ) {
    return this.customers.reviewCustomerRiskRecord(customerId, riskRecordId, body, req.user);
  }


  /** CUSTOMER-01B：客户状态时间线（账号级 + 当前空间级同一条线）。 */
  @Get("customers/:customerId/status-history")
  customerStatusHistory(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.customers.listCustomerStatusHistory(customerId, req.user);
  }


  /** CUSTOMER-01B：敏感资料访问审计。本身就是访问画像，需解密权限才能查。 */
  @Get("customers/:customerId/sensitive-access")
  customerSensitiveAccess(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.customers.listCustomerSensitiveAccess(customerId, req.user);
  }



  /**
   * CUSTOMER-01D：重复客户候选（需求 4.8.3）。只在同租户内查找。
   * 候选带 matchedBy——运营要知道「为什么系统认为这两个是同一人」，否则人工合并变成盲签。
   */
  @Get("customers/:customerId/duplicates")
  customerDuplicates(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.customers.findCustomerDuplicates(customerId, req.user);
  }


  /** CUSTOMER-01D：合并冲突预览。只读，不写任何东西；供人工确认后再提交。 */
  @Get("customers/:customerId/merge-preview")
  customerMergePreview(
    @Param("customerId") customerId: string,
    @Query("targetCustomerId") targetCustomerId: string,
    @Req() req: RequestWithUser
  ) {
    return this.customers.previewCustomerMerge(customerId, targetCustomerId, req.user);
  }


  /** CUSTOMER-01D：提交人工合并。不搬订单、不合并空间权益，只写映射并标记被合并方。 */
  @Post("customers/merge")
  mergeCustomers(@Body() body: MergeCustomersDto, @Req() req: RequestWithUser) {
    return this.customers.mergeCustomers(body, req.user);
  }


  /**
   * CUSTOMER-01D：注销前置检查（需求 4.8.13）。
   * blockers 来自真实事实，非空即禁止注销；manualConfirmations 是本系统尚无数据源的类别，
   * 必须人工确认——把它们当成「检查通过」就是借注销规避欠款。
   */
  @Get("customers/:customerId/closability")
  customerClosability(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.customers.getCustomerClosability(customerId, req.user);
  }


  @Get("customers/:customerId/membership-closability")
  customerMembershipClosability(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.customers.getCustomerMembershipClosability(customerId, req.user);
  }


  /** CUSTOMER-01B：该客户此刻能否在本空间开展新业务，以及被拒的具体原因。 */
  @Get("customers/:customerId/transactability")
  customerTransactability(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.customers.getCustomerTransactability(customerId, req.user);
  }


  /**
   * CUSTOMER-01C：企业开票资料、合同、授信账期。
   *
   * 三者各自成表而不是平铺进企业资料：一家企业可以同时持有多份开票资料与多份有效合同，
   * 而订单引用的是「下单当时生效的那一份」。
   */
  @Get("customers/:customerId/invoice-profiles")
  customerInvoiceProfiles(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.customers.listCustomerInvoiceProfiles(customerId, req.user);
  }


  @Put("customers/:customerId/invoice-profiles")
  saveCustomerInvoiceProfile(
    @Param("customerId") customerId: string,
    @Body() body: SaveCustomerInvoiceProfileDto,
    @Req() req: RequestWithUser
  ) {
    return this.customers.saveCustomerInvoiceProfile(customerId, body, req.user);
  }


  @Get("customers/:customerId/contracts")
  customerContracts(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.customers.listCustomerContracts(customerId, req.user);
  }


  @Put("customers/:customerId/contracts")
  saveCustomerContract(
    @Param("customerId") customerId: string,
    @Body() body: SaveCustomerContractDto,
    @Req() req: RequestWithUser
  ) {
    return this.customers.saveCustomerContract(customerId, body, req.user);
  }


  @Get("customers/:customerId/credit")
  customerCredit(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.customers.getCustomerCredit(customerId, req.user);
  }


  @Put("customers/:customerId/credit")
  saveCustomerCredit(
    @Param("customerId") customerId: string,
    @Body() body: SaveCustomerCreditDto,
    @Req() req: RequestWithUser
  ) {
    return this.customers.saveCustomerCredit(customerId, body, req.user);
  }


  @Get("customers/:customerId/credit/account")
  customerCreditAccount(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.customers.getCustomerCreditAccount(customerId, req.user);
  }


  @Get("customers/:customerId/credit/ledger")
  customerCreditLedger(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.customers.listCustomerCreditLedger(customerId, req.user);
  }


  @Post("customers/:customerId/credit/maturities")
  recordCustomerCreditMaturity(@Param("customerId") customerId: string, @Body() body: RecordCustomerCorporateCreditMaturityDto,
    @Req() req: RequestWithUser) {
    return this.customers.recordCustomerCreditMaturity(customerId, body, req.user);
  }


  @Get("customers/:customerId/credit/maturities/:ledgerId")
  customerCreditMaturity(@Param("customerId") customerId: string, @Param("ledgerId") ledgerId: string, @Req() req: RequestWithUser) {
    return this.customers.readCustomerCreditMaturity(customerId, ledgerId, req.user);
  }


  @Get("customers/:customerId/credit/payments/:paymentId/reverse")
  customerCreditPaymentReversal(@Param("customerId") customerId: string, @Param("paymentId") paymentId: string,
    @Req() req: RequestWithUser) {
    return this.customers.readCustomerCreditPaymentReversal(customerId, paymentId, req.user);
  }


  @Post("customers/:customerId/credit/payments/:paymentId/reverse")
  reverseCustomerCreditPayment(@Param("customerId") customerId: string, @Param("paymentId") paymentId: string,
    @Body() body: ReverseCustomerCorporateCreditPaymentDto, @Req() req: RequestWithUser) {
    return this.customers.reverseCustomerCreditPayment(customerId, paymentId, body, req.user);
  }


  @Post("customers/:customerId/credit/payments")
  recordCustomerCreditPayment(
    @Param("customerId") customerId: string,
    @Body() body: RecordCustomerCorporateCreditPaymentDto,
    @Req() req: RequestWithUser
  ) {
    return this.customers.recordCustomerCreditPayment(customerId, body, req.user);
  }
}
