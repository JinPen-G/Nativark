/** Standard HTTP consumers for local-business reads and human policy CAS. Missing policy never enables a tool. */
import { Body, Controller, Header, HttpCode, Module, Post, Req } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { RENTAL_DESKTOP_BUSINESS_HTTP } from '@rental-os/shared';
import { AuthService } from '../../auth/auth.service';
import { PrismaService } from '../../database/prisma.service';
import { RentalCoreService } from '../../rental-core/rental-core.service';
import { ApiAuthGuard } from '../../../common/api-auth.guard';
import { OperationLogService } from '../../../common/operation-log.service';
import { respondAiScene } from '../scenes/original-scenes.controller';
import { withRequestAbort, type AiRequestAbortSource } from '../scenes/request-abort';
import { composeDesktopBusinessApplication, type DesktopBusinessRequest } from './desktop-business.application';
import { PrismaDesktopBusinessPolicyRepository } from './desktop-business-policy.repository';

type Request = DesktopBusinessRequest & AiRequestAbortSource;
@Controller(RENTAL_DESKTOP_BUSINESS_HTTP.basePath)
export class AiDesktopBusinessController {
  constructor(private readonly modules: ModuleRef) {}
  private call(request: Request, body: unknown, method: keyof ReturnType<typeof composeDesktopBusinessApplication>) {
    return respondAiScene(() => withRequestAbort(request, signal => {
      const application = composeDesktopBusinessApplication({
        auth: this.modules.get(AuthService, { strict: false }), guard: this.modules.get(ApiAuthGuard, { strict: false }),
        core: this.modules.get(RentalCoreService, { strict: false }),
        audit: this.modules.get(OperationLogService, { strict: false }),
        policies: new PrismaDesktopBusinessPolicyRepository(this.modules.get(PrismaService, { strict: false }))
      });
      return application[method](request, body, signal);
    }), 'read_same_policy_operation');
  }
  @Post(RENTAL_DESKTOP_BUSINESS_HTTP.catalog) @HttpCode(200) @Header('Cache-Control', 'no-store')
  catalog(@Req() request: Request, @Body() body: unknown) { return this.call(request, body, 'catalog'); }
  @Post(RENTAL_DESKTOP_BUSINESS_HTTP.policy) @HttpCode(200) @Header('Cache-Control', 'no-store')
  policy(@Req() request: Request, @Body() body: unknown) { return this.call(request, body, 'readPolicy'); }
  @Post(RENTAL_DESKTOP_BUSINESS_HTTP.savePolicy) @HttpCode(200) @Header('Cache-Control', 'no-store')
  change(@Req() request: Request, @Body() body: unknown) { return this.call(request, body, 'changePolicy'); }
  @Post(RENTAL_DESKTOP_BUSINESS_HTTP.policyOperation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  operation(@Req() request: Request, @Body() body: unknown) { return this.call(request, body, 'readPolicyOperation'); }
}
@Module({ controllers: [AiDesktopBusinessController] })
export class AiDesktopBusinessModule {}
