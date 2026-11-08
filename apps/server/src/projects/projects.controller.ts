import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  ProjectDetail,
  ProjectHistory,
  ProjectSummary,
  RefreshResult,
} from '@ramesses/shared';
import { HistoryQueryDto, ListProjectsQueryDto } from './dto/projects-query.dto';
import { ProjectsScheduler } from './projects-scheduler.service';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly scheduler: ProjectsScheduler,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Catalog with latest tracker numbers and derived rates' })
  public list(@Query() query: ListProjectsQueryDto): Promise<ProjectSummary[]> {
    return this.projects.summaries(query.includeHidden === 'true');
  }

  @Post('refresh')
  @HttpCode(202)
  @ApiOperation({ summary: 'Ask for a sample run now (throttled)' })
  public refresh(): Promise<RefreshResult> {
    return this.scheduler.requestRefresh();
  }

  @Get(':name')
  @ApiOperation({ summary: 'One project with its derived metrics' })
  public detail(@Param('name') name: string): Promise<ProjectDetail> {
    return this.projects.detail(name);
  }

  @Get(':name/history')
  @ApiOperation({ summary: 'Stored samples over 24h (raw), 7d, or 30d (hourly)' })
  public history(
    @Param('name') name: string,
    @Query() query: HistoryQueryDto,
  ): Promise<ProjectHistory> {
    return this.projects.history(name, query.range ?? '24h');
  }
}
