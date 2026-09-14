import { Module } from '@nestjs/common';
import { FACE_PROVIDER } from '../biometric-provider.interface';
import { FaceApiProvider } from './face-api.provider';

@Module({
  providers: [FaceApiProvider, { provide: FACE_PROVIDER, useExisting: FaceApiProvider }],
  exports: [FACE_PROVIDER],
})
export class FaceProviderModule {}
