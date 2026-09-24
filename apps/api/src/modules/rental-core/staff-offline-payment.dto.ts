import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from "class-validator";
import type { CreateStaffOfflinePaymentRequest } from "@rental-os/shared";

export class CreateStaffOfflinePaymentDto implements CreateStaffOfflinePaymentRequest {
  @IsString() orderId!: string;
  @IsIn(["rental", "deposit"]) instrument!: "rental" | "deposit";
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount!: number;
  @IsIn(["offline_cash", "offline_transfer"]) paymentMethod!: "offline_cash" | "offline_transfer";
  @IsString() @MaxLength(500) reason!: string;
  @IsString() @MaxLength(191) idempotencyKey!: string;
  @IsOptional() @IsString() @MaxLength(191) evidenceFileAssetId?: string;
}
