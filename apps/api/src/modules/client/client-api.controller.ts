import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException
} from "@nestjs/common";
import { ClientApiService } from "./client-api.service";
import { ClientAuthService } from "./client-auth.service";
import {
  ClientAvailabilityRequestDto,
  ClientCancelOrderRequestDto,
  ClientChangePasswordRequestDto,
  ClientContactRequestDto,
  ClientCreateOrderRequestDto,
  ClientCreateQuoteRequestDto,
  ClientMembershipLoginRequestDto,
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
}

function currentClient(req: ClientRequest): ClientSessionContext {
  if (!req.client) throw new UnauthorizedException("请先登录客户端账号");
  return req.client;
}

@Controller("client/v1")
export class ClientApiController {
  constructor(private readonly api: ClientApiService, private readonly auth: ClientAuthService) {}

  @Get("tenants/:tenantCode/workspaces")
  listWorkspaces(@Param("tenantCode") tenantCode: string) {
    return this.auth.listPublicWorkspaces(tenantCode);
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

  @Get("catalog")
  catalog(@Req() req: ClientRequest) {
    return this.api.catalog(currentClient(req));
  }

  @Get("catalog/items/:itemGroupId/images/:imageId")
  async catalogImage(@Req() req: ClientRequest, @Param("itemGroupId") itemGroupId: string, @Param("imageId") imageId: string, @Res() res: ClientBinaryResponse) {
    const image = await this.api.readCatalogItemImage(currentClient(req), itemGroupId, imageId);
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

  @Get("orders/:id/payment-intents/:intentId")
  paymentIntent(@Req() req: ClientRequest, @Param("id") id: string, @Param("intentId") intentId: string) {
    return this.api.getPaymentIntent(currentClient(req), id, intentId);
  }
}
