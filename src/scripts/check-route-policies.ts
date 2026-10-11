/**
 * Verifica que TODA ruta del API declare su política de acceso.
 *
 *   npm run check:routes
 *
 * El API es deny-by-default (ver auth/decorators/access.decorator.ts): una ruta
 * sin `@Public()`, `@AnyAuthenticated()` ni `@Roles(...)` responde 403. Este
 * script lo detecta ANTES de llegar a producción y falla (exit 1) si encuentra
 * alguna. No arranca el API ni toca la base de datos: lee los metadatos de los
 * decoradores de cada `*.controller`.
 *
 * Correrlo antes de cerrar cualquier fase que agregue o cambie endpoints.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { IS_PUBLIC_KEY, ANY_AUTHENTICATED_KEY } from '../modules/auth/decorators/access.decorator';
import { ROLES_KEY } from '../modules/auth/decorators/roles.decorator';

// Metadatos internos de @nestjs/common (constantes públicas de facto).
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';
const HTTP_METHODS: Record<number, string> = { 0: 'GET', 1: 'POST', 2: 'PUT', 3: 'DELETE', 4: 'PATCH', 5: 'ALL', 6: 'OPTIONS', 7: 'HEAD' };

type Policy = 'PUBLIC' | 'ANY_AUTHENTICATED' | string;

function findControllerFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findControllerFiles(full));
    else if (/\.controller\.(js|ts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) found.push(full);
  }
  return found;
}

function policyOf(target: object, handler: object): Policy | null {
  const read = (key: string) => Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, target);
  if (read(IS_PUBLIC_KEY)) return 'PUBLIC';
  const roles = read(ROLES_KEY) as string[] | undefined;
  if (roles && roles.length > 0) return `ROLES(${roles.join(', ')})`;
  if (read(ANY_AUTHENTICATED_KEY)) return 'ANY_AUTHENTICATED';
  return null;
}

function joinPath(...parts: string[]): string {
  return '/' + parts.map((part) => part.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
}

function main(): void {
  const root = path.resolve(__dirname, '..');
  const files = [...findControllerFiles(path.join(root, 'modules')), ...findControllerFiles(path.join(root, 'health'))];
  const rows: Array<{ route: string; policy: Policy | null }> = [];

  for (const file of files) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function' || Reflect.getMetadata(PATH_METADATA, exported) === undefined) continue;
      const controllerPath = Reflect.getMetadata(PATH_METADATA, exported) as string;
      const prototype = (exported as { prototype: Record<string, unknown> }).prototype;

      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        const method = HTTP_METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? '?';
        const methodPath = (Reflect.getMetadata(PATH_METADATA, handler) as string) ?? '';
        rows.push({ route: `${method.padEnd(6)} ${joinPath(controllerPath, methodPath)}`, policy: policyOf(exported, handler) });
      }
    }
  }

  rows.sort((a, b) => a.route.localeCompare(b.route));
  for (const row of rows) {
    // eslint-disable-next-line no-console
    console.log(`${row.policy ? 'OK  ' : 'FALTA'}  ${row.route.padEnd(48)} ${row.policy ?? '— sin política (respondería 403)'}`);
  }

  const missing = rows.filter((row) => !row.policy);
  // eslint-disable-next-line no-console
  console.log(`\n${rows.length} rutas revisadas, ${missing.length} sin política.`);
  if (missing.length > 0) process.exit(1);
}

main();
