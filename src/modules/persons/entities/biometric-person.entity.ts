import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { PersonIdentifierEntity } from './person-identifier.entity';

@Entity({ name: 'BiometricPerson', schema: 'identity' })
export class BiometricPersonEntity {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ name: 'NationalId', type: 'nvarchar', length: 50, unique: true })
  nationalId: string;

  @Column({ name: 'FirstName', type: 'nvarchar', length: 150 })
  firstName: string;

  @Column({ name: 'LastName', type: 'nvarchar', length: 150 })
  lastName: string;

  @Column({ name: 'DateOfBirth', type: 'date', nullable: true })
  dateOfBirth: string | null;

  @Column({ name: 'IsActive', type: 'bit', default: true })
  isActive: boolean;

  // Referencia a security.User(Id). Sin relación TypeORM a propósito
  // (ver CLAUDE.md: no acoplar módulos de fases distintas).
  @Column({ name: 'CreatedByUserId' })
  createdByUserId: number;

  @CreateDateColumn({ name: 'CreatedAt', type: 'datetime2' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'UpdatedAt', type: 'datetime2', nullable: true })
  updatedAt: Date | null;

  @OneToMany(() => PersonIdentifierEntity, (identifier) => identifier.person)
  identifiers: PersonIdentifierEntity[];
}
