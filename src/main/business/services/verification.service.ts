import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/database/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as AWS from 'aws-sdk';
import { VerificationDocumentType, VerificationStatus } from '@prisma/client';

@Injectable()
export class VerificationService {
  private s3: AWS.S3;
  private bucketName: string;
  private cdnDomain: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    // Initialize AWS S3 for encrypted document storage
    this.s3 = new AWS.S3({
      accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID'),
      secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY'),
      region: this.configService.get<string>('AWS_REGION', 'eu-west-1'),
    });

    this.bucketName = this.configService.get<string>('AWS_S3_VERIFICATION_DOCS_BUCKET', 'nomadshift-verification-docs');
    this.cdnDomain = this.configService.get<string>('CDN_DOMAIN', 'https://d1a1a1a1.cloudfront.net');
  }

  /**
   * Upload verification document
   */
  async uploadDocument(
    businessProfileId: number,
    documentType: VerificationDocumentType,
    fileName: string,
    fileBuffer: Buffer,
    userId: number
  ) {
    // Verify business profile ownership
    const profile = await this.prisma.businessProfile.findUnique({
      where: { id: businessProfileId },
      include: {
        verificationDocuments: {
          where: {
            verificationStatus: {
              in: [VerificationStatus.PENDING, VerificationStatus.APPROVED],
            },
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Business profile not found');
    }

    if (profile.userId !== userId) {
      throw new ForbiddenException('You do not have permission to upload documents for this business profile');
    }

    // Check if business is already verified
    if (profile.isVerified) {
      throw new BadRequestException('This business is already verified.');
    }

    // Check document limit (max 3 documents per submission)
    if (profile.verificationDocuments.length >= 3) {
      throw new BadRequestException('Maximum limit of 3 verification documents reached.');
    }

    // Validate file type
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    const fileType = this.getFileType(fileName);
    if (!allowedTypes.includes(fileType)) {
      throw new BadRequestException('Invalid file type. Only PDF, JPEG, and PNG are allowed.');
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (fileBuffer.length > maxSize) {
      throw new BadRequestException('File size cannot exceed 10MB.');
    }

    // Generate unique key
    const fileExtension = fileName.split('.').pop();
    const uniqueFileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExtension}`;
    const key = `verification-documents/${businessProfileId}/${uniqueFileName}`;

    try {
      // Upload to S3 (private, encrypted)
      await this.s3.putObject({
        Bucket: this.bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: fileType,
        ServerSideEncryption: 'AES256',
      }).promise();

      // Save document metadata to database
      const document = await this.prisma.businessVerificationDocument.create({
        data: {
          businessProfileId,
          documentType,
          fileUrl: key, // Store S3 key (not public URL)
          fileName: uniqueFileName,
          verificationStatus: VerificationStatus.PENDING,
        },
      });

      // In production, send notification to admin
      // await this.notifyAdmins(document);

      return {
        message: 'Verification document uploaded successfully!',
        document: {
          id: document.id,
          documentType: document.documentType,
          fileName: document.fileName,
          uploadDate: document.uploadDate,
          verificationStatus: document.verificationStatus,
        },
      };
    } catch (error) {
      console.error('Document upload error:', error);
      throw new BadRequestException('Failed to upload document. Please try again.');
    }
  }

  /**
   * Get verification status for a business profile
   */
  async getVerificationStatus(businessProfileId: number, userId?: number) {
    const profile = await this.prisma.businessProfile.findUnique({
      where: { id: businessProfileId },
      include: {
        verificationDocuments: {
          orderBy: { uploadDate: 'desc' },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Business profile not found');
    }

    // If userId is provided, check ownership
    if (userId !== undefined && profile.userId !== userId) {
      throw new ForbiddenException('You do not have permission to view verification status for this business profile');
    }

    return {
      isVerified: profile.isVerified,
      documents: profile.verificationDocuments.map((doc) => ({
        id: doc.id,
        documentType: doc.documentType,
        fileName: doc.fileName,
        uploadDate: doc.uploadDate,
        verificationStatus: doc.verificationStatus,
        rejectionReason: doc.rejectionReason,
      })),
    };
  }

  /**
   * Approve verification (admin only)
   */
  async approveVerification(documentId: number, adminUserId: number) {
    // Verify admin user
    const adminUser = await this.prisma.user.findUnique({
      where: { id: adminUserId },
    });

    if (!adminUser || adminUser.role !== 'ADMIN') {
      throw new ForbiddenException('Only administrators can approve verifications');
    }

    // Get document with business profile
    const document = await this.prisma.businessVerificationDocument.findUnique({
      where: { id: documentId },
      include: {
        businessProfile: true,
      },
    });

    if (!document) {
      throw new NotFoundException('Verification document not found');
    }

    if (document.verificationStatus === VerificationStatus.APPROVED) {
      throw new BadRequestException('This document is already approved.');
    }

    // Update document status
    await this.prisma.businessVerificationDocument.update({
      where: { id: documentId },
      data: {
        verificationStatus: VerificationStatus.APPROVED,
        reviewedBy: adminUserId,
        reviewDate: new Date(),
      },
    });

    // Mark business profile as verified
    await this.prisma.businessProfile.update({
      where: { id: document.businessProfileId },
      data: { isVerified: true },
    });

    // In production, send approval email to business owner
    // await this.sendApprovalEmail(document.businessProfile.userId);

    return {
      message: 'Verification approved successfully!',
      businessProfileId: document.businessProfileId,
    };
  }

  /**
   * Reject verification (admin only)
   */
  async rejectVerification(documentId: number, rejectionReason: string, adminUserId: number) {
    if (!rejectionReason || rejectionReason.trim().length === 0) {
      throw new BadRequestException('Rejection reason is required');
    }

    // Verify admin user
    const adminUser = await this.prisma.user.findUnique({
      where: { id: adminUserId },
    });

    if (!adminUser || adminUser.role !== 'ADMIN') {
      throw new ForbiddenException('Only administrators can reject verifications');
    }

    // Get document
    const document = await this.prisma.businessVerificationDocument.findUnique({
      where: { id: documentId },
      include: {
        businessProfile: true,
      },
    });

    if (!document) {
      throw new NotFoundException('Verification document not found');
    }

    if (document.verificationStatus === VerificationStatus.APPROVED) {
      throw new BadRequestException('Cannot reject an already approved document.');
    }

    // Update document status
    await this.prisma.businessVerificationDocument.update({
      where: { id: documentId },
      data: {
        verificationStatus: VerificationStatus.REJECTED,
        reviewedBy: adminUserId,
        reviewDate: new Date(),
        rejectionReason,
      },
    });

    // In production, send rejection email to business owner
    // await this.sendRejectionEmail(document.businessProfile.userId, rejectionReason);

    return {
      message: 'Verification rejected successfully!',
      businessProfileId: document.businessProfileId,
    };
  }

  /**
   * Get pending verifications (admin only)
   */
  async getPendingVerifications(adminUserId: number) {
    // Verify admin user
    const adminUser = await this.prisma.user.findUnique({
      where: { id: adminUserId },
    });

    if (!adminUser || adminUser.role !== 'ADMIN') {
      throw new ForbiddenException('Only administrators can view pending verifications');
    }

    const pendingVerifications = await this.prisma.businessVerificationDocument.findMany({
      where: {
        verificationStatus: VerificationStatus.PENDING,
      },
      include: {
        businessProfile: {
          select: {
            id: true,
            businessName: true,
            businessType: true,
            locationCity: true,
            locationCountry: true,
          },
        },
      },
      orderBy: { uploadDate: 'asc' },
    });

    return pendingVerifications.map((doc) => ({
      id: doc.id,
      businessProfile: doc.businessProfile,
      documentType: doc.documentType,
      fileName: doc.fileName,
      uploadDate: doc.uploadDate,
    }));
  }

  /**
   * Get file type from filename
   */
  private getFileType(fileName: string): string {
    const extension = fileName.split('.').pop()?.toLowerCase();

    switch (extension) {
      case 'pdf':
        return 'application/pdf';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      default:
        return 'application/octet-stream';
    }
  }

  /**
   * Delete verification document (user can delete their own documents)
   */
  async deleteDocument(documentId: number, userId: number) {
    const document = await this.prisma.businessVerificationDocument.findUnique({
      where: { id: documentId },
      include: {
        businessProfile: true,
      },
    });

    if (!document) {
      throw new NotFoundException('Verification document not found');
    }

    // Check ownership
    if (document.businessProfile.userId !== userId) {
      throw new ForbiddenException('You do not have permission to delete this document');
    }

    // Cannot delete approved documents
    if (document.verificationStatus === VerificationStatus.APPROVED) {
      throw new BadRequestException('Cannot delete an approved verification document.');
    }

    // Delete from S3
    try {
      await this.s3.deleteObject({
        Bucket: this.bucketName,
        Key: document.fileUrl,
      }).promise();
    } catch (error) {
      console.error('Failed to delete document from S3:', error);
    }

    // Delete from database
    await this.prisma.businessVerificationDocument.delete({
      where: { id: documentId },
    });

    return {
      message: 'Verification document deleted successfully!',
    };
  }
}
