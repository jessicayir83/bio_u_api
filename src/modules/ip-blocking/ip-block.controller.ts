import { Body, Controller, Get, Ip, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { IpBlockService } from './ip-block.service';
import { BlockIpDto } from './dto/block-ip.dto';
import { UnblockIpDto } from './dto/unblock-ip.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

/** Bloqueo manual de IPs desde el dashboard de auditoría: exclusivo de Admin. */
@Controller('ip-blocks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class IpBlockController {
  constructor(private readonly ipBlockService: IpBlockService) {}

  /** Últimos bloqueos (activos, vencidos y levantados). */
  @Get()
  list() {
    return this.ipBlockService.list();
  }

  @Post()
  block(@Body() dto: BlockIpDto, @CurrentUser() user: AuthenticatedUser, @Ip() requesterIp: string) {
    return this.ipBlockService.block(dto, user, requesterIp);
  }

  @Post(':id/unblock')
  unblock(@Param('id', ParseIntPipe) id: number, @Body() dto: UnblockIpDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ipBlockService.unblock(id, user, dto.reason);
  }
}
