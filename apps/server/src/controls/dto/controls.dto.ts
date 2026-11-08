import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** The warrior's own rule for a tracker nickname (`downloader`). */
export const NICKNAME_PATTERN = /^[-_a-zA-Z0-9]{3,30}$/;
/** The warrior refuses more than six concurrent items. */
export const MAX_CONCURRENT_ITEMS = 6;

export class SelectProjectDto {
  /** catalog key, as the warrior lists it */
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class UpdateWarriorSettingsDto {
  @IsOptional()
  @IsString()
  @Matches(NICKNAME_PATTERN, {
    message: 'downloader must be 3 to 30 letters, digits, hyphens, or underscores',
  })
  downloader?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_CONCURRENT_ITEMS)
  concurrentItems?: number;
}
