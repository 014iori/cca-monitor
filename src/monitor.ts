import { ethers } from 'ethers';
import { ChainConfig, AuctionInfo } from './types.js';
import { CCA_FACTORY_ADDRESS, KNOWN_CURRENCIES } from './chains.js';
import { CCA_FACTORY_ABI, AUCTION_PARAMETERS_ABI_TYPES, ERC20_ABI } from './abi.js';

// How many blocks to look back on first start — kept small so we don't need dozens
// of catch-up polls on chains with tight getLogs limits (e.g. Alchemy free tier = 10 blocks)
const INITIAL_LOOKBACK_BLOCKS = 10n;

// Precomputed: keccak256("AuctionCreated(address,address,uint256,bytes)")
const AUCTION_CREATED_TOPIC = ethers.id('AuctionCreated(address,address,uint256,bytes)');

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Rate limiter: ensures we don't hammer the RPC (1 req/sec)
function createRateLimiter(minIntervalMs: number) {
  let lastCall = 0;
  return async function <T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const wait = minIntervalMs - (now - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    return fn();
  };
}

async function safeCall<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

interface RawAuctionEvent {
  auctionAddress: string;
  tokenAddress: string;
  amount: bigint;
  currency: string;
  startBlock: bigint;
  endBlock: bigint;
  floorPrice: bigint;
  requiredCurrencyRaised: bigint;
  txHash: string;
  blockNumber: bigint;
}

export class ChainMonitor {
  private provider: ethers.JsonRpcProvider;
  private chainKey: string;
  private config: ChainConfig;
  private lastBlock: bigint | null = null;
  private rateLimiter: <T>(fn: () => Promise<T>) => Promise<T>;

  constructor(chainKey: string, config: ChainConfig) {
    this.chainKey = chainKey;
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpc);
    // 1 req/sec per RPC as per spec
    this.rateLimiter = createRateLimiter(1100);
  }

  async initialize(): Promise<void> {
    const latest = await this.rateLimiter(() => this.provider.getBlockNumber());
    this.lastBlock = BigInt(latest) - INITIAL_LOOKBACK_BLOCKS;
    if (this.lastBlock < 0n) this.lastBlock = 0n;
    console.log(`[${this.tag}] Initialized. Starting from block ${this.lastBlock}`);
  }

  async poll(): Promise<RawAuctionEvent[]> {
    const latestNum = await this.rateLimiter(() => this.provider.getBlockNumber());
    const latest = BigInt(latestNum);

    if (this.lastBlock === null) {
      this.lastBlock = latest - INITIAL_LOOKBACK_BLOCKS;
    }

    if (latest <= this.lastBlock) {
      console.log(`[${this.tag}] No new blocks (latest: ${latest})`);
      return [];
    }

    const maxRange = BigInt(this.config.maxBlocksPerQuery);
    const fromBlock = this.lastBlock + 1n;
    const toBlock = latest < fromBlock + maxRange
      ? latest
      : fromBlock + maxRange - 1n;

    console.log(`[${this.tag}] Polling blocks ${fromBlock}–${toBlock}`);

    const results = await this.fetchAuctionCreatedEvents(fromBlock, toBlock);

    this.lastBlock = toBlock;
    return results;
  }

  private async fetchAuctionCreatedEvents(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<RawAuctionEvent[]> {
    const results: RawAuctionEvent[] = [];

    const logs = await this.rateLimiter(() =>
      this.provider.getLogs({
        address: CCA_FACTORY_ADDRESS,
        topics: [AUCTION_CREATED_TOPIC],
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
      }),
    );

    for (const log of logs) {
      try {
        // topic[1] = auction (indexed), topic[2] = token (indexed)
        const auctionAddress = ethers.getAddress('0x' + log.topics[1].slice(26));
        const tokenAddress = ethers.getAddress('0x' + log.topics[2].slice(26));

        // Decode non-indexed data: (uint256 amount, bytes configData)
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ['uint256', 'bytes'],
          log.data,
        );
        const amount: bigint = decoded[0];
        const configData: string = decoded[1];

        // Decode AuctionParameters from configData
        const params = ethers.AbiCoder.defaultAbiCoder().decode(
          [...AUCTION_PARAMETERS_ABI_TYPES],
          configData,
        );

        const currency: string = params[0];      // address
        const startBlock: bigint = params[3];    // uint64
        const endBlock: bigint = params[4];      // uint64
        const floorPrice: bigint = params[8];    // uint256
        const requiredCurrencyRaised: bigint = params[9]; // uint128

        results.push({
          auctionAddress,
          tokenAddress,
          amount,
          currency,
          startBlock,
          endBlock,
          floorPrice,
          requiredCurrencyRaised,
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        });

        console.log(`[${this.tag}] 🆕 AuctionCreated event: ${auctionAddress}`);
      } catch (err) {
        console.error(`[${this.tag}] Failed to decode AuctionCreated log:`, err);
      }
    }

    return results;
  }

  async fetchAuctionInfo(event: RawAuctionEvent): Promise<AuctionInfo | null> {
    try {
      // Fetch token metadata
      const token = new ethers.Contract(event.tokenAddress, ERC20_ABI, this.provider);
      const [tokenName, tokenSymbol, tokenDecimals] = await Promise.all([
        safeCall(() => token.name()),
        safeCall(() => token.symbol()),
        safeCall(() => token.decimals()),
      ]);

      // Fetch currency metadata
      let currencySymbol = 'ETH';
      let currencyDecimals = 18;

      const isNativeEth =
        event.currency === ethers.ZeroAddress ||
        event.currency === '0x0000000000000000000000000000000000000000';

      if (!isNativeEth && ethers.isAddress(event.currency)) {
        const known = KNOWN_CURRENCIES[event.currency.toLowerCase()];
        if (known) {
          currencySymbol = known;
          // WETH and ETH share decimals=18; USDC uses 6
          currencyDecimals = known === 'USDC' ? 6 : 18;
        } else {
          const currency = new ethers.Contract(event.currency, ERC20_ABI, this.provider);
          const [sym, dec] = await Promise.all([
            safeCall(() => currency.symbol()),
            safeCall(() => currency.decimals()),
          ]);
          currencySymbol = sym ?? 'UNKNOWN';
          currencyDecimals = dec ?? 18;
        }
      }

      // Get block timestamp
      const block = await this.rateLimiter(() =>
        this.provider.getBlock(Number(event.blockNumber)),
      );
      const timestamp = block?.timestamp ?? Math.floor(Date.now() / 1000);

      return {
        auctionAddress: event.auctionAddress,
        chain: this.chainKey,
        chainId: this.config.chainId,
        tokenAddress: event.tokenAddress,
        tokenName: tokenName ?? 'Unknown',
        tokenSymbol: tokenSymbol ?? '???',
        tokenDecimals: tokenDecimals ?? 18,
        currencyAddress: event.currency,
        currencySymbol,
        currencyDecimals,
        totalSupply: event.amount,
        startBlock: event.startBlock,
        endBlock: event.endBlock,
        floorPrice: event.floorPrice,
        requiredCurrencyRaised: event.requiredCurrencyRaised,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        timestamp,
      };
    } catch (err) {
      console.error(`[${this.tag}] Failed to fetch auction info for ${event.auctionAddress}:`, err);
      return null;
    }
  }

  private get tag(): string {
    return this.config.name.toUpperCase().slice(0, 4);
  }
}
