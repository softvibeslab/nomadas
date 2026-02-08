import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../shared/infrastructure/database/prisma.service';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { PasswordValidator } from './utils/password-validator';
import { LoginDto, RegisterDto, VerifyEmailDto, ResendVerificationDto } from './dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { userRoles: { select: { role: true } } },
    });

    if (!user || !user.verifiedAt) {
      throw new UnauthorizedException('Please verify your email address before logging in');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const roles = user.userRoles.map(ur => ur.role);
    return { id: user.id, email: user.email, roles };
  }

  async register(registerDto: RegisterDto) {
    const { email, password, firstName, lastName, preferredLanguage, acceptTos } = registerDto;

    // Check if email already exists
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException('This email is already registered. Please log in or reset your password.');
    }

    // Validate password strength
    const passwordValidation = PasswordValidator.isValidPassword(password);
    if (!passwordValidation.isValid) {
      throw new BadRequestException({
        message: 'Password does not meet requirements',
        errors: passwordValidation.errors
      });
    }

    // Generate verification token
    const verificationToken = uuidv4();
    const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user with transaction
    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          preferredLanguage,
          verificationToken,
          verificationTokenExpiresAt,
        },
      });

      // Record ToS acceptance
      await tx.tosAcceptance.create({
        data: {
          userId: newUser.id,
          version: '1.0',
          // In a real application, you would get IP and user agent from the request
          ipAddress: '127.0.0.1',
          userAgent: 'nomadas-app/1.0',
        },
      });

      return newUser;
    });

    // In a real application, you would send an email here
    // await this.sendVerificationEmail(user.email, verificationToken);

    return {
      message: 'Account created successfully. Please check your email to verify your account.',
      email: user.email,
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { userRoles: { select: { role: true } } },
    });

    if (!user || !user.verifiedAt) {
      throw new UnauthorizedException('Please verify your email address before logging in. We\'ve sent a verification email to [email].');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const roles = user.userRoles.map(ur => ur.role);
    const payload = {
      sub: user.id,
      email: user.email,
      roles,
    };

    // Create session
    const sessionId = uuidv4();
    const token = this.jwtService.sign(payload);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        token,
        expiresAt,
      },
    });

    return {
      access_token: token,
      expiresIn: '30d',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles,
      },
    };
  }

  async verifyEmail(verifyEmailDto: VerifyEmailDto) {
    const { token } = verifyEmailDto;

    const user = await this.prisma.user.findFirst({
      where: {
        verificationToken: token,
        verificationTokenExpiresAt: { gt: new Date() },
        verifiedAt: null,
      },
    });

    if (!user) {
      if (await this.prisma.user.findFirst({
        where: {
          verificationToken: token,
          verifiedAt: null,
        },
      })) {
        throw new BadRequestException('This verification link has expired. Please request a new verification email.');
      } else {
        throw new BadRequestException('This verification link is invalid.');
      }
    }

    // Mark user as verified
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        verifiedAt: new Date(),
        verificationToken: null,
      },
    });

    // In a real application, you would send a welcome email here
    // await this.sendWelcomeEmail(user.email);

    return {
      message: 'Email verified successfully! You can now proceed to the next step.',
    };
  }

  async resendVerification(resendVerificationDto: ResendVerificationDto) {
    const { email } = resendVerificationDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new BadRequestException('No user found with this email address.');
    }

    if (user.verifiedAt) {
      throw new BadRequestException('This email has already been verified. You can now log in.');
    }

    // Generate new verification token
    const verificationToken = uuidv4();
    const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        verificationToken,
        verificationTokenExpiresAt,
      },
    });

    // In a real application, you would send an email here
    // await this.sendVerificationEmail(user.email, verificationToken);

    return {
      message: 'A new verification email has been sent. Please check your inbox.',
    };
  }

  async logout(userId: number) {
    await this.prisma.session.deleteMany({
      where: { userId },
    });
    return { message: 'Logged out successfully' };
  }

  async getUserProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { select: { role: true } } },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const roles = user.userRoles.map(ur => ur.role);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.avatar,
      preferredLanguage: user.preferredLanguage,
      verifiedAt: user.verifiedAt,
      roles,
      createdAt: user.createdAt,
    };
  }
}