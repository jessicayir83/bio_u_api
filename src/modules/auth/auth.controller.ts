import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { AnyAuthenticated, Public } from './decorators/access.decorator';
import { RateLimit } from '../../common/throttler/rate-limit.decorator';
import { AuthenticatedUser } from './interfaces/jwt-payload.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @RateLimit('auth')
  @Public()
  async login(@Body() dto: LoginDto) {
    const user = await this.authService.validateUser(dto.username, dto.password);
    return this.authService.login(user);
  }

  @Post('refresh')
  @RateLimit('auth')
  @Public()
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @AnyAuthenticated()
  async logout(@CurrentUser() user: AuthenticatedUser, @Body() dto: RefreshTokenDto) {
    await this.authService.logout(user.userId, dto.refreshToken);
    return { message: 'Sesión cerrada.' };
  }

  /** Cambio de la propia contraseña; límite bajo para frenar fuerza bruta sobre la actual. */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @AnyAuthenticated()
  @RateLimit('passwordChange')
  async changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.userId, dto.currentPassword, dto.newPassword);
  }

  /**
   * Datos de la propia sesión (los roles se releen de la BD en cada request).
   */
  @Get('me')
  @AnyAuthenticated()
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}

