import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Endpoint de salud (Fase 1).
 *
 * Confirma dos cosas end-to-end:
 *  1. Que el API está corriendo.
 *  2. Que la conexión a SQL Server (BiometricPlatformDB) está viva.
 *
 * El frontend lo consulta en el Dashboard placeholder para probar
 * la cadena completa Frontend -> API -> SQL Server.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async check() {
    let database: 'up' | 'down' = 'down';
    try {
      await this.dataSource.query('SELECT 1');
      database = 'up';
    } catch {
      database = 'down';
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database,
    };
  }
}
