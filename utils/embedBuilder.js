const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  RoleSelectMenuBuilder,
} = require('discord.js');

const CID = 'embedbuilder'; // customId namespace prefix

// Button style labels for UI
const BUTTON_STYLES = [
  { value: 'Primary', label: 'Blue (Primary)', emoji: '🔵' },
  { value: 'Secondary', label: 'Gray (Secondary)', emoji: '⚫' },
  { value: 'Success', label: 'Green (Success)', emoji: '🟢' },
  { value: 'Danger', label: 'Red (Danger)', emoji: '🔴' },
];

// ---------- URL validation ----------
// Discord's embed/button URL fields require a real http(s) URL or nothing at all -
// anything else (like someone typing "idc" or "none") throws deep inside discord.js
// and takes the whole process down if not caught. Validate up front instead.
function isValidUrl(value) {
  if (!value) return true; // empty/null is fine, field just won't be set
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------- Color parsing ----------
function parseColor(input) {
  if (!input) return 0x5865f2;
  const cleaned = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) return parseInt(cleaned, 16);
  const named = {
    red: 0xed4245, green: 0x57f287, blue: 0x3498db, yellow: 0xfee75c,
    orange: 0xe67e22, purple: 0x9b59b6, blurple: 0x5865f2, white: 0xffffff,
    black: 0x000000, random: Math.floor(Math.random() * 0xffffff),
  };
  return named[cleaned.toLowerCase()] ?? 0x5865f2;
}

// Renders the draft's numeric color back to a "#RRGGBB" string so the
// color modal field can be pre-filled with what's actually set.
function toHexColor(colorNum) {
  if (colorNum == null) return null;
  return '#' + colorNum.toString(16).padStart(6, '0').toUpperCase();
}

// ---------- Reconstruct a draft from an existing Discord embed ----------
// Used by /embed edit to pre-populate the builder with the current state of a
// sent message. Components (buttons) are passed separately since they live on
// the Message, not the Embed. Reactions cannot be recovered from the API the
// same way - they are left empty so the user can re-add them if needed.
//
// @param {APIEmbed}   apiEmbed   - The raw embed data from message.embeds[0].data
//                                  (or any discord.js Embed object via .data)
// @param {Component[]} components - message.components (ActionRows) from the sent
//                                   message, used to restore role/link buttons.
// @returns {Object} A draft object compatible with embedSessionStore.blankDraft()
function draftFromEmbed(apiEmbed, components = []) {
  const draft = {
    title: apiEmbed.title ?? null,
    description: apiEmbed.description ?? null,
    url: apiEmbed.url ?? null,
    color: apiEmbed.color ?? 0x5865f2,
    author: {
      name: apiEmbed.author?.name ?? null,
      iconURL: apiEmbed.author?.icon_url ?? null,
      url: apiEmbed.author?.url ?? null,
    },
    footer: {
      text: apiEmbed.footer?.text ?? null,
      iconURL: apiEmbed.footer?.icon_url ?? null,
    },
    thumbnail: apiEmbed.thumbnail?.url ?? null,
    image: apiEmbed.image?.url ?? null,
    fields: (apiEmbed.fields ?? []).map((f) => ({
      name: f.name,
      value: f.value,
      inline: !!f.inline,
    })),
    timestamp: !!apiEmbed.timestamp,
    reactions: [], // reactions can't be read back from the API in a useful way
    buttons: [],
  };

  // Reconstruct buttons from the message's component rows.
  // Role buttons encode their role ID in the customId as "embedbtn:role:<roleId>".
  // Link buttons use ButtonStyle.Link and carry a URL directly.
  for (const row of components) {
    // row may be a raw API component or a discord.js ActionRow - handle both
    const rowComponents = row.components ?? [];
    for (const component of rowComponents) {
      // component.type === 2 is a Button in the Discord API
      if (component.type !== 2) continue;

      const label = component.label ?? '';
      const emoji = component.emoji
        ? (component.emoji.id
          ? `<${component.emoji.animated ? 'a' : ''}:${component.emoji.name}:${component.emoji.id}>`
          : component.emoji.name)
        : undefined;

      if (component.style === 5) {
        // ButtonStyle.Link = 5
        draft.buttons.push({
          type: 'link',
          label,
          url: component.url ?? '',
          emoji,
        });
      } else if (component.custom_id?.startsWith('embedbtn:role:')) {
        const roleId = component.custom_id.split(':')[2];
        // Map API style numbers back to our string names
        const styleMap = { 1: 'Primary', 2: 'Secondary', 3: 'Success', 4: 'Danger' };
        const style = styleMap[component.style] ?? 'Primary';
        draft.buttons.push({
          type: 'role',
          label,
          roleId,
          style,
          emoji,
        });
      }
      // Buttons with other customIds (e.g. ticket close buttons added by other
      // systems) are silently skipped - we only own embedbtn: buttons.
    }
  }

  return draft;
}

// ---------- Build the live-preview Embed from draft data ----------
// Every URL-type field is guarded with isValidUrl before being handed to the
// discord.js setter. Those setters validate their input and throw
// synchronously on anything that isn't a real http(s) URL - a throw that
// isn't a promise rejection, so it can't be caught by a .catch() on
// whatever's sending the message, and previously reached process level as
// an uncaughtException (crashing the whole bot, not just this one guild's
// message - see the %userAvatar%-as-thumbnail incident this guarded
// against). Skipping the field is a much better failure mode than that.
function buildEmbedFromDraft(draft) {
  const e = new EmbedBuilder().setColor(draft.color ?? 0x5865f2);

  if (draft.title) e.setTitle(draft.title.slice(0, 256));
  if (draft.description) e.setDescription(draft.description.slice(0, 4096));
  if (draft.url && draft.title && isValidUrl(draft.url)) e.setURL(draft.url);
  if (draft.author?.name) {
    e.setAuthor({
      name: draft.author.name.slice(0, 256),
      iconURL: isValidUrl(draft.author.iconURL) ? (draft.author.iconURL || undefined) : undefined,
      url: isValidUrl(draft.author.url) ? (draft.author.url || undefined) : undefined,
    });
  }
  if (draft.footer?.text) {
    e.setFooter({
      text: draft.footer.text.slice(0, 2048),
      iconURL: isValidUrl(draft.footer.iconURL) ? (draft.footer.iconURL || undefined) : undefined,
    });
  }
  if (draft.thumbnail && isValidUrl(draft.thumbnail)) e.setThumbnail(draft.thumbnail);
  if (draft.image && isValidUrl(draft.image)) e.setImage(draft.image);
  if (draft.fields?.length) {
    e.addFields(draft.fields.slice(0, 25).map((f) => ({
      name: f.name.slice(0, 256),
      value: f.value.slice(0, 1024),
      inline: !!f.inline,
    })));
  }
  if (draft.timestamp) e.setTimestamp();

  // Discord requires an embed to have at least one of these set to render.
  if (!draft.title && !draft.description && !draft.image && !draft.thumbnail && !draft.fields?.length) {
    e.setDescription('*(Empty embed - use the menus below to add content)*');
  }

  return e;
}

// ---------- Build real send-time buttons from draft.buttons ----------
function buildLiveButtonRows(buttons) {
  if (!buttons?.length) return [];
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const chunk = buttons.slice(i, i + 5);
    const row = new ActionRowBuilder().addComponents(
      chunk.map((b, idx) => {
        const btn = new ButtonBuilder().setLabel(b.label.slice(0, 80));
        if (b.emoji) btn.setEmoji(b.emoji);
        if (b.type === 'link') {
          btn.setStyle(ButtonStyle.Link).setURL(b.url);
        } else {
          // role-toggle button, stateless customId encodes the role id
          // Normalize style to match ButtonStyle enum keys (case-sensitive)
          const styleKey = b.style ? b.style.charAt(0).toUpperCase() + b.style.slice(1).toLowerCase() : 'Primary';
          const validStyles = ['Primary', 'Secondary', 'Success', 'Danger'];
          const finalStyle = validStyles.includes(styleKey) ? styleKey : 'Primary';
          btn.setStyle(ButtonStyle[finalStyle]);
          btn.setCustomId(`embedbtn:role:${b.roleId}`);
        }
        return btn;
      })
    );
    rows.push(row);
  }
  return rows;
}

// ---------- Build the builder-panel control rows (select menus + action buttons) ----------
// Pass isEditSession=true when the session has an editMessageId - swaps "Send Now"
// for "Update Message" with a matching emoji so the user always knows which mode
// they're in.
//
// The menus are grouped by intent (not by content type) so the panel is easier
// to read at a glance:
//   1. ✏️ Edit the embed       - title, author, footer, images, timestamp
//   2. ➕ Add something new     - a field, a button, or a reaction
//   3. 🗑️ Edit or remove       - only shown once there's something to manage
function buildPanelComponents(session) {
  const hasFields = session.draft.fields.length > 0;
  const hasReactions = session.draft.reactions.length > 0;
  const hasButtons = session.draft.buttons.length > 0;
  const isEditSession = !!session.editMessageId;

  const contentSelect = new StringSelectMenuBuilder()
    .setCustomId(`${CID}:content`)
    .setPlaceholder('✏️ Edit the embed...')
    .addOptions([
      { label: 'Title & Description', value: 'basic', emoji: '📄' },
      { label: 'Author (top line)', value: 'author', emoji: '👤' },
      { label: 'Footer (bottom line)', value: 'footer', emoji: '📌' },
      { label: 'Images (thumbnail & banner)', value: 'images', emoji: '🖼️' },
      { label: session.draft.timestamp ? 'Remove Timestamp' : 'Add Timestamp', value: 'timestamp', emoji: '🕐' },
    ]);

  const addSelect = new StringSelectMenuBuilder()
    .setCustomId(`${CID}:add`)
    .setPlaceholder('➕ Add something new...')
    .addOptions([
      { label: 'Add a Field (labeled bullet)', value: 'field', emoji: '➕' },
      { label: 'Add a Link Button', value: 'link', emoji: '🔗' },
      { label: 'Add a Role Button', value: 'role', emoji: '🏷️' },
      { label: 'Add a Reaction (auto-reacted)', value: 'reaction', emoji: '😀' },
    ]);

  const manageOptions = [
    hasFields ? { label: 'Edit / Remove Fields', value: 'fields', emoji: '📋' } : null,
    hasButtons ? { label: 'Edit / Remove Buttons', value: 'buttons', emoji: '🔘' } : null,
    hasReactions ? { label: 'Remove Reactions', value: 'reactions', emoji: '😀' } : null,
    hasFields ? { label: 'Clear All Fields', value: 'clear', emoji: '🗑️' } : null,
  ].filter(Boolean);

  // Ticket embeds (session.purpose = 'ticket:panel' | 'ticket:opened' | 'ticket:close')
  // and the welcome embed (session.purpose = 'welcome') aren't sent as a
  // one-off message - they're saved into guildSettings and rendered later by
  // their own systems (ticket panel/opened/close messages, or the join
  // welcome message), so "Send Now" doesn't apply to them.
  const isSettingsPurpose = typeof session.purpose === 'string' && (session.purpose.startsWith('ticket:') || session.purpose === 'welcome');

  // Determine the primary action button for the panel's last row:
  //   • settings purpose  → "Save & Use"   (writes to guildSettings)
  //   • edit session      → "Update Message" (patches the existing sent message)
  //   • otherwise         → "Send Now"      (posts a new message)
  let primaryActionButton;
  if (isSettingsPurpose) {
    primaryActionButton = new ButtonBuilder()
      .setCustomId(`${CID}:saveSettings`)
      .setLabel('Save & Use')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✅');
  } else if (isEditSession) {
    primaryActionButton = new ButtonBuilder()
      .setCustomId(`${CID}:updatenow`)
      .setLabel('Update Message')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✏️');
  } else {
    primaryActionButton = new ButtonBuilder()
      .setCustomId(`${CID}:sendnow`)
      .setLabel('Send Now')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📤');
  }

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${CID}:save`).setLabel('Save Template').setStyle(ButtonStyle.Success).setEmoji('💾'),
    primaryActionButton,
    new ButtonBuilder().setCustomId(`${CID}:cancel`).setLabel('Cancel').setStyle(ButtonStyle.Danger).setEmoji('✖️')
  );

  const rows = [
    new ActionRowBuilder().addComponents(contentSelect),
    new ActionRowBuilder().addComponents(addSelect),
  ];
  if (manageOptions.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${CID}:manage`)
          .setPlaceholder('🗑️ Edit or remove...')
          .addOptions(manageOptions)
      )
    );
  }
  rows.push(actionRow);
  return rows;
}

// ---------- Builder guide text ----------
// Shown above the preview embed whenever the panel is refreshed. Gives a
// first-time user (a) a live summary of what's already in the embed so they
// can see their changes land, and (b) a plain-language 1-2-3 of what each
// dropdown does instead of leaving them to decode placeholder labels.
function buildGuideText(session) {
  const draft = session.draft;
  const hasManage = draft.fields.length > 0 || draft.buttons.length > 0 || draft.reactions.length > 0;
  const isSettingsPurpose = typeof session.purpose === 'string' &&
    (session.purpose.startsWith('ticket:') || session.purpose === 'welcome');
  const actionLabel = isSettingsPurpose ? 'Save & Use'
    : session.editMessageId ? 'Update Message' : 'Send Now';

  const summary = [];
  if (draft.title) summary.push('📄 title');
  if (draft.description) summary.push('description');
  if (draft.author?.name) summary.push('👤 author');
  if (draft.footer?.text) summary.push('📌 footer');
  if (draft.fields.length) summary.push(`${draft.fields.length} field${draft.fields.length === 1 ? '' : 's'}`);
  if (draft.buttons.length) summary.push(`${draft.buttons.length} button${draft.buttons.length === 1 ? '' : 's'}`);
  if (draft.reactions.length) summary.push(`${draft.reactions.length} reaction${draft.reactions.length === 1 ? '' : 's'}`);
  if (draft.timestamp) summary.push('🕐 timestamp');

  const summaryLine = summary.length
    ? `**In your embed now:** ${summary.join(' · ')}`
    : '_Nothing added yet — pick a dropdown below to start._';

  const steps = [
    '1. **✏️ Edit the embed** — title, text, color, author, footer, images',
    '2. **➕ Add something** — a field, button, or reaction',
  ];
  if (hasManage) steps.push('3. **🗑️ Edit / Remove** — change or delete what you added');

  return `${summaryLine}\n\n**Build it step by step:**\n${steps.join('\n')}\n\nThe preview below updates as you go. Click **${actionLabel}** when it looks right.`;
}

// ---------- Modals ----------
// `session` is optional (the "add new X" modals - fields/reactions/buttons -
// intentionally always open blank). When provided, the relevant modal kinds
// pre-fill their inputs with the current draft values via .setValue(), so
// reopening a section (or "Edit Button") doesn't wipe out what was already
// there when the user hits submit again unchanged.
function buildModal(kind, session = null) {
  const modal = new ModalBuilder();
  const draft = session?.draft;

  const textInput = (id, label, opts = {}) => {
    const maxLength = opts.maxLength || (opts.paragraph ? 4000 : 400);
    const input = new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(opts.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(!!opts.required)
      .setMaxLength(maxLength);
    if (opts.value != null && opts.value !== '') {
      input.setValue(String(opts.value).slice(0, maxLength));
    }
    if (opts.placeholder) input.setPlaceholder(opts.placeholder);
    return input;
  };

  switch (kind) {
    case 'basic':
      modal.setCustomId(`${CID}:modal:basic`).setTitle('Title & Description');
      modal.addComponents(
        new ActionRowBuilder().addComponents(textInput('title', 'Title', { value: draft?.title })),
        new ActionRowBuilder().addComponents(textInput('description', 'Description', { paragraph: true, value: draft?.description })),
        new ActionRowBuilder().addComponents(textInput('color', 'Color (hex e.g. #5865F2, or "random")', { value: draft ? toHexColor(draft.color) : null })),
        new ActionRowBuilder().addComponents(textInput('url', 'Title URL (optional)', { value: draft?.url }))
      );
      break;
    case 'author':
      modal.setCustomId(`${CID}:modal:author`).setTitle('Author');
      modal.addComponents(
        new ActionRowBuilder().addComponents(textInput('name', 'Author Name', { value: draft?.author?.name })),
        new ActionRowBuilder().addComponents(textInput('iconURL', 'Author Icon URL', { value: draft?.author?.iconURL })),
        new ActionRowBuilder().addComponents(textInput('url', 'Author URL (link when clicked)', { value: draft?.author?.url }))
      );
      break;
    case 'footer':
      modal.setCustomId(`${CID}:modal:footer`).setTitle('Footer');
      modal.addComponents(
        new ActionRowBuilder().addComponents(textInput('text', 'Footer Text', { value: draft?.footer?.text })),
        new ActionRowBuilder().addComponents(textInput('iconURL', 'Footer Icon URL', { value: draft?.footer?.iconURL }))
      );
      break;
    case 'images':
      modal.setCustomId(`${CID}:modal:images`).setTitle('Images');
      modal.addComponents(
        new ActionRowBuilder().addComponents(textInput('thumbnail', 'Thumbnail URL (small, top-right)', { value: draft?.thumbnail })),
        new ActionRowBuilder().addComponents(textInput('image', 'Image URL (large, bottom)', { value: draft?.image }))
      );
      break;
    case 'add_field':
      modal.setCustomId(`${CID}:modal:add_field`).setTitle('Add Field');
      modal.addComponents(
        new ActionRowBuilder().addComponents(textInput('name', 'Field Name', { required: true })),
        new ActionRowBuilder().addComponents(textInput('value', 'Field Value', { required: true, paragraph: true })),
        new ActionRowBuilder().addComponents(textInput('inline', 'Inline? (yes/no)', { placeholder: 'yes = sit beside the previous field' }))
      );
      break;
    case 'add_reaction':
      modal.setCustomId(`${CID}:modal:add_reaction`).setTitle('Add Reaction');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          textInput('emoji', 'Emoji (unicode 👍 or custom :name:id)', { required: true })
        )
      );
      break;
    case 'add_link_button':
      modal.setCustomId(`${CID}:modal:add_link_button`).setTitle('Add Link Button');
      modal.addComponents(
        new ActionRowBuilder().addComponents(textInput('label', 'Button Label', { required: true, maxLength: 80 })),
        new ActionRowBuilder().addComponents(textInput('url', 'URL (must start with https://)', { required: true })),
        new ActionRowBuilder().addComponents(textInput('emoji', 'Emoji (optional)'))
      );
      break;
    case 'add_role_button':
      modal.setCustomId(`${CID}:modal:add_role_button`).setTitle('Add Role Toggle Button');
      modal.addComponents(
        new ActionRowBuilder().addComponents(textInput('label', 'Button Label', { required: true, maxLength: 80 })),
        new ActionRowBuilder().addComponents(textInput('style', 'Color (Primary, Secondary, Success, Danger)', { required: false })),
        new ActionRowBuilder().addComponents(textInput('emoji', 'Emoji (optional)'))
      );
      break;
    case 'edit_button': {
      const editingIdx = session?._editingButtonIdx;
      const btn = editingIdx != null ? draft?.buttons?.[editingIdx] : null;
      const target = btn ? (btn.type === 'link' ? btn.url : btn.roleId) : null;
      modal.setCustomId(`${CID}:modal:edit_button`).setTitle('Edit Button');
      modal.addComponents(
        new ActionRowBuilder().addComponents(textInput('label', 'Button Label', { required: true, maxLength: 80, value: btn?.label })),
        new ActionRowBuilder().addComponents(textInput('target', 'URL or Role ID', { required: true, value: target })),
        new ActionRowBuilder().addComponents(textInput('style', 'Style: Primary/Secondary/Success/Danger', { value: btn?.style })),
        new ActionRowBuilder().addComponents(textInput('emoji', 'Emoji (optional)', { value: btn?.emoji }))
      );
      break;
    }
    case 'save_template':
      modal.setCustomId(`${CID}:modal:save_template`).setTitle('Save Template');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          textInput('name', 'Template Name', { required: true, maxLength: 60, value: session?.name })
        )
      );
      break;
    default:
      throw new Error(`Unknown modal kind: ${kind}`);
  }

  return modal;
}

// Build a role select menu for button creation
function buildRoleSelectMenu(customId) {
  return new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Select a role for this button...')
      .setMinValues(1)
      .setMaxValues(1)
  );
}

// Build a button style select menu
function buildStyleSelectMenu(customId, currentStyle = 'Primary') {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(`Button color: ${currentStyle}`)
      .addOptions(BUTTON_STYLES.map(s => ({
        label: s.label,
        value: s.value,
        emoji: s.emoji,
        default: s.value === currentStyle,
      })))
  );
}

// Build a menu to select which button to edit/remove
function buildButtonManageSelect(session) {
  const buttons = session.draft.buttons;
  if (!buttons.length) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${CID}:button_manage_select`)
      .setPlaceholder('Select a button to edit/remove...')
      .addOptions(buttons.map((b, i) => ({
        label: b.label.slice(0, 25),
        value: String(i),
        description: b.type === 'link' ? `Link: ${b.url?.slice(0, 50)}` : `Role button`,
        emoji: b.emoji || (b.type === 'link' ? '🔗' : '🏷️'),
      })))
  );
}

// Build a menu to select which reaction to remove
function buildReactionManageSelect(session) {
  const reactions = session.draft.reactions;
  if (!reactions.length) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${CID}:reaction_manage_select`)
      .setPlaceholder('Select a reaction to remove...')
      .addOptions(reactions.map((r, i) => ({
        label: `Reaction ${i + 1}`,
        value: String(i),
        emoji: r.slice(0, 2), // First 2 chars in case it's a custom emoji format
      })))
  );
}

module.exports = {
  CID,
  isValidUrl,
  parseColor,
  draftFromEmbed,
  buildEmbedFromDraft,
  buildLiveButtonRows,
  buildPanelComponents,
  buildGuideText,
  buildModal,
  buildRoleSelectMenu,
  buildStyleSelectMenu,
  buildButtonManageSelect,
  buildReactionManageSelect,
  BUTTON_STYLES,
};
