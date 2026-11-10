/** Merchant rental coordination uses the original workspace/operator Guard/ALS.
 * Deliberately not /membership, which selects tenant-wide membership authority. */
import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import { EnterpriseRentalHandoffService } from "./enterprise-rental-handoff.service";
import { ReviewEnterpriseRentalHandoffRequestDto } from "./enterprise-request.dto";
interface Request { user?: SystemUserRow }
const operator = (request: Request) => { if (!request.user) throw new UnauthorizedException("请使用当前商户身份"); return request.user; };
@Controller("rental/v1/enterprise-handoff-requests")
export class EnterpriseRentalHandoffMerchantController {
  constructor(private readonly handoffs: EnterpriseRentalHandoffService) {}
  @Get() queue(@Req() req: Request, @Query("page") page?: string) {
    if (page !== undefined && (typeof page !== "string" || !/^[1-9][0-9]{0,5}$/u.test(page))) throw new BadRequestException("原订单页码无效");
    return this.handoffs.merchantQueue(operator(req), page === undefined ? 1 : Number(page));
  }
  @Get(":id") material(@Req() req: Request, @Param("id") id: string) { return this.handoffs.merchantDetail(operator(req), id); }
  @Post(":id/review") review(@Req() req: Request, @Param("id") id: string, @Body() input: ReviewEnterpriseRentalHandoffRequestDto) { return this.handoffs.review(operator(req), id, input); }
  @Get(":id/review-operations/:key") original(@Req() req: Request, @Param("id") id: string, @Param("key") key: string) { return this.handoffs.readReview(operator(req), id, key); }
}
