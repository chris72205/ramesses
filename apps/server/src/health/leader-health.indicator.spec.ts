import type { HealthIndicatorService } from '@nestjs/terminus';
import { describe, expect, it, vi } from 'vitest';
import type { LeaderElectionService } from '../leader/leader-election.service';
import { LeaderHealthIndicator } from './leader-health.indicator';

describe('LeaderHealthIndicator', () => {
  it('is always up and reports the lease state', () => {
    const up = vi.fn((data: unknown) => ({ leader: { status: 'up', ...(data as object) } }));
    const service = { check: vi.fn(() => ({ up })) } as unknown as HealthIndicatorService;
    const election = { isLeader: true, instanceId: 'host:1:abc' } as LeaderElectionService;
    expect(new LeaderHealthIndicator(service, election).report('leader')).toEqual({
      leader: { status: 'up', leader: true, instanceId: 'host:1:abc' },
    });
  });
});
