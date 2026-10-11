import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Semáforo con cola acotada. Limita cuántas tareas pesadas (p. ej. extraer un
 * descriptor facial con face-api WASM, 1-3 s de CPU cada una) corren a la vez:
 * sin esto, una ráfaga de requests simultáneos satura el event loop y deja
 * colgado TODO el API, no solo el reconocimiento.
 *
 * Si la cola está llena o la espera pasa del tope, responde 429 (el kiosco ya
 * reintenta solo) en vez de acumular trabajo sin límite.
 */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiting: Array<{ start: () => void; timer: NodeJS.Timeout }> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueued: number,
    private readonly maxWaitMs: number,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.maxQueued) {
      return Promise.reject(busyError());
    }
    return new Promise<void>((resolve, reject) => {
      const entry = {
        start: () => {
          clearTimeout(entry.timer);
          resolve();
        },
        timer: setTimeout(() => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(busyError());
        }, this.maxWaitMs),
      };
      this.waiting.push(entry);
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      // El cupo pasa directo al siguiente: `active` no cambia.
      next.start();
    } else {
      this.active -= 1;
    }
  }
}

function busyError(): HttpException {
  return new HttpException('El sistema está ocupado. Intentá de nuevo en unos segundos.', HttpStatus.TOO_MANY_REQUESTS);
}
