import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
} from 'discord.js';
import { ethers } from 'ethers';
import { CHAINS, KNOWN_CURRENCIES } from './chains.js';
import { CCA_AUCTION_ABI, ERC20_ABI } from './abi.js';
import { AuctionInfo } from './types.js';

const AUCTION_CREATED_TOPIC = ethers.id('AuctionCreated(address,address,uint256,bytes)');
const ORANGE = 0xff6b2c;
const UNISWAP_AUCTIONS_URL = 'https://app.uniswap.org/explore/auctions';

const COMMAND = new SlashCommandBuilder()
  .setName('auction')
  .setDescription('Get info about a Uniswap CCA auction')
  .addStringOption((opt) =>
    opt.setName('address').setDescription('Auction contract address').setRequired(true),
  )
  .toJSON();

let discordClient: Client | null = null;

export function startBot(): void {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.log('[Bot] DISCORD_BOT_TOKEN not set — skipping bot startup');
    return;
  }

  const clientId = Buffer.from(token.split('.')[0], 'base64').toString('utf-8');
  const guildId = process.env.DISCORD_GUILD_ID;
  const rest = new REST().setToken(token);

  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  rest
    .put(route, { body: [COMMAND] })
    .then(() => console.log(`[Bot] /auction registered (${guildId ? 'guild' : 'global'})`))
    .catch((err) => console.error('[Bot] Failed to register command:', err.message));

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  discordClient = client;

  client.once('ready', () => {
    console.log(`[Bot] Logged in as ${client.user?.tag}`);
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'auction') return;

    const raw = (interaction as ChatInputCommandInteraction).options.getString('address', true);

    if (!ethers.isAddress(raw)) {
      await interaction.reply({ content: '❌ Invalid address.', ephemeral: true });
      return;
    }

    await interaction.deferReply();
    const address = ethers.getAddress(raw);

    try {
      const result = await findAuction(address);
      if (!result) {
        await interaction.editReply(`❌ No auction found for \`${address}\` on any monitored chain.`);
        return;
      }
      await interaction.editReply({ embeds: [buildEmbed(result, address)] });
    } catch (err) {
      console.error('[Bot] Error handling /auction:', err);
      await interaction.editReply('❌ An error occurred while fetching auction data.');
    }
  });

  client.login(token).catch((err) => {
    console.error('[Bot] Failed to login:', err.message);
  });
}

export async function sendAuctionAlert(auction: AuctionInfo): Promise<void> {
  const channelId = process.env.DISCORD_CHANNEL_ID;
  if (!channelId) {
    console.error('[Bot] DISCORD_CHANNEL_ID not set — skipping alert');
    return;
  }
  if (!discordClient?.isReady()) {
    console.error('[Bot] Client not ready — skipping alert');
    return;
  }

  const chain = CHAINS[auction.chain];
  const explorer = chain?.blockExplorer ?? 'https://etherscan.io';

  const embed = new EmbedBuilder()
    .setTitle(`🔔 New CCA Auction: $${auction.tokenSymbol} — ${auction.tokenName}`)
    .setURL(UNISWAP_AUCTIONS_URL)
    .setColor(ORANGE)
    .addFields(
      { name: '🔗 Chain', value: chain?.name ?? auction.chain, inline: true },
      { name: '💰 Token', value: `[$${auction.tokenSymbol}](${explorer}/address/${auction.tokenAddress})`, inline: true },
      { name: '💵 Currency', value: auction.currencySymbol, inline: true },
      { name: '📦 Supply', value: `${fmt(auction.totalSupply, auction.tokenDecimals, 0)} ${auction.tokenSymbol}`, inline: true },
      { name: '🏷️ Floor Price', value: `${fmt(auction.floorPrice, auction.currencyDecimals, 6)} ${auction.currencySymbol}`, inline: true },
      { name: '⏰ Duration', value: estimateDuration(auction.startBlock, auction.endBlock, chain?.blockTime ?? 12), inline: true },
      { name: '🎓 Graduation', value: `${fmt(auction.requiredCurrencyRaised, auction.currencyDecimals, 2)} ${auction.currencySymbol}`, inline: true },
      {
        name: '🔗 Links',
        value: `[View Auction](${UNISWAP_AUCTIONS_URL}) • [Contract](${explorer}/address/${auction.auctionAddress}) • [Tx](${explorer}/tx/${auction.txHash})`,
        inline: false,
      },
    )
    .setFooter({ text: 'Uniswap CCA Monitor' })
    .setTimestamp(new Date(auction.timestamp * 1000));

  const channel = await discordClient.channels.fetch(channelId);
  if (!channel || !(channel instanceof TextChannel)) {
    console.error('[Bot] Channel not found or not a text channel');
    return;
  }

  await channel.send({ content: `New Uniswap CCA Auction detected on **${chain?.name ?? auction.chain}**!`, embeds: [embed] });
  console.log(`[Bot] Alert sent for $${auction.tokenSymbol} on ${chain?.name}`);
}

export async function sendAuctionAlertWithRetry(auction: AuctionInfo, retries = 3): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await sendAuctionAlert(auction);
      return;
    } catch (err) {
      console.error(`[Bot] Alert attempt ${i + 1}/${retries} failed:`, err);
      if (i < retries - 1) await sleep(2000 * (i + 1));
    }
  }
}

// ── /auction lookup helpers ────────────────────────────────────────────────

function buildEmbed(result: Awaited<ReturnType<typeof findAuction>> & {}, address: string): EmbedBuilder {
  const { info, chainConfig } = result!;
  const explorer = chainConfig.blockExplorer;

  // FDV = clearingPrice (Q96) * tokenTotalSupply / (2^96 * 10^currencyDecimals)
  const Q96 = 2n ** 96n;
  const fdvRaw = info.clearingPrice * info.tokenTotalSupply / Q96;
  const fdv = fmt(fdvRaw, info.currencyDecimals, 2);

  // Bid concentrated at = clearingPrice (Q96) per token, adjusted for decimals
  const pricePerToken = info.clearingPrice * BigInt(10 ** info.tokenDecimals) / Q96;
  const bidAt = fmt(pricePerToken, info.currencyDecimals, 6);

  // Days left
  const blocksLeft = Math.max(0, Number(info.endBlock) - info.currentBlock);
  const secsLeft = blocksLeft * info.blockTime;
  const daysLeft = Math.floor(secsLeft / 86400);
  const hoursLeft = Math.floor((secsLeft % 86400) / 3600);
  const daysLeftStr = daysLeft > 0
    ? (hoursLeft > 0 ? `${daysLeft}d ${hoursLeft}h` : `${daysLeft}d`)
    : `${hoursLeft}h`;

  return new EmbedBuilder()
    .setTitle(`$${info.symbol}`)
    .setURL(`${UNISWAP_AUCTIONS_URL}`)
    .setColor(ORANGE)
    .addFields(
      { name: '⛓️ Chain', value: chainConfig.name, inline: true },
      { name: '📈 Current FDV', value: `${fdv} ${info.currencySymbol}`, inline: true },
      { name: '💰 Committed Volume', value: `${fmt(info.currencyRaised, info.currencyDecimals, 2)} ${info.currencySymbol}`, inline: true },
      { name: '🎯 Bid Concentrated At', value: `${bidAt} ${info.currencySymbol}`, inline: true },
      { name: '🪙 Auction Supply', value: `${fmt(info.auctionSupply, info.tokenDecimals, 0)} ${info.symbol}`, inline: true },
      { name: '📊 Total Supply', value: `${fmt(info.tokenTotalSupply, info.tokenDecimals, 0)} ${info.symbol}`, inline: true },
      { name: '💧 Committed to LP', value: `${fmt(info.currencyRaised, info.currencyDecimals, 2)} ${info.currencySymbol}`, inline: true },
      { name: '⏳ Days Left', value: daysLeftStr, inline: true },
      { name: '📄 Contract', value: `[${address.slice(0, 6)}...${address.slice(-4)}](${explorer}/address/${address})`, inline: true },
    )
    .setFooter({ text: 'Uniswap CCA Monitor' })
    .setTimestamp();
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

function fmt(v: bigint, dec: number, maxDec = 4): string {
  const d = BigInt(10 ** dec);
  const whole = v / d;
  const rem = (v % d).toString().padStart(dec, '0').slice(0, maxDec).replace(/0+$/, '');
  return rem ? `${Number(whole).toLocaleString('en-US')}.${rem}` : Number(whole).toLocaleString('en-US');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface AuctionData {
  symbol: string;
  tokenAddress: string;
  tokenDecimals: number;
  tokenTotalSupply: bigint;       // ERC20 total supply
  auctionSupply: bigint;          // tokens being auctioned
  currencySymbol: string;
  currencyDecimals: number;
  clearingPrice: bigint;          // Q96 fixed-point
  currencyRaised: bigint;
  requiredRaise: bigint;
  endBlock: bigint;
  currentBlock: number;
  blockTime: number;
}

// Read auction data directly from the contract — no log scanning needed
async function findAuction(
  address: string,
): Promise<{ info: AuctionData; chainConfig: (typeof CHAINS)[string] } | null> {
  for (const [, config] of Object.entries(CHAINS)) {
    const provider = new ethers.JsonRpcProvider(config.rpc);

    try {
      const code = await provider.getCode(address);
      if (code === '0x') continue;
    } catch { continue; }

    try {
      const auction = new ethers.Contract(address, CCA_AUCTION_ABI, provider);

      const [tokenAddress, currency, auctionSupply, endBlock, clearingPrice, currencyRaised, requiredRaise, currentBlock] =
        await Promise.all([
          auction.token().catch(() => null),
          auction.currency().catch(() => ethers.ZeroAddress),
          auction.totalSupply().catch(() => 0n),
          auction.endBlock().catch(() => 0n),
          auction.clearingPrice().catch(() => 0n),
          auction.currencyRaised().catch(() => 0n),
          auction.requiredCurrencyRaised().catch(() => 0n),
          provider.getBlockNumber(),
        ]);

      if (!tokenAddress || !ethers.isAddress(tokenAddress)) continue;

      const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const [symbol, tokenDecimals, tokenTotalSupply] = await Promise.all([
        token.symbol().catch(() => '???'),
        token.decimals().catch(() => 18),
        token.totalSupply().catch(() => 0n),
      ]);

      const isNative = !currency || currency === ethers.ZeroAddress;
      let currencySymbol = 'ETH', currencyDecimals = 18;
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

      return {
        info: {
          symbol,
          tokenAddress: ethers.getAddress(tokenAddress),
          tokenDecimals: Number(tokenDecimals),
          tokenTotalSupply,
          auctionSupply,
          currencySymbol, currencyDecimals,
          clearingPrice,
          currencyRaised,
          requiredRaise,
          endBlock,
          currentBlock,
          blockTime: config.blockTime,
        },
        chainConfig: config,
      };
    } catch { continue; }
  }
  return null;
}
