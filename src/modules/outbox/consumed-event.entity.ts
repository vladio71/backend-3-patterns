// Таблиця ефектів споживача: event id як первинний ключ, тому ефект застосовується один раз.
import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'consumed_events' })
export class ConsumedEvent {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ type: 'text' })
  type!: string;

  @Column({ type: 'text' })
  effect!: string;

  @CreateDateColumn({ name: 'handled_at', type: 'timestamptz' })
  handledAt!: Date;
}
