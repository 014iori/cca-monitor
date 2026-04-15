import 'dotenv/config';
import { ethers } from 'ethers';
import { CHAINS, CCA_FACTORY_ADDRESS, KNOWN_CURRENCIES } from './chains.js';
import { ERC20_ABI, AUCTION_PARAMETERS_ABI_TYPES } from './abi.js';

const AUCTION_CREATED_TOPIC = ethers.id('AuctionCreated(address,address,uint256,bytes)');

const auctionAddress = process.argv[2];
if (!auctionAddress || !ethers.isAddress(auctionAddress)) {
  console.error('Usage: npm run auction-info -- <auction-address>');
  process.exit(1);
}

async function findAuction(address: string) {
  for (const [key, config] of Object.entries(CHAINS)) {
    const provider = new ethers.JsonRpcProvider(config.rpc);

    try {
      const code = await provider.getCode(address);
      if (code === '0x') continue; // not deployed on this chain
    } catch {
      continue;
    }

    console.log(`Found on ${config.name} — fetching logs...`);

    // Search for the AuctionCreated event for this auction address
    // We scan recent blocks in chunks since Alchemy free = 10 blocks
    const latest = await provider.getBlockNumber();
    const chunkSize = config.maxBlocksPerQuery;
    const maxLookback = 50000; // ~7 days on most chains

    let found = false;
    for (let to = latest; to > latest - maxLookback; to -= chunkSize) {
      const from = Math.max(to - chunkSize + 1, 0);
      const logs = await provider.getLogs({
        address: CCA_FACTORY_ADDRESS,
        topics: [
          AUCTION_CREATED_TOPIC,
          ethers.zeroPadValue(address.toLowerCase(), 32), // filter by auction address
        ],
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
      }).catch(() => []);

      if (logs.length > 0) {
        const log = logs[0];
        const tokenAddress = ethers.getAddress('0x' + log.topics[2].slice(26));
        const [amount, configData] = ethers.AbiCoder.defaultAbiCoder().decode(
          ['uint256', 'bytes'], log.data,
        );
        const params = ethers.AbiCoder.defaultAbiCoder().decode(
          [...AUCTION_PARAMETERS_ABI_TYPES], configData,
        );

        const currency: string = params[0];
        const startBlock: bigint = params[3];
        const endBlock: bigint = params[4];
        const floorPrice: bigint = params[8];
        const requiredRaise: bigint = params[9];

        // Token metadata
        const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        const [name, symbol, decimals] = await Promise.all([
          token.name().catch(() => 'Unknown'),
          token.symbol().catch(() => '???'),
          token.decimals().catch(() => 18),
        ]);

        // Currency metadata
        const isNative = currency === ethers.ZeroAddress;
        let currencySymbol = 'ETH';
        let currencyDecimals = 18;
        if (!isNative) {
          const known = KNOWN_CURRENCIES[currency.toLowerCase()];
          if (known) {
            currencySymbol = known;
            currencyDecimals = known === 'USDC' ? 6 : 18;
          } else {
            const cur = new ethers.Contract(currency, ERC20_ABI, provider);
            currencySymbol = await cur.symbol().catch(() => 'UNKNOWN');
            currencyDecimals = await cur.decimals().catch(() => 18);
          }
        }

        const fmt = (v: bigint, dec: number, maxDec = 4) => {
          const d = BigInt(10 ** dec);
          const whole = v / d;
          const rem = (v % d).toString().padStart(dec, '0').slice(0, maxDec).replace(/0+$/, '');
          return rem ? `${Number(whole).toLocaleString('en-US')}.${rem}` : Number(whole).toLocaleString('en-US');
        };

        const blockDiff = Number(endBlock - startBlock);
        const seconds = blockDiff * config.blockTime;
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const duration = days > 0 ? (hours > 0 ? `~${days}d ${hours}h` : `~${days}d`) : `~${hours}h`;

        const explorer = config.blockExplorer;

        console.log('');
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`  $${symbol} — ${name}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`  Chain             ${config.name}`);
        console.log(`  Token             ${tokenAddress}`);
        console.log(`  Auction           ${ethers.getAddress(address)}`);
        console.log(`  Currency          ${currencySymbol}${isNative ? '' : ` (${currency})`}`);
        console.log(`  Supply for Sale   ${fmt(amount, Number(decimals), 0)} ${symbol}`);
        console.log(`  Floor Price       ${fmt(floorPrice, currencyDecimals, 6)} ${currencySymbol}`);
        console.log(`  Graduation        ${fmt(requiredRaise, currencyDecimals, 2)} ${currencySymbol}`);
        console.log(`  Duration          ${duration} (blocks ${startBlock} → ${endBlock})`);
        console.log(`  Tx                ${log.transactionHash}`);
        console.log(`  Explorer          ${explorer}/address/${ethers.getAddress(address)}`);
        console.log(`  Uniswap           https://app.uniswap.org/explore/auctions`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        found = true;
        break;
      }
    }

    if (!found) {
      console.log(`  Contract found on ${config.name} but no AuctionCreated event in the last ${maxLookback} blocks.`);
    }
    return;
  }

  console.error(`No contract found at ${address} on any monitored chain.`);
  process.exit(1);
}

findAuction(ethers.getAddress(auctionAddress)).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
