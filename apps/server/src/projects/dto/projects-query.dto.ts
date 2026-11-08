import { IsIn, IsOptional } from 'class-validator';
import type { HistoryRange } from '@ramesses/shared';

export const HISTORY_RANGES: HistoryRange[] = ['24h', '7d', '30d'];

export class ListProjectsQueryDto {
  /** `true` adds unlisted and retired projects. */
  @IsOptional()
  @IsIn(['true', 'false'])
  includeHidden?: 'true' | 'false';
}

export class HistoryQueryDto {
  @IsOptional()
  @IsIn(HISTORY_RANGES)
  range?: HistoryRange;
}
