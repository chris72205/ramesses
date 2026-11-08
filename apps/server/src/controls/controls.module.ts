import { Module } from '@nestjs/common';
import { FleetModule } from '../fleet/fleet.module';
import { WarriorsModule } from '../warriors/warriors.module';
import { WARRIOR_CONTROL_CLIENT, WarriorControlClient } from './warrior-control-client';
import { WarriorControlsController } from './warrior-controls.controller';
import { WarriorControlsService } from './warrior-controls.service';

@Module({
  imports: [WarriorsModule, FleetModule],
  controllers: [WarriorControlsController],
  providers: [
    { provide: WARRIOR_CONTROL_CLIENT, useFactory: () => new WarriorControlClient() },
    WarriorControlsService,
  ],
})
export class ControlsModule {}
