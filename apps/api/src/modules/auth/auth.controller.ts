import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import type { ChangePasswordRequest, RefreshSessionRequest } from "@store-rental/shared";
import { IsNotEmpty, IsString } from "class-validator";
import { AuthService } from "./auth.service";

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  tenantCode!: string;

  @IsString()
  @IsNotEmpty()
  account!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    return this.authService.getCurrentUser(authorization);
  }

  @Post("refresh")
  refresh(@Body() body: RefreshSessionRequest) {
    return this.authService.refresh(body);
  }

  @Post("logout")
  logout(@Body() body: RefreshSessionRequest) {
    return this.authService.logout(body);
  }

  @Post("change-password")
  changePassword(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: ChangePasswordRequest
  ) {
    return this.authService.changePassword(authorization, body);
  }
}
