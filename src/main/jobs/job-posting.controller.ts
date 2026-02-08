import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JobStatus } from '@prisma/client';
import { JobPostingService } from './job-posting.service';
import {
  CreateJobPostingDto,
  UpdateJobPostingDto,
  ChangeJobStatusDto,
  SearchJobsDto,
} from './dto';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { User } from '../identity/decorators/user.decorator';

@ApiTags('Job Postings')
@Controller('jobs')
export class JobPostingController {
  constructor(private readonly jobPostingService: JobPostingService) {}

  /**
   * Public endpoint - Search job postings
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search job postings',
    description: 'Search for job postings with advanced filters. This endpoint supports geospatial search, category filtering, compensation ranges, and more.',
  })
  @ApiResponse({
    status: 200,
    description: 'Search results returned successfully',
    schema: {
      example: {
        hits: 150,
        jobs: [
          {
            id: 1,
            title: 'Summer Server - Beach Restaurant',
            description: 'Join our vibrant team...',
            category: 'FOOD_SERVICE',
            locations: [{ city: 'Barcelona', country: 'Spain' }],
            compensationMin: 300,
            compensationMax: 400,
            businessProfile: {
              businessName: 'Sunset Beach Bar',
              averageRating: 4.5,
              hasGoodEmployerBadge: true,
            },
          },
        ],
        page: 1,
        limit: 20,
      },
    },
  })
  async searchJobs(@Query() searchDto: SearchJobsDto) {
    // Search is handled by the existing JobsService
    // This endpoint will be integrated with advanced search in Phase 3
    return { message: 'Advanced search will be implemented in Phase 3' };
  }

  /**
   * Public endpoint - Get job by ID
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get job posting by ID',
    description: 'Returns detailed information about a specific job posting. Track views for analytics.',
  })
  @ApiParam({
    name: 'id',
    description: 'Job posting ID',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: 'Job posting found',
    schema: {
      example: {
        id: 1,
        title: 'Summer Server - Beach Restaurant',
        description: 'Join our vibrant beach restaurant team...',
        category: 'FOOD_SERVICE',
        workType: 'SEASONAL',
        startDate: '2024-06-01',
        endDate: '2024-08-31',
        compensationMin: 300,
        compensationMax: 400,
        accommodationIncluded: true,
        mealsIncluded: true,
        locations: [
          {
            id: 1,
            address: '123 Passeig de Gràcia',
            city: 'Barcelona',
            country: 'Spain',
            latitude: 41.3851,
            longitude: 2.1734,
          },
        ],
        businessProfile: {
          businessName: 'Sunset Beach Bar',
          businessType: 'RESTAURANT',
          locationCity: 'Barcelona',
          locationCountry: 'Spain',
          prestigeLevel: 'GOLD',
          averageRating: 4.5,
          totalReviews: 15,
          hasGoodEmployerBadge: true,
        },
        viewCount: 42,
        status: 'ACTIVE',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Job posting not found' })
  async getJob(@Param('id') id: string) {
    return this.jobPostingService.findOne(+id);
  }

  /**
   * Business endpoint - Create job posting
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new job posting',
    description: 'Creates a new job posting for the authenticated business user. Enforces business rules (max 50 active jobs, min 50 char description, etc.)',
  })
  @ApiResponse({
    status: 201,
    description: 'Job posting created successfully',
    schema: {
      example: {
        id: 1,
        message: 'Job posting created successfully!',
        job: {
          id: 1,
          title: 'Summer Server - Beach Restaurant',
          status: 'DRAFT',
          // ... other fields
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Validation failed or business rules violated' })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT token required' })
  @ApiResponse({ status: 404, description: 'Not Found - Business profile not found' })
  async create(@User() user: any, @Body() createDto: CreateJobPostingDto) {
    return this.jobPostingService.create(user.userId, createDto);
  }

  /**
   * Business endpoint - Get all job postings for authenticated business
   */
  @Get('business/my-jobs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get all job postings for authenticated business',
    description: 'Returns a paginated list of all job postings owned by the authenticated business user.',
  })
  @ApiResponse({
    status: 200,
    description: 'Job postings list',
    schema: {
      example: {
        jobs: [
          {
            id: 1,
            title: 'Summer Server',
            status: 'ACTIVE',
            applicantCount: 5,
            viewCount: 42,
          },
        ],
        total: 10,
        page: 1,
        limit: 20,
        totalPages: 1,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT token required' })
  async getMyJobs(
    @User() user: any,
    @Query('status') status?: JobStatus,
    @Query('page') page?: number,
    @Query('limit') limit?: number
  ) {
    return this.jobPostingService.findAllByBusiness(user.userId, { status, page, limit });
  }

  /**
   * Business endpoint - Update job posting
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update a job posting',
    description: 'Updates an existing job posting. Only allowed if job is in DRAFT or ACTIVE status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Job posting updated successfully',
    schema: {
      example: {
        message: 'Job posting updated successfully!',
        job: {
          id: 1,
          title: 'Updated Summer Server',
          // ... other fields
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Job cannot be updated (wrong status)' })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT token required' })
  @ApiResponse({ status: 403, description: 'Forbidden - Not your job posting' })
  @ApiResponse({ status: 404, description: 'Job posting not found' })
  async update(@Param('id') id: string, @User() user: any, @Body() updateDto: UpdateJobPostingDto) {
    return this.jobPostingService.update(+id, user.userId, updateDto);
  }

  /**
   * Business endpoint - Change job status
   */
  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change job posting status',
    description: 'Changes the status of a job posting. Follows status workflow rules (DRAFT -> ACTIVE -> FILLED/COMPLETED/CANCELLED). Closed jobs cannot be reactivated.',
  })
  @ApiResponse({
    status: 200,
    description: 'Job status changed successfully',
    schema: {
      example: {
        message: 'Job status changed to ACTIVE',
        job: {
          id: 1,
          status: 'ACTIVE',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid status transition' })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT token required' })
  @ApiResponse({ status: 403, description: 'Forbidden - Not your job posting' })
  @ApiResponse({ status: 404, description: 'Job posting not found' })
  async changeStatus(@Param('id') id: string, @User() user: any, @Body() changeDto: ChangeJobStatusDto) {
    return this.jobPostingService.changeStatus(+id, user.userId, changeDto);
  }

  /**
   * Business endpoint - Delete job posting (soft delete)
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a job posting (soft delete)',
    description: 'Soft deletes a job posting by setting status to CLOSED. The job remains in the database but is removed from search results.',
  })
  @ApiResponse({
    status: 200,
    description: 'Job posting deleted successfully',
    schema: {
      example: {
        message: 'Job posting deleted successfully!',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT token required' })
  @ApiResponse({ status: 403, description: 'Forbidden - Not your job posting' })
  @ApiResponse({ status: 404, description: 'Job posting not found' })
  async remove(@Param('id') id: string, @User() user: any) {
    return this.jobPostingService.remove(+id, user.userId);
  }
}
