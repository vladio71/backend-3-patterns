// Мінімальний JWT-auth. Перший користувач нового tenant стає admin, решта user.
// Це не предмет проєкту, тому без refresh-токенів і без сесій.
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { AppConfig, CONFIG } from '../../common/config';
import { conflict, isUniqueViolation } from '../../common/errors';
import { Tenant } from './tenant.entity';
import { User, UserRole } from './user.entity';

export type JwtClaims = { sub: string; tenantId: string; role: UserRole };

export type AuthResult = { accessToken: string; user: { id: string; email: string; role: UserRole; tenantId: string } };

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async register(tenantSlug: string, email: string, password: string): Promise<AuthResult> {
    let tenant = await this.tenants.findOne({ where: { slug: tenantSlug } });
    let role: UserRole = 'user';
    if (!tenant) {
      tenant = await this.tenants.save(this.tenants.create({ slug: tenantSlug, name: tenantSlug }));
      role = 'admin';
    }
    const passwordHash = await bcrypt.hash(password, 8);
    try {
      const user = await this.users.save(this.users.create({ tenantId: tenant.id, email, passwordHash, role }));
      return this.issue(user);
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('EMAIL_TAKEN', 'Такий email уже зареєстровано в цьому tenant');
      throw error;
    }
  }

  async login(tenantSlug: string, email: string, password: string): Promise<AuthResult> {
    const tenant = await this.tenants.findOne({ where: { slug: tenantSlug } });
    if (!tenant) throw new UnauthorizedException('Невірні дані для входу');
    const user = await this.users.findOne({ where: { tenantId: tenant.id, email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new UnauthorizedException('Невірні дані для входу');
    return this.issue(user);
  }

  verify(token: string): JwtClaims {
    const payload = jwt.verify(token, this.config.jwtSecret) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string' || typeof payload.tenantId !== 'string') throw new UnauthorizedException('Невірний токен');
    return { sub: payload.sub, tenantId: payload.tenantId, role: payload.role as UserRole };
  }

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  private issue(user: User): AuthResult {
    const claims: JwtClaims = { sub: user.id, tenantId: user.tenantId, role: user.role };
    const accessToken = jwt.sign(claims, this.config.jwtSecret, { expiresIn: '12h' });
    return { accessToken, user: { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId } };
  }
}
