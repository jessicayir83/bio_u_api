import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BiometricPersonEntity } from './biometric-person.entity';

/**
 * Identificadores secundarios de la persona (código de empleado,
 * pasaporte, etc). La cédula vive en BiometricPerson.nationalId.
 */
@Entity({ name: 'PersonIdentifier', schema: 'identity' })
export class PersonIdentifierEntity {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ name: 'PersonId' })
  personId: number;

  @ManyToOne(() => BiometricPersonEntity, (person) => person.identifiers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'PersonId' })
  person: BiometricPersonEntity;

  @Column({ name: 'IdentifierType', type: 'nvarchar', length: 50 })
  identifierType: string;

  @Column({ name: 'IdentifierValue', type: 'nvarchar', length: 150 })
  identifierValue: string;

  @CreateDateColumn({ name: 'CreatedAt', type: 'datetime2' })
  createdAt: Date;
}
