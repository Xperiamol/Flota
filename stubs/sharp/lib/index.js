// Stub for sharp — image processing is not used in Electron main process (Mem0/vector embeddings only).
// This stub prevents @xenova/transformers from throwing "Cannot find package 'sharp'"
// while never being actually invoked.
'use strict';
function sharp() {
  throw new Error('[sharp stub] Image processing is not available in this build.');
}
module.exports = sharp;
