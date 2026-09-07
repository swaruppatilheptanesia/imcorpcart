import { createApp } from './app';
import { env } from './config/env';
import { connectPrisma, disconnectPrisma } from './config/prisma';
import { startWebhookRetryLoop } from './services/webhook.service';
import { resumePendingFulfilments } from './services/voucher-fulfilment.service';

// Minimal bootstrap: connect the DB, start listening, wire graceful shutdown.
async function main() {
  await connectPrisma();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`🚀 imcorpcart API listening on http://localhost:${env.PORT}/api`);
  });

  // Reprocess due partner webhook deliveries (retry with backoff). Runs only in
  // the main server process.
  startWebhookRetryLoop();

  // Resume any voucher (Hubble) fulfilments that were mid-flight when the process
  // last stopped — place/poll continues until the code is delivered or refunded.
  void resumePendingFulfilments().catch((e) => console.error('resumePendingFulfilments failed:', e));

  async function shutdown(signal: string) {
    // eslint-disable-next-line no-console
    console.log(`\n${signal} received — shutting down`);
    server.close(async () => {
      await disconnectPrisma();
      process.exit(0);
    });
    // Force-exit if the server hasn't closed in time.
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
