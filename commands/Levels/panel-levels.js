/**
 * /panel-levels
 * Full interactive panel for the level system.
 *
 * Fixes applied:
 *  1. Removed the stray `modalCollector` (was a MessageComponentCollector
 *     incorrectly used for modals — caused ghost acknowledgements).
 *  2. Modal handler now calls `modal.deferUpdate()` before doing anything,
 *     so Discord gets an immediate acknowledgement and we can't race with
 *     handlePanelInteraction or any other listener in interactionCreate.js.
 *  3. All modal reply calls changed to `modal.followUp()` after the deferUpdate,
 *     which is the correct pattern once an interaction is deferred.
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');

const {
  getSettings, updateSettings,
  getLevelDefinitions, setLevelDefinition, deleteLevelDefinition,
} = require('../../utils/levelStore');

// ── helpers ───────────────────────────────────────────────────────────────────

function overviewEmbed(guildId) {
  const s    = getSettings(guildId);
  const defs = getLevelDefinitions(guildId);

  const xpSection = [
    `**System Status:** ${s.enabled !== false ? '🟢 **ON**' : '🔴 **OFF**'}`,
    `**Message XP:** ${s.xpPerMessage.min}–${s.xpPerMessage.max} (random per message)`,
    `**Cooldown:** ${s.cooldownMs / 1000}s between message XP grants`,
    `**Voice XP:** ${s.xpPerVoiceMin} XP/min`,
    `**Reaction XP:** ${s.xpPerReaction} XP`,
    `**Command XP:** ${s.xpPerCommand} XP`,
  ].join('\n');

  const notifySection = [
    `**DM on level-up:** ${s.notifyDM ? '✅' : '❌'}`,
    `**Same channel:** ${s.notifySameChannel ? '✅' : '❌'}`,
    `**Dedicated channel:** ${s.notifyDedicatedChannel ? `✅ <#${s.notifyChannel}>` : '❌'}`,
  ].join('\n');

  const levelSection = defs.length
    ? defs.map(d =>
        `**Lv ${d.level}** — ${d.name} · ${d.xpRequired.toLocaleString()} XP${d.roleId ? ` · <@&${d.roleId}>` : ''}`
      ).join('\n')
    : '*No levels defined.*';

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('⚙️  Level System — Overview')
    .addFields(
      { name: '📈 XP Settings',       value: xpSection,     inline: false },
      { name: '🔔 Notifications',     value: notifySection, inline: false },
      { name: '🏆 Level Definitions', value: levelSection,  inline: false },
    )
    .setTimestamp();
}

function mainMenuRow(guildId) {
  const s = getSettings(guildId);
  const enabled = s.enabled !== false;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('lp_xp_settings').setLabel('XP Settings').setStyle(ButtonStyle.Primary).setEmoji('📈'),
    new ButtonBuilder().setCustomId('lp_levels').setLabel('Level Manager').setStyle(ButtonStyle.Primary).setEmoji('🏆'),
    new ButtonBuilder().setCustomId('lp_notify').setLabel('Notifications').setStyle(ButtonStyle.Primary).setEmoji('🔔'),
    new ButtonBuilder().setCustomId('lp_toggle_enabled').setLabel(enabled ? 'Turn OFF Level System' : 'Turn ON Level System').setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success).setEmoji('⏻'),
    new ButtonBuilder().setCustomId('lp_overview').setLabel('Refresh').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
  );
}

// ── command ───────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel-levels')
    .setDescription('(Mod) Manage the level and XP system.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    await interaction.reply({
      embeds:     [overviewEmbed(guildId)],
      components: [mainMenuRow(guildId)],
      ephemeral:  true,
    });

    // ── Button / select-menu collector ────────────────────────────────────────
    const collector = interaction.channel.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      time:   10 * 60 * 1000,  // 10 min session
    });

    collector.on('collect', async i => {
      // ── OVERVIEW ────────────────────────────────────────────────────────────
      if (i.customId === 'lp_overview') {
        return i.update({ embeds: [overviewEmbed(guildId)], components: [mainMenuRow(guildId)] });
      }

      // ── MASTER ON/OFF ───────────────────────────────────────────────────────
      if (i.customId === 'lp_toggle_enabled') {
        const s = getSettings(guildId);
        const enabled = s.enabled === false; // toggle (legacy data without the field -> ON)
        updateSettings(guildId, { enabled });
        return i.update({ embeds: [overviewEmbed(guildId)], components: [mainMenuRow(guildId)] });
      }

      // ────────────────────────────────────────────────────────────────────────
      //  ① XP SETTINGS
      // ────────────────────────────────────────────────────────────────────────
      if (i.customId === 'lp_xp_settings') {
        const s = getSettings(guildId);
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('📈 XP Settings')
          .setDescription('Use the buttons below to change each value.')
          .addFields(
            { name: 'Message XP Range', value: `${s.xpPerMessage.min}–${s.xpPerMessage.max}`, inline: true },
            { name: 'Cooldown',         value: `${s.cooldownMs / 1000}s`,                       inline: true },
            { name: 'Voice XP / min',   value: `${s.xpPerVoiceMin}`,                            inline: true },
            { name: 'Reaction XP',      value: `${s.xpPerReaction}`,                            inline: true },
            { name: 'Command XP',       value: `${s.xpPerCommand}`,                             inline: true },
          );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('lp_edit_msg_xp').setLabel('Message XP').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('lp_edit_cooldown').setLabel('Cooldown').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('lp_edit_voice_xp').setLabel('Voice XP').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('lp_edit_react_xp').setLabel('Reaction XP').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('lp_back').setLabel('Back').setStyle(ButtonStyle.Danger),
        );

        return i.update({ embeds: [embed], components: [row] });
      }

      // Edit message XP range
      if (i.customId === 'lp_edit_msg_xp') {
        const modal = new ModalBuilder().setCustomId('modal_msg_xp').setTitle('Set Message XP Range');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('min_xp').setLabel('Minimum XP per message').setStyle(TextInputStyle.Short)
              .setRequired(true).setValue(String(getSettings(guildId).xpPerMessage.min))
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('max_xp').setLabel('Maximum XP per message').setStyle(TextInputStyle.Short)
              .setRequired(true).setValue(String(getSettings(guildId).xpPerMessage.max))
          ),
        );
        return i.showModal(modal);
      }

      // Edit cooldown
      if (i.customId === 'lp_edit_cooldown') {
        const modal = new ModalBuilder().setCustomId('modal_cooldown').setTitle('Set XP Cooldown');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('cooldown_sec').setLabel('Cooldown in seconds').setStyle(TextInputStyle.Short)
              .setRequired(true).setValue(String(getSettings(guildId).cooldownMs / 1000))
          ),
        );
        return i.showModal(modal);
      }

      // Edit voice XP
      if (i.customId === 'lp_edit_voice_xp') {
        const modal = new ModalBuilder().setCustomId('modal_voice_xp').setTitle('Set Voice XP per Minute');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('voice_xp').setLabel('XP per minute in voice').setStyle(TextInputStyle.Short)
              .setRequired(true).setValue(String(getSettings(guildId).xpPerVoiceMin))
          ),
        );
        return i.showModal(modal);
      }

      // Edit reaction XP
      if (i.customId === 'lp_edit_react_xp') {
        const modal = new ModalBuilder().setCustomId('modal_react_xp').setTitle('Set Reaction & Command XP');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('react_xp').setLabel('XP per reaction').setStyle(TextInputStyle.Short)
              .setRequired(true).setValue(String(getSettings(guildId).xpPerReaction))
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('cmd_xp').setLabel('XP per slash command used').setStyle(TextInputStyle.Short)
              .setRequired(true).setValue(String(getSettings(guildId).xpPerCommand))
          ),
        );
        return i.showModal(modal);
      }

      // ────────────────────────────────────────────────────────────────────────
      //  ② LEVEL MANAGER
      // ────────────────────────────────────────────────────────────────────────
      if (i.customId === 'lp_levels') {
        const defs = getLevelDefinitions(guildId);
        const embed = new EmbedBuilder()
          .setColor(0xf5a623)
          .setTitle('🏆 Level Manager')
          .setDescription(
            defs.length
              ? defs.map(d => `**Lv ${d.level}** — ${d.name} · ${d.xpRequired.toLocaleString()} XP${d.roleId ? ` · <@&${d.roleId}>` : ''}`).join('\n')
              : '*No levels defined yet. Add one below.*'
          );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('lp_add_level').setLabel('Add Level').setStyle(ButtonStyle.Success).setEmoji('➕'),
          new ButtonBuilder().setCustomId('lp_edit_level').setLabel('Edit Level').setStyle(ButtonStyle.Secondary).setEmoji('✏️').setDisabled(!defs.length),
          new ButtonBuilder().setCustomId('lp_delete_level').setLabel('Delete Level').setStyle(ButtonStyle.Danger).setEmoji('🗑️').setDisabled(!defs.length),
          new ButtonBuilder().setCustomId('lp_back').setLabel('Back').setStyle(ButtonStyle.Danger),
        );

        return i.update({ embeds: [embed], components: [row] });
      }

      // Add level
      if (i.customId === 'lp_add_level') {
        const modal = new ModalBuilder().setCustomId('modal_add_level').setTitle('Add New Level');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('lvl_num').setLabel('Level number (e.g. 5)').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('lvl_name').setLabel('Level name (e.g. Elite)').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('lvl_xp').setLabel('XP required to reach this level').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('lvl_role').setLabel('Role ID to assign (leave blank for none)').setStyle(TextInputStyle.Short).setRequired(false)
          ),
        );
        return i.showModal(modal);
      }

      // Edit level — show select menu of existing levels
      if (i.customId === 'lp_edit_level') {
        const defs = getLevelDefinitions(guildId);
        const select = new StringSelectMenuBuilder()
          .setCustomId('lp_select_edit_level')
          .setPlaceholder('Choose a level to edit')
          .addOptions(defs.map(d => ({ label: `Lv ${d.level} — ${d.name}`, value: String(d.level) })));
        return i.update({
          embeds:     [new EmbedBuilder().setColor(0x5865f2).setTitle('Choose a level to edit')],
          components: [new ActionRowBuilder().addComponents(select)],
        });
      }

      if (i.customId === 'lp_select_edit_level') {
        const level = parseInt(i.values[0]);
        const defs  = getLevelDefinitions(guildId);
        const def   = defs.find(d => d.level === level);

        const modal = new ModalBuilder().setCustomId(`modal_edit_level_${level}`).setTitle(`Edit Level ${level}`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('lvl_name').setLabel('Level name').setStyle(TextInputStyle.Short)
              .setRequired(true).setValue(def.name)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('lvl_xp').setLabel('XP required').setStyle(TextInputStyle.Short)
              .setRequired(true).setValue(String(def.xpRequired))
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('lvl_role').setLabel('Role ID (blank = none)').setStyle(TextInputStyle.Short)
              .setRequired(false).setValue(def.roleId ?? '')
          ),
        );
        return i.showModal(modal);
      }

      // Delete level — show select menu
      if (i.customId === 'lp_delete_level') {
        const defs = getLevelDefinitions(guildId);
        const select = new StringSelectMenuBuilder()
          .setCustomId('lp_select_delete_level')
          .setPlaceholder('Choose a level to delete')
          .addOptions(defs.map(d => ({ label: `Lv ${d.level} — ${d.name}`, value: String(d.level) })));
        return i.update({
          embeds:     [new EmbedBuilder().setColor(0xed4245).setTitle('Choose a level to delete')],
          components: [new ActionRowBuilder().addComponents(select)],
        });
      }

      if (i.customId === 'lp_select_delete_level') {
        const level = parseInt(i.values[0]);
        deleteLevelDefinition(guildId, level);
        return i.update({
          embeds:     [new EmbedBuilder().setColor(0x57f287).setTitle(`✅ Level ${level} deleted.`)],
          components: [mainMenuRow(guildId)],
        });
      }

      // ────────────────────────────────────────────────────────────────────────
      //  ③ NOTIFICATIONS
      // ────────────────────────────────────────────────────────────────────────
      if (i.customId === 'lp_notify') {
        const s = getSettings(guildId);
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🔔 Notification Settings')
          .addFields(
            { name: 'DM on level-up',   value: s.notifyDM               ? '✅ On' : '❌ Off', inline: true },
            { name: 'Same channel',      value: s.notifySameChannel      ? '✅ On' : '❌ Off', inline: true },
            { name: 'Dedicated channel', value: s.notifyDedicatedChannel ? `✅ <#${s.notifyChannel}>` : '❌ Off', inline: true },
          );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('lp_toggle_dm').setLabel(`DM: ${s.notifyDM ? 'ON' : 'OFF'}`).setStyle(s.notifyDM ? ButtonStyle.Success : ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('lp_toggle_same').setLabel(`Same Channel: ${s.notifySameChannel ? 'ON' : 'OFF'}`).setStyle(s.notifySameChannel ? ButtonStyle.Success : ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('lp_set_notify_ch').setLabel('Set Dedicated Channel').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('lp_back').setLabel('Back').setStyle(ButtonStyle.Danger),
        );

        return i.update({ embeds: [embed], components: [row] });
      }

      if (i.customId === 'lp_toggle_dm') {
        const s = getSettings(guildId);
        updateSettings(guildId, { notifyDM: !s.notifyDM });
        return i.update({
          embeds: [new EmbedBuilder().setColor(0x57f287).setDescription(`DM notifications: **${!s.notifyDM ? 'ON' : 'OFF'}**`)],
          components: [mainMenuRow(guildId)],
        });
      }

      if (i.customId === 'lp_toggle_same') {
        const s = getSettings(guildId);
        updateSettings(guildId, { notifySameChannel: !s.notifySameChannel });
        return i.update({
          embeds: [new EmbedBuilder().setColor(0x57f287).setDescription(`Same-channel notifications: **${!s.notifySameChannel ? 'ON' : 'OFF'}**`)],
          components: [mainMenuRow(guildId)],
        });
      }

      if (i.customId === 'lp_set_notify_ch') {
        const modal = new ModalBuilder().setCustomId('modal_notify_ch').setTitle('Set Level-Up Notification Channel');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('channel_id').setLabel('Channel ID (paste the channel\'s ID)').setStyle(TextInputStyle.Short).setRequired(true)
          ),
        );
        return i.showModal(modal);
      }

      // ── BACK ────────────────────────────────────────────────────────────────
      if (i.customId === 'lp_back') {
        return i.update({ embeds: [overviewEmbed(guildId)], components: [mainMenuRow(guildId)] });
      }
    });

    // ── Modal submissions ─────────────────────────────────────────────────────
    // FIX: The old code had a stray createMessageComponentCollector for modals
    // (wrong collector type — modals are not message components). Removed it.
    //
    // FIX: Each modal handler now calls deferUpdate() first. This immediately
    // acknowledges the interaction with Discord so no other listener can race
    // to reply first. All follow-up messages use followUp() instead of reply().

    const modalHandler = async modal => {
      if (!modal.isModalSubmit()) return;
      if (modal.user.id !== interaction.user.id) return;

      // Only handle modals that belong to this panel session.
      const knownModals = [
        'modal_msg_xp', 'modal_cooldown', 'modal_voice_xp', 'modal_react_xp',
        'modal_add_level', 'modal_notify_ch',
      ];
      const id = modal.customId;
      const isKnown = knownModals.includes(id) || id.startsWith('modal_edit_level_');
      if (!isKnown) return;

      // Acknowledge immediately — prevents any other listener from racing us.
      await modal.deferUpdate();

      // ── Message XP range ──────────────────────────────────────────────────
      if (id === 'modal_msg_xp') {
        const min = parseInt(modal.fields.getTextInputValue('min_xp'));
        const max = parseInt(modal.fields.getTextInputValue('max_xp'));
        if (isNaN(min) || isNaN(max) || min < 0 || max < min) {
          return modal.followUp({ content: '❌ Invalid range. Min must be ≥ 0 and max ≥ min.', ephemeral: true });
        }
        updateSettings(guildId, { xpPerMessage: { min, max } });
        return modal.followUp({ content: `✅ Message XP range set to **${min}–${max}**.`, ephemeral: true });
      }

      // ── Cooldown ──────────────────────────────────────────────────────────
      if (id === 'modal_cooldown') {
        const sec = parseInt(modal.fields.getTextInputValue('cooldown_sec'));
        if (isNaN(sec) || sec < 0) return modal.followUp({ content: '❌ Enter a valid number ≥ 0.', ephemeral: true });
        updateSettings(guildId, { cooldownMs: sec * 1000 });
        return modal.followUp({ content: `✅ XP cooldown set to **${sec}s**.`, ephemeral: true });
      }

      // ── Voice XP ──────────────────────────────────────────────────────────
      if (id === 'modal_voice_xp') {
        const xp = parseInt(modal.fields.getTextInputValue('voice_xp'));
        if (isNaN(xp) || xp < 0) return modal.followUp({ content: '❌ Enter a valid number ≥ 0.', ephemeral: true });
        updateSettings(guildId, { xpPerVoiceMin: xp });
        return modal.followUp({ content: `✅ Voice XP set to **${xp} XP/min**.`, ephemeral: true });
      }

      // ── Reaction + Command XP ─────────────────────────────────────────────
      if (id === 'modal_react_xp') {
        const react = parseInt(modal.fields.getTextInputValue('react_xp'));
        const cmd   = parseInt(modal.fields.getTextInputValue('cmd_xp'));
        if (isNaN(react) || isNaN(cmd)) return modal.followUp({ content: '❌ Enter valid numbers.', ephemeral: true });
        updateSettings(guildId, { xpPerReaction: react, xpPerCommand: cmd });
        return modal.followUp({ content: `✅ Reaction XP: **${react}** · Command XP: **${cmd}**.`, ephemeral: true });
      }

      // ── Add level ─────────────────────────────────────────────────────────
      if (id === 'modal_add_level') {
        const level = parseInt(modal.fields.getTextInputValue('lvl_num'));
        const name  = modal.fields.getTextInputValue('lvl_name').trim();
        const xp    = parseInt(modal.fields.getTextInputValue('lvl_xp'));
        const role  = modal.fields.getTextInputValue('lvl_role').trim() || null;
        if (isNaN(level) || level < 1 || isNaN(xp) || xp < 1 || !name) {
          return modal.followUp({ content: '❌ Invalid input. Level and XP must be positive numbers.', ephemeral: true });
        }
        setLevelDefinition(guildId, level, name, xp, role);
        return modal.followUp({ content: `✅ Level **${level}** — **${name}** added (${xp.toLocaleString()} XP required).`, ephemeral: true });
      }

      // ── Edit level ────────────────────────────────────────────────────────
      if (id.startsWith('modal_edit_level_')) {
        const level = parseInt(id.replace('modal_edit_level_', ''));
        const name  = modal.fields.getTextInputValue('lvl_name').trim();
        const xp    = parseInt(modal.fields.getTextInputValue('lvl_xp'));
        const role  = modal.fields.getTextInputValue('lvl_role').trim() || null;
        if (isNaN(xp) || xp < 1 || !name) return modal.followUp({ content: '❌ Invalid input.', ephemeral: true });
        setLevelDefinition(guildId, level, name, xp, role);
        return modal.followUp({ content: `✅ Level **${level}** updated.`, ephemeral: true });
      }

      // ── Set dedicated notify channel ──────────────────────────────────────
      if (id === 'modal_notify_ch') {
        const channelId = modal.fields.getTextInputValue('channel_id').trim();
        const ch = modal.guild.channels.cache.get(channelId);
        if (!ch) return modal.followUp({ content: '❌ Channel not found. Make sure you paste the Channel ID, not the name.', ephemeral: true });
        updateSettings(guildId, { notifyChannel: channelId, notifyDedicatedChannel: true });
        return modal.followUp({ content: `✅ Level-up notifications will be sent to <#${channelId}>.`, ephemeral: true });
      }
    };

    interaction.client.on('interactionCreate', modalHandler);

    collector.on('end', () => {
      interaction.client.off('interactionCreate', modalHandler);
    });
  },
};
