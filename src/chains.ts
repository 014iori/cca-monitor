import { ChainConfig } from './types.js';

export const CHAINS: Record<string, ChainConfig> = {
  ethereum: {
    name: 'Ethereum',
    chainId: 1,
    rpc: process.env.ETHEREUM_RPC || 'https://eth.llamarpc.com',
    blockExplorer: 'https://etherscan.io',
    blockTime: 12,
    maxBlocksPerQuery: 10, // Alchemy free tier limit
  },
  base: {
    name: 'Base',
    chainId: 8453,
    rpc: process.env.BASE_RPC || 'https://mainnet.base.org',
    blockExplorer: 'https://basescan.org',
    blockTime: 2,
    maxBlocksPerQuery: 10, // Alchemy free tier limit
  },
  arbitrum: {
    name: 'Arbitrum',
    chainId: 42161,
    rpc: process.env.ARBITRUM_RPC || 'https://arb1.arbitrum.io/rpc',
    blockExplorer: 'https://arbiscan.io',
    blockTime: 1,
    maxBlocksPerQuery: 10, // Alchemy free tier limit
  },
  unichain: {
    name: 'Unichain',
    chainId: 130,
    rpc: process.env.UNICHAIN_RPC || 'https://mainnet.unichain.org',
    blockExplorer: 'https://uniscan.xyz',
    blockTime: 1,
    maxBlocksPerQuery: 9000,
  },
};

export const CCA_FACTORY_ADDRESS = '0xCCccCcCAE7503Cac057829BF2811De42E16e0bD5';
export const LIQUIDITY_LAUNCHER_ADDRESS = '0x00000008412db3394C91A5CbD01635c6d140637C';

// Well-known currency symbols (address -> symbol)
export const KNOWN_CURRENCIES: Record<string, string> = {
  // WETH on various chains
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH', // Ethereum
  '0x4200000000000000000000000000000000000006': 'WETH', // Base / Unichain
  '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 'WETH', // Arbitrum
  // USDC
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC', // Ethereum
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC', // Base
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC', // Arbitrum
};
