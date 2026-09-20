import { BadRequestException, Body, Controller, Ip, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { KioskService } from './kiosk.service';
import { KioskRegisterDto } from './dto/kiosk-register.dto';
import { type FacePoseStep, parsePoseSteps } from '../biometric-providers/face/face-quality';

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_REGISTER_PHOTOS = 3;
/** Frames de un mismo intento de identificación (ver VerificationService.identifyDescriptors). */
const MAX_PROBE_PHOTOS = 3;

/** identify/check-in aceptan `images` (varios frames) o `image` (uno, compatibilidad con clientes previos/Postman). */
const probeFilesInterceptor = FileFieldsInterceptor([
  { name: 'images', maxCount: MAX_PROBE_PHOTOS },
  { name: 'image', maxCount: 1 },
]);

type ProbeUpload = { images?: Express.Multer.File[]; image?: Express.Multer.File[] };

function toProbeBuffers(files: ProbeUpload = {}): Buffer[] {
  const all = [...(files.images ?? []), ...(files.image ?? [])];
  if (all.length === 0) {
    throw new BadRequestException('Se requiere al menos una foto (campo "images" o "image").');
  }
  if (all.some((file) => file.size > MAX_IMAGE_SIZE_BYTES)) {
    throw new BadRequestException('Alguna de las fotos supera el tamaño máximo permitido (5MB).');
  }
  return all.map((file) => file.buffer);
}

/**
 * ÚNICA superficie pública del API (sin JwtAuthGuard) — ver README del
 * módulo. Respuestas deliberadamente mínimas y con límite de intentos por
 * IP, porque un endpoint de identificación biométrica abierto permitiría
 * consultar contra la base de personas.
 */
@Controller('kiosk')
// 30/min: la pantalla de "Ingresar" detecta el rostro en vivo y reintenta
// sola cada ~4-6s mientras la persona se acomoda, así que un límite bajo
// cortaría un uso legítimo. Sigue siendo una barrera efectiva: cada
// request le cuesta 1-3s de CPU a quien la haga.
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class KioskController {
  constructor(private readonly kioskService: KioskService) {}

  @Post('identify')
  @UseInterceptors(probeFilesInterceptor)
  identify(@UploadedFiles() files: ProbeUpload) {
    return this.kioskService.identify(toProbeBuffers(files));
  }

  // Más restrictivo que el resto: crear personas es la operación sensible.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @UseInterceptors(FilesInterceptor('images', MAX_REGISTER_PHOTOS))
  register(@Body() dto: KioskRegisterDto, @UploadedFiles() images: Express.Multer.File[] = []) {
    if (images.some((image) => image.size > MAX_IMAGE_SIZE_BYTES)) {
      throw new BadRequestException('Alguna de las fotos supera el tamaño máximo permitido (5MB).');
    }

    // `steps` es opcional: sin él, el registro se comporta como antes del
    // Nivel 2 (todas las fotos frontales, sin validación de pose). Así no se
    // rompe Postman ni ningún cliente viejo.
    let poseSteps: FacePoseStep[] | undefined;
    if (dto.steps) {
      try {
        poseSteps = parsePoseSteps(dto.steps);
      } catch (err) {
        throw new BadRequestException(err instanceof Error ? err.message : 'Pasos de captura inválidos.');
      }
    }

    return this.kioskService.register(
      dto,
      images.map((image) => image.buffer),
      poseSteps,
    );
  }

  @Post('check-in')
  @UseInterceptors(probeFilesInterceptor)
  checkIn(@UploadedFiles() files: ProbeUpload, @Ip() ip: string) {
    return this.kioskService.checkIn(toProbeBuffers(files), ip ?? null);
  }
}
