import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Optional,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { CLIENT_PUBLIC_DOCUMENT_KINDS, type ClientChannelKind, type ClientPublicDocumentKind } from "@rental-os/shared";
import { ClientApiService } from "./client-api.service";
import { ClientAuthService } from "./client-auth.service";
import { ClientAccountClosureService } from "./client-account-closure.service";
import { ClientDeliveryAddressService } from "./client-delivery-address.service";
import { ClientWechatAuthService } from "./client-wechat-auth.service";
import {
  ClientAccountClosureRequestDto,
  ClientAvailabilityRequestDto,
  ClientCancelOrderRequestDto,
  ClientChallengeRequestDto,
  ClientChangePasswordRequestDto,
  ClientDeliveryAddressRequestDto,
  ClientFeeResponseRequestDto,
  ClientSmsLoginRequestDto,
  ClientWechatBindRequestDto,
  ClientWechatPhoneLoginRequestDto,
  ClientContactRequestDto,
  ClientCreateOrderRequestDto,
  ClientCreateQuoteRequestDto,
  ClientQualificationUploadCompleteRequestDto,
  ClientQualificationUploadSessionRequestDto,
  ClientMembershipLoginRequestDto,
  ClientMiniProgramPaymentIntentRequestDto,
  ClientMyOrdersQueryDto,
  ClientOrderExtensionRequestDto,
  ClientPaymentIntentRequestDto,
  ClientPaymentSimulationRequestDto,
  ClientPersonalMembershipRegistrationRequestDto,
  ClientProfileUpdateRequestDto,
  ClientRefreshRequestDto,
  ClientRegistrationChallengeRequestDto,
  ClientSubmitQualificationRequestDto,
  ClientSwitchWorkspaceRequestDto,
  VerifyClientRegistrationChallengeRequestDto
} from "./client-request.dto";
import { type ClientRequestContext as ClientSessionContext } from "./client-auth.service";

interface ClientRequest {
  client?: ClientSessionContext;
  headers?: Record<string, unknown>;
}

interface ClientBinaryResponse {
  setHeader(name: string, value: string): void;
  send(body: Buffer): void;
  redirect(status: number, url: string): void;
}

function currentClient(req: ClientRequest): ClientSessionContext {
  if (!req.client) throw new UnauthorizedException("请先登录客户端账号");
  return req.client;
}

@Controller("client/v1")
export class ClientApiController {
  constructor(
    private readonly api: ClientApiService,
    private readonly auth: ClientAuthService,
    @Optional() private readonly wechat?: ClientWechatAuthService,
    @Optional() private readonly addresses?: ClientDeliveryAddressService,
    @Optional() private readonly closure?: ClientAccountClosureService
  ) {}

  private requireWechat() {
    if (!this.wechat) throw new ServiceUnavailableException("微信登录服务未就绪");
    return this.wechat;
  }

  private requireAddresses() {
    if (!this.addresses) throw new ServiceUnavailableException("配送地址服务未就绪");
    return this.addresses;
  }

  private requireClosure() {
    if (!this.closure) throw new ServiceUnavailableException("注销服务未就绪");
    return this.closure;
  }

  @Get("tenants/:tenantCode/workspaces")
  listWorkspaces(@Param("tenantCode") tenantCode: string) {
    return this.auth.listPublicWorkspaces(tenantCode);
  }

  /** MP-01 / CLIENT-CHANNEL-01：公开渠道启动配置（品牌、协议、客服、帮助、横幅、已发布服务、登录方式与能力开关）。小程序与 APP 按 client 叠加渠道能力。 */
  @Get("public/bootstrap")
  bootstrap(@Query("tenantCode") tenantCode: string, @Query("client") client?: string, @Query("appId") appId?: string) {
    if (!tenantCode?.trim()) throw new BadRequestException("缺少商户编码");
    const kind: ClientChannelKind = client === "app" ? "app" : client === "web" ? "web" : "wechat_miniprogram";
    return this.api.channelBootstrap(tenantCode, kind, appId);
  }

  /** CLIENT-CHANNEL-01：公开文档正文（用户协议 / 隐私政策 / 帮助），客户端内直接渲染。 */
  @Get("public/documents/:kind")
  publicDocument(@Query("tenantCode") tenantCode: string, @Param("kind") kind: string) {
    if (!tenantCode?.trim()) throw new BadRequestException("缺少商户编码");
    if (!CLIENT_PUBLIC_DOCUMENT_KINDS.includes(kind as ClientPublicDocumentKind)) throw new BadRequestException("未知文档类型");
    return this.api.publicDocument(tenantCode, kind as ClientPublicDocumentKind);
  }

  /** MP-03：游客公开目录，只对已发布到小程序渠道的服务开放。 */
  @Get("public/catalog")
  publicCatalog(@Query("tenantCode") tenantCode: string, @Query("service") service: string) {
    if (!tenantCode?.trim() || !service?.trim()) throw new BadRequestException("缺少商户编码或服务编码");
    return this.api.publicCatalog(tenantCode, service);
  }

  @Get("public/catalog/items/:itemGroupId/images/:imageId")
  async publicCatalogImage(@Query("tenantCode") tenantCode: string, @Query("service") service: string, @Param("itemGroupId") itemGroupId: string, @Param("imageId") imageId: string, @Res() res: ClientBinaryResponse) {
    if (!tenantCode?.trim() || !service?.trim()) throw new BadRequestException("缺少商户编码或服务编码");
    const image = await this.api.readPublicCatalogItemImage(tenantCode, service, itemGroupId, imageId);
    if ("redirectUrl" in image) {
      res.redirect(302, image.redirectUrl!);
      return;
    }
    res.setHeader("Content-Type", image.mimeType);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(image.fileName)}`);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(image.content);
  }

  /** MP-02B：用途化验证码（registration / login）。 */
  @Post("auth/challenges")
  @HttpCode(201)
  createPurposeChallenge(@Body() body: ClientChallengeRequestDto) {
    return this.auth.createChallenge(body);
  }

  @Post("auth/sms-login")
  smsLogin(@Body() body: ClientSmsLoginRequestDto) {
    return this.auth.smsLogin(body);
  }

  /** MP-02A：微信手机号一键登录。 */
  @Post("auth/wechat/phone-login")
  wechatPhoneLogin(@Body() body: ClientWechatPhoneLoginRequestDto) {
    return this.requireWechat().phoneLogin(body);
  }

  @Post("auth/wechat/bind")
  bindWechat(@Req() req: ClientRequest, @Body() body: ClientWechatBindRequestDto) {
    return this.requireWechat().bind(currentClient(req), body);
  }

  /** MP-02B：本人注销预检、短信核验与确认。 */
  @Get("auth/closure/preview")
  closurePreview(@Req() req: ClientRequest) {
    return this.requireClosure().preview(currentClient(req));
  }

  @Post("auth/closure/challenge")
  @HttpCode(201)
  closureChallenge(@Req() req: ClientRequest) {
    return this.auth.createClosureChallenge(currentClient(req));
  }

  @Post("auth/closure")
  closeAccount(@Req() req: ClientRequest, @Body() body: ClientAccountClosureRequestDto) {
    return this.requireClosure().close(currentClient(req), body);
  }

  @Post("auth/registration/challenges")
  @HttpCode(201)
  createChallenge(@Body() body: ClientRegistrationChallengeRequestDto) {
    return this.auth.createChallenge(body);
  }

  @Post("auth/registration/challenges/:challengeId/verify")
  verifyChallenge(@Param("challengeId") challengeId: string, @Body() body: VerifyClientRegistrationChallengeRequestDto) {
    return this.auth.verifyChallenge({ ...body, challengeId });
  }

  @Post("auth/register")
  @HttpCode(201)
  register(@Body() body: ClientPersonalMembershipRegistrationRequestDto) {
    return this.auth.registerPersonal(body);
  }

  @Post("auth/login")
  login(@Body() body: ClientMembershipLoginRequestDto) {
    return this.auth.login(body);
  }

  @Post("auth/refresh")
  refresh(@Body() body: ClientRefreshRequestDto) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post("auth/logout")
  logout(@Body() body: ClientRefreshRequestDto) {
    return this.auth.logout(body.refreshToken);
  }

  @Post("auth/switch-workspace")
  switchWorkspace(@Req() req: ClientRequest, @Body() body: ClientSwitchWorkspaceRequestDto) {
    return this.auth.switchWorkspace(currentClient(req), body);
  }

  @Get("auth/me")
  me(@Req() req: ClientRequest) {
    return this.api.membershipStatus(currentClient(req));
  }

  @Post("auth/change-password")
  changePassword(@Req() req: ClientRequest, @Body() body: ClientChangePasswordRequestDto) {
    return this.auth.changePassword(currentClient(req), body.currentPassword, body.newPassword);
  }

  @Get("config")
  config(@Req() req: ClientRequest) {
    return this.api.config(currentClient(req));
  }

  @Get("payment/capabilities")
  paymentCapabilities(@Req() req: ClientRequest) {
    return this.api.paymentCapabilities(currentClient(req));
  }

  @Get("profile")
  profile(@Req() req: ClientRequest) {
    return this.api.profile(currentClient(req));
  }

  @Patch("profile")
  updateProfile(@Req() req: ClientRequest, @Body() body: ClientProfileUpdateRequestDto) {
    return this.api.updateProfile(currentClient(req), body);
  }

  /** 微信小程序 wx.request 不支持 PATCH：同一部分更新语义的 PUT 别名，DTO 与处理器完全相同。 */
  @Put("profile")
  updateProfileViaPut(@Req() req: ClientRequest, @Body() body: ClientProfileUpdateRequestDto) {
    return this.api.updateProfile(currentClient(req), body);
  }

  @Get("profile/contacts")
  contacts(@Req() req: ClientRequest) {
    return this.api.contacts(currentClient(req));
  }

  @Put("profile/contacts")
  saveContact(@Req() req: ClientRequest, @Body() body: ClientContactRequestDto) {
    return this.api.saveContact(currentClient(req), body);
  }

  @Delete("profile/contacts/:contactId")
  deleteContact(@Req() req: ClientRequest, @Param("contactId") contactId: string) {
    return this.api.deleteContact(currentClient(req), contactId);
  }

  /** MP-06：本人配送地址簿（不是联系人）。 */
  @Get("profile/addresses")
  listAddresses(@Req() req: ClientRequest) {
    return this.requireAddresses().list(currentClient(req));
  }

  @Put("profile/addresses")
  saveAddress(@Req() req: ClientRequest, @Body() body: ClientDeliveryAddressRequestDto) {
    return this.requireAddresses().save(currentClient(req), body);
  }

  @Delete("profile/addresses/:addressId")
  deleteAddress(@Req() req: ClientRequest, @Param("addressId") addressId: string) {
    return this.requireAddresses().remove(currentClient(req), addressId);
  }

  @Get("membership/status")
  membershipStatus(@Req() req: ClientRequest) {
    return this.api.membershipStatus(currentClient(req));
  }

  @Get("notifications")
  notifications(@Req() req: ClientRequest, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.api.notifications(currentClient(req), { page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined });
  }

  @Get("membership/booking-options")
  bookingOptions(@Req() req: ClientRequest) {
    return this.api.bookingOptions(currentClient(req));
  }

  @Get("membership/plans")
  membershipPlans(@Req() req: ClientRequest) {
    return this.api.membershipPlans(currentClient(req));
  }

  @Get("membership/assignments")
  membershipAssignments(@Req() req: ClientRequest) {
    return this.api.membershipAssignments(currentClient(req));
  }

  @Get("membership/benefits")
  membershipBenefits(@Req() req: ClientRequest, @Query("corporateCustomerId") corporateCustomerId?: string) {
    return this.api.membershipBenefits(currentClient(req), corporateCustomerId);
  }

  @Get("membership/corporates")
  corporateIdentities(@Req() req: ClientRequest) {
    return this.api.corporateIdentities(currentClient(req));
  }

  @Get("membership/qualification-types")
  qualificationTypes(@Req() req: ClientRequest) {
    return this.api.qualificationTypes(currentClient(req));
  }

  @Get("membership/qualifications")
  qualifications(@Req() req: ClientRequest) {
    return this.api.qualifications(currentClient(req));
  }

  @Post("membership/qualifications")
  @HttpCode(201)
  submitQualification(@Req() req: ClientRequest, @Body() body: ClientSubmitQualificationRequestDto) {
    return this.api.submitQualification(currentClient(req), body);
  }

  @Post("membership/qualifications/files")
  @HttpCode(201)
  qualificationFileUpload(@Req() req: ClientRequest, @Body() body: ClientQualificationUploadSessionRequestDto) {
    return this.api.createQualificationUploadSession(currentClient(req), body);
  }

  @Post("membership/qualifications/files/:sessionId/complete")
  completeQualificationFileUpload(@Req() req: ClientRequest, @Param("sessionId") sessionId: string, @Body() body: ClientQualificationUploadCompleteRequestDto) {
    return this.api.completeQualificationUpload(currentClient(req), sessionId, body);
  }

  @Get("membership/qualifications/files/:fileAssetId/download-url")
  qualificationFileUrl(@Req() req: ClientRequest, @Param("fileAssetId") fileAssetId: string) {
    return this.api.qualificationFileUrl(currentClient(req), fileAssetId);
  }

  @Get("catalog")
  catalog(@Req() req: ClientRequest) {
    return this.api.catalog(currentClient(req));
  }

  @Get("catalog/items/:itemGroupId/images/:imageId")
  async catalogImage(@Req() req: ClientRequest, @Param("itemGroupId") itemGroupId: string, @Param("imageId") imageId: string, @Res() res: ClientBinaryResponse) {
    const image = await this.api.readCatalogItemImage(currentClient(req), itemGroupId, imageId);
    if ("redirectUrl" in image) {
      res.redirect(302, image.redirectUrl!);
      return;
    }
    res.setHeader("Content-Type", image.mimeType);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(image.fileName)}`);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(image.content);
  }

  @Post("availability")
  availability(@Req() req: ClientRequest, @Body() body: ClientAvailabilityRequestDto) {
    return this.api.availability(currentClient(req), body);
  }

  @Post("quotes")
  @HttpCode(201)
  quote(@Req() req: ClientRequest, @Body() body: ClientCreateQuoteRequestDto) {
    return this.api.createQuote(currentClient(req), body);
  }

  @Get("quotes/:id")
  quoteDetail(@Req() req: ClientRequest, @Param("id") id: string) {
    return this.api.getQuote(currentClient(req), id);
  }

  @Get("coupons")
  coupons(@Req() req: ClientRequest) {
    return this.api.coupons(currentClient(req));
  }

  @Post("coupons/:templateId/claim")
  @HttpCode(201)
  claimCoupon(@Req() req: ClientRequest, @Param("templateId") templateId: string) {
    return this.api.claimCoupon(currentClient(req), templateId);
  }

  @Post("orders")
  @HttpCode(201)
  createOrder(@Req() req: ClientRequest, @Body() body: ClientCreateOrderRequestDto) {
    return this.api.createOrder(currentClient(req), body, req);
  }

  @Get("my/orders")
  myOrders(@Req() req: ClientRequest, @Query() query: ClientMyOrdersQueryDto) {
    return this.api.myOrders(currentClient(req), query);
  }

  @Get("orders")
  listOrders(@Req() req: ClientRequest, @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("status") status?: string) {
    return this.api.listOrders(currentClient(req), { page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined, status });
  }

  @Get("orders/:id")
  orderDetail(@Req() req: ClientRequest, @Param("id") id: string) {
    return this.api.getOrder(currentClient(req), id);
  }

  @Get("orders/:id/fulfillment")
  fulfillment(@Req() req: ClientRequest, @Param("id") id: string) {
    return this.api.fulfillment(currentClient(req), id);
  }

  @Get("orders/:id/documents/:type")
  orderDocument(@Req() req: ClientRequest, @Param("id") id: string, @Param("type") type: string, @Query("snapshotId") snapshotId?: string) {
    return this.api.orderDocument(currentClient(req), id, type, snapshotId);
  }

  @Get("orders/:id/documents/:type/versions")
  orderDocumentVersions(@Req() req: ClientRequest, @Param("id") id: string, @Param("type") type: string) {
    return this.api.orderDocumentVersions(currentClient(req), id, type);
  }

  /** MP-11：需要本人响应的已批准费用，以及确认/异议。 */
  @Get("orders/:id/fee-items")
  feeItems(@Req() req: ClientRequest, @Param("id") id: string) {
    return this.api.feeItems(currentClient(req), id);
  }

  @Post("orders/:id/fee-items/:inspectionId/:exceptionIndex/response")
  respondToFee(@Req() req: ClientRequest, @Param("id") id: string, @Param("inspectionId") inspectionId: string, @Param("exceptionIndex") exceptionIndex: string, @Body() body: ClientFeeResponseRequestDto) {
    return this.api.respondToFee(currentClient(req), id, inspectionId, Number(exceptionIndex), body, req);
  }

  @Post("orders/:id/cancel/preview")
  @HttpCode(200)
  previewCancellation(@Req() req: ClientRequest, @Param("id") id: string) {
    return this.api.previewCancellation(currentClient(req), id);
  }

  @Post("orders/:id/cancel")
  cancelOrder(@Req() req: ClientRequest, @Param("id") id: string, @Body() body: ClientCancelOrderRequestDto) {
    return this.api.cancelOrder(currentClient(req), id, body, req);
  }

  @Get("orders/:id/extensions")
  extensions(@Req() req: ClientRequest, @Param("id") id: string) {
    return this.api.listExtensions(currentClient(req), id);
  }

  @Post("orders/:id/extensions/preview")
  previewExtension(@Req() req: ClientRequest, @Param("id") id: string, @Body() body: ClientOrderExtensionRequestDto) {
    return this.api.previewExtension(currentClient(req), id, body);
  }

  @Post("orders/:id/extensions")
  @HttpCode(201)
  applyExtension(@Req() req: ClientRequest, @Param("id") id: string, @Body() body: ClientOrderExtensionRequestDto) {
    return this.api.applyExtension(currentClient(req), id, body, req);
  }

  @Post("orders/:id/extensions/:extensionId/pay")
  payExtension(@Req() req: ClientRequest, @Param("id") id: string, @Param("extensionId") extensionId: string) {
    return this.api.payExtension(currentClient(req), id, extensionId, req);
  }

  @Get("orders/:id/funding")
  funding(@Req() req: ClientRequest, @Param("id") id: string) {
    return this.api.funding(currentClient(req), id);
  }

  @Post("orders/:id/funding/simulate")
  @HttpCode(201)
  simulateFunding(@Req() req: ClientRequest, @Param("id") id: string, @Body() body: ClientPaymentSimulationRequestDto) {
    return this.api.simulateFunding(currentClient(req), id, body, req);
  }

  @Post("orders/:id/payment-intents")
  @HttpCode(201)
  createPaymentIntent(@Req() req: ClientRequest, @Param("id") id: string, @Body() body: ClientPaymentIntentRequestDto) {
    return this.api.createPaymentIntent(currentClient(req), id, body);
  }

  @Post("orders/:id/mini-program-payment-intents")
  @HttpCode(201)
  createMiniProgramPaymentIntent(@Req() req: ClientRequest, @Param("id") id: string, @Body() body: ClientMiniProgramPaymentIntentRequestDto) {
    return this.api.createMiniProgramPaymentIntent(currentClient(req), id, body);
  }

  @Get("orders/:id/payment-intents/:intentId")
  paymentIntent(@Req() req: ClientRequest, @Param("id") id: string, @Param("intentId") intentId: string) {
    return this.api.getPaymentIntent(currentClient(req), id, intentId);
  }

  @Post("orders/:id/payment-intents/:intentId/refresh")
  refreshPaymentIntent(@Req() req: ClientRequest, @Param("id") id: string, @Param("intentId") intentId: string) {
    return this.api.refreshPaymentIntent(currentClient(req), id, intentId);
  }

  @Post("orders/:id/payment-intents/:intentId/close")
  closePaymentIntent(@Req() req: ClientRequest, @Param("id") id: string, @Param("intentId") intentId: string) {
    return this.api.closePaymentIntent(currentClient(req), id, intentId);
  }
}
