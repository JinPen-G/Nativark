import { IsNumber, IsString, MaxLength, Min } from "class-validator";
import type { CreatePaymentRefundRequest } from "@rental-os/shared";

export class CreatePaymentRefundDto implements CreatePaymentRefundRequest {
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsString()
  @MaxLength(191)
  idempotencyKey!: string;
}
