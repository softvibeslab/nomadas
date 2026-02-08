import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/infrastructure/database/prisma.service';
import { OpenSearchService } from '../../shared/infrastructure/search/opensearch.service';
import { JobStatus, BusinessProfile } from '@prisma/client';
import {
  CreateJobPostingDto,
  UpdateJobPostingDto,
  ChangeJobStatusDto,
} from './dto';

/**
 * Job Posting Service
 * Handles job posting CRUD operations with business rules and status workflow
 * SPEC-JOB-001 Phase 1
 */
@Injectable()
export class JobPostingService {
  private readonly logger = new Logger(JobPostingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openSearch: OpenSearchService,
  ) {}

  /**
   * Create a new job posting
   * Business rules:
   * - Max 50 active jobs per business (BR-JOB-001)
   * - Min 50 char description (BR-JOB-002)
   * - Compensation > 0 if provided (BR-JOB-003)
   * - Start date must be in future (BR-JOB-004)
   * - End date must be after start date (BR-JOB-005)
   */
  async create(userId: number, createDto: CreateJobPostingDto) {
    // Get business profile
    const businessProfile = await this.getBusinessProfile(userId);

    // Validate business rules
    await this.validateJobCreationRules(businessProfile, createDto);

    // Create job posting with locations
    const jobPosting = await this.prisma.$transaction(async (tx) => {
      // Create job posting
      const job = await tx.jobPosting.create({
        data: {
          businessId: businessProfile.id,
          title: createDto.title,
          description: createDto.description,
          requirements: createDto.requirements,
          category: createDto.category,
          workType: createDto.workType,
          durationAmount: createDto.durationAmount,
          durationUnit: createDto.durationUnit,
          startDate: new Date(createDto.startDate),
          endDate: new Date(createDto.endDate),
          compensationType: createDto.compensationType,
          compensationMin: createDto.compensationMin,
          compensationMax: createDto.compensationMax,
          compensationCurrency: createDto.compensationCurrency,
          accommodationIncluded: createDto.accommodationIncluded ?? false,
          mealsIncluded: createDto.mealsIncluded ?? false,
          requiredLanguages: createDto.requiredLanguages,
          skills: createDto.skills,
          requiredExperience: createDto.requiredExperience,
          status: JobStatus.DRAFT,
        },
      });

      // Create job locations
      if (createDto.locations && createDto.locations.length > 0) {
        await tx.jobLocation.createMany({
          data: createDto.locations.map((location) => ({
            jobPostingId: job.id,
            locationName: location.locationName,
            address: location.address,
            city: location.city,
            country: location.country,
            postalCode: location.postalCode,
            latitude: location.latitude,
            longitude: location.longitude,
          })),
        });
      }

      return job;
    });

    // Index in OpenSearch (in background, don't block response)
    this.indexJobInOpenSearch(jobPosting.id).catch((error) => {
      this.logger.error(`Failed to index job ${jobPosting.id} in OpenSearch`, error);
    });

    this.logger.log(`Job posting created: ${jobPosting.id} for business ${businessProfile.id}`);

    return {
      id: jobPosting.id,
      message: 'Job posting created successfully!',
      job: await this.findOne(jobPosting.id),
    };
  }

  /**
   * Find all job postings for a business
   */
  async findAllByBusiness(
    userId: number,
    params: { status?: JobStatus; page?: number; limit?: number }
  ) {
    const businessProfile = await this.getBusinessProfile(userId);

    const where: any = { businessId: businessProfile.id };
    if (params.status) {
      where.status = params.status;
    }

    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const [jobs, total] = await Promise.all([
      this.prisma.jobPosting.findMany({
        where,
        include: {
          locations: true,
          _count: {
            select: { applications: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.jobPosting.count({ where }),
    ]);

    return {
      jobs: jobs.map((job) => this.sanitizeJobPosting(job)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Find a single job posting by ID
   */
  async findOne(id: number, userId?: number) {
    const job = await this.prisma.jobPosting.findUnique({
      where: { id },
      include: {
        businessProfile: {
          select: {
            id: true,
            businessName: true,
            businessType: true,
            locationCity: true,
            locationCountry: true,
            prestigeLevel: true,
            averageRating: true,
            totalReviews: true,
            hasGoodEmployerBadge: true,
          },
        },
        locations: true,
        _count: {
          select: { applications: true },
        },
      },
    });

    if (!job) {
      throw new NotFoundException(`Job posting with ID ${id} not found`);
    }

    // Check ownership if userId provided
    if (userId !== undefined && job.businessProfileId !== userId) {
      // For workers, hide applicant count
      return this.sanitizeJobPostingForWorker(job);
    }

    return this.sanitizeJobPosting(job);
  }

  /**
   * Update a job posting
   * Only allowed if job is in DRAFT or ACTIVE status
   */
  async update(id: number, userId: number, updateDto: UpdateJobPostingDto) {
    const job = await this.prisma.jobPosting.findUnique({
      where: { id },
      include: { locations: true },
    });

    if (!job) {
      throw new NotFoundException(`Job posting with ID ${id} not found`);
    }

    // Check ownership
    const businessProfile = await this.getBusinessProfile(userId);
    if (job.businessId !== businessProfile.id) {
      throw new ForbiddenException('You do not have permission to update this job posting');
    }

    // Check if job can be updated (only DRAFT or ACTIVE)
    if (job.status !== JobStatus.DRAFT && job.status !== JobStatus.ACTIVE) {
      throw new BadRequestException(
        `Cannot update job with status ${job.status}. Only DRAFT and ACTIVE jobs can be updated.`
      );
    }

    // Validate date changes
    if (updateDto.startDate || updateDto.endDate) {
      const startDate = updateDto.startDate ? new Date(updateDto.startDate) : job.startDate;
      const endDate = updateDto.endDate ? new Date(updateDto.endDate) : job.endDate;

      if (endDate <= startDate) {
        throw new BadRequestException('End date must be after start date');
      }
    }

    // Update job posting
    const updatedJob = await this.prisma.$transaction(async (tx) => {
      // Update job
      const job = await tx.jobPosting.update({
        where: { id },
        data: {
          ...(updateDto.title !== undefined && { title: updateDto.title }),
          ...(updateDto.description !== undefined && { description: updateDto.description }),
          ...(updateDto.requirements !== undefined && { requirements: updateDto.requirements }),
          ...(updateDto.category !== undefined && { category: updateDto.category }),
          ...(updateDto.workType !== undefined && { workType: updateDto.workType }),
          ...(updateDto.durationAmount !== undefined && { durationAmount: updateDto.durationAmount }),
          ...(updateDto.durationUnit !== undefined && { durationUnit: updateDto.durationUnit }),
          ...(updateDto.startDate !== undefined && { startDate: new Date(updateDto.startDate) }),
          ...(updateDto.endDate !== undefined && { endDate: new Date(updateDto.endDate) }),
          ...(updateDto.compensationType !== undefined && { compensationType: updateDto.compensationType }),
          ...(updateDto.compensationMin !== undefined && { compensationMin: updateDto.compensationMin }),
          ...(updateDto.compensationMax !== undefined && { compensationMax: updateDto.compensationMax }),
          ...(updateDto.compensationCurrency !== undefined && { compensationCurrency: updateDto.compensationCurrency }),
          ...(updateDto.accommodationIncluded !== undefined && { accommodationIncluded: updateDto.accommodationIncluded }),
          ...(updateDto.mealsIncluded !== undefined && { mealsIncluded: updateDto.mealsIncluded }),
          ...(updateDto.requiredLanguages !== undefined && { requiredLanguages: updateDto.requiredLanguages }),
          ...(updateDto.skills !== undefined && { skills: updateDto.skills }),
          ...(updateDto.requiredExperience !== undefined && { requiredExperience: updateDto.requiredExperience }),
        },
      });

      // Update locations if provided
      if (updateDto.locations) {
        // Delete existing locations
        await tx.jobLocation.deleteMany({
          where: { jobPostingId: id },
        });

        // Create new locations
        if (updateDto.locations.length > 0) {
          await tx.jobLocation.createMany({
            data: updateDto.locations.map((location) => ({
              jobPostingId: id,
              locationName: location.locationName,
              address: location.address,
              city: location.city,
              country: location.country,
              postalCode: location.postalCode,
              latitude: location.latitude,
              longitude: location.longitude,
            })),
          });
        }
      }

      return job;
    });

    // Update OpenSearch index (in background)
    this.updateOpenSearchIndex(updatedJob.id).catch((error) => {
      this.logger.error(`Failed to update OpenSearch index for job ${updatedJob.id}`, error);
    });

    this.logger.log(`Job posting updated: ${updatedJob.id}`);

    return {
      message: 'Job posting updated successfully!',
      job: await this.findOne(updatedJob.id),
    };
  }

  /**
   * Change job status
   * Status workflow: DRAFT -> ACTIVE -> FILLED/COMPLETED/CANCELLED
   * CLOSED jobs cannot be reactivated (BR-JOB-006)
   */
  async changeStatus(id: number, userId: number, changeDto: ChangeJobStatusDto) {
    const job = await this.prisma.jobPosting.findUnique({
      where: { id },
    });

    if (!job) {
      throw new NotFoundException(`Job posting with ID ${id} not found`);
    }

    // Check ownership
    const businessProfile = await this.getBusinessProfile(userId);
    if (job.businessId !== businessProfile.id) {
      throw new ForbiddenException('You do not have permission to change this job status');
    }

    // Validate status transition
    this.validateStatusTransition(job.status, changeDto.status);

    // Update status
    const updateData: any = { status: changeDto.status };

    // Set closedAt for terminal statuses
    if (
      [JobStatus.CLOSED, JobStatus.FILLED, JobStatus.COMPLETED, JobStatus.CANCELLED].includes(
        changeDto.status
      )
    ) {
      updateData.closedAt = new Date();
    }

    const updatedJob = await this.prisma.jobPosting.update({
      where: { id },
      data: updateData,
    });

    // Update OpenSearch index (remove closed jobs, index others)
    if (
      [JobStatus.CLOSED, JobStatus.CANCELLED].includes(changeDto.status)
    ) {
      this.removeFromOpenSearch(id).catch((error) => {
        this.logger.error(`Failed to remove job ${id} from OpenSearch`, error);
      });
    } else {
      this.updateOpenSearchIndex(id).catch((error) => {
        this.logger.error(`Failed to update OpenSearch index for job ${id}`, error);
      });
    }

    this.logger.log(`Job status changed: ${id} from ${job.status} to ${changeDto.status}`);

    return {
      message: `Job status changed to ${changeDto.status}`,
      job: await this.findOne(updatedJob.id),
    };
  }

  /**
   * Delete a job posting (soft delete by setting status to CLOSED)
   */
  async remove(id: number, userId: number) {
    const job = await this.prisma.jobPosting.findUnique({
      where: { id },
    });

    if (!job) {
      throw new NotFoundException(`Job posting with ID ${id} not found`);
    }

    // Check ownership
    const businessProfile = await this.getBusinessProfile(userId);
    if (job.businessId !== businessProfile.id) {
      throw new ForbiddenException('You do not have permission to delete this job posting');
    }

    // Soft delete by setting status to CLOSED
    await this.prisma.jobPosting.update({
      where: { id },
      data: {
        status: JobStatus.CLOSED,
        closedAt: new Date(),
      },
    });

    // Remove from OpenSearch
    this.removeFromOpenSearch(id).catch((error) => {
      this.logger.error(`Failed to remove job ${id} from OpenSearch`, error);
    });

    this.logger.log(`Job posting deleted (soft): ${id}`);

    return {
      message: 'Job posting deleted successfully!',
    };
  }

  /**
   * Track job view
   */
  async trackView(jobId: number, viewerType: string, viewerId?: number, viewSource?: string) {
    try {
      await this.prisma.jobView.create({
        data: {
          jobPostingId: jobId,
          viewerType,
          viewerId,
          viewSource,
        },
      });

      // Increment view count (batch updates would be better for high traffic)
      await this.prisma.jobPosting.update({
        where: { id: jobId },
        data: {
          viewCount: {
            increment: 1,
          },
        },
      });
    } catch (error) {
      // Log but don't throw - view tracking shouldn't break the request
      this.logger.error(`Failed to track view for job ${jobId}`, error);
    }
  }

  /**
   * Validate job creation business rules
   */
  private async validateJobCreationRules(
    businessProfile: BusinessProfile,
    createDto: CreateJobPostingDto
  ) {
    // BR-JOB-001: Max 50 active jobs
    const activeJobCount = await this.prisma.jobPosting.count({
      where: {
        businessId: businessProfile.id,
        status: {
          in: [JobStatus.DRAFT, JobStatus.ACTIVE],
        },
      },
    });

    if (activeJobCount >= 50) {
      throw new BadRequestException(
        'You have reached the maximum limit of 50 active job postings. Please close or delete some jobs first.'
      );
    }

    // BR-JOB-002: Min 50 char description (already enforced by DTO)
    if (createDto.description.length < 50) {
      throw new BadRequestException('Job description must be at least 50 characters long');
    }

    // BR-JOB-003: Compensation > 0 if provided
    if (
      (createDto.compensationMin !== undefined && createDto.compensationMin <= 0) ||
      (createDto.compensationMax !== undefined && createDto.compensationMax <= 0)
    ) {
      throw new BadRequestException('Compensation must be greater than 0');
    }

    // Validate compensation range
    if (
      createDto.compensationMin !== undefined &&
      createDto.compensationMax !== undefined &&
      createDto.compensationMin > createDto.compensationMax
    ) {
      throw new BadRequestException('Minimum compensation cannot be greater than maximum compensation');
    }

    // BR-JOB-004: Start date must be in future
    const startDate = new Date(createDto.startDate);
    if (startDate < new Date()) {
      throw new BadRequestException('Start date must be in the future');
    }

    // BR-JOB-005: End date must be after start date
    const endDate = new Date(createDto.endDate);
    if (endDate <= startDate) {
      throw new BadRequestException('End date must be after start date');
    }

    // Validate at least one location
    if (!createDto.locations || createDto.locations.length === 0) {
      throw new BadRequestException('At least one job location is required');
    }
  }

  /**
   * Validate status transition
   * BR-JOB-006: Closed jobs cannot be reactivated
   */
  private validateStatusTransition(currentStatus: JobStatus, newStatus: JobStatus) {
    // Closed jobs cannot be reactivated
    if (currentStatus === JobStatus.CLOSED && newStatus === JobStatus.ACTIVE) {
      throw new BadRequestException(
        'Cannot reactivate a closed job. Please create a new job posting.'
      );
    }

    // FILLED and COMPLETED are terminal states
    if (
      [JobStatus.FILLED, JobStatus.COMPLETED].includes(currentStatus) &&
      newStatus === JobStatus.ACTIVE
    ) {
      throw new BadRequestException(
        `Cannot reactivate a job with status ${currentStatus}. Please create a new job posting.`
      );
    }

    // CANCELLED can only transition from DRAFT or ACTIVE
    if (newStatus === JobStatus.CANCELLED) {
      if (![JobStatus.DRAFT, JobStatus.ACTIVE].includes(currentStatus)) {
        throw new BadRequestException(
          `Cannot cancel a job with status ${currentStatus}`
        );
      }
    }

    // FILLED should only come from ACTIVE
    if (newStatus === JobStatus.FILLED && currentStatus !== JobStatus.ACTIVE) {
      throw new BadRequestException(
        'Can only mark ACTIVE jobs as FILLED'
      );
    }

    // COMPLETED should only come from FILLED
    if (newStatus === JobStatus.COMPLETED && currentStatus !== JobStatus.FILLED) {
      throw new BadRequestException(
        'Can only mark FILLED jobs as COMPLETED'
      );
    }
  }

  /**
   * Get business profile for user
   */
  private async getBusinessProfile(userId: number): Promise<BusinessProfile> {
    const businessProfile = await this.prisma.businessProfile.findFirst({
      where: { userId },
    });

    if (!businessProfile) {
      throw new NotFoundException(
        'Business profile not found. Please create a business profile first.'
      );
    }

    return businessProfile;
  }

  /**
   * Sanitize job posting for response
   */
  private sanitizeJobPosting(job: any): any {
    const { businessProfileId, ...sanitized } = job;
    return sanitized;
  }

  /**
   * Sanitize job posting for worker view (hide sensitive info)
   */
  private sanitizeJobPostingForWorker(job: any): any {
    const sanitized = this.sanitizeJobPosting(job);
    // Remove applicant count for workers
    if (sanitized._count) {
      delete sanitized._count.applications;
    }
    return sanitized;
  }

  /**
   * Index job in OpenSearch (async)
   */
  private async indexJobInOpenSearch(jobId: number) {
    const job = await this.prisma.jobPosting.findUnique({
      where: { id: jobId },
      include: { locations: true, businessProfile: true },
    });

    if (!job) return;

    // Use first location for geo search
    const primaryLocation = job.locations[0];

    await this.openSearch.indexJob({
      id: job.id,
      title: job.title,
      description: job.description,
      requirements: job.requirements,
      category: job.category,
      workType: job.workType,
      latitude: primaryLocation?.latitude,
      longitude: primaryLocation?.longitude,
      startDate: job.startDate,
      endDate: job.endDate,
      compensationMin: job.compensationMin,
      compensationMax: job.compensationMax,
      requiredLanguages: job.requiredLanguages,
      skills: job.skills,
      status: job.status,
      businessId: job.businessId,
      businessName: job.businessProfile.businessName,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  }

  /**
   * Update OpenSearch index (async)
   */
  private async updateOpenSearchIndex(jobId: number) {
    await this.indexJobInOpenSearch(jobId);
  }

  /**
   * Remove from OpenSearch (async)
   */
  private async removeFromOpenSearch(jobId: number) {
    try {
      await this.openSearch.deleteJob(jobId);
    } catch (error) {
      this.logger.error(`Failed to remove job ${jobId} from OpenSearch`, error);
    }
  }
}
