import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserEntity } from './user.entity';

@Entity({ name: 'RefreshToken', schema: 'security' })
export class RefreshTokenEntity {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ name: 'UserId' })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'UserId' })
  user: UserEntity;

  // SHA-256 hex del refresh token plano. El token en si nunca se persiste.
  @Column({ name: 'TokenHash', type: 'nvarchar', length: 128 })
  tokenHash: string;

  @Column({ name: 'ExpiresAt', type: 'datetime2' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'CreatedAt', type: 'datetime2' })
  createdAt: Date;

  @Column({ name: 'RevokedAt', type: 'datetime2', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'ReplacedByTokenHash', type: 'nvarchar', length: 128, nullable: true })
  replacedByTokenHash: string | null;

  @Column({ name: 'CreatedByIp', type: 'nvarchar', length: 64, nullable: true })
  createdByIp: string | null;
}
