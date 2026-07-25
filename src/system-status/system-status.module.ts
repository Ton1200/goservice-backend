import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SystemStatusResolver } from './system-status.resolver';
import { SystemStatusService } from './system-status.service';

@Module({
  imports: [DatabaseModule],
  providers: [SystemStatusResolver, SystemStatusService],
})
export class SystemStatusModule {}
