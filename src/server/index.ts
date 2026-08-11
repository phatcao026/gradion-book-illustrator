import 'dotenv/config';

import { createApp } from './app.js';
import { openDatabase } from './database.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const databasePath = process.env.DATABASE_PATH ?? './data/gradion.sqlite';
const uploadsDirectory = process.env.UPLOADS_DIRECTORY ?? './uploads';

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}

const database = openDatabase(databasePath);
const server = createApp({
  database,
  uploadsDirectory,
  secureCookies: process.env.NODE_ENV === 'production',
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
