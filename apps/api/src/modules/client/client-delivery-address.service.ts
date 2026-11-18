/** 原Nest入口供给同一数据库与Rental配置，配送地址/快照实现由Rental包单源维护。 */
import { Injectable } from "@nestjs/common";
import { ClientDeliveryAddressService as RentalClientDeliveryAddressService } from "@rental-os/rental-core/mysql-client-delivery-address";
import { PrismaService } from "../database/prisma.service";
import { RentalCoreService } from "../rental-core/rental-core.service";
export type { StoredDeliverySnapshot } from "@rental-os/rental-core/mysql-client-delivery-address";

@Injectable()
export class ClientDeliveryAddressService extends RentalClientDeliveryAddressService {
  constructor(prisma: PrismaService, rentalCore: RentalCoreService) { super(prisma, rentalCore); }
}
