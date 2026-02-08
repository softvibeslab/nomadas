import { IsString, IsNotEmpty, IsIn, MaxLength } from 'class-validator';

export class UploadPhotoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  contentType: string;
}

export class ConfirmUploadDto {
  @IsString()
  @IsNotEmpty()
  fileKey: string;
}
