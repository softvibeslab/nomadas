import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JobExpiryProcessor } from './job-expiry.processor';
import { SearchCleanupProcessor } from './search-cleanup.processor';
import { SearchAlertsProcessor } from './search-alerts.processor';
import { PrismaService } from '../../../shared/infrastructure/database/prisma.service';
import { SavedSearchService } from '../saved-search.service';

/**
 * Jobs Queue Module
 * Bull Queue integration for background job processing
 * SPEC-JOB-001 Phase 6
 */
@Module({
  imports: [
    BullModule.registerQueueAsync(
      {
        name: 'jobs-expiry',
        imports: [ConfigModule],
        useFactory: async (configService: ConfigService) => ({
          redis: {
            host: configService.get<string>('REDIS_HOST') || 'localhost',
            port: configService.get<number>('REDIS_PORT') || 6379,
            password: configService.get<string>('REDIS_PASSWORD'),
          },
          defaultJobOptions: {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
            removeOnComplete: 10,
            removeOnFail: 50,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'searches-cleanup',
        imports: [ConfigModule],
        useFactory: async (configService: ConfigService) => ({
          redis: {
            host: configService.get<string>('REDIS_HOST') || 'localhost',
            port: configService.get<number>('REDIS_PORT') || 6379,
            password: configService.get<string>('REDIS_PASSWORD'),
          },
          defaultJobOptions: {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
            removeOnComplete: 5,
            removeOnFail: 20,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'search-alerts',
        imports: [ConfigModule],
        useFactory: async (configService: ConfigService) => ({
          redis: {
            host: configService.get<string>('REDIS_HOST') || 'localhost',
            port: configService.get<number>('REDIS_PORT') || 6379,
            password: configService.get<string>('REDIS_PASSWORD'),
          },
          defaultJobOptions: {
            attempts: 2,
            backoff: {
              type: 'exponential',
              delay: 3000,
            },
            removeOnComplete: 20,
            removeOnFail: 100,
          },
        }),
        inject: [ConfigService],
      }
    ),
  ],
  providers: [
    PrismaService,
    SavedSearchService,
    JobExpiryProcessor,
    SearchCleanupProcessor,
    SearchAlertsProcessor,
  ],
  exports: [BullModule],
})
export class JobsQueueModule {}
