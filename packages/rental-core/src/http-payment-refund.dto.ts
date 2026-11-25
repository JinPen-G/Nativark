import { IsNumber, IsString, MaxLength, Min } from "class-validator";
import type { CreatePaymentRefundRequest } from "./payment-contracts";

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
