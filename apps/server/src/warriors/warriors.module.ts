import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Warrior } from './warrior.entity';
import { WarriorsController } from './warriors.controller';
import { WarriorsService } from './warriors.service';

@Module({
  imports: [TypeOrmModule.forFeature([Warrior])],
  controllers: [WarriorsController],
  providers: [WarriorsService],
  exports: [WarriorsService],
})
export class WarriorsModule {}
