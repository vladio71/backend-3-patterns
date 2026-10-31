// Збережена відповідь на POST /orders за Idempotency-Key. Ключ унікальний у межах (tenant, користувач).
import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'idempotency_keys' })
export class IdempotencyKey {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** Власник ключа: два користувачі одного tenant можуть незалежно використати той самий рядок ключа. */
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @PrimaryColumn({ type: 'text' })
  key!: string;

  /** sha256 від тіла запиту: той самий ключ з іншим тілом це помилка клієнта. */
  @Column({ name: 'request_hash', type: 'text' })
  requestHash!: string;

  @Column({ name: 'status_code', type: 'integer', nullable: true })
  statusCode!: number | null;

  @Column({ name: 'response_body', type: 'jsonb', nullable: true })
  responseBody!: object | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
