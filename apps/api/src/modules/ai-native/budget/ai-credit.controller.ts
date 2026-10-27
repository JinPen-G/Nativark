import { BadRequestException, Body, Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
import { AiCreditService } from './ai-credit.service';
import { z } from 'zod';
type Request = { headers: { authorization?: string } };
function empty(body: unknown) {
  if (!z.object({}).strict().safeParse(body).success) throw new BadRequestException({ code: 'AI_INVALID_INPUT' });
}
/** Routes mirror shared AI_CREDIT_HTTP. Global ApiAuthGuard performs the exact
 * permission check; the service then re-resolves the current server identity. */
@Controller('ai-native/credits')
export class AiCreditController {
  constructor(private readonly service: AiCreditService) {}
  @Post('read') @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() req: Request, @Body() body: unknown) { empty(body); return this.service.read(req.headers.authorization); }
  @Post('request') @HttpCode(200) @Header('Cache-Control', 'no-store')
  request(@Req() req: Request, @Body() body: unknown) { return this.service.request(req.headers.authorization, body); }
  @Post('receipt') @HttpCode(200) @Header('Cache-Control', 'no-store')
  receipt(@Req() req: Request, @Body() body: unknown) { return this.service.receipt(req.headers.authorization, body); }
  @Post('allocate') @HttpCode(200) @Header('Cache-Control', 'no-store')
  allocate(@Req() req: Request, @Body() body: unknown) { return this.service.allocate(req.headers.authorization, body); }
  @Post('allocation-receipt') @HttpCode(200) @Header('Cache-Control', 'no-store')
  allocationReceipt(@Req() req: Request, @Body() body: unknown) { return this.service.allocationReceipt(req.headers.authorization, body); }
  @Post('platform-read') @HttpCode(200) @Header('Cache-Control', 'no-store')
  platformRead(@Req() req: Request, @Body() body: unknown) { return this.service.platformRead(req.headers.authorization, body); }
  @Post('platform-decide') @HttpCode(200) @Header('Cache-Control', 'no-store')
  platformDecide(@Req() req: Request, @Body() body: unknown) { return this.service.platformDecide(req.headers.authorization, body); }
  @Post('platform-receipt') @HttpCode(200) @Header('Cache-Control', 'no-store')
  platformReceipt(@Req() req: Request, @Body() body: unknown) { return this.service.platformReceipt(req.headers.authorization, body); }
  @Post('calls') @HttpCode(200) @Header('Cache-Control', 'no-store')
  calls(@Req() req: Request, @Body() body: unknown) { return this.service.calls(req.headers.authorization, body); }
}
