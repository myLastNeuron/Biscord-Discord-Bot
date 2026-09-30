// Auto-React handlers: autoReactWizardModal, autoReactWizard:channel, autoReactWizard:trigger,
// autoReactWizard:matchMode, autoReactWizard:allChannels, autoReactWizard:cancel,
// autoReactRuleEdit, autoReactRuleRemove, confirmRemoveAutoReact

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const autoReactStore = require('../utils/autoReactStore');
const autoReactWizardStore = require('../utils/autoReactWizardStore');
const { parseEmojiList, describeRule } = require('../utils/autoReactMatcher');
const { buildAutoReactSettingsEmbed, buildAutoReactSettingsComponents } = require('../utils/panelBuilder');
const { buildAutoReactTriggerStepEmbed, buildAutoReactTriggerStepComponents } = require('../utils/panelBuilder');
const { buildAutoReactMatchModeStepEmbed, buildAutoReactMatchModeStepComponents } = require('../utils/panelBuilder');
const { buildAutoReactChannelStepEmbed, buildAutoReactChannelStepComponents } = require('../utils/panelBuilder');
const { buildAutoReactRuleDetailEmbed, buildAutoReactRuleDetailComponents } = require('../utils/panelBuilder');
const { buildAutoReactRemoveConfirmEmbed, buildAutoReactRemoveConfirmComponents } = require('../utils/panelBuilder');
const { err } = require('../utils/logger');

const AUTOREACT_KEYWORD_TRIGGERS = new Set(['keyword', 'image_keyword']);

function match(interaction) {
  if (interaction.isModalSubmit() && interaction.customId === 'panel:autoReactWizardModal') return true;
  if (interaction.isChannelSelectMenu() && interaction.customId === 'panel:autoReactWizard:channel') return true;
  if (interaction.isStringSelectMenu() && interaction.customId === 'panel:autoReactWizard:trigger') return true;
  if (interaction.isStringSelectMenu() && interaction.customId === 'panel:autoReactWizard:matchMode') return true;
  if (interaction.isButton() && interaction.customId === 'panel:autoReactWizard:allChannels') return true;
  if (interaction.isButton() && interaction.customId === 'panel:autoReactWizard:cancel') return true;
  if (interaction.isStringSelectMenu() && interaction.customId === 'panel:selectAutoReactRule') return true;
  if (interaction.customId.startsWith('panel:autoReactRuleEdit:')) return true;
  if (interaction.customId.startsWith('panel:autoReactRuleRemove:')) return true;
  if (interaction.customId.startsWith('panel:confirmRemoveAutoReact:')) return true;
  return false;
}

function buildAutoReactWizardModal(session) {
  const modal = new ModalBuilder()
    .setCustomId('panel:autoReactWizardModal')
    .setTitle(session.editingId ? 'Edit Auto-React Rule' : 'Add Auto-React Rule');

  const emojiInput = new TextInputBuilder()
    .setCustomId('emojis')
    .setLabel('Emoji(s) to react with')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('👍 ❤️ (space or comma separated)')
    .setValue(session.emojisRaw || '')
    .setRequired(true);
  const rows = [new ActionRowBuilder().addComponents(emojiInput)];

  if (AUTOREACT_KEYWORD_TRIGGERS.has(session.trigger)) {
    const keywordsInput = new TextInputBuilder()
      .setCustomId('keywords')
      .setLabel('Keywords/patterns (comma separated)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('* = anything, % = date/time, ^ = time HH:MM')
      .setValue(session.keywordsRaw || '')
      .setRequired(true);
    rows.push(new ActionRowBuilder().addComponents(keywordsInput));
  }

  modal.addComponents(...rows);
  return modal;
}

async function execute(interaction) {
  const customId = interaction.customId;

  try {
    // Wizard: channel select
    if (customId === 'panel:autoReactWizard:channel') {
      const session = autoReactWizardStore.updateSession(interaction.guild.id, interaction.user.id, {
        channelId: interaction.values[0],
      });
      return interaction.showModal(buildAutoReactWizardModal(session));
    }

    // Wizard: trigger select
    if (customId === 'panel:autoReactWizard:trigger') {
      const trigger = interaction.values[0];
      const session = autoReactWizardStore.updateSession(interaction.guild.id, interaction.user.id, { trigger });

      if (AUTOREACT_KEYWORD_TRIGGERS.has(trigger)) {
        return interaction.update({
          embeds: [buildAutoReactMatchModeStepEmbed(session)],
          components: buildAutoReactMatchModeStepComponents(),
        });
      }

      return interaction.update({
        embeds: [buildAutoReactChannelStepEmbed(session)],
        components: buildAutoReactChannelStepComponents(),
      });
    }

    // Wizard: match mode select
    if (customId === 'panel:autoReactWizard:matchMode') {
      const session = autoReactWizardStore.updateSession(interaction.guild.id, interaction.user.id, {
        matchAll: interaction.values[0] === 'all',
      });
      return interaction.update({
        embeds: [buildAutoReactChannelStepEmbed(session)],
        components: buildAutoReactChannelStepComponents(),
      });
    }

    // Wizard: all channels button
    if (customId === 'panel:autoReactWizard:allChannels') {
      const session = autoReactWizardStore.updateSession(interaction.guild.id, interaction.user.id, { channelId: null });
      return interaction.showModal(buildAutoReactWizardModal(session));
    }

    // Wizard: cancel button
    if (customId === 'panel:autoReactWizard:cancel') {
      autoReactWizardStore.endSession(interaction.guild.id, interaction.user.id);
      const rules = autoReactStore.listRules(interaction.guild.id);
      return interaction.update({
        content: 'Cancelled — no changes made.',
        embeds: [buildAutoReactSettingsEmbed(interaction.guild, rules)],
        components: buildAutoReactSettingsComponents(rules),
      });
    }

    // Wizard modal submit (final step)
    if (customId === 'panel:autoReactWizardModal') {
      const session = autoReactWizardStore.getSession(interaction.guild.id, interaction.user.id);
      if (!session || !session.trigger) {
        return interaction.reply({
          content: 'That rule-building session expired — open Auto-React Settings and press Add Rule (or Edit) again.',
          ephemeral: true,
        });
      }

      const emojis = parseEmojiList(interaction.fields.getTextInputValue('emojis'));
      if (!emojis.length) {
        return interaction.reply({ content: "I couldn't find any emojis in that.", ephemeral: true });
      }

      let keywords = [];
      if (AUTOREACT_KEYWORD_TRIGGERS.has(session.trigger)) {
        keywords = interaction.fields.getTextInputValue('keywords').split(/[,\n]+/).map((k) => k.trim()).filter(Boolean);
        if (!keywords.length) {
          return interaction.reply({ content: "I couldn't find any keywords in that.", ephemeral: true });
        }
      }

      if (session.editingId) {
        autoReactStore.removeRule(interaction.guild.id, session.editingId);
      }

      const rule = autoReactStore.addRule(interaction.guild.id, {
        channelId: session.channelId || null,
        trigger: session.trigger,
        keywords,
        matchAll: session.matchAll,
        emojis,
        createdBy: interaction.user.id,
      });

      autoReactWizardStore.endSession(interaction.guild.id, interaction.user.id);

      return interaction.reply({
        content: `✅ ${session.editingId ? 'Updated' : 'Added'} rule: ${describeRule(rule, interaction.guild)}\n\n` +
          'Open `/panel` → Auto-React Settings again to see the updated list.',
        ephemeral: true,
      });
    }

    // Select rule from list
    if (customId === 'panel:selectAutoReactRule') {
      const ruleId = interaction.values[0];
      const rules = autoReactStore.listRules(interaction.guild.id);
      const rule = rules.find((r) => r.id === ruleId);

      if (!rule) {
        return interaction.update({
          content: 'That auto-react rule no longer exists — it may have already been removed.',
          embeds: [buildAutoReactSettingsEmbed(interaction.guild, rules)],
          components: buildAutoReactSettingsComponents(rules),
        });
      }

      return interaction.update({
        embeds: [buildAutoReactRuleDetailEmbed(interaction.guild, rule)],
        components: buildAutoReactRuleDetailComponents(ruleId),
      });
    }

    // Edit rule
    if (customId.startsWith('panel:autoReactRuleEdit:')) {
      const ruleId = customId.split(':')[2];
      const rules = autoReactStore.listRules(interaction.guild.id);
      const rule = rules.find((r) => r.id === ruleId);

      if (!rule) {
        return interaction.update({
          content: 'That rule no longer exists — it may have already been removed.',
          embeds: [buildAutoReactSettingsEmbed(interaction.guild, rules)],
          components: buildAutoReactSettingsComponents(rules),
        });
      }

      const session = autoReactWizardStore.startSession(interaction.guild.id, interaction.user.id, {
        editingId: rule.id,
        trigger: rule.trigger,
        matchAll: rule.matchAll,
        channelId: rule.channelId,
        emojisRaw: (rule.emojis || []).map((e) => e.raw).join(' '),
        keywordsRaw: (rule.keywords || []).join(', '),
      });
      return interaction.update({
        embeds: [buildAutoReactTriggerStepEmbed(session)],
        components: buildAutoReactTriggerStepComponents(),
      });
    }

    // Remove rule (confirmation screen)
    if (customId.startsWith('panel:autoReactRuleRemove:')) {
      const ruleId = customId.split(':')[2];
      const rules = autoReactStore.listRules(interaction.guild.id);
      const rule = rules.find((r) => r.id === ruleId);

      if (!rule) {
        return interaction.update({
          content: 'That rule no longer exists — it may have already been removed.',
          embeds: [buildAutoReactSettingsEmbed(interaction.guild, rules)],
          components: buildAutoReactSettingsComponents(rules),
        });
      }

      return interaction.update({
        embeds: [buildAutoReactRemoveConfirmEmbed(interaction.guild, rule)],
        components: buildAutoReactRemoveConfirmComponents(ruleId),
      });
    }

    // Confirm remove
    if (customId.startsWith('panel:confirmRemoveAutoReact:')) {
      const ruleId = customId.split(':')[2];
      autoReactStore.removeRule(interaction.guild.id, ruleId);
      const rules = autoReactStore.listRules(interaction.guild.id);
      return interaction.update({
        content: '✅ Auto-react rule removed.',
        embeds: [buildAutoReactSettingsEmbed(interaction.guild, rules)],
        components: buildAutoReactSettingsComponents(rules),
      });
    }
  } catch (error) {
    err(error, { tag: 'handlers:autoReact', customId, userId: interaction.user.id });
    throw error;
  }
}

module.exports = { match, execute };