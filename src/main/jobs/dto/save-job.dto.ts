import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaveJobDto {
  @ApiProperty({
    description: 'Job ID to save',
    example: 1,
  })
  jobPostingId: number;

  @ApiPropertyOptional({
    description: 'Worker private notes about this job',
    example: 'Great location, good pay, apply before May',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
