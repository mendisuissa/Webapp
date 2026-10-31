import pino from 'pino';
import { config } from '../config.js';

// The log file lives on the App Service /home share (SMB). Every touch of it must be asynchronous:
// a synchronous existsSync/mkdirSync/openSync here used to run at import time, before the server
// listened, so a stalled share left the process "Running" but never answering (issue #20).
// sync:false makes SonicBoom create the directory and open the file in the background; maxLength
// caps the in-memory buffer (lines are dropped, not queued forever) if the share never answers.
const fileDestination = pino.destination({
  dest: config.logFile,
  sync: false,
  mkdir: true,
  maxLength: 16 * 1024 * 1024
});
// A failed open/write must never crash the API; fall back to the console.
fileDestination.on('error', (err) => {
  console.error(`File logging unavailable (${(err as NodeJS.ErrnoException).code ?? 'error'}); continuing.`);
});

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info'
}, fileDestination);

export const requestLogger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
