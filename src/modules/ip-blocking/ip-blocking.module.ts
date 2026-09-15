import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockedIpEntity } from './entities/blocked-ip.entity';
import { IpBlockService } from './ip-block.service';
import { IpBlockController } from './ip-block.controller';

@Module({
  imports: [TypeOrmModule.forFeature([BlockedIpEntity])],
  controllers: [IpBlockController],
  providers: [IpBlockService],
  exports: [IpBlockService],
})
export class IpBlockingModule {}
