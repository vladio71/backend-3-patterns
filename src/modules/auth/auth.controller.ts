import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { LoginDto, RegisterDto } from './auth.dto';
import { AuthResult, AuthService } from './auth.service';
import { AuthedRequest } from './jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthResult> {
    return this.auth.register(dto.tenantSlug, dto.email, dto.password);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto): Promise<AuthResult> {
    return this.auth.login(dto.tenantSlug, dto.email, dto.password);
  }

  @ApiBearerAuth()
  @Get('me')
  async me(@Req() req: AuthedRequest): Promise<{ id: string; email: string; role: string; tenantId: string }> {
    const user = await this.auth.findById(req.user.sub);
    if (!user) return { id: req.user.sub, email: '', role: req.user.role, tenantId: req.user.tenantId };
    return { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId };
  }
}
