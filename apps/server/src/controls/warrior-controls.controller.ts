import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ControlAccepted, WarriorSettings } from '@ramesses/shared';
import { SelectProjectDto, UpdateWarriorSettingsDto } from './dto/controls.dto';
import { WarriorControlsService } from './warrior-controls.service';

/**
 * Controls for one warrior. Mutations answer 202: the warrior acknowledges before it acts, and
 * the result arrives over /ws as the warrior's own events plus a fresh snapshot.
 */
@ApiTags('warrior controls')
@Controller('warriors/:id')
export class WarriorControlsController {
  constructor(private readonly controls: WarriorControlsService) {}

  @Put('project')
  @HttpCode(202)
  @ApiOperation({ summary: 'Ask the warrior to work on a project from its own catalog' })
  public selectProject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SelectProjectDto,
  ): Promise<ControlAccepted> {
    return this.controls.selectProject(id, body.name);
  }

  @Delete('project')
  @HttpCode(202)
  @ApiOperation({ summary: 'Ask the warrior to finish its items and then sit idle' })
  public deselectProject(@Param('id', ParseUUIDPipe) id: string): Promise<ControlAccepted> {
    return this.controls.deselectProject(id);
  }

  @Get('settings')
  @ApiOperation({ summary: "Read the warrior's nickname and concurrency from its settings page" })
  public readSettings(@Param('id', ParseUUIDPipe) id: string): Promise<WarriorSettings> {
    return this.controls.readSettings(id);
  }

  @Patch('settings')
  @HttpCode(202)
  @ApiOperation({ summary: 'Change nickname, concurrency (1 to 6), or both on the warrior' })
  public updateSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateWarriorSettingsDto,
  ): Promise<ControlAccepted> {
    return this.controls.updateSettings(id, body);
  }
}
