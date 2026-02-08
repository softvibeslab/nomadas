import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/database/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as AWS from 'aws-sdk';
import * as sharp from 'sharp';

@Injectable()
export class PhotoUploadService {
  private s3: AWS.S3;
  private bucketName: string;
  private cdnDomain: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    // Initialize AWS S3
    this.s3 = new AWS.S3({
      accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID'),
      secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY'),
      region: this.configService.get<string>('AWS_REGION', 'eu-west-1'),
    });

    this.bucketName = this.configService.get<string>('AWS_S3_BUSINESS_PHOTOS_BUCKET', 'nomadshift-business-photos');
    this.cdnDomain = this.configService.get<string>('CDN_DOMAIN', 'https://d1a1a1a1.cloudfront.net');
  }

  /**
   * Generate a presigned URL for direct photo upload
   */
  async generatePresignedUploadUrl(businessProfileId: number, fileName: string, contentType: string, userId: number) {
    // Verify business profile ownership
    const profile = await this.prisma.businessProfile.findUnique({
      where: { id: businessProfileId },
      include: {
        photos: {
          select: { id: true },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Business profile not found');
    }

    if (profile.userId !== userId) {
      throw new ForbiddenException('You do not have permission to upload photos to this business profile');
    }

    // Check photo limit (max 10 photos)
    if (profile.photos.length >= 10) {
      throw new BadRequestException('Maximum limit of 10 photos reached. Please delete existing photos before uploading new ones.');
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(contentType)) {
      throw new BadRequestException('Invalid file type. Only JPEG, PNG, and WEBP are allowed.');
    }

    // Generate unique key
    const fileExtension = fileName.split('.').pop();
    const uniqueFileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExtension}`;
    const key = `business-profiles/${businessProfileId}/photos/${uniqueFileName}`;

    // Generate presigned URL (valid for 15 minutes)
    const presignedUrl = await this.s3.getSignedUrlPromise('putObject', {
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
      Expires: 900, // 15 minutes
    });

    return {
      uploadUrl: presignedUrl,
      fileKey: key,
      expiresIn: 900,
    };
  }

  /**
   * Confirm photo upload and process the image
   */
  async confirmPhotoUpload(businessProfileId: number, fileKey: string, userId: number) {
    // Verify ownership
    const profile = await this.prisma.businessProfile.findUnique({
      where: { id: businessProfileId },
      include: {
        photos: {
          orderBy: { uploadOrder: 'desc' },
          take: 1,
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Business profile not found');
    }

    if (profile.userId !== userId) {
      throw new ForbiddenException('You do not have permission to modify this business profile');
    }

    try {
      // Download the uploaded image from S3
      const s3Object = await this.s3.getObject({
        Bucket: this.bucketName,
        Key: fileKey,
      }).promise();

      const imageBuffer = s3Object.Body as Buffer;

      // Get image metadata
      const metadata = await sharp(imageBuffer).metadata();
      const width = metadata.width || 0;
      const height = metadata.height || 0;
      const fileSizeBytes = imageBuffer.length;

      // Validate dimensions
      if (width < 400 || height < 400) {
        throw new BadRequestException('Image dimensions must be at least 400x400 pixels');
      }

      if (width > 8000 || height > 8000) {
        throw new BadRequestException('Image dimensions cannot exceed 8000x8000 pixels');
      }

      // Validate file size (5MB max)
      if (fileSizeBytes > 5 * 1024 * 1024) {
        throw new BadRequestException('File size cannot exceed 5MB');
      }

      // Process image: create thumbnail and standard size
      const [thumbnailBuffer, standardBuffer] = await Promise.all([
        sharp(imageBuffer)
          .resize(200, 200, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 80 })
          .toBuffer(),
        sharp(imageBuffer)
          .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer(),
      ]);

      // Generate keys for processed images
      const thumbnailKey = fileKey.replace(/\.([^.]*)$/, '_thumb.$1');
      const standardKey = fileKey.replace(/\.([^.]*)$/, '_standard.$1');

      // Upload processed images to S3
      await Promise.all([
        this.s3.putObject({
          Bucket: this.bucketName,
          Key: thumbnailKey,
          Body: thumbnailBuffer,
          ContentType: 'image/jpeg',
        }).promise(),
        this.s3.putObject({
          Bucket: this.bucketName,
          Key: standardKey,
          Body: standardBuffer,
          ContentType: 'image/jpeg',
        }).promise(),
      ]);

      // Determine upload order (next available)
      const nextOrder = profile.photos.length > 0 ? profile.photos[0].uploadOrder + 1 : 0;

      // Determine if this is the primary photo (first photo)
      const isPrimary = profile.photos.length === 0;

      // Save photo metadata to database
      const photo = await this.prisma.businessPhoto.create({
        data: {
          businessProfileId,
          fileName: fileKey.split('/').pop() || 'photo.jpg',
          fileUrl: `${this.cdnDomain}/${standardKey}`,
          thumbnailUrl: `${this.cdnDomain}/${thumbnailKey}`,
          fileSizeBytes,
          width,
          height,
          uploadOrder: nextOrder,
          isPrimary,
        },
      });

      // Delete original uploaded file (we only keep processed versions)
      await this.s3.deleteObject({
        Bucket: this.bucketName,
        Key: fileKey,
      }).promise();

      return {
        message: 'Photo uploaded and processed successfully!',
        photo: {
          id: photo.id,
          fileUrl: photo.fileUrl,
          thumbnailUrl: photo.thumbnailUrl,
          width: photo.width,
          height: photo.height,
          isPrimary: photo.isPrimary,
        },
      };
    } catch (error) {
      // Clean up uploaded file if processing fails
      await this.s3.deleteObject({
        Bucket: this.bucketName,
        Key: fileKey,
      }).promise();
      throw error;
    }
  }

  /**
   * Delete a photo
   */
  async deletePhoto(businessProfileId: number, photoId: number, userId: number) {
    // Verify ownership and get photo
    const profile = await this.prisma.businessProfile.findUnique({
      where: { id: businessProfileId },
      include: {
        photos: {
          where: { id: photoId },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Business profile not found');
    }

    if (profile.userId !== userId) {
      throw new ForbiddenException('You do not have permission to delete photos from this business profile');
    }

    if (profile.photos.length === 0) {
      throw new NotFoundException('Photo not found');
    }

    const photo = profile.photos[0];

    // Check if this is the only photo (minimum 1 photo required)
    const totalPhotos = await this.prisma.businessPhoto.count({
      where: { businessProfileId },
    });

    if (totalPhotos === 1) {
      throw new BadRequestException('Cannot delete the only photo. Business profiles must have at least 1 photo.');
    }

    // Delete files from S3
    const fileKey = photo.fileUrl.replace(`${this.cdnDomain}/`, '');
    const thumbnailKey = photo.thumbnailUrl.replace(`${this.cdnDomain}/`, '');

    await Promise.all([
      this.s3.deleteObject({ Bucket: this.bucketName, Key: fileKey }).promise(),
      this.s3.deleteObject({ Bucket: this.bucketName, Key: thumbnailKey }).promise(),
    ]);

    // Delete from database
    await this.prisma.businessPhoto.delete({
      where: { id: photoId },
    });

    // If this was the primary photo, set another photo as primary
    if (photo.isPrimary) {
      const nextPhoto = await this.prisma.businessPhoto.findFirst({
        where: { businessProfileId },
        orderBy: { uploadOrder: 'asc' },
      });

      if (nextPhoto) {
        await this.prisma.businessPhoto.update({
          where: { id: nextPhoto.id },
          data: { isPrimary: true },
        });
      }
    }

    return {
      message: 'Photo deleted successfully!',
    };
  }

  /**
   * Reorder photos
   */
  async reorderPhotos(businessProfileId: number, photoIds: number[], userId: number) {
    // Verify ownership
    const profile = await this.prisma.businessProfile.findUnique({
      where: { id: businessProfileId },
    });

    if (!profile) {
      throw new NotFoundException('Business profile not found');
    }

    if (profile.userId !== userId) {
      throw new ForbiddenException('You do not have permission to reorder photos in this business profile');
    }

    // Verify all photos belong to this business profile
    const photos = await this.prisma.businessPhoto.findMany({
      where: {
        id: { in: photoIds },
        businessProfileId,
      },
    });

    if (photos.length !== photoIds.length) {
      throw new BadRequestException('Some photos do not belong to this business profile');
    }

    // Update upload order for each photo
    await Promise.all(
      photoIds.map((photoId, index) =>
        this.prisma.businessPhoto.update({
          where: { id: photoId },
          data: { uploadOrder: index },
        })
      )
    );

    return {
      message: 'Photos reordered successfully!',
    };
  }

  /**
   * Set primary photo
   */
  async setPrimaryPhoto(businessProfileId: number, photoId: number, userId: number) {
    // Verify ownership
    const profile = await this.prisma.businessProfile.findUnique({
      where: { id: businessProfileId },
      include: {
        photos: {
          where: { id: photoId },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Business profile not found');
    }

    if (profile.userId !== userId) {
      throw new ForbiddenException('You do not have permission to modify this business profile');
    }

    if (profile.photos.length === 0) {
      throw new NotFoundException('Photo not found');
    }

    // Unset current primary photo
    await this.prisma.businessPhoto.updateMany({
      where: { businessProfileId, isPrimary: true },
      data: { isPrimary: false },
    });

    // Set new primary photo
    await this.prisma.businessPhoto.update({
      where: { id: photoId },
      data: { isPrimary: true },
    });

    return {
      message: 'Primary photo set successfully!',
    };
  }
}
