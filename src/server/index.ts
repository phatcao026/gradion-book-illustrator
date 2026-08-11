import 'dotenv/config';

import { createApp } from './app.js';
import { openDatabase } from './database.js';
import {
  GoogleGeminiGateway,
  UnconfiguredGeminiGateway,
} from './gemini/gemini-gateway.js';
import {
  GoogleGeminiImageGateway,
  UnconfiguredGeminiImageGateway,
} from './gemini/image-gateway.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const databasePath = process.env.DATABASE_PATH ?? './data/gradion.sqlite';
const uploadsDirectory = process.env.UPLOADS_DIRECTORY ?? './uploads';
const staleAttemptMinutes = Number.parseFloat(
  process.env.STALE_ATTEMPT_MINUTES ?? '10',
);
const geminiTextModel = process.env.GEMINI_TEXT_MODEL ?? 'gemini-3.6-flash';
const geminiImageModel =
  process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-image';
const geminiServiceTier = process.env.GEMINI_SERVICE_TIER ?? 'standard';

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}

if (!Number.isFinite(staleAttemptMinutes) || staleAttemptMinutes <= 0) {
  throw new Error(
    `Invalid STALE_ATTEMPT_MINUTES value: ${process.env.STALE_ATTEMPT_MINUTES}`,
  );
}

if (geminiServiceTier !== 'standard') {
  throw new Error('GEMINI_SERVICE_TIER must be standard for this application.');
}

const geminiGateway = process.env.GEMINI_API_KEY
  ? new GoogleGeminiGateway({
      apiKey: process.env.GEMINI_API_KEY,
      model: geminiTextModel,
      serviceTier: 'standard',
    })
  : new UnconfiguredGeminiGateway(geminiTextModel);
const geminiImageGateway = process.env.GEMINI_API_KEY
  ? new GoogleGeminiImageGateway({
      apiKey: process.env.GEMINI_API_KEY,
      model: geminiImageModel,
      serviceTier: 'standard',
    })
  : new UnconfiguredGeminiImageGateway(geminiImageModel);

const database = openDatabase(databasePath);
const server = createApp({
  database,
  uploadsDirectory,
  secureCookies: process.env.NODE_ENV === 'production',
  staleAttemptMs: staleAttemptMinutes * 60 * 1000,
  geminiGateway,
  geminiImageGateway,
}).listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
