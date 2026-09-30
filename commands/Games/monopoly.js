const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { PREMIUM_COLORS } = require('../../utils/theme');
const { createRoom, roomLinkFromCode } = require('../../utils/aspalRoom');

// Accepts either a full http(s) link (an aspal.io room) or a bare room id
// like `4J8S22`, which gets expanded into https://aspal.io/room/<id>.
// Returns a URL string, or null if the input doesn't look valid.
function parseGameLink(raw) {
  const input = (raw || '').trim();
  if (!input) return null;

  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  if (/^[a-zA-Z0-9-]{1,32}$/.test(input)) {
    return roomLinkFromCode(input);
  }

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('monopoly')
    .setDescription('Create a private Monopoly room on Aspal.io and get a join link for your server')
    .addStringOption((opt) => opt
      .setName('room')
      .setDescription('Pin an existing room by id or link (e.g. 4J8S22)')),

  async execute(interaction) {
    const roomRaw = interaction.options.getString('room');
    const hostId = interaction.user.id;

    // Pinning an existing room — no game API needed.
    if (roomRaw && roomRaw.trim()) {
      const link = parseGameLink(roomRaw);
      if (!link) {
        return interaction.reply({
          content: '❌ That doesn\'t look like a valid room id or link. Paste an aspal.io room link (e.g. `https://aspal.io/room/4J8S22`) or a bare id (e.g. `4J8S22`).',
          flags: MessageFlags.Ephemeral,
        });
      }

      const embed = new EmbedBuilder()
        .setColor(PREMIUM_COLORS.success)
        .setTitle('🎲 Monopoly Night!')
        .setDescription(`**Host: <@${hostId}>** pinned a room.\nTap the button below to jump in and play!`)
        .addFields(
          { name: '🗺️ Pick a map', value: 'Classic, world cities, custom maps & special game modes are all available in the lobby.' },
          { name: '🎲 How to play', value: 'Buy cities, build districts, play action cards and bankrupt your rivals!' },
        )
        .setFooter({ text: 'Aspal.io · free browser game — play with friends, no account needed' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('▶️ Join the Room')
          .setStyle(ButtonStyle.Link)
          .setURL(link),
      );

      await interaction.reply({ embeds: [embed], components: [row] });

      return interaction.followUp({
        content: `✅ Join button posted — it opens the room directly. Share it so friends can jump in. (<@${hostId}>, you're hosting 🎲)`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // No room given — create a fresh private room automatically.
    await interaction.deferReply();

    let room;
    try {
      room = await createRoom();
    } catch (err) {
      const message = err && err.message === 'captcha-required'
        ? '⚠️ Aspal.io is asking for a CAPTCHA on this server\'s connection right now — try again in a few minutes.'
        : `⚠️ Failed to create a room on Aspal.io: \`${err?.message || err}\`.`;
      return interaction.editReply({ content: message });
    }

    const embed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.success)
      .setTitle('🎲 Monopoly Night!')
      .setDescription(`**<@${hostId}>** created a private room.\nTap the button below to join — **the first player in becomes the host** and can start the game!`)
      .addFields(
        { name: '🗺️ Pick a map', value: 'Classic, world cities, custom maps & special game modes are all available in the lobby.' },
        { name: '🎲 How to play', value: 'Buy cities, build districts, play action cards and bankrupt your rivals!' },
        { name: '💡 Tip', value: `Room id: \`${room.roomId}\`. Want to pin a specific room later? Run \`/monopoly room:\` with its id or link.` },
      )
      .setFooter({ text: 'Aspal.io · free browser game — play with friends, no account needed' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('▶️ Join the Room')
        .setStyle(ButtonStyle.Link)
        .setURL(room.link),
    );

    return interaction.editReply({ embeds: [embed], components: [row] });
  },
};