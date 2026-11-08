import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { ProjectsModule } from '../projects/projects.module';
import { WarriorsModule } from '../warriors/warriors.module';
import { FleetGateway } from './fleet.gateway';
import { FleetService } from './fleet.service';

@Module({
  imports: [WarriorsModule, MetricsModule, ProjectsModule],
  providers: [FleetService, FleetGateway],
  exports: [FleetService],
})
export class FleetModule {}
