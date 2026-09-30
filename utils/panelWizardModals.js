const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

// Trigger types that need the keywords field in the auto-react wizard's final popup.
const AUTOREACT_KEYWORD_TRIGGERS = new Set(['keyword', 'image_keyword']);

// The auto-react wizard's last step is a short popup (modal) for emoji(s) and, if the
// trigger needs it, keywords - trigger type and match mode can't live in a
// modal since Discord modals only support text fields, not dropdowns.
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

// The autopost wizard's last step is a short popup (modal) for the text
// fields - channel/hour/minute were already picked via select menus in the
// prior steps, since Discord modals only support text fields.
function buildAutopostWizardModal(session) {
  const modal = new ModalBuilder()
    .setCustomId('panel:autopostWizardModal')
    .setTitle(session.editingToken ? 'Edit Autopost' : 'Add Autopost');

  const titleInput = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Roster title')
    .setStyle(TextInputStyle.Short)
    .setValue(session.titleRaw || '')
    .setRequired(true);

  const descriptionInput = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Description (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(session.descriptionRaw || '')
    .setRequired(false);

  const categorySlotsInput = new TextInputBuilder()
    .setCustomId('categorySlots')
    .setLabel('Category, Main slots, Sub slots')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('10, 2')
    .setValue(session.categorySlotsRaw || '')
    .setRequired(true);

  const minuteLockInput = new TextInputBuilder()
    .setCustomId('minuteLock')
    .setLabel('Minute (0-59), Lock-after mins (optional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(session.scheduleType === 'hourly' ? '20  (posts at xx:20 every hour)' : '20, 15')
    .setValue(session.minuteLockRaw || '')
    .setRequired(true);

  const thumbnailInput = new TextInputBuilder()
    .setCustomId('thumbnail')
    .setLabel('Thumbnail/Image URL (optional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://...')
    .setValue(session.thumbnailRaw || '')
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(descriptionInput),
    new ActionRowBuilder().addComponents(categorySlotsInput),
    new ActionRowBuilder().addComponents(minuteLockInput),
    new ActionRowBuilder().addComponents(thumbnailInput),
  );
  return modal;
}

module.exports = { AUTOREACT_KEYWORD_TRIGGERS, buildAutoReactWizardModal, buildAutopostWizardModal };
