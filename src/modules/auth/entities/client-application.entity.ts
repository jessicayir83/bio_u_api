import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Solo estructura en Fase 2 (ver plan_implementation). El flujo OAuth2
 * client-credentials completo se activa en Fase 8 (Device Gateway), cuando
 * exista un consumidor real.
 */
@Entity({ name: 'ClientApplication', schema: 'security' })
export class ClientApplicationEntity {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ name: 'ClientId', type: 'nvarchar', length: 100, unique: true })
  clientId: string;

  @Column({ name: 'ClientSecretHash', type: 'nvarchar', length: 200 })
  clientSecretHash: string;

  @Column({ name: 'Name', type: 'nvarchar', length: 200 })
  name: string;

  @Column({ name: 'IsActive', type: 'bit', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'CreatedAt', type: 'datetime2' })
  createdAt: Date;
}
