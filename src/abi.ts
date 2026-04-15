// Exact ABI from https://github.com/Uniswap/continuous-clearing-auction

export const CCA_FACTORY_ABI = [
  // initializeDistribution deploys a new CCA and emits AuctionCreated
  {
    type: 'function',
    name: 'initializeDistribution',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'configData', type: 'bytes' },
    ],
    outputs: [{ name: 'auction', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  // AuctionCreated(address indexed auction, address indexed token, uint256 amount, bytes configData)
  // configData = abi.encode(AuctionParameters)
  {
    type: 'event',
    name: 'AuctionCreated',
    inputs: [
      { name: 'auction', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'configData', type: 'bytes', indexed: false },
    ],
  },
] as const;

// AuctionParameters struct — ABI-encoded in the configData field of AuctionCreated
// struct AuctionParameters {
//   address currency;
//   address tokensRecipient;
//   address fundsRecipient;
//   uint64 startBlock;
//   uint64 endBlock;
//   uint64 claimBlock;
//   uint256 tickSpacing;
//   address validationHook;
//   uint256 floorPrice;
//   uint128 requiredCurrencyRaised;
//   bytes auctionStepsData;
// }
export const AUCTION_PARAMETERS_ABI_TYPES = [
  'address', // currency
  'address', // tokensRecipient
  'address', // fundsRecipient
  'uint64',  // startBlock
  'uint64',  // endBlock
  'uint64',  // claimBlock
  'uint256', // tickSpacing
  'address', // validationHook
  'uint256', // floorPrice
  'uint128', // requiredCurrencyRaised
  'bytes',   // auctionStepsData
] as const;

// View functions on the deployed CCA auction contract
export const CCA_AUCTION_ABI = [
  { type: 'function', name: 'token', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'currency', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'totalSupply', inputs: [], outputs: [{ type: 'uint128' }], stateMutability: 'view' },
  { type: 'function', name: 'startBlock', inputs: [], outputs: [{ type: 'uint64' }], stateMutability: 'view' },
  { type: 'function', name: 'endBlock', inputs: [], outputs: [{ type: 'uint64' }], stateMutability: 'view' },
  { type: 'function', name: 'floorPrice', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'requiredCurrencyRaised', inputs: [], outputs: [{ type: 'uint128' }], stateMutability: 'view' },
  // Q96 fixed-point clearing price (currency per token × 2^96)
  { type: 'function', name: 'clearingPrice', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  // Total currency committed so far (human-readable)
  { type: 'function', name: 'currencyRaised', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  // Total tokens cleared/sold so far
  { type: 'function', name: 'totalCleared', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const;

export const ERC20_ABI = [
  { type: 'function', name: 'name', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'symbol', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
  { type: 'function', name: 'totalSupply', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const;
