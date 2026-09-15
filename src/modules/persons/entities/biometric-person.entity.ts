import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { PersonIdentifierEntity } from './person-identifier.entity';

@Entity({ name: 'BiometricPerson', schema: 'identity' })
export class BiometricPersonEntity {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  /** CEDULA | DIMEX | PASAPORTE | OTRO (ver identification.ts). Único junto con nationalId. */
  @Column({ name: 'IdentificationType', type: 'nvarchar', length: 20, default: 'CEDULA' })
  identificationType: string;

  /** Número de identificación (de cualquier tipo), normalizado. El nombre de la columna es histórico. */
  @Column({ name: 'NationalId', type: 'nvarchar', length: 50 })
  nationalId: string;

  @Column({ name: 'FirstName', type: 'nvarchar', length: 150 })
  firstName: string;

  @Column({ name: 'LastName', type: 'nvarchar', length: 150 })
  lastName: string;

  @Column({ name: 'DateOfBirth', type: 'date', nullable: true })
  dateOfBirth: string | null;

  @Column({ name: 'IsActive', type: 'bit', default: true })
  isActive: boolean;

  /** Último ingreso concedido en el kiosco ("Último escaneo" del listado). */
  @Column({ name: 'LastCheckInAt', type: 'datetime2', nullable: true })
  lastCheckInAt: Date | null;

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
