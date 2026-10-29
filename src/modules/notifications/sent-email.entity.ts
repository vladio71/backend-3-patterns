// FakeEmailProvider пише листи сюди замість SMTP, щоб тести могли перевірити факт відправлення.
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'sent_emails' })
export class SentEmail {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

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
