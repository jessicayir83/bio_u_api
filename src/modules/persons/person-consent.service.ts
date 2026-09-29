import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PersonConsentEntity, type ConsentChannel } from './entities/person-consent.entity';
import { AuditService } from '../audit/audit.service';

/** Edad a partir de la cual la persona consiente por sí misma. */
export const ADULT_AGE_YEARS = 18;

/** true solo si hay fecha de nacimiento válida y la persona es menor de edad. Sin fecha no se puede saber. */
export function isMinor(dateOfBirth: string | null | undefined, now: Date = new Date()): boolean {
  if (!dateOfBirth) return false;
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return false;
  const adultOn = new Date(Date.UTC(birth.getUTCFullYear() + ADULT_AGE_YEARS, birth.getUTCMonth(), birth.getUTCDate()));
  return now < adultOn;
}

@Injectable()
export class PersonConsentService {
  constructor(
    @InjectRepository(PersonConsentEntity)
    private readonly consentRepository: Repository<PersonConsentEntity>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Guarda el consentimiento de tratamiento biométrico. Tiene su propia fila
   * de auditoría (`record`, no `annotate`) para no pisar el evento del request
   * (PERSON_CREATED / KIOSK_REGISTER_SUCCESS); el correlation id las enlaza.
   */
  async recordBiometricConsent(input: {
    personId: number;
    policyVersion: string;
    channel: ConsentChannel;
    recordedByUserId?: number | null;
  }): Promise<void> {
    const consent = await this.consentRepository.save(
      this.consentRepository.create({
        personId: input.personId,
        purpose: 'BIOMETRIC_PROCESSING',
        policyVersion: input.policyVersion,
        channel: input.channel,
        grantedAt: new Date(),
        recordedByUserId: input.recordedByUserId ?? null,
      }),
    );
    await this.auditService.record({
      eventType: 'CONSENT_GRANTED',
      actorType: input.channel === 'PANEL' ? 'USER' : 'SYSTEM',
      actorUserId: input.channel === 'PANEL' ? input.recordedByUserId : undefined,
      sourceIp: this.auditService.currentSourceIp(),
      correlationId: this.auditService.currentCorrelationId(),
      targetType: 'Person',
      targetId: input.personId,
      // Solo ids y metadatos del consentimiento, nunca datos personales.
      details: { consentId: consent.id, purpose: consent.purpose, policyVersion: input.policyVersion, channel: input.channel },
    });
  }
}
