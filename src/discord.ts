import { AuctionInfo } from './types.js';
import { CHAINS } from './chains.js';

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const UNISWAP_AUCTIONS_URL = 'https://app.uniswap.org/explore/auctions';
const ORANGE = 0xff6b2c; // Uniswap orange

function formatNumber(value: bigint, decimals: number, maxDecimals = 4): string {
  const divisor = BigInt(10 ** decimals);
  const whole = value / divisor;
  const remainder = value % divisor;
  const remainderStr = remainder.toString().padStart(decimals, '0').slice(0, maxDecimals);
  const trimmed = remainderStr.replace(/0+$/, '');
  if (!trimmed) return Number(whole).toLocaleString('en-US');
  return `${Number(whole).toLocaleString('en-US')}.${trimmed}`;
}

function estimateDuration(startBlock: bigint, endBlock: bigint, blockTime: number): string {
  const blocks = Number(endBlock - startBlock);
  if (blocks <= 0) return 'Unknown';
  const seconds = blocks * blockTime;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return hours > 0 ? `~${days}d ${hours}h` : `~${days}d`;
  return `~${hours}h`;
}

export async function sendAuctionAlert(auction: AuctionInfo): Promise<void> {
  if (!WEBHOOK_URL) {
    console.error('[Discord] DISCORD_WEBHOOK_URL is not set — skipping notification');
    return;
  }

  const chain = CHAINS[auction.chain];
  const explorerBase = chain?.blockExplorer ?? 'https://etherscan.io';
  const blockTime = chain?.blockTime ?? 12;

  const auctionLink = `${explorerBase}/address/${auction.auctionAddress}`;
  const tokenLink = `${explorerBase}/address/${auction.tokenAddress}`;
  const txLink = `${explorerBase}/tx/${auction.txHash}`;

  const supplyFormatted = formatNumber(auction.totalSupply, auction.tokenDecimals, 0);
  const floorFormatted = formatNumber(auction.floorPrice, auction.currencyDecimals, 6);
  const graduationFormatted = formatNumber(
    auction.requiredCurrencyRaised,
    auction.currencyDecimals,
    2,
  );
  const duration = estimateDuration(auction.startBlock, auction.endBlock, blockTime);

  const payload = {
    content: `New Uniswap CCA Auction detected on **${chain?.name ?? auction.chain}**!`,
    embeds: [
      {
        title: `🔔 New CCA Auction: $${auction.tokenSymbol} — ${auction.tokenName}`,
        url: UNISWAP_AUCTIONS_URL,
        color: ORANGE,
        fields: [
          {
            name: '🔗 Chain',
            value: chain?.name ?? auction.chain,
            inline: true,
          },
          {
            name: '💰 Token',
            value: `[$${auction.tokenSymbol}](${tokenLink})`,
            inline: true,
          },
          {
            name: '💵 Raise Currency',
            value: auction.currencySymbol,
            inline: true,
          },
          {
            name: '📦 Supply for Sale',
            value: `${supplyFormatted} ${auction.tokenSymbol}`,
            inline: true,
          },
          {
            name: '🏷️ Floor Price',
            value: `${floorFormatted} ${auction.currencySymbol}`,
            inline: true,
          },
          {
            name: '⏰ Duration',
            value: duration,
            inline: true,
          },
          {
            name: '🎓 Graduation Threshold',
            value: `${graduationFormatted} ${auction.currencySymbol}`,
            inline: true,
          },
          {
            name: '🔗 Links',
            value: `[View Auction](${UNISWAP_AUCTIONS_URL}) • [Contract](${auctionLink}) • [Tx](${txLink})`,
            inline: false,
          },
        ],
        footer: {
          text: 'Uniswap CCA Monitor',
        },
        timestamp: new Date(auction.timestamp * 1000).toISOString(),
      },
    ],
  };

  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord webhook returned ${res.status}: ${text}`);
  }

  console.log(`[Discord] Alert sent for $${auction.tokenSymbol} on ${chain?.name}`);
}

// Simple rate-limit aware sender with retry
export async function sendAuctionAlertWithRetry(
  auction: AuctionInfo,
  retries = 3,
): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await sendAuctionAlert(auction);
      return;
    } catch (err) {
      console.error(`[Discord] Attempt ${i + 1}/${retries} failed:`, err);
      if (i < retries - 1) await sleep(2000 * (i + 1));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
