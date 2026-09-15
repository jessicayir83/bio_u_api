/**
 * Calibración del umbral facial con los datos reales de la base.
 *
 *   npm run calibrate:face
 *
 * Solo LEE (templates y AccessLog) y solo imprime agregados: nunca nombres,
 * cédulas ni vectores. Usa el mismo AppModule que el API (misma conexión,
 * mismo descifrado de templates, mismo provider facial).
 *
 * - Distancias genuinas: entre templates de la MISMA persona.
 * - Distancias impostoras: entre templates de personas DISTINTAS.
 * - Simulación 1:N "deja uno afuera": cada template actúa como probe contra
 *   el resto, con el umbral y margen configurados.
 *
 * Limitación: template contra template es optimista (fotos de registro,
 * buena calidad) respecto de un probe real del kiosco. Tomalo como cota.
 * Si hay templates hechos con otro detector (ver FACE_DETECTOR), mezclarlos
 * distorsiona las distancias: calibrá después de reenrolar.
 */
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { AppConfig } from '../config/configuration';
import { TemplateEntity } from '../modules/enrollment/entities/template.entity';
import { AccessLogEntity } from '../modules/kiosk/entities/access-log.entity';
import { BiometricProvider, FACE_PROVIDER } from '../modules/biometric-providers/biometric-provider.interface';

/** Tope de pares impostores: más allá se muestrea al azar (el costo crece cuadrático). */
const MAX_IMPOSTOR_PAIRS = 200_000;
const THRESHOLDS_TO_REPORT = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[index];
}

function describe(label: string, values: number[]): void {
  const sorted = [...values].sort((a, b) => a - b);
  const fmt = (n: number) => (Number.isNaN(n) ? '  -  ' : n.toFixed(3));
  console.log(
    `${label.padEnd(12)} n=${String(sorted.length).padStart(7)}  min=${fmt(sorted[0] ?? NaN)}  p5=${fmt(percentile(sorted, 5))}  ` +
      `p50=${fmt(percentile(sorted, 50))}  p95=${fmt(percentile(sorted, 95))}  max=${fmt(sorted[sorted.length - 1] ?? NaN)}`,
  );
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const biometrics = app.get(ConfigService).get<AppConfig['biometrics']>('biometrics')!;
    const provider = app.get<BiometricProvider>(FACE_PROVIDER);
    const templateRepository = app.get<Repository<TemplateEntity>>(getRepositoryToken(TemplateEntity));
    const accessLogRepository = app.get<Repository<AccessLogEntity>>(getRepositoryToken(AccessLogEntity));

    const distance = (a: number[], b: number[]) => provider.compare({ vector: a }, { vector: b }).distance;

    const templates = await templateRepository.find({ where: { modality: 'Face' }, relations: { person: true } });
    const byPerson = new Map<number, number[][]>();
    for (const template of templates) {
      if (!template.person?.isActive) continue;
      const vectors = byPerson.get(template.personId) ?? [];
      vectors.push(JSON.parse(template.vectorJson));
      byPerson.set(template.personId, vectors);
    }
    const people = [...byPerson.entries()];
    const all = people.flatMap(([personId, vectors]) => vectors.map((vector) => ({ personId, vector })));

    console.log('\n=== Calibración facial ===');
    console.log(
      `Detector: ${biometrics.faceDetector} | Umbral actual: ${biometrics.faceMatchThreshold} | Margen 1:N: ${biometrics.faceIdentifyMargin}`,
    );
    console.log(`Personas activas con templates: ${people.length} | Templates: ${all.length}`);

    // --- Genuinas ---
    const genuine: number[] = [];
    for (const [, vectors] of people) {
      for (let i = 0; i < vectors.length; i++) {
        for (let j = i + 1; j < vectors.length; j++) genuine.push(distance(vectors[i], vectors[j]));
      }
    }

    // --- Impostoras (todas o muestra) ---
    const impostor: number[] = [];
    const totalImpostorPairs = (all.length * (all.length - 1)) / 2 - genuine.length;
    if (totalImpostorPairs <= MAX_IMPOSTOR_PAIRS) {
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          if (all[i].personId !== all[j].personId) impostor.push(distance(all[i].vector, all[j].vector));
        }
      }
    } else {
      while (impostor.length < MAX_IMPOSTOR_PAIRS) {
        const a = all[Math.floor(Math.random() * all.length)];
        const b = all[Math.floor(Math.random() * all.length)];
        if (a.personId !== b.personId) impostor.push(distance(a.vector, b.vector));
      }
      console.log(`(pares impostores muestreados: ${MAX_IMPOSTOR_PAIRS} de ${totalImpostorPairs})`);
    }

    console.log('\n--- Distribución de distancias ---');
    describe('Genuinas', genuine);
    describe('Impostoras', impostor);

    console.log('\n--- Tasas por umbral (template vs template) ---');
    const thresholds = [...new Set([...THRESHOLDS_TO_REPORT, biometrics.faceMatchThreshold])].sort((a, b) => a - b);
    if (genuine.length === 0 && impostor.length === 0) {
      console.log('Sin pares para comparar (hacen falta 2+ templates).');
    } else {
      const rate = (hits: number, total: number, decimals: number) =>
        total ? `${((hits / total) * 100).toFixed(decimals)}%` : '-';
      console.log('Umbral   Rechazo falso (FRR)   Aceptación falsa (FAR)');
      for (const t of thresholds) {
        const frr = rate(genuine.filter((d) => d > t).length, genuine.length, 2);
        const far = rate(impostor.filter((d) => d <= t).length, impostor.length, 3);
        const mark = t === biometrics.faceMatchThreshold ? '  ← actual' : '';
        console.log(`${t.toFixed(2)}     ${frr.padStart(8)}              ${far.padStart(9)}${mark}`);
      }
    }

    // --- Simulación 1:N deja-uno-afuera ---
    const outcome = { correct: 0, rejected: 0, ambiguous: 0, wrong: 0 };
    for (const [personId, vectors] of people) {
      if (vectors.length < 2) continue;
      vectors.forEach((probe, index) => {
        let ownBest = Infinity;
        vectors.forEach((other, otherIndex) => {
          if (otherIndex !== index) ownBest = Math.min(ownBest, distance(probe, other));
        });
        // Mejor distancia por cada otra persona.
        const others = people
          .filter(([otherId]) => otherId !== personId)
          .map(([, otherVectors]) => Math.min(...otherVectors.map((v) => distance(probe, v))))
          .sort((a, b) => a - b);
        const ranking = [{ own: true, d: ownBest }, ...others.map((d) => ({ own: false, d }))].sort((a, b) => a.d - b.d);
        const [best, second] = ranking;
        if (best.d > biometrics.faceMatchThreshold) outcome.rejected++;
        else if (second && second.d - best.d < biometrics.faceIdentifyMargin) outcome.ambiguous++;
        else if (best.own) outcome.correct++;
        else outcome.wrong++;
      });
    }
    const simulated = outcome.correct + outcome.rejected + outcome.ambiguous + outcome.wrong;
    console.log('\n--- Simulación 1:N (cada template como probe, con umbral y margen actuales) ---');
    if (simulated === 0) {
      console.log('Sin personas con 2+ templates: no se puede simular.');
    } else {
      const pct = (n: number) => `${((n / simulated) * 100).toFixed(1)}%`;
      console.log(
        `Probes: ${simulated} | Correctos: ${outcome.correct} (${pct(outcome.correct)}) | No reconocidos: ${outcome.rejected} (${pct(outcome.rejected)}) | ` +
          `Ambiguos: ${outcome.ambiguous} (${pct(outcome.ambiguous)}) | CONFUNDIDOS con otra persona: ${outcome.wrong} (${pct(outcome.wrong)})`,
      );
    }

    // --- AccessLog ---
    const logs = await accessLogRepository.find({ where: { modality: 'Face' } });
    const grantedDistances = logs.filter((log) => log.granted && log.distance !== null).map((log) => log.distance as number);
    console.log('\n--- Kiosco (biometric.AccessLog) ---');
    console.log(`Intentos: ${logs.length} | Concedidos: ${logs.filter((l) => l.granted).length} | Denegados: ${logs.filter((l) => !l.granted).length}`);
    describe('Concedidos', grantedDistances);
    console.log('(Concedidos con distancia cerca del umbral = personas que entran "de milagro": probable FRR real mayor.)');

    // --- Recomendación ---
    console.log('\n--- Lectura ---');
    if (people.length < 5 || genuine.length < 10) {
      console.log('⚠ Muy pocos datos (se sugieren 5+ personas y 10+ pares genuinos): los números no son representativos todavía.');
    }
    if (genuine.length && impostor.length) {
      const maxGenuine = Math.max(...genuine);
      const minImpostor = Math.min(...impostor);
      if (maxGenuine < minImpostor) {
        console.log(
          `Genuinas e impostoras no se solapan: cualquier umbral entre ${maxGenuine.toFixed(3)} y ${minImpostor.toFixed(3)} separa ` +
            `perfecto en estos datos. Punto medio: ${((maxGenuine + minImpostor) / 2).toFixed(3)}.`,
        );
      } else {
        const safe = thresholds.filter((t) => impostor.every((d) => d > t)).pop();
        console.log(
          `Las distribuciones se solapan (genuina máx ${maxGenuine.toFixed(3)} ≥ impostora mín ${minImpostor.toFixed(3)}). ` +
            (safe !== undefined
              ? `Mayor umbral de la tabla sin aceptaciones falsas: ${safe.toFixed(2)}.`
              : 'Ningún umbral de la tabla evita aceptaciones falsas.'),
        );
      }
      console.log('Para control de acceso priorizá FAR ≈ 0 (no confundir personas) aunque suba el rechazo falso.');
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
