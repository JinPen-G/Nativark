/** Bitmap-only customer avatar endpoints. Original /platform/customers Guard applies to both routes. */
import { BadRequestException, Controller, Get, Inject, Param, Post, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { requireRequestTenantId } from "@rental-os/platform-server/request-identity";
import type { CustomerAvatarUpload } from "./mysql-customer-avatar";
import { rentalNativeResponse } from "./http-native-response";
import { RENTAL_CUSTOMER_AVATAR_APPLICATION, type RentalCustomerAvatarHttpApplication } from "./http-customer-avatar-applications";
interface AvatarResponse { setHeader(name: string, value: string): void; send(body: Buffer): void; }
@Controller("platform/customers")
export class CustomerAvatarController {
  constructor(@Inject(RENTAL_CUSTOMER_AVATAR_APPLICATION) private readonly avatars: RentalCustomerAvatarHttpApplication) {}
  @Get(":customerId/avatar")
  async read(@Param("customerId") customerId: string, @Res() response: AvatarResponse) {
    response = rentalNativeResponse(response);
    const file=await this.avatars.read(requireRequestTenantId(),customerId);
    response.setHeader("Content-Type",file.mimeType);response.setHeader("X-Content-Type-Options","nosniff");
    response.setHeader("Cache-Control","private, no-store");response.send(file.content);
  }
  @Post(":customerId/avatar")
  @UseInterceptors(FileInterceptor("file",{limits:{files:1,fileSize:5*1024*1024}}))
  save(@Param("customerId") customerId: string,@UploadedFile() file?:CustomerAvatarUpload) {
    if(!file)throw new BadRequestException("请选择头像图片");return this.avatars.save(requireRequestTenantId(),customerId,file);
  }
}
