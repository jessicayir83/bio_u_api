import { Module } from '@nestjs/common';
import { FINGERPRINT_PROVIDER } from '../biometric-provider.interface';
import { MockFingerprintProvider } from './mock-fingerprint.provider';

@Module({
  providers: [MockFingerprintProvider, { provide: FINGERPRINT_PROVIDER, useExisting: MockFingerprintProvider }],
  exports: [FINGERPRINT_PROVIDER],
})
export class FingerprintProviderModule {}
