export async function register() {
  // Only run in the Node.js runtime (not the Edge runtime), and only once
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { processAllPendingJobs } = await import('./lib/batch-worker');

    const POLL_INTERVAL_MS = 5 * 60_000; // check every 5 minutes

    const tick = async () => {
      try {
        const { processed } = await processAllPendingJobs();
        if (processed > 0) {
          console.log(`[batch-poller] Advanced ${processed} job(s)`);
        }
      } catch (e) {
        console.error('[batch-poller] Error:', e);
      }
    };

    // Run once immediately on startup, then on interval
    tick();
    setInterval(tick, POLL_INTERVAL_MS);

    console.log(`[batch-poller] Started — polling every ${POLL_INTERVAL_MS / 1000}s`);
  }
}
