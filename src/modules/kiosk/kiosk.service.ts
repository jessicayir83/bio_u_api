import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BiometricPersonEntity } from '../persons/entities/biometric-person.entity';
import { EnrollmentEntity } from '../enrollment/entities/enrollment.entity';
import { TemplateEntity } from '../enrollment/entities/template.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { AccessLogEntity } from './entities/access-log.entity';
import { VerificationService, type BiometricIdentificationResult } from '../verification/verification.service';
import { KioskRegisterDto } from './dto/kiosk-register.dto';
import { AuditService } from '../audit/audit.service';

/** Username del usuario de sistema que queda como autor de lo registrado en el kiosco (lo siembra el script 05). */
const KIOSK_SYSTEM_USERNAME = 'kiosk';
/** Fotos de calidad suficiente que exige el registro (o todas, si se mandaron menos). */
const MIN_VALID_REGISTER_PHOTOS = 2;

export interface KioskIdentifyResponse {
  matched: boolean;
  person?: { id: number; firstName: string; lastName: string };
  ambiguous?: boolean;
}

export interface KioskCheckInResponse {
  granted: boolean;
  person?: { id: number; firstName: string; lastName: string };
  distance?: number;
  ambiguous?: boolean;
}

@Injectable()
export class KioskService {
  private kioskUserId?: number;

  constructor(
    @InjectRepository(BiometricPersonEntity)
    private readonly personRepository: Repository<BiometricPersonEntity>,
    @InjectRepository(EnrollmentEntity)
    private readonly enrollmentRepository: Repository<EnrollmentEntity>,
    @InjectRepository(TemplateEntity)
    private readonly templateRepository: Repository<TemplateEntity>,
    @InjectRepository(AccessLogEntity)
    private readonly accessLogRepository: Repository<AccessLogEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly verificationService: VerificationService,
    private readonly auditService: AuditService,
  ) {}

  /** 1:N — respuesta mínima a propósito: este endpoint es público (ver README del módulo). */
  async identify(imageBuffers: Buffer[]): Promise<KioskIdentifyResponse> {
    const result = await this.identifyWithAudit(imageBuffers, 'KIOSK_IDENTIFY_REJECTED');
    this.auditService.annotate({
      eventType: result.matched ? 'KIOSK_IDENTIFY_MATCH' : result.ambiguous ? 'KIOSK_IDENTIFY_AMBIGUOUS' : 'KIOSK_IDENTIFY_NO_MATCH',
      targetType: result.person ? 'Person' : undefined,
      targetId: result.person?.id,
      details: { frames: imageBuffers.length, distance: result.distance ?? null },
    });
    return this.toPublicIdentifyResponse(result);
  }

  /**
   * Los problemas con las fotos responden 422 (no 400) para que la pantalla
   * distinga "volvé a sacar las fotos" de un error en los datos del formulario.
   */
  async register(dto: KioskRegisterDto, imageBuffers: Buffer[]): Promise<BiometricPersonEntity> {
    if (imageBuffers.length === 0) {
      throw new BadRequestException('Se requiere al menos una foto.');
    }

    // 1) Descriptores con controles de calidad estrictos: estas fotos quedan
    //    como referencia de la persona para todos sus ingresos futuros.
    const { descriptors, firstProblem } = await this.verificationService.extractValidDescriptors(
      'Face',
      imageBuffers,
      'enrollment',
    );
    const requiredValid = Math.min(MIN_VALID_REGISTER_PHOTOS, imageBuffers.length);
    if (descriptors.length < requiredValid) {
      this.auditService.annotate({
        eventType: 'KIOSK_REGISTER_REJECTED',
        details: { reason: firstProblem ?? null, validPhotos: descriptors.length, totalPhotos: imageBuffers.length },
      });
      throw new UnprocessableEntityException(
        `Solo ${descriptors.length} de ${imageBuffers.length} fotos sirven. ${firstProblem ?? ''} Volvé a sacar las fotos.`.trim(),
      );
    }

    // 2) ¿Esta cara ya está registrada? Con todas las fotos válidas, no solo la primera.
    const existingByFace = await this.verificationService.identifyDescriptors('Face', descriptors);
    if (existingByFace.matched && existingByFace.person) {
      // Misma cara con OTRA cédula = alguien ya registrado intentando una segunda identidad.
      const sameNationalId = existingByFace.person.nationalId === dto.nationalId;
      this.auditService.annotate({
        eventType: sameNationalId ? 'KIOSK_REGISTER_DUPLICATE_FACE' : 'KIOSK_REGISTER_IDENTITY_MISMATCH',
        targetType: 'Person',
        targetId: existingByFace.person.id,
        details: { distance: existingByFace.distance ?? null, nationalIdMatchesExisting: sameNationalId },
      });
      if (!sameNationalId) {
        // No revelar a quién pertenece esa cara a alguien que declaró otra identidad.
        throw new ConflictException('No se pudo completar el registro. Acercate a un operador para continuar.');
      }
      throw new ConflictException(
        `Esta persona ya está registrada como ${existingByFace.person.firstName} ${existingByFace.person.lastName}. Usá "Ingresar".`,
      );
    }

    // 3) ¿La cédula ya existe?
    const existingByNationalId = await this.personRepository.findOne({ where: { nationalId: dto.nationalId } });
    if (existingByNationalId) {
      // La cara no coincidió con nadie pero la cédula ya existe: posible uso de la cédula de otra persona
      // (o un falso negativo del reconocimiento de la persona legítima).
      this.auditService.annotate({
        eventType: 'KIOSK_REGISTER_NATIONALID_CONFLICT',
        targetType: 'Person',
        targetId: existingByNationalId.id,
      });
      throw new ConflictException('Ya existe una persona registrada con esa cédula.');
    }

    // 4) Crear persona + enrollment + un template por foto válida.
    const kioskUserId = await this.getKioskUserId();

    const person = await this.personRepository.save(
      this.personRepository.create({
        nationalId: dto.nationalId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        dateOfBirth: dto.dateOfBirth ?? null,
        createdByUserId: kioskUserId,
      }),
    );

    const enrollment = await this.enrollmentRepository.save(
      this.enrollmentRepository.create({
        personId: person.id,
        modality: 'Face',
        createdByUserId: kioskUserId,
        status: 'Completed',
        completedAt: new Date(),
      }),
    );

    await this.templateRepository.save(
      descriptors.map((descriptor) =>
        this.templateRepository.create({
          personId: person.id,
          enrollmentId: enrollment.id,
          modality: 'Face',
          vectorJson: JSON.stringify(descriptor.vector),
        }),
      ),
    );

    this.auditService.annotate({
      eventType: 'KIOSK_REGISTER_SUCCESS',
      targetType: 'Person',
      targetId: person.id,
      details: { enrollmentId: enrollment.id, templates: descriptors.length, totalPhotos: imageBuffers.length },
    });
    return person;
  }

  async checkIn(imageBuffers: Buffer[], sourceIp: string | null): Promise<KioskCheckInResponse> {
    const result = await this.identifyWithAudit(imageBuffers, 'KIOSK_CHECKIN_REJECTED');

    const accessLog = await this.accessLogRepository.save(
      this.accessLogRepository.create({
        personId: result.person?.id ?? null,
        modality: 'Face',
        granted: result.matched,
        distance: result.distance ?? null,
        sourceIp,
      }),
    );

    this.auditService.annotate({
      eventType: result.matched ? 'KIOSK_CHECKIN_GRANTED' : result.ambiguous ? 'KIOSK_CHECKIN_AMBIGUOUS' : 'KIOSK_CHECKIN_DENIED',
      targetType: result.person ? 'Person' : undefined,
      targetId: result.person?.id,
      details: { frames: imageBuffers.length, distance: result.distance ?? null, accessLogId: accessLog.id },
    });

    const publicResult = this.toPublicIdentifyResponse(result);
    return { granted: publicResult.matched, person: publicResult.person, distance: result.distance, ambiguous: publicResult.ambiguous };
  }

  /** Identificación 1:N que deja auditado el motivo si todas las fotos se rechazan (calidad/sin rostro). */
  private async identifyWithAudit(
    imageBuffers: Buffer[],
    rejectedEventType: 'KIOSK_IDENTIFY_REJECTED' | 'KIOSK_CHECKIN_REJECTED',
  ): Promise<BiometricIdentificationResult> {
    try {
      return await this.verificationService.identify('Face', imageBuffers);
    } catch (err) {
      if (err instanceof BadRequestException) {
        this.auditService.annotate({ eventType: rejectedEventType, details: { frames: imageBuffers.length, reason: err.message } });
      }
      throw err;
    }
  }

  /** Nunca devuelve la cédula ni ningún otro dato sensible: estos endpoints son públicos. */
  private toPublicIdentifyResponse(result: BiometricIdentificationResult): KioskIdentifyResponse {
    if (!result.matched || !result.person) {
      return { matched: false, ambiguous: result.ambiguous };
    }
    return {
      matched: true,
      person: { id: result.person.id, firstName: result.person.firstName, lastName: result.person.lastName },
    };
  }

  private async getKioskUserId(): Promise<number> {
    if (this.kioskUserId) {
      return this.kioskUserId;
    }
    const kioskUser = await this.userRepository.findOne({ where: { username: KIOSK_SYSTEM_USERNAME } });
    if (!kioskUser) {
      throw new InternalServerErrorException(
        `No existe el usuario de sistema "${KIOSK_SYSTEM_USERNAME}". Ejecutá database/05_create_access_log_table.sql.`,
      );
    }
    this.kioskUserId = kioskUser.id;
    return this.kioskUserId;
  }
}
