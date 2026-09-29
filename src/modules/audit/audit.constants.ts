/**
 * Catálogo de auditoría: severidades, categorías y tipos de evento.
 *
 * Criterio de severidad (pedido de Jess, 2026-09-15):
 * - SEV1: alerta real — patrones de ataque o fraude (ráfagas de una IP,
 *   reuso de refresh token, identidad suplantada en el kiosco, template
 *   alterado, base de datos caída).
 * - SEV2: requiere atención — fallos repetidos (5 intentos del kiosco o de
 *   una cuenta), accesos denegados por rol, token con firma inválida,
 *   rate limit, identificación ambigua, errores del servidor, privilegios
 *   de Admin otorgados, login de admin desde una IP nueva.
 * - SEV3: menor — un fallo aislado (credenciales, foto rechazada, no
 *   reconocido), validaciones, 404, y acciones sensibles legítimas que
 *   conviene poder revisar (desactivar, resetear contraseña, exportar).
 * - NORMAL: operación esperada del sistema.
 */

export const AUDIT_SEVERITIES = ['SEV1', 'SEV2', 'SEV3', 'NORMAL'] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export const AUDIT_CATEGORIES = [
  'AUTH',
  'USER',
  'PERSON',
  'ENROLLMENT',
  'VERIFICATION',
  'KIOSK',
  'SECURITY',
  'AUDIT',
  'SYSTEM',
  'HTTP',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_OUTCOMES = ['SUCCESS', 'FAILURE', 'DENIED', 'ERROR', 'INFO'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export type AuditActorType = 'USER' | 'ANONYMOUS' | 'SYSTEM';

interface EventTypeDefinition {
  category: AuditCategory;
  severity: AuditSeverity;
  outcome: AuditOutcome;
  /** Descripción legible (se usa como Message por defecto y en el dashboard). */
  label: string;
}

const define = <T extends Record<string, EventTypeDefinition>>(catalog: T) => catalog;

export const AUDIT_EVENT_TYPES = define({
  // --- Autenticación ---
  AUTH_LOGIN_SUCCESS: { category: 'AUTH', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Inicio de sesión exitoso' },
  AUTH_LOGIN_FAILED: { category: 'AUTH', severity: 'SEV3', outcome: 'FAILURE', label: 'Inicio de sesión fallido' },
  AUTH_LOGIN_INACTIVE_ACCOUNT: { category: 'AUTH', severity: 'SEV2', outcome: 'DENIED', label: 'Intento de inicio de sesión con cuenta desactivada' },
  AUTH_LOGIN_NEW_IP: { category: 'AUTH', severity: 'SEV3', outcome: 'SUCCESS', label: 'Inicio de sesión desde una IP nunca usada por la cuenta' },
  AUTH_LOGOUT: { category: 'AUTH', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Cierre de sesión' },
  AUTH_TOKEN_REFRESHED: { category: 'AUTH', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Sesión renovada' },
  AUTH_REFRESH_FAILED: { category: 'AUTH', severity: 'SEV3', outcome: 'FAILURE', label: 'Renovación de sesión rechazada' },
  AUTH_REFRESH_TOKEN_REUSE: { category: 'SECURITY', severity: 'SEV1', outcome: 'DENIED', label: 'Reuso de refresh token: posible robo de sesión (se revocaron todas las sesiones)' },
  AUTH_TOKEN_EXPIRED: { category: 'AUTH', severity: 'NORMAL', outcome: 'DENIED', label: 'Token de acceso vencido' },
  AUTH_TOKEN_MISSING: { category: 'AUTH', severity: 'SEV3', outcome: 'DENIED', label: 'Acceso a recurso protegido sin token' },
  AUTH_TOKEN_INVALID: { category: 'SECURITY', severity: 'SEV2', outcome: 'DENIED', label: 'Token con firma o formato inválido' },
  AUTH_ACCESS_DENIED_ROLE: { category: 'SECURITY', severity: 'SEV2', outcome: 'DENIED', label: 'Acceso denegado por rol insuficiente' },
  AUTH_PASSWORD_CHANGED: { category: 'AUTH', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Contraseña propia cambiada' },
  AUTH_PASSWORD_CHANGE_FAILED: { category: 'AUTH', severity: 'SEV3', outcome: 'FAILURE', label: 'Cambio de contraseña rechazado' },

  // --- Usuarios del panel ---
  USER_LISTED: { category: 'USER', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Consulta de usuarios' },
  USER_VIEWED: { category: 'USER', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Consulta de un usuario' },
  USER_CREATED: { category: 'USER', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Usuario creado' },
  USER_UPDATED: { category: 'USER', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Usuario modificado' },
  USER_ADMIN_ROLE_GRANTED: { category: 'SECURITY', severity: 'SEV2', outcome: 'SUCCESS', label: 'Rol Admin otorgado a un usuario' },
  USER_ADMIN_ROLE_REVOKED: { category: 'USER', severity: 'SEV3', outcome: 'SUCCESS', label: 'Rol Admin retirado a un usuario' },
  USER_DEACTIVATED: { category: 'USER', severity: 'SEV3', outcome: 'SUCCESS', label: 'Usuario desactivado' },
  USER_ACTIVATED: { category: 'USER', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Usuario reactivado' },
  USER_PASSWORD_RESET: { category: 'USER', severity: 'SEV3', outcome: 'SUCCESS', label: 'Contraseña de un usuario reasignada por Admin' },
  ROLE_LISTED: { category: 'USER', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Consulta de roles' },

  // --- Personas ---
  PERSON_LISTED: { category: 'PERSON', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Consulta del listado de personas' },
  PERSON_VIEWED: { category: 'PERSON', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Consulta de una persona' },
  PERSON_CREATED: { category: 'PERSON', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Persona creada' },
  PERSON_UPDATED: { category: 'PERSON', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Persona modificada' },
  PERSON_DEACTIVATED: { category: 'PERSON', severity: 'SEV3', outcome: 'SUCCESS', label: 'Persona desactivada' },
  // SEV2 y no SEV3: a diferencia de desactivar, esto es irreversible y borra
  // biometría. Si alguien purga personas que no correspondía, esta fila es lo
  // único que queda — la bitácora no tiene FK a la persona justamente por eso.
  PERSON_PURGED: { category: 'PERSON', severity: 'SEV2', outcome: 'SUCCESS', label: 'Persona eliminada definitivamente con todos sus registros' },
  CONSENT_GRANTED: { category: 'PERSON', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Consentimiento de tratamiento biométrico registrado' },
  PERSON_IDENTIFIER_ADDED: { category: 'PERSON', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Identificador agregado a una persona' },
  PERSON_IDENTIFIER_REMOVED: { category: 'PERSON', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Identificador eliminado de una persona' },

  // --- Enrollment / biometría ---
  ENROLLMENT_LISTED: { category: 'ENROLLMENT', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Consulta de enrollments' },
  ENROLLMENT_VIEWED: { category: 'ENROLLMENT', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Consulta de un enrollment' },
  ENROLLMENT_CREATED: { category: 'ENROLLMENT', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Enrollment creado' },
  ENROLLMENT_STATUS_CHANGED: { category: 'ENROLLMENT', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Estado de enrollment cambiado' },
  ENROLLMENT_REVOKED: { category: 'ENROLLMENT', severity: 'SEV3', outcome: 'SUCCESS', label: 'Enrollment revocado' },
  BIOMETRIC_CAPTURED: { category: 'ENROLLMENT', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Muestra biométrica capturada y guardada' },
  BIOMETRIC_CAPTURE_REJECTED: { category: 'ENROLLMENT', severity: 'SEV3', outcome: 'FAILURE', label: 'Muestra biométrica rechazada' },

  // --- Galería biométrica (Nivel 2: templates adaptativos y revocación) ---
  // SEV3 y no NORMAL: el sistema modifica solo la galería biométrica de una
  // persona. Es legítimo, pero es exactamente lo que hay que poder revisar si
  // alguien sospecha que una galería se corrió hacia otra cara.
  BIOMETRIC_TEMPLATE_ADAPTED: { category: 'ENROLLMENT', severity: 'SEV3', outcome: 'SUCCESS', label: 'Template adaptativo agregado tras un ingreso reconocido' },
  // Solo en modo `shadow`: lo que se habría agregado, sin escribir nada.
  BIOMETRIC_TEMPLATE_ADAPTIVE_CANDIDATE: { category: 'ENROLLMENT', severity: 'NORMAL', outcome: 'INFO', label: 'Template adaptativo candidato (modo shadow, no se guardó)' },
  BIOMETRIC_TEMPLATE_EVICTED: { category: 'ENROLLMENT', severity: 'SEV3', outcome: 'SUCCESS', label: 'Template adaptativo revocado por el tope de la galería' },
  BIOMETRIC_TEMPLATE_REVOKED: { category: 'ENROLLMENT', severity: 'SEV3', outcome: 'SUCCESS', label: 'Template revocado manualmente' },
  BIOMETRIC_TEMPLATE_RESTORED: { category: 'ENROLLMENT', severity: 'SEV3', outcome: 'SUCCESS', label: 'Template restaurado manualmente' },
  BIOMETRIC_TEMPLATES_VIEWED: { category: 'ENROLLMENT', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Consulta de la galería biométrica de una persona' },

  // --- Verificación 1:1 (panel) ---
  VERIFICATION_MATCH: { category: 'VERIFICATION', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Verificación 1:1: coincide' },
  VERIFICATION_NO_MATCH: { category: 'VERIFICATION', severity: 'SEV3', outcome: 'FAILURE', label: 'Verificación 1:1: no coincide' },
  VERIFICATION_REJECTED: { category: 'VERIFICATION', severity: 'SEV3', outcome: 'FAILURE', label: 'Verificación 1:1: muestra rechazada' },

  // --- Kiosco (público) ---
  KIOSK_IDENTIFY_MATCH: { category: 'KIOSK', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Reconocimiento: rostro identificado' },
  KIOSK_IDENTIFY_NO_MATCH: { category: 'KIOSK', severity: 'NORMAL', outcome: 'INFO', label: 'Reconocimiento: rostro no registrado' },
  KIOSK_IDENTIFY_AMBIGUOUS: { category: 'KIOSK', severity: 'SEV2', outcome: 'FAILURE', label: 'Reconocimiento: identificación ambigua entre dos personas' },
  KIOSK_IDENTIFY_REJECTED: { category: 'KIOSK', severity: 'SEV3', outcome: 'FAILURE', label: 'Reconocimiento: foto rechazada al identificar' },
  KIOSK_CHECKIN_GRANTED: { category: 'KIOSK', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Reconocimiento: ingreso concedido' },
  KIOSK_CHECKIN_DENIED: { category: 'KIOSK', severity: 'SEV3', outcome: 'DENIED', label: 'Reconocimiento: ingreso denegado (no reconocido)' },
  KIOSK_CHECKIN_DISABLED_PERSON: { category: 'KIOSK', severity: 'SEV3', outcome: 'DENIED', label: 'Reconocimiento: ingreso denegado, la persona está deshabilitada' },
  KIOSK_CHECKIN_AMBIGUOUS: { category: 'KIOSK', severity: 'SEV2', outcome: 'DENIED', label: 'Reconocimiento: ingreso denegado por identificación ambigua' },
  KIOSK_CHECKIN_REJECTED: { category: 'KIOSK', severity: 'SEV3', outcome: 'FAILURE', label: 'Reconocimiento: fotos de ingreso rechazadas por calidad' },
  KIOSK_REGISTER_SUCCESS: { category: 'KIOSK', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Reconocimiento: persona registrada' },
  KIOSK_REGISTER_REJECTED: { category: 'KIOSK', severity: 'SEV3', outcome: 'FAILURE', label: 'Reconocimiento: registro rechazado (fotos o datos)' },
  KIOSK_REGISTER_DUPLICATE_FACE: { category: 'KIOSK', severity: 'SEV3', outcome: 'DENIED', label: 'Reconocimiento: la persona ya estaba registrada (misma cédula)' },
  KIOSK_REGISTER_IDENTITY_MISMATCH: { category: 'SECURITY', severity: 'SEV1', outcome: 'DENIED', label: 'Reconocimiento: rostro ya registrado intentando registrarse con OTRA cédula' },
  KIOSK_REGISTER_NATIONALID_CONFLICT: { category: 'SECURITY', severity: 'SEV2', outcome: 'DENIED', label: 'Reconocimiento: registro con una cédula ya existente y un rostro que no coincide' },
  // El mismo número ya existe bajo OTRO tipo de identificación. Puede ser
  // legítimo (la misma persona con cédula y DIMEX) o puede ser alguien usando
  // el número de otro cambiando el tipo para esquivar la unicidad, que es por
  // (tipo + número). Por eso se avisa y queda como alerta en vez de crearse
  // en silencio.
  SECURITY_IDENTIFICATION_NUMBER_REUSED: { category: 'SECURITY', severity: 'SEV2', outcome: 'DENIED', label: 'Registro con un número de identificación ya usado bajo otro tipo' },

  // --- Auditoría ---
  AUDIT_VIEWED: { category: 'AUDIT', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Consulta de la auditoría' },
  AUDIT_EXPORTED: { category: 'AUDIT', severity: 'SEV3', outcome: 'SUCCESS', label: 'Exportación de la auditoría' },
  AUDIT_ALERT_ACKNOWLEDGED: { category: 'AUDIT', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Alerta marcada como revisada' },

  // --- Seguridad (detectores y errores) ---
  SECURITY_LOGIN_BURST: { category: 'SECURITY', severity: 'SEV1', outcome: 'INFO', label: 'Ráfaga de intentos de inicio de sesión desde una IP' },
  SECURITY_KIOSK_BURST: { category: 'SECURITY', severity: 'SEV1', outcome: 'INFO', label: 'Ráfaga de intentos de ingreso/registro en el kiosco desde una IP' },
  SECURITY_ROUTE_SCANNING: { category: 'SECURITY', severity: 'SEV1', outcome: 'INFO', label: 'Escaneo de rutas: muchas respuestas 404 desde una IP' },
  SECURITY_RATE_LIMIT_BURST: { category: 'SECURITY', severity: 'SEV1', outcome: 'INFO', label: 'Ráfaga de bloqueos por rate limit desde una IP' },
  SECURITY_AUTH_FAILURE_BURST: { category: 'SECURITY', severity: 'SEV1', outcome: 'INFO', label: 'Ráfaga de accesos no autorizados (401/403) desde una IP' },
  SECURITY_ACCOUNT_REPEATED_LOGIN_FAILURE: { category: 'SECURITY', severity: 'SEV2', outcome: 'INFO', label: 'Fallos repetidos de inicio de sesión sobre una misma cuenta' },
  SECURITY_KIOSK_REGISTER_REPEATED_FAILURE: { category: 'SECURITY', severity: 'SEV2', outcome: 'INFO', label: 'Reconocimiento: el rostro no se pudo registrar tras varios intentos desde una IP' },
  SECURITY_KIOSK_CHECKIN_REPEATED_FAILURE: { category: 'SECURITY', severity: 'SEV2', outcome: 'INFO', label: 'Reconocimiento: ingreso no reconocido tras varios intentos desde una IP' },
  SECURITY_RATE_LIMITED: { category: 'SECURITY', severity: 'SEV2', outcome: 'DENIED', label: 'Request bloqueado por rate limit' },
  SECURITY_IP_BLOCKED: { category: 'SECURITY', severity: 'SEV2', outcome: 'SUCCESS', label: 'IP bloqueada por un Admin' },
  SECURITY_IP_UNBLOCKED: { category: 'SECURITY', severity: 'SEV3', outcome: 'SUCCESS', label: 'IP desbloqueada por un Admin' },
  SECURITY_BLOCKED_IP_REQUEST: { category: 'SECURITY', severity: 'SEV3', outcome: 'DENIED', label: 'Request rechazado: la IP está bloqueada' },
  SECURITY_TEMPLATE_INTEGRITY_FAILURE: { category: 'SECURITY', severity: 'SEV1', outcome: 'ERROR', label: 'Template biométrico alterado o ilegible (falló la verificación de integridad)' },

  // --- Sistema / HTTP genérico ---
  SYSTEM_STARTUP: { category: 'SYSTEM', severity: 'NORMAL', outcome: 'INFO', label: 'API iniciado' },
  SYSTEM_SHUTDOWN: { category: 'SYSTEM', severity: 'SEV3', outcome: 'INFO', label: 'API detenido' },
  SYSTEM_ERROR: { category: 'SYSTEM', severity: 'SEV2', outcome: 'ERROR', label: 'Error interno del servidor' },
  SYSTEM_DATABASE_ERROR: { category: 'SYSTEM', severity: 'SEV1', outcome: 'ERROR', label: 'Error de conexión con la base de datos' },
  HEALTH_CHECKED: { category: 'SYSTEM', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Chequeo de salud' },
  HTTP_REQUEST: { category: 'HTTP', severity: 'NORMAL', outcome: 'SUCCESS', label: 'Request HTTP' },
  HTTP_CLIENT_ERROR: { category: 'HTTP', severity: 'SEV3', outcome: 'FAILURE', label: 'Request HTTP rechazado (datos inválidos o conflicto)' },
  HTTP_NOT_FOUND: { category: 'HTTP', severity: 'SEV3', outcome: 'FAILURE', label: 'Ruta o recurso inexistente (404)' },
});

export type AuditEventType = keyof typeof AUDIT_EVENT_TYPES;

/**
 * Alertas desde las que un Admin puede bloquear la IP de origen: intentos
 * fallidos o alarmantes (pedido de Jess, 2026-09-15). A propósito NO:
 * - SECURITY_ROUTE_SCANNING (escaneo de rutas: ruido de internet, no un intento real).
 * - AUTH_REFRESH_TOKEN_REUSE (la IP puede ser la de la víctima, no la del atacante).
 */
export const BLOCKABLE_ALERT_TYPES: ReadonlySet<string> = new Set<AuditEventType>([
  'SECURITY_LOGIN_BURST',
  'SECURITY_KIOSK_BURST',
  'SECURITY_AUTH_FAILURE_BURST',
  'SECURITY_RATE_LIMIT_BURST',
  'SECURITY_ACCOUNT_REPEATED_LOGIN_FAILURE',
  'SECURITY_KIOSK_REGISTER_REPEATED_FAILURE',
  'SECURITY_KIOSK_CHECKIN_REPEATED_FAILURE',
  'KIOSK_REGISTER_IDENTITY_MISMATCH',
]);

export function isAuditSeverity(value: string): value is AuditSeverity {
  return (AUDIT_SEVERITIES as readonly string[]).includes(value);
}
