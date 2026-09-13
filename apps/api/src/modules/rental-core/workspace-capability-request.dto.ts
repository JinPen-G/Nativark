import {
  RENTAL_CAPABILITY_CODES,
  RENTAL_CAPABILITY_LIFECYCLE_STATUSES,
  type RentalCapability,
  type RentalCapabilityConfig,
  type RentalCapabilityLifecycleStatus,
  type SaveWorkspaceCapabilityRequest,
  type UpgradeWorkspaceCapabilityRequest
} from "@rental-os/shared";
import { IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Min } from "class-validator";

/**
 * CORE-EXT-02A：capability 生命周期与配置的请求 DTO。
 *
 * `config` 刻意只声明为「对象」，不在这里逐字段校验：可接受的键与取值域来自注册表的
 * `configSchema`，随能力而异，静态装饰器表达不了。真正的逐字段校验在
 * `WorkspaceCapabilityService.validatedConfig` 里按定义执行——那里能给出
 * 「能力 X 不接受配置项 Y」这类可读原因，而不是一句笼统的 400。
 *
 * 注意 `whitelist: true` 只剥离**顶层** DTO 上没有装饰器的属性；`@IsObject()` 标注的
 * 嵌套对象整体保留，因此未知配置键会原样到达服务层并被那里显式拒绝，不会被静默丢弃。
 */
export class SaveWorkspaceCapabilityDto implements SaveWorkspaceCapabilityRequest {
  @IsIn(RENTAL_CAPABILITY_CODES)
  code!: RentalCapability;

  @IsIn(RENTAL_CAPABILITY_LIFECYCLE_STATUSES)
  status!: RentalCapabilityLifecycleStatus;

  @IsOptional()
  @IsObject()
  config?: RentalCapabilityConfig;

  // 原因必填且限长：生命周期变更要能事后解释，而 reason 列是 TEXT，
  // 这里的上限是为了防止把整段日志粘进审计，不是为了迁就列宽。
  @IsString()
  @IsNotEmpty({ message: "变更能力状态必须填写原因" })
  @MaxLength(500)
  reason!: string;

  // 乐观并发用的版本号。允许 0：首次写入前实例的 revision 就是 0，
  // 用 @Min(1) 会把「基于初始版本的修改」判成非法入参。
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;
}

export class UpgradeWorkspaceCapabilityDto implements UpgradeWorkspaceCapabilityRequest {
  @IsString()
  @IsNotEmpty({ message: "升级能力必须填写原因" })
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;
}
