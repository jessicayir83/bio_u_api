import { IsIn } from 'class-validator';
import { EnrollmentStatus } from '../entities/enrollment.entity';

export class UpdateEnrollmentStatusDto {
  @IsIn(['Completed', 'Revoked'])
  status: Extract<EnrollmentStatus, 'Completed' | 'Revoked'>;
}
