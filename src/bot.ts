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
import { CHAINS, CCA_FACTORY_ADDRESS, KNOWN_CURRENCIES } from './chains.js';
import { ERC20_ABI, AUCTION_PARAMETERS_ABI_TYPES } from './abi.js';
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

  return new EmbedBuilder()
    .setTitle(`$${info.symbol} — ${info.name}`)
    .setURL(UNISWAP_AUCTIONS_URL)
    .setColor(ORANGE)
    .addFields(
      { name: '🔗 Chain', value: chainConfig.name, inline: true },
      { name: '💰 Token', value: `[$${info.symbol}](${explorer}/address/${info.tokenAddress})`, inline: true },
      { name: '💵 Currency', value: info.currencySymbol, inline: true },
      { name: '📦 Supply', value: `${fmt(info.amount, info.tokenDecimals, 0)} ${info.symbol}`, inline: true },
      { name: '🏷️ Floor Price', value: `${fmt(info.floorPrice, info.currencyDecimals, 6)} ${info.currencySymbol}`, inline: true },
      { name: '⏰ Duration', value: info.duration, inline: true },
      { name: '🎓 Graduation', value: `${fmt(info.requiredRaise, info.currencyDecimals, 2)} ${info.currencySymbol}`, inline: true },
      {
        name: '🔗 Links',
        value: `[View Auction](${UNISWAP_AUCTIONS_URL}) • [Contract](${explorer}/address/${address}) • [Tx](${explorer}/tx/${info.txHash})`,
        inline: false,
      },
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
  name: string; symbol: string; tokenAddress: string; tokenDecimals: number;
  currencySymbol: string; currencyDecimals: number;
  amount: bigint; floorPrice: bigint; requiredRaise: bigint;
  duration: string; txHash: string;
}

async function findAuction(
  address: string,
): Promise<{ info: AuctionData; chainConfig: (typeof CHAINS)[string] } | null> {
  for (const [, config] of Object.entries(CHAINS)) {
    const provider = new ethers.JsonRpcProvider(config.rpc);
    try {
      const code = await provider.getCode(address);
      if (code === '0x') continue;
    } catch { continue; }

    const latest = await provider.getBlockNumber();
    const chunkSize = config.maxBlocksPerQuery;

    for (let to = latest; to > latest - 50000; to -= chunkSize) {
      const from = Math.max(to - chunkSize + 1, 0);
      const logs = await provider.getLogs({
        address: CCA_FACTORY_ADDRESS,
        topics: [AUCTION_CREATED_TOPIC, ethers.zeroPadValue(address.toLowerCase(), 32)],
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
      }).catch(() => []);

      if (logs.length === 0) continue;

      const log = logs[0];
      const tokenAddress = ethers.getAddress('0x' + log.topics[2].slice(26));
      const [amount, configData] = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'bytes'], log.data);
      const params = ethers.AbiCoder.defaultAbiCoder().decode([...AUCTION_PARAMETERS_ABI_TYPES], configData);

      const currency: string = params[0];
      const startBlock: bigint = params[3];
      const endBlock: bigint = params[4];
      const floorPrice: bigint = params[8];
      const requiredRaise: bigint = params[9];

      const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const [name, symbol, tokenDecimals] = await Promise.all([
        token.name().catch(() => 'Unknown'),
        token.symbol().catch(() => '???'),
        token.decimals().catch(() => 18),
      ]);

      const isNative = currency === ethers.ZeroAddress;
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

      const blockDiff = Number(endBlock - startBlock);
      const seconds = blockDiff * config.blockTime;
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const duration = days > 0 ? (hours > 0 ? `~${days}d ${hours}h` : `~${days}d`) : `~${hours}h`;

      return {
        info: { name, symbol, tokenAddress, tokenDecimals: Number(tokenDecimals), currencySymbol, currencyDecimals, amount, floorPrice, requiredRaise, duration, txHash: log.transactionHash },
        chainConfig: config,
      };
    }
  }
  return null;
}
