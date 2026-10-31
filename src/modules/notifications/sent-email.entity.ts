// FakeEmailProvider пише листи сюди замість SMTP, щоб тести могли перевірити факт відправлення.
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'sent_emails' })
@Index('sent_emails_tenant_sent_idx', ['tenantId', 'sentAt'])
export class SentEmail {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Null для листів без tenant (системних або зі старих job-ів): їх не показує жоден tenant. */
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'text' })
  to!: string;

  @Column({ type: 'text' })
  subject!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ name: 'job_id', type: 'text', nullable: true })
  jobId!: string | null;

  @CreateDateColumn({ name: 'sent_at', type: 'timestamptz' })
  sentAt!: Date;
}
