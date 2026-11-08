import { Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { LeaderElectionService } from '../leader/leader-election.service';

/** Always up; reports whether this replica currently holds the leader lease. */
@Injectable()
export class LeaderHealthIndicator {
  constructor(
    private readonly indicators: HealthIndicatorService,
    private readonly election: LeaderElectionService,
  ) {}

  public report(key: string): HealthIndicatorResult {
    return this.indicators
      .check(key)
      .up({ leader: this.election.isLeader, instanceId: this.election.instanceId });
  }
}
