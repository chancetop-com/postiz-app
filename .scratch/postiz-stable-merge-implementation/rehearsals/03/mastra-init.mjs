// Runs the same Mastra Postgres storage initialisation the API does through
// libraries/nestjs-libraries/src/chat/mastra.store.ts, against the rehearsal
// database. It answers one question the Prisma schema cannot: what happens to
// the pre-existing (and deliberately duplicated) mastra_ai_spans rows when the
// upgraded application initialises its storage.
import { PostgresStore } from '@mastra/pg';

const store = new PostgresStore({
  id: 'ticket-03-rehearsal',
  connectionString: process.env.DATABASE_URL,
});

try {
  await store.init();
  console.log('MASTRA_INIT_OK');
} catch (error) {
  console.log('MASTRA_INIT_FAILED');
  console.log(String(error?.message ?? error));
  process.exitCode = 1;
} finally {
  await store.close?.();
}
