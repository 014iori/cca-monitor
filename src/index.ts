import 'dotenv/config';
import { CHAINS } from './chains.js';
import { ChainMonitor } from './monitor.js';
import { loadSeenAuctions, markAsSeen, hasSeen } from './storage.js';
import { sendAuctionAlertWithRetry } from './discord.js';

const POLL_INTERVAL_MS = (Number(process.env.POLL_INTERVAL_SECONDS) || 30) * 1000;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('🦄 Uniswap CCA Monitor starting...');
  console.log(`Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`Monitoring chains: ${Object.keys(CHAINS).join(', ')}`);
  console.log('');

  const seenAuctions = loadSeenAuctions();
  console.log(`Loaded ${Object.keys(seenAuctions).length} previously seen auction(s)`);

  // Initialize monitors for all chains
  const monitors: { key: string; monitor: ChainMonitor }[] = [];
  for (const [key, config] of Object.entries(CHAINS)) {
    const monitor = new ChainMonitor(key, config);
    try {
      await monitor.initialize();
      monitors.push({ key, monitor });
    } catch (err) {
      console.error(`[${key.toUpperCase()}] Failed to initialize — will skip this chain:`, err);
    }
  }

  if (monitors.length === 0) {
    console.error('No chains could be initialized. Exiting.');
    process.exit(1);
  }

  console.log(`\n✅ Monitoring ${monitors.length} chain(s). Polling every ${POLL_INTERVAL_MS / 1000}s...\n`);

  // Graceful shutdown
  let running = true;
  function shutdown() {
    console.log('\n[Main] Shutting down...');
    running = false;
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (running) {
    const pollStart = Date.now();

    // Poll all chains in parallel
    const pollTasks = monitors.map(async ({ key, monitor }) => {
      try {
        const events = await monitor.poll();

        for (const event of events) {
          const addrLower = event.auctionAddress.toLowerCase();

          if (hasSeen(seenAuctions, addrLower)) {
            console.log(`[${key.toUpperCase()}] Already seen: ${event.auctionAddress}`);
            continue;
          }

          // Mark as seen immediately to prevent duplicate alerts
          markAsSeen(seenAuctions, addrLower, {
            chain: key,
            tokenAddress: event.tokenAddress,
            tokenSymbol: '???',
            timestamp: Math.floor(Date.now() / 1000),
            txHash: event.txHash,
          });

          const info = await monitor.fetchAuctionInfo(event);
          if (!info) {
            console.warn(`[${key.toUpperCase()}] Could not fetch full info for ${event.auctionAddress}`);
            continue;
          }

          // Update stored entry with resolved symbol
          markAsSeen(seenAuctions, addrLower, {
            chain: key,
            tokenAddress: info.tokenAddress,
            tokenSymbol: info.tokenSymbol,
            timestamp: info.timestamp,
            txHash: event.txHash,
          });

          console.log(
            `[${key.toUpperCase()}] Sending Discord alert for $${info.tokenSymbol} (${info.tokenName})`,
          );
          await sendAuctionAlertWithRetry(info);
        }
      } catch (err) {
        console.error(`[${key.toUpperCase()}] Poll error:`, err);
      }
    });

    await Promise.allSettled(pollTasks);

    // Wait for next interval, accounting for time already spent
    const elapsed = Date.now() - pollStart;
    const waitMs = Math.max(0, POLL_INTERVAL_MS - elapsed);
    if (running && waitMs > 0) await sleep(waitMs);
  }

  console.log('[Main] Exited cleanly.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
