import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaService } from '@shared/infrastructure/database/prisma.service';
import { IdentityModule } from './identity/identity.module';
import { BusinessModule } from './business/business.module';
import { JobsModule } from './jobs/jobs.module';
import { NotificationModule } from './notifications/notification.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: `${configService.get<string>('JWT_EXPIRES_IN', '30d')}`,
        },
      }),
      inject: [ConfigService],
    }),
    IdentityModule,
    BusinessModule,
    JobsModule,
    NotificationModule,
  ],
  providers: [PrismaService],
})
export class AppModule {}