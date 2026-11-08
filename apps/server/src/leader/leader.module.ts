import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { LeaderElectionService } from './leader-election.service';

@Module({
  imports: [RedisModule],
  providers: [LeaderElectionService],
  exports: [LeaderElectionService],
})
export class LeaderModule {}
