import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
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
import { PersonRegistrationService, isUniqueViolation } from '../persons/person-registration.service';
import { PersonConsentService, isMinor } from '../persons/person-consent.service';
import { templateProvenanceFields } from '../enrollment/template-fields';
import { AdaptiveTemplateService } from '../enrollment/adaptive-template.service';
import type { BiometricDescriptor } from '../biometric-providers/biometric-provider.interface';
import type { FaceDetectorKind, FacePoseStep } from '../biometric-providers/face/face-quality';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

/** Username del usuario de sistema que queda como autor de lo registrado en el kiosco (lo siembra el script 05). */
const KIOSK_SYSTEM_USERNAME = 'kiosk';
/** Fotos de calidad suficiente que exige el registro (o todas, si se mandaron menos). */
const MIN_VALID_REGISTER_PHOTOS = 2;

export interface KioskIdentifyResponse {
  matched: boolean;
  /** La persona está registrada pero deshabilitada: la pantalla muestra el aviso (sin nombre ni motivo). */
  disabled?: boolean;
  person?: { id: number; firstName: string; lastName: string };
  ambiguous?: boolean;
}

export interface KioskCheckInResponse {
  granted: boolean;
  disabled?: boolean;
  person?: { id: number; firstName: string; lastName: string };
  distance?: number;
  ambiguous?: boolean;
}

@Injectable()
export class KioskService {
  private readonly logger = new Logger(KioskService.name);
  private kioskUserId?: number;
  /** Se guarda con cada template: permite detectar los que quedaron viejos al cambiar de detector. */
  private readonly faceDetector: FaceDetectorKind;

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
    private readonly registrationService: PersonRegistrationService,
    private readonly consentService: PersonConsentService,
    private readonly adaptiveTemplateService: AdaptiveTemplateService,
    configService: ConfigService<AppConfig, true>,
  ) {
    this.faceDetector = configService.get<AppConfig['biometrics']>('biometrics').faceDetector;
  }

  /** 1:N — respuesta mínima a propósito: este endpoint es público (ver README del módulo). */
  async identify(imageBuffers: Buffer[]): Promise<KioskIdentifyResponse> {
    const result = await this.identifyWithAudit(imageBuffers, 'KIOSK_IDENTIFY_REJECTED');
    this.auditService.annotate({
      eventType: result.matched ? 'KIOSK_IDENTIFY_MATCH' : result.ambiguous ? 'KIOSK_IDENTIFY_AMBIGUOUS' : 'KIOSK_IDENTIFY_NO_MATCH',
      targetType: result.person || result.disabledPersonId ? 'Person' : undefined,
      targetId: result.person?.id ?? result.disabledPersonId,
      details: { frames: imageBuffers.length, distance: result.distance ?? null },
    });
    return this.toPublicIdentifyResponse(result);
  }

  /**
   * Los problemas con las fotos responden 422 (no 400) para que la pantalla
   * distinga "volvé a sacar las fotos" de un error en los datos del formulario.
   */
  async register(dto: KioskRegisterDto, imageBuffers: Buffer[], poseSteps?: FacePoseStep[]): Promise<BiometricPersonEntity> {
    if (imageBuffers.length === 0) {
      throw new BadRequestException('Se requiere al menos una foto.');
    }
    if (poseSteps && poseSteps.length !== imageBuffers.length) {
      // Nunca emparejar parcialmente: no se sabría qué foto es qué pose.
      throw new BadRequestException('La cantidad de pasos no coincide con la cantidad de fotos.');
    }
    // Tipo + número normalizado (400 si el formato no corresponde al tipo).
    const identification = this.registrationService.resolveIdentification(dto.identificationType, dto.nationalId);

    // Un menor de edad no consiente por sí mismo: el registro lo hace un operador
    // con la autorización de su padre, madre o tutor. Si no se indica fecha de
    // nacimiento no hay forma de saberlo desde acá (límite conocido).
    if (isMinor(dto.dateOfBirth)) {
      this.auditService.annotate({ eventType: 'KIOSK_REGISTER_REJECTED', details: { reason: 'MINOR_NEEDS_GUARDIAN' } });
      throw new BadRequestException(
        'Para registrarte necesitamos la autorización de tu padre, madre o tutor. Acercate a un operador para continuar.',
      );
    }

    // 1) Descriptores con controles de calidad estrictos: estas fotos quedan
    //    como referencia de la persona para todos sus ingresos futuros. Si el
    //    registro fue guiado, cada foto se valida además contra su pose.
    const { descriptors, validPoseSteps, firstProblem } = await this.verificationService.extractValidDescriptors(
      'Face',
      imageBuffers,
      'enrollment',
      poseSteps,
    );
    const requiredValid = Math.min(MIN_VALID_REGISTER_PHOTOS, imageBuffers.length);
    if (descriptors.length < requiredValid) {
      this.auditService.annotate({
        eventType: 'KIOSK_REGISTER_REJECTED',
        details: { reason: firstProblem ?? null, validPhotos: descriptors.length, totalPhotos: imageBuffers.length },
      });
      await this.registrationService.record({
        channel: 'KIOSK',
        status: 'REJECTED_PHOTOS',
        identification,
        detail: firstProblem ?? 'Fotos insuficientes',
      });
      throw new UnprocessableEntityException(
        `Solo ${descriptors.length} de ${imageBuffers.length} fotos sirven. ${firstProblem ?? ''} Volvé a sacar las fotos.`.trim(),
      );
    }

    // 2) ¿Esta cara ya está registrada? Con todas las fotos válidas, no solo la primera.
    const existingByFace = await this.verificationService.identifyDescriptors('Face', descriptors);
    if (existingByFace.disabled) {
      // Es una persona ya registrada pero deshabilitada: no se le permite crear un registro nuevo
      // con otra identidad. Respuesta genérica (no revela el motivo) y se deriva a un humano.
      this.auditService.annotate({
        eventType: 'KIOSK_REGISTER_IDENTITY_MISMATCH',
        targetType: 'Person',
        targetId: existingByFace.disabledPersonId,
        details: { reason: 'DISABLED_PERSON_REGISTRATION_ATTEMPT' },
      });
      await this.registrationService.record({
        channel: 'KIOSK',
        status: 'IDENTITY_MISMATCH',
        identification,
        personId: existingByFace.disabledPersonId,
        detail: 'El rostro corresponde a una persona deshabilitada.',
      });
      throw new ConflictException('No se pudo completar el registro. Acercate a un operador para continuar.');
    }
    if (existingByFace.matched && existingByFace.person) {
      // Misma cara con OTRA cédula = alguien ya registrado intentando una segunda identidad.
      const sameNationalId =
        existingByFace.person.identificationType === identification.identificationType &&
        existingByFace.person.nationalId === identification.nationalId;
      await this.registrationService.record({
        channel: 'KIOSK',
        status: sameNationalId ? 'DUPLICATE_FACE' : 'IDENTITY_MISMATCH',
        identification,
        personId: existingByFace.person.id,
        detail: sameNationalId
          ? 'La persona ya estaba registrada.'
          : 'El rostro ya está registrado con otra identificación.',
      });
      this.auditService.annotate({
        eventType: sameNationalId ? 'KIOSK_REGISTER_DUPLICATE_FACE' : 'KIOSK_REGISTER_IDENTITY_MISMATCH',
        targetType: 'Person',
        targetId: existingByFace.person.id,
        details: { distance: existingByFace.distance ?? null, sameIdentification: sameNationalId },
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
    const existingByNationalId = await this.personRepository.findOne({ where: identification });
    if (existingByNationalId) {
      // La cara no coincidió con nadie pero la cédula ya existe: posible uso de la cédula de otra persona
      // (o un falso negativo del reconocimiento de la persona legítima).
      this.auditService.annotate({
        eventType: 'KIOSK_REGISTER_NATIONALID_CONFLICT',
        targetType: 'Person',
        targetId: existingByNationalId.id,
        details: { identificationType: identification.identificationType },
      });
      await this.registrationService.record({
        channel: 'KIOSK',
        status: 'DUPLICATE_ID',
        identification,
        personId: existingByNationalId.id,
        detail: 'La identificación ya pertenece a una persona y el rostro no coincide.',
      });
      throw new ConflictException('Ya existe una persona registrada con ese tipo y número de identificación.');
    }

    // 3.b) El mismo número bajo OTRO tipo de identificación. En el panel esto
    // se le avisa al operador para que confirme; acá no hay operador y el
    // endpoint es público, así que la respuesta es genérica a propósito:
    // decirle "ese número ya existe" a un desconocido convierte al kiosco en
    // un oráculo para averiguar quién está registrado. Queda la alerta SEV2 y
    // se deriva a un humano.
    const otherType = await this.registrationService.findSameNumberOtherType(identification);
    if (otherType) {
      this.registrationService.annotateNumberReused({
        identification,
        existingPersonId: otherType.id,
        existingType: otherType.identificationType,
        channel: 'KIOSK',
      });
      await this.registrationService.record({
        channel: 'KIOSK',
        status: 'DUPLICATE_ID',
        identification,
        personId: otherType.id,
        detail: `El número ya existe con el tipo ${otherType.identificationType}.`,
      });
      throw new ConflictException('No se pudo completar el registro. Acercate a un operador para continuar.');
    }

    // 4) Crear persona + enrollment + un template por foto válida.
    const kioskUserId = await this.getKioskUserId();

    let person: BiometricPersonEntity;
    try {
      person = await this.personRepository.save(
        this.personRepository.create({
          identificationType: identification.identificationType,
          nationalId: identification.nationalId,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          dateOfBirth: dto.dateOfBirth ?? null,
          createdByUserId: kioskUserId,
        }),
      );
    } catch (err) {
      // Dos registros simultáneos con la misma identificación: el índice único frena al segundo.
      if (isUniqueViolation(err)) {
        throw new ConflictException('Ya existe una persona registrada con ese tipo y número de identificación.');
      }
      throw err;
    }

    // La persona aceptó por sí misma en la pantalla de consentimiento del kiosco.
    await this.consentService.recordBiometricConsent({
      personId: person.id,
      policyVersion: dto.policyVersion,
      channel: 'KIOSK',
    });

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
      descriptors.map((descriptor, index) =>
        this.templateRepository.create({
          personId: person.id,
          enrollmentId: enrollment.id,
          modality: 'Face',
          vectorJson: JSON.stringify(descriptor.vector),
          ...templateProvenanceFields(descriptor, this.faceDetector, { poseStep: validPoseSteps[index] }),
        }),
      ),
    );

    await this.registrationService.record({ channel: 'KIOSK', status: 'SUCCESS', identification, personId: person.id });
    this.auditService.annotate({
      eventType: 'KIOSK_REGISTER_SUCCESS',
      targetType: 'Person',
      targetId: person.id,
      details: {
        enrollmentId: enrollment.id,
        templates: descriptors.length,
        totalPhotos: imageBuffers.length,
        identificationType: identification.identificationType,
      },
    });
    return person;
  }

  async checkIn(imageBuffers: Buffer[], sourceIp: string | null): Promise<KioskCheckInResponse> {
    // Se extraen los descriptores acá (y no dentro de `identify`) porque el
    // aprendizaje adaptativo necesita el descriptor del frame que ganó. Es el
    // mismo trabajo, partido en dos llamadas.
    const { descriptors, firstProblem } = await this.verificationService.extractValidDescriptors(
      'Face',
      imageBuffers,
      'probe',
    );
    if (descriptors.length === 0) {
      const reason = firstProblem ?? 'No se recibió ninguna muestra.';
      this.auditService.annotate({
        eventType: 'KIOSK_CHECKIN_REJECTED',
        details: { frames: imageBuffers.length, reason },
      });
      throw new BadRequestException(reason);
    }
    const result = await this.verificationService.identifyDescriptors('Face', descriptors);

    const accessLog = await this.accessLogRepository.save(
      this.accessLogRepository.create({
        personId: result.person?.id ?? result.disabledPersonId ?? null,
        modality: 'Face',
        granted: result.matched,
        status: result.matched ? 'GRANTED' : result.ambiguous ? 'AMBIGUOUS' : 'DENIED',
        channel: 'KIOSK_CHECKIN',
        distance: result.distance ?? null,
        sourceIp,
      }),
    );

    if (result.matched && result.person) {
      // "Último escaneo" del listado de personas.
      await this.personRepository.update(result.person.id, { lastCheckInAt: accessLog.occurredAt });
      await this.learnFromCheckIn(result, descriptors, accessLog.id);
    }

    this.auditService.annotate({
      eventType: result.matched
        ? 'KIOSK_CHECKIN_GRANTED'
        : result.disabled
          ? 'KIOSK_CHECKIN_DISABLED_PERSON'
          : result.ambiguous
            ? 'KIOSK_CHECKIN_AMBIGUOUS'
            : 'KIOSK_CHECKIN_DENIED',
      targetType: result.person || result.disabledPersonId ? 'Person' : undefined,
      targetId: result.person?.id ?? result.disabledPersonId,
      details: { frames: imageBuffers.length, distance: result.distance ?? null, accessLogId: accessLog.id },
    });

    const publicResult = this.toPublicIdentifyResponse(result);
    return {
      granted: publicResult.matched,
      person: publicResult.person,
      distance: result.distance,
      ambiguous: publicResult.ambiguous,
      disabled: publicResult.disabled,
    };
  }

  /**
   * Contabiliza el template que ganó y, si el ingreso fue lo bastante
   * holgado, lo aprende como template adaptativo.
   *
   * Todo acá es accesorio al ingreso: si falla, se loguea y ya. Nadie puede
   * quedarse afuera porque el sistema no pudo aprender.
   */
  private async learnFromCheckIn(
    result: BiometricIdentificationResult,
    descriptors: BiometricDescriptor[],
    accessLogId: number,
  ): Promise<void> {
    const detail = result.detail;
    if (!detail || !result.person) return;

    try {
      await this.adaptiveTemplateService.recordTemplateUse(detail.bestTemplateId);

      const enrollmentId = await this.findFaceEnrollmentId(result.person.id);
      if (!enrollmentId) return;

      await this.adaptiveTemplateService.maybeAdapt({
        personId: result.person.id,
        enrollmentId,
        accessLogId,
        descriptor: descriptors[detail.bestProbeIndex],
        detail,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`No se pudo aprender del ingreso de la persona ${result.person.id}: ${reason}`);
    }
  }

  /** El enrollment facial de la persona al que se cuelgan los templates aprendidos. */
  private async findFaceEnrollmentId(personId: number): Promise<number | null> {
    const enrollment = await this.enrollmentRepository.findOne({
      where: { personId, modality: 'Face', status: 'Completed' },
      order: { id: 'ASC' },
      select: { id: true },
    });
    return enrollment?.id ?? null;
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
    if (result.disabled) {
      // Solo el aviso: ni nombre, ni id, ni motivo.
      return { matched: false, disabled: true };
    }
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
