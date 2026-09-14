// @vladmandic/face-api publica sus .d.ts vacíos para la build node-wasm
// (verificado: dist/face-api.node-wasm.d.ts pesa 0 bytes en la versión
// instalada). Este shim declara el módulo como `any` para no perder
// noImplicitAny en el resto del proyecto; el tipado real hacia el resto
// de la app lo da la interfaz `FaceProvider` (ver face-provider.interface.ts),
// que sí está completamente tipada.
declare module '@vladmandic/face-api/dist/face-api.node-wasm.js' {
  const faceapi: any;
  export = faceapi;
}
