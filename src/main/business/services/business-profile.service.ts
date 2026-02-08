import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/database/prisma.service';
import { CreateBusinessProfileDto, UpdateBusinessProfileDto } from '../dto';
import { BusinessStatus, PrestigeLevel } from '@prisma/client';

@Injectable()
export class BusinessProfileService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new business profile
   */
  async create(userId: number, createDto: CreateBusinessProfileDto) {
    // Check how many business profiles the user already has (limit to 10)
    const profileCount = await this.prisma.businessProfile.count({
      where: { userId },
    });

    if (profileCount >= 10) {
      throw new BadRequestException('You have reached the maximum limit of 10 business profiles. Please contact support if you need more.');
    }

    // If isPrimary is set to true, unset any other primary business for this user
    if (createDto.isPrimary) {
      await this.prisma.businessProfile.updateMany({
        where: { userId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    // Create business profile
    const profile = await this.prisma.businessProfile.create({
      data: {
        userId,
        businessName: createDto.businessName,
        businessType: createDto.businessType,
        businessTypeCustom: createDto.businessTypeCustom,
        description: createDto.description,
        locationAddress: createDto.locationAddress,
        locationCity: createDto.locationCity,
        locationCountry: createDto.locationCountry,
        locationPostalCode: createDto.locationPostalCode,
        locationLatitude: createDto.locationLatitude,
        locationLongitude: createDto.locationLongitude,
        contactEmail: createDto.contactEmail,
        contactPhone: createDto.contactPhone,
        websiteUrl: createDto.websiteUrl,
        isPrimary: createDto.isPrimary || false,
        status: BusinessStatus.ACTIVE,
      },
    });

    return {
      id: profile.id,
      message: 'Business profile created successfully!',
      profile: this.sanitizeProfile(profile),
    };
  }

  /**
   * Find all business profiles for a user
   */
  async findAllByUser(userId: number) {
    const profiles = await this.prisma.businessProfile.findMany({
      where: { userId },
      include: {
        photos: {
          orderBy: { uploadOrder: 'asc' },
        },
      },
      orderBy: { isPrimary: 'desc' },
    });

    return profiles.map((profile) => this.sanitizeProfile(profile));
  }

  /**
   * Find a single business profile by ID
   */
  async findOne(id: number, userId?: number) {
    const profile = await this.prisma.businessProfile.findUnique({
      where: { id },
      include: {
        photos: {
          orderBy: { uploadOrder: 'asc' },
        },
        verificationDocuments: {
          orderBy: { uploadDate: 'desc' },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException(`Business profile with ID ${id} not found`);
    }

    // If userId is provided, check ownership
    if (userId !== undefined && profile.userId !== userId) {
      throw new ForbiddenException('You do not have permission to view this business profile');
    }

    return this.sanitizeProfile(profile);
  }

  /**
   * Update a business profile
   */
  async update(id: number, userId: number, updateDto: UpdateBusinessProfileDto) {
    // Check if profile exists and user owns it
    const profile = await this.prisma.businessProfile.findUnique({
      where: { id },
    });

    if (!profile) {
      throw new NotFoundException(`Business profile with ID ${id} not found`);
    }

    if (profile.userId !== userId) {
      throw new ForbiddenException('You do not have permission to update this business profile');
    }

    // Track changes for audit log
    const changes: Array<{ field: string; oldValue: any; newValue: any }> = [];

    // Compare fields and track changes
    const fieldsToTrack = [
      'businessName', 'businessType', 'description',
      'locationAddress', 'locationCity', 'locationCountry',
      'contactEmail', 'contactPhone', 'websiteUrl'
    ];

    for (const field of fieldsToTrack) {
      const oldVal = (profile as any)[this.toCamelCase(field)];
      const newVal = updateDto[field as keyof UpdateBusinessProfileDto];
      if (newVal !== undefined && oldVal !== newVal) {
        changes.push({ field, oldValue: oldVal, newValue: newVal });
      }
    }

    // If isPrimary is being set to true, unset other primary businesses
    if (updateDto.isPrimary === true) {
      await this.prisma.businessProfile.updateMany({
        where: { userId, id: { not: id }, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    // Update profile
    const updatedProfile = await this.prisma.businessProfile.update({
      where: { id },
      data: {
        ...updateDto,
        locationLatitude: updateDto.locationLatitude ?? profile.locationLatitude,
        locationLongitude: updateDto.locationLongitude ?? profile.locationLongitude,
      },
      include: {
        photos: {
          orderBy: { uploadOrder: 'asc' },
        },
      },
    });

    // Create audit log entries for tracked changes
    if (changes.length > 0) {
      await this.prisma.businessProfileChange.createMany({
        data: changes.map((change) => ({
          businessProfileId: id,
          changedField: change.field,
          oldValue: String(change.oldValue),
          newValue: String(change.newValue),
          changedBy: userId,
        })),
      });
    }

    return {
      message: 'Business profile updated successfully!',
      profile: this.sanitizeProfile(updatedProfile),
    };
  }

  /**
   * Delete a business profile
   */
  async remove(id: number, userId: number) {
    // Check if profile exists and user owns it
    const profile = await this.prisma.businessProfile.findUnique({
      where: { id },
      include: {
        jobPostings: {
          where: {
            status: { in: ['ACTIVE', 'DRAFT'] },
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException(`Business profile with ID ${id} not found`);
    }

    if (profile.userId !== userId) {
      throw new ForbiddenException('You do not have permission to delete this business profile');
    }

    // Check for active job postings
    if (profile.jobPostings.length > 0) {
      throw new BadRequestException(
        'Cannot delete this business profile because it has active job postings. Please close or delete the job postings first.'
      );
    }

    // Delete profile (cascade will delete related photos, verification documents, and change history)
    await this.prisma.businessProfile.delete({
      where: { id },
    });

    return {
      message: 'Business profile deleted successfully!',
    };
  }

  /**
   * Calculate prestige level based on reviews
   */
  calculatePrestigeLevel(totalReviews: number, averageRating: number): PrestigeLevel {
    // Bronze: Default or low rating
    if (totalReviews < 5 || averageRating < 4.0) {
      return PrestigeLevel.BRONZE;
    }

    // Silver: 5-9 reviews, good rating
    if (totalReviews >= 5 && totalReviews <= 9 && averageRating >= 4.0 && averageRating <= 4.4) {
      return PrestigeLevel.SILVER;
    }

    // Gold: 10-24 reviews, excellent rating
    if (totalReviews >= 10 && totalReviews <= 24 && averageRating >= 4.5 && averageRating <= 4.7) {
      return PrestigeLevel.GOLD;
    }

    // Platinum: 25+ reviews, outstanding rating
    if (totalReviews >= 25 && averageRating >= 4.8) {
      return PrestigeLevel.PLATINUM;
    }

    return PrestigeLevel.BRONZE;
  }

  /**
   * Check if business has Good Employer badge
   */
  hasGoodEmployerBadge(totalReviews: number, averageRating: number): boolean {
    return totalReviews >= 10 && averageRating >= 4.5;
  }

  /**
   * Update prestige metrics (called after review submission)
   */
  async updatePrestigeMetrics(businessProfileId: number) {
    // Calculate new metrics from reviews
    const reviews = await this.prisma.review.findMany({
      where: {
        workAgreement: {
          application: {
            jobPosting: {
              businessId: businessProfileId,
            },
          },
        },
        visible: true,
      },
    });

    const totalReviews = reviews.length;
    const averageRating = totalReviews > 0
      ? reviews.reduce((sum, r) => sum + r.overallRating, 0) / totalReviews
      : 0;

    const prestigeLevel = this.calculatePrestigeLevel(totalReviews, averageRating);
    const hasGoodEmployerBadge = this.hasGoodEmployerBadge(totalReviews, averageRating);

    // Update business profile
    await this.prisma.businessProfile.update({
      where: { id: businessProfileId },
      data: {
        totalReviews,
        averageRating,
        prestigeLevel,
        hasGoodEmployerBadge,
      },
    });

    return { prestigeLevel, hasGoodEmployerBadge, totalReviews, averageRating };
  }

  /**
   * Remove sensitive information from profile
   */
  private sanitizeProfile(profile: any): any {
    const { userId, ...sanitized } = profile;
    return sanitized;
  }

  /**
   * Convert snake_case to camelCase
   */
  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
  }
}
