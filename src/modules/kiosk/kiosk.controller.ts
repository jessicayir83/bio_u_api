import {
  BadRequestException,
  Body,
  Controller,
  Ip,
  MaxFileSizeValidator,
  ParseFilePipe,
  Post,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { KioskService } from './kiosk.service';
import { KioskRegisterDto } from './dto/kiosk-register.dto';

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_REGISTER_PHOTOS = 3;

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
  @UseInterceptors(FileInterceptor('image'))
  identify(
    @UploadedFile(new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: MAX_IMAGE_SIZE_BYTES })] }))
    image: Express.Multer.File,
  ) {
    return this.kioskService.identify(image.buffer);
  }

  // Más restrictivo que el resto: crear personas es la operación sensible.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @UseInterceptors(FilesInterceptor('images', MAX_REGISTER_PHOTOS))
  register(@Body() dto: KioskRegisterDto, @UploadedFiles() images: Express.Multer.File[] = []) {
    if (images.some((image) => image.size > MAX_IMAGE_SIZE_BYTES)) {
      throw new BadRequestException('Alguna de las fotos supera el tamaño máximo permitido (5MB).');
    }
    return this.kioskService.register(
      dto,
      images.map((image) => image.buffer),
    );
  }

  @Post('check-in')
  @UseInterceptors(FileInterceptor('image'))
  checkIn(
    @UploadedFile(new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: MAX_IMAGE_SIZE_BYTES })] }))
    image: Express.Multer.File,
    @Ip() ip: string,
  ) {
    return this.kioskService.checkIn(image.buffer, ip ?? null);
  }
}
