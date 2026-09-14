import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { UserEntity } from './user.entity';
import { RoleEntity } from './role.entity';

@Entity({ name: 'UserRole', schema: 'security' })
export class UserRoleEntity {
  @PrimaryColumn({ name: 'UserId' })
  userId: number;

  @PrimaryColumn({ name: 'RoleId' })
  roleId: number;

  @ManyToOne(() => UserEntity, (user) => user.userRoles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'UserId' })
  user: UserEntity;

  @ManyToOne(() => RoleEntity, (role) => role.userRoles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'RoleId' })
  role: RoleEntity;

  @CreateDateColumn({ name: 'AssignedAt', type: 'datetime2' })
  assignedAt: Date;
}
