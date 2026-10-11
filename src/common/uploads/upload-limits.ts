/**
 * Límites de multer para las subidas de fotos. Sin ellos multer carga en memoria
 * el archivo COMPLETO antes de que la validación de tamaño del controller lo
 * rechace; con `limits` corta la subida apenas se pasa del tope.
 */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

export const IMAGE_UPLOAD_LIMITS = {
  fileSize: MAX_IMAGE_SIZE_BYTES,
  /** Campos de texto (steps, nombres, etc.): ninguno necesita más que esto. */
  fieldSize: 10 * 1024,
  fields: 20,
  /** Máximo de archivos por request: 3 frames/poses + el campo legado `image`. */
  files: 4,
};
