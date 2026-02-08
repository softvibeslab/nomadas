import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BusinessProfileController } from './controllers/business-profile.controller';
import { PhotoController } from './controllers/photo.controller';
import { VerificationController, AdminVerificationController } from './controllers/verification.controller';
import { GeocodingController } from './controllers/geocoding.controller';
import { BusinessProfileService } from './services/business-profile.service';
import { PhotoUploadService } from './services/photo-upload.service';
import { GeocodingService } from './services/geocoding.service';
import { VerificationService } from './services/verification.service';
import { PrismaService } from '../../shared/infrastructure/database/prisma.service';

@Module({
  imports: [ConfigModule],
  controllers: [
    BusinessProfileController,
    PhotoController,
    VerificationController,
    AdminVerificationController,
    GeocodingController,
  ],
  providers: [
    BusinessProfileService,
    PhotoUploadService,
    GeocodingService,
    VerificationService,
    PrismaService,
  ],
  exports: [
    BusinessProfileService,
    PhotoUploadService,
    GeocodingService,
    VerificationService,
  ],
})
export class BusinessModule {}
