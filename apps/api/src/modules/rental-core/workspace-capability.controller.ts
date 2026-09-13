import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import { RENTAL_CAPABILITY_CODES, type RentalCapability, type SystemUserRow } from "@rental-os/shared";
import {
  SaveWorkspaceCapabilityDto,
  UpgradeWorkspaceCapabilityDto
} from "./workspace-capability-request.dto";
import { WorkspaceCapabilityService } from "./workspace-capability.service";

interface AuthenticatedRequest {
  user: SystemUserRow;
}

/**
 * CORE-EXT-02A：经营空间 capability 治理接口。
 *
 * 三条口径在这一层就固定下来，不留给调用方选择：
 *   1. **空间取自会话**。没有任何入口接受 `workspaceId`——守卫已把会话空间写进请求身份，
 *      服务层从那里取。接受请求体里的空间等于允许跨空间改配置。
 *   2. **品类取自空间行**（见仓储 `workspaceScope`），不接受请求体传入。
 *   3. **操作人取自会话**，不接受请求体传入，否则审计里的责任人可被伪造。
 */
@Controller("rental/v1")
export class WorkspaceCapabilityController {
  constructor(private readonly service: WorkspaceCapabilityService) {}

  @Get("capabilities")
  overview(@Req() req: AuthenticatedRequest) {
    return this.service.overview(req.user.tenantId);
  }

  @Put("capabilities")
  save(@Req() req: AuthenticatedRequest, @Body() body: SaveWorkspaceCapabilityDto) {
    return this.service.save(req.user.tenantId, body, req.user.displayName);
  }

  @Post("capabilities/:code/upgrade")
  upgrade(
    @Req() req: AuthenticatedRequest,
    @Param("code") code: string,
    @Body() body: UpgradeWorkspaceCapabilityDto
  ) {
    return this.service.upgrade(req.user.tenantId, this.capabilityCode(code), body, req.user.displayName);
  }

  @Get("capability-audits")
  audits(@Req() req: AuthenticatedRequest, @Query("code") code?: string) {
    return this.service.listAudits(req.user.tenantId, code ? this.capabilityCode(code) : undefined);
  }

  /**
   * Review P1-3：存量空间的**显式对账**入口。
   *
   * 迁移刻意不回填启用状态，租户初始化建立的默认空间也不自动初始化——那属于存量兼容层，
   * 静默补启用等于凭空认定历史空间已具备能力。但必须留一条可解释的转正路径：
   * 由有「经营空间能力治理」权限的人显式调用本接口，按品类必选清单初始化当前空间，
   * 每条都写 `system_initialize` 审计。
   *
   * 幂等：已存在实例的能力一律跳过，不覆盖运营后来的暂停/停用决定，因此可重复调用。
   * 返回值同时给出 `skipped` 及其原因，让运营知道还差什么（未实现、或必填配置无默认值）。
   */
  @Post("capabilities/initialize-required")
  initializeRequired(@Req() req: AuthenticatedRequest) {
    return this.service.reconcileRequiredCapabilities(req.user.tenantId, req.user.displayName);
  }

  /**
   * 路径/查询里的 code 必须是已注册的能力码。
   *
   * 不能直接 `as RentalCapability`：那样任意字符串都会被当成能力码带进仓储查询，
   * 审计筛选会静默返回空列表（看起来「这个能力没有任何审计」），
   * 而升级入口则要等到服务层查注册表才报错。在边界上就判定，错误信息也更直接。
   */
  private capabilityCode(value: string): RentalCapability {
    if (!(RENTAL_CAPABILITY_CODES as readonly string[]).includes(value)) {
      throw new BadRequestException(`未注册的 capability：${value}`);
    }
    return value as RentalCapability;
  }
}
