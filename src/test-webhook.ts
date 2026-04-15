import 'dotenv/config';
import { sendAuctionAlertWithRetry } from './discord.js';
import { AuctionInfo } from './types.js';

const fakeAuction: AuctionInfo = {
  auctionAddress: '0xDeAdBeEf00000000000000000000000000000001',
  chain: 'base',
  chainId: 8453,
  tokenAddress: '0xDeAdBeEf00000000000000000000000000000002',
  tokenName: 'Test Token',
  tokenSymbol: 'TEST',
  tokenDecimals: 18,
  currencyAddress: '0x4200000000000000000000000000000000000006',
  currencySymbol: 'WETH',
  currencyDecimals: 18,
  totalSupply: 10_000_000n * 10n ** 18n,
  startBlock: 44_000_000n,
  endBlock: 44_129_600n, // ~3 days on Base (2s blocks)
  floorPrice: 1n * 10n ** 15n, // 0.001 WETH
  requiredCurrencyRaised: 500n * 10n ** 18n, // 500 WETH
  txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  blockNumber: 44_000_000n,
  timestamp: Math.floor(Date.now() / 1000),
};

console.log('Sending test webhook...');
sendAuctionAlertWithRetry(fakeAuction)
  .then(() => {
    console.log('✅ Test webhook sent successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Failed:', err);
    process.exit(1);
  });
