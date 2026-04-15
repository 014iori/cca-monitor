export interface ChainConfig {
  name: string;
  chainId: number;
  rpc: string;
  blockExplorer: string;
  blockTime: number; // average seconds per block
  maxBlocksPerQuery: number; // max range for eth_getLogs (varies by RPC provider)
}

export interface AuctionInfo {
  auctionAddress: string;
  chain: string;
  chainId: number;
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: number;
  currencyAddress: string;
  currencySymbol: string;
  currencyDecimals: number;
  totalSupply: bigint;
  startBlock: bigint;
  endBlock: bigint;
  floorPrice: bigint;
  requiredCurrencyRaised: bigint;
  txHash: string;
  blockNumber: bigint;
  timestamp: number;
}

export interface SeenAuction {
  chain: string;
  tokenAddress: string;
  tokenSymbol: string;
  timestamp: number;
  txHash: string;
}

export interface SeenAuctionsStore {
  [auctionAddress: string]: SeenAuction;
}
