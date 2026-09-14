import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { UserRoleEntity } from './user-role.entity';

@Entity({ name: 'User', schema: 'security' })
export class UserEntity {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ name: 'Username', type: 'nvarchar', length: 100, unique: true })
  username: string;

  @Column({ name: 'Email', type: 'nvarchar', length: 256, unique: true })
  email: string;

  @Column({ name: 'PasswordHash', type: 'nvarchar', length: 200 })
  passwordHash: string;

  @Column({ name: 'FullName', type: 'nvarchar', length: 200, nullable: true })
  fullName: string | null;

  @Column({ name: 'IsActive', type: 'bit', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'CreatedAt', type: 'datetime2' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'UpdatedAt', type: 'datetime2', nullable: true })
  updatedAt: Date | null;

  @Column({ name: 'LastLoginAt', type: 'datetime2', nullable: true })
  lastLoginAt: Date | null;

  @OneToMany(() => UserRoleEntity, (userRole) => userRole.user)
  userRoles: UserRoleEntity[];
}
