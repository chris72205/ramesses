import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { WarriorRecord } from '@ramesses/shared';
import { CreateWarriorDto, UpdateWarriorDto } from './dto/create-warrior.dto';
import { WarriorsService } from './warriors.service';

@Controller('warriors')
export class WarriorsController {
  constructor(private readonly warriors: WarriorsService) {}

  @Get()
  async list(): Promise<WarriorRecord[]> {
    const all = await this.warriors.findAll();
    return all.map((w) => w.toRecord());
  }

  @Post()
  async create(@Body() body: CreateWarriorDto): Promise<WarriorRecord> {
    return (await this.warriors.create(body)).toRecord();
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateWarriorDto,
  ): Promise<WarriorRecord> {
    return (await this.warriors.update(id, body)).toRecord();
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.warriors.remove(id);
  }
}
