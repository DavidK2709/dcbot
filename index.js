require('dotenv').config();
const { Client: BotClient, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const fs = require('fs');

// === CONFIG ===
const { BOT_TOKEN, BOT_USER_ID, ALLOWED_GUILD, TRIGGER_CHANNEL_ID, LOG_CHANNEL_ID } = process.env;

const departmentConfig = {
  'Arbeitsmedizin': {
    categoryId: '1378976400303718522',
    memberRoleId: '1378976857470406706',
    leaderRoleId: '1378976900642508933'
  },
  'Psychologie': {
    categoryId: '1378976458877177996',
    memberRoleId: '1378976959945769061',
    leaderRoleId: '1378977015516102656'
  },
  'Station': {
    categoryId: '1378976512191238226',
    memberRoleId: '1378977083904102600',
    leaderRoleId: '1378977159615348766'
  }
};

const memberRoleToDepartment = {
  '1378976857470406706': 'Arbeitsmedizin',
  '1378976959945769061': 'Psychologie',
  '1378977083904102600': 'Station'
};

const ticketDataStore = new Map();

// === HELPER FUNCTIONS ===
const getTimestamp = () => new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(', ', ' - ');

const findUserInGuild = async (guild, input) => {
  try {
    const members = await guild.members.fetch();
    const cleanInput = input.trim();
    let member;

    const isNumber = /^\d+$/.test(cleanInput);
    if (isNumber) {
      const formattedNumber = cleanInput.padStart(2, '0');
      member = members.find(m => {
        const match = m.displayName.match(/\[(\d+)\]/);
        return match && match[1] === formattedNumber;
      });
      return member ? { mention: `<@${member.user.id}>`, nickname: member.displayName } : { mention: cleanInput, nickname: cleanInput };
    }

    member = members.find(m => m.displayName.replace(/\[[\d+]\]\s*/g, '').toLowerCase() === cleanInput.toLowerCase());
    return member ? { mention: `<@${member.user.id}>`, nickname: member.displayName } : { mention: cleanInput, nickname: cleanInput };
  } catch (err) {
    console.error(`(Bot) Fehler beim Abrufen der Mitgliederliste in ${guild.name} (${guild.id}):`, err);
    return { mention: cleanInput, nickname: cleanInput };
  }
};

const updateChannelName = async (channel, ticketData) => {
  const isAutomaticTicket = Object.keys({
    ticket_arbeitsmedizinisches_polizei: '', ticket_arbeitsmedizinisches_jva: '', ticket_arbeitsmedizinisches_ammunation: '',
    ticket_arbeitsmedizinisches_mediziner: '', ticket_psycholgie_bundeswehr: '', ticket_psychologie_jva: ''
  }).includes(ticketData.grund);
  const baseName = isAutomaticTicket
      ? `${ticketData.grund.split('_').slice(1).join('_')}-${ticketData.patient.replace(/ /g, '-')}`
      : `${ticketData.patient.replace(/ /g, '-')}`;

  let symbols = [];
  if (ticketData.isClosed) {
    symbols = ['✅'];
  } else if (ticketData.lastReset) {
    symbols = ['❗'];
  } else if (ticketData.appointmentDate && ticketData.appointmentTime) {
    symbols = ['📅'];
    if (ticketData.acceptedBy) symbols.unshift('📌'); // 📌 vor 📅
    else if (ticketData.callAttempt) symbols = ['📅']; // 📅 ersetzt ☎️
  } else if (ticketData.callAttempt) {
    symbols = ['☎️'];
    if (ticketData.acceptedBy) symbols.unshift('📌'); // 📌 vor ☎️
  } else if (ticketData.acceptedBy) {
    symbols = ['📌'];
  } else {
    symbols = ['🆕'];
  }

  const newName = `${symbols.join('')} ${baseName}`;
  await channel.setName(newName.slice(0, 100)); // Discord hat eine maximale Länge von 100 Zeichen
};

const getButtonRows = (ticketData) => {
  const rows = [];

  if (ticketData.isClosed) {
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('reopen_ticket_button').setLabel('Ticket wieder öffnen').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('delete_ticket_button').setLabel('Ticket löschen').setStyle(ButtonStyle.Danger)
    ));
    return rows;
  }

  const hasInteraction = ticketData.acceptedBy || ticketData.appointmentDate || ticketData.appointmentTime || ticketData.avpsLink;
  const isResetDisabled = !hasInteraction || ticketData.lastReset;
  const takeoverButton = ticketData.acceptedBy
      ? new ButtonBuilder().setCustomId('takeover_ticket_button').setLabel('Ticket neuvergeben').setStyle(ButtonStyle.Secondary)
      : new ButtonBuilder().setCustomId('takeover_ticket_button').setLabel('Ticket vergeben').setStyle(ButtonStyle.Danger);

  const row1Components = [
    new ButtonBuilder().setCustomId('call_attempt_button').setLabel('Versucht anzurufen').setStyle(ButtonStyle.Danger),
    takeoverButton,
    new ButtonBuilder().setCustomId('close_ticket_button').setLabel('Schließen').setStyle(ButtonStyle.Danger)
  ];

  if (!ticketData.appointmentDate && !ticketData.appointmentTime) {
    row1Components.splice(1, 0, new ButtonBuilder().setCustomId('schedule_appointment_button').setLabel('Termin festlegen').setStyle(ButtonStyle.Danger));
  }

  rows.push(new ActionRowBuilder().addComponents(row1Components));

  if (ticketData.appointmentDate && ticketData.appointmentTime && !ticketData.appointmentCompleted) {
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('no_show_button').setLabel('Nicht zum Termin erschienen').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('reschedule_appointment_button').setLabel('Termin umlegen').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('appointment_completed_button').setLabel('Termin erledigt').setStyle(ButtonStyle.Success)
    ));
  }

  if (ticketData.appointmentCompleted) {
    rows.push(new ActionRowBuilder().addComponents(
        ticketData.avpsLink
            ? [
              new ButtonBuilder().setCustomId('edit_avps_link_button').setLabel('AVPS Akte bearbeiten').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId('delete_avps_link_button').setLabel('Akte löschen').setStyle(ButtonStyle.Danger)
            ]
            : [new ButtonBuilder().setCustomId('avps_link_button').setLabel('AVPS Akte hinterlegen').setStyle(ButtonStyle.Danger)]
    ));
  }

  rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('reset_ticket_button').setLabel('Ticket zurücksetzen').setStyle(ButtonStyle.Secondary).setDisabled(isResetDisabled)
  ));

  return rows;
};

const createEmbedFields = (ticketData, ticketReasons) => {
  const fields = [
    { name: 'Abteilung', value: ticketData.abteilungPing || 'Nicht angegeben' },
    { name: 'Grund', value: ticketReasons[ticketData.grund] || ticketData.grund || 'Nicht angegeben' },
    { name: 'Patient', value: ticketData.patient || 'Nicht angegeben' },
    { name: 'Telefon', value: ticketData.telefon || 'Nicht angegeben' },
    { name: 'Sonstiges', value: ticketData.sonstiges || 'Nicht angegeben' }
  ];

  if (ticketData.acceptedBy) fields.push({ name: 'Übernommen von', value: ticketData.acceptedBy, inline: true });
  if (ticketData.appointmentDate && ticketData.appointmentTime) fields.push({ name: 'Termin', value: `${ticketData.appointmentDate} - ${ticketData.appointmentTime}` });
  if (ticketData.avpsLink) fields.push({ name: 'AVPS-Akte', value: ticketData.avpsLink });

  return fields;
};

const saveTicketData = () => {
  const data = Array.from(ticketDataStore.entries()).map(([key, value]) => ({ key, value }));
  fs.writeFileSync('tickets.json', JSON.stringify(data, null, 2));
};

const loadTicketData = () => {
  try {
    if (!fs.existsSync('tickets.json')) {
      console.log('tickets.json nicht gefunden. Initialisiere mit leerer Map.');
      ticketDataStore.clear();
      return;
    }
    const data = fs.readFileSync('tickets.json', 'utf8');
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) throw new Error('Ungültiges Format in tickets.json');

    ticketDataStore.clear();
    for (const item of parsed) {
      if (!item.key || !item.value) throw new Error('Fehlende Schlüssel oder Werte in tickets.json');
      ticketDataStore.set(item.key, item.value);
    }
    console.log('Ticket-Daten erfolgreich geladen.');
  } catch (err) {
    console.error('Fehler beim Laden von tickets.json:', err);
    ticketDataStore.clear();
    fs.writeFileSync('tickets.json', JSON.stringify([], null, 2));
    console.log('tickets.json zurückgesetzt auf leeres Array.');
  }
};

const archiveTicketData = (channelId, data) => {
  let archivedTickets = [];
  try {
    if (fs.existsSync('archive_tickets.json')) {
      const archivedData = fs.readFileSync('archive_tickets.json', 'utf8');
      archivedTickets = JSON.parse(archivedData);
      if (!Array.isArray(archivedTickets)) throw new Error('Ungültiges Format in archive_tickets.json');
    }
  } catch (err) {
    console.error('Fehler beim Laden von archive_tickets.json:', err);
    archivedTickets = [];
  }
  archivedTickets.push({ channelId, data, archivedAt: new Date().toISOString() });
  fs.writeFileSync('archive_tickets.json', JSON.stringify(archivedTickets, null, 2));
  console.log(`(Bot) Ticket ${channelId} erfolgreich in archive_tickets.json archiviert.`);
};

// === BOT CLIENT ===
const bot = new BotClient({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
});

// === EVENTS ===
bot.on('ready', async () => {
  console.log(`(Bot) Eingeloggt als ${bot.user.tag} auf Server ${bot.guilds.cache.map(g => g.name).join(', ')}`);
  loadTicketData();

  const formChannelId = '1378976315822313502';
  const formChannel = bot.channels.cache.get(formChannelId);
  if (formChannel) {
    console.log(`(Bot) Kanal gefunden: ${formChannel.name} (${formChannel.id})`);
    try {
      const messages = await formChannel.messages.fetch({ limit: 100 });
      console.log(`(Bot) ${messages.size} Nachrichten im Kanal geladen`);
      const botMessages = messages.filter(msg => msg.author.id === bot.user.id && msg.components.length > 0);

      if (botMessages.size > 1) {
        const messagesToDelete = botMessages.map(msg => msg).slice(1);
        for (const msg of messagesToDelete) {
          await msg.delete();
          console.log(`(Bot) Alte Ticketformular-Nachricht gelöscht: ${msg.id}`);
        }
      }

      const otherMessages = messages.filter(msg => msg.author.id !== bot.user.id || !msg.components.length);
      for (const msg of otherMessages.values()) {
        await msg.delete();
        console.log(`(Bot) Andere Nachricht gelöscht: ${msg.id}`);
      }

      if (botMessages.size === 0) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('create_ticket_station').setLabel('Station').setStyle(ButtonStyle.Primary).setEmoji('🏥'),
            new ButtonBuilder().setCustomId('create_ticket_arbeitsmedizin').setLabel('Arbeitsmedizin').setStyle(ButtonStyle.Success).setEmoji('🏃‍♂️'),
            new ButtonBuilder().setCustomId('create_ticket_psychologie').setLabel('Psychologie').setStyle(ButtonStyle.Danger).setEmoji('🗣️')
        );

        const embed = new EmbedBuilder()
            .setTitle('Behandlungsanfrage öffnen')
            .setDescription('Bitte wähle den gewünschten Fachbereich aus:')
            .setColor(0x480007);

        const sentMessage = await formChannel.send({ embeds: [embed], components: [row] });
        console.log(`(Bot) Neue Ticketformular-Nachricht gesendet in Kanal ${formChannel.name} (${formChannel.id}) mit ID ${sentMessage.id}`);
      } else {
        console.log(`(Bot) Ticketformular-Nachricht bereits vorhanden in Kanal ${formChannel.name} (${formChannel.id})`);
      }
    } catch (error) {
      console.error(`(Bot) Fehler beim Verarbeiten des Kanals ${formChannelId}:`, error);
    }
  } else {
    console.error(`(Bot) Kanal mit ID ${formChannelId} nicht gefunden oder nicht zugänglich. Verfügbare Server: ${bot.guilds.cache.map(g => `${g.name} (${g.id})`).join(', ')}`);
  }
});

bot.on('messageCreate', async (message) => {
  console.log(`(Bot) Nachricht empfangen in Kanal ${message.channel.id}: ${message.content}`);
  if (message.channel.id !== TRIGGER_CHANNEL_ID || message.author.id !== BOT_USER_ID) return;

  const data = {
    abteilung: '', grund: '', patient: '', telefon: '', sonstiges: '', abteilungPing: '',
    buttonMessageId: null, appointmentMessageId: null, completedMessageId: null,
    avpsMessageId: null, embedMessageId: null,
    appointmentDate: null, appointmentTime: null, acceptedBy: null, avpsLink: null,
    appointmentCompleted: false, isClosed: false, lastReset: false, callAttempt: false
  };

  const lines = message.content.split('\n').map(line => line.trim());
  for (const line of lines) {
    const match = line.match(/>\s\*\*(.+?):\*\*\s(.+)/);
    if (match) {
      const field = match[1].toLowerCase();
      const value = match[2].trim();
      if (field === 'abteilung') {
        const roleIdMatch = value.match(/<@&(\d+)>/);
        if (roleIdMatch) {
          const roleId = roleIdMatch[1];
          const department = memberRoleToDepartment[roleId];
          if (department) {
            data.abteilung = department;
            data.abteilungPing = `<@&${roleId}>`;
          } else {
            data.abteilung = 'Nicht angegeben';
            data.abteilungPing = 'Nicht angegeben';
          }
        } else {
          data.abteilung = value;
          data.abteilungPing = value;
        }
      } else if (['grund', 'patient', 'telefon', 'sonstiges'].includes(field)) {
        data[field] = value;
      }
    }
  }

  if (!data.grund || !data.patient || !data.abteilung || !departmentConfig[data.abteilung]) {
    console.log(`(Bot) Fehler: Grund, Patient oder ungültige Abteilung fehlt in Kanal ${message.channel.id}`);
    return;
  }

  const departmentConfigEntry = departmentConfig[data.abteilung];
  if (!departmentConfigEntry) {
    console.log(`(Bot) Ungültige Abteilung: ${data.abteilung}`);
    return;
  }

  const categoryId = departmentConfigEntry.categoryId;
  const memberRoleId = departmentConfigEntry.memberRoleId;

  const ticketReasons = {
    ticket_arbeitsmedizinisches_polizei: 'Arbeitsmedizinisches Gutachten Polizeibewerber',
    ticket_arbeitsmedizinisches_jva: 'Arbeitsmedizinisches Gutachten JVA/Wachschutz',
    ticket_arbeitsmedizinisches_ammunation: 'Arbeitsmedizinisches Gutachten Ammunation',
    ticket_arbeitsmedizinisches_mediziner: 'Arbeitsmedizinisches Gutachten Mediziner',
    ticket_psycholgie_bundeswehr: 'Psychologisches Gutachten Bundeswehr',
    ticket_psychologie_jva: 'Psychologisches Gutachten JVA',
  };

  const isAutomaticTicket = Object.keys(ticketReasons).includes(data.grund);
  const channelName = isAutomaticTicket
      ? `${data.grund.split('_').slice(1).join('_')}-${data.patient.replace(/ /g, '-')}`
      : `${data.patient.replace(/ /g, '-')}`;

  const guild = message.guild;
  const channel = await guild.channels.create({
    name: `🆕 ${channelName}`,
    type: 0,
    parent: categoryId,
    permissionOverwrites: [
      { id: guild.id, deny: ['ViewChannel'] },
      { id: memberRoleId, allow: ['ViewChannel', 'SendMessages'] },
    ],
  });

  ticketDataStore.set(channel.id, data);
  saveTicketData();

  const embedTitle = isAutomaticTicket ? `Behandlungsanfrage für ${ticketReasons[data.grund] || data.grund}` : `Behandlungsanfrage für ${data.abteilungPing || data.abteilung}`;
  const embed = new EmbedBuilder()
      .setTitle(embedTitle)
      .setColor(0x480007)
      .addFields(createEmbedFields(data, ticketReasons));

  const embedMessage = await channel.send({
    content: `Eine neue Behandlungsanfrage (${data.abteilungPing || data.abteilung})`,
    embeds: [embed],
    components: getButtonRows(data),
  });

  data.embedMessageId = embedMessage.id;
  saveTicketData();
  console.log(`(Bot) Ticket erstellt und Embed gesendet in ${channel.name} (${channel.id})`);
});

bot.on('interactionCreate', async (interaction) => {
  console.log(`(Bot) Interaktion empfangen: ${interaction.customId}`);
  if (interaction.isButton() && interaction.customId.startsWith('create_ticket_')) {
    const department = interaction.customId.split('_')[2].charAt(0).toUpperCase() + interaction.customId.split('_')[2].slice(1);
    const modal = new ModalBuilder()
        .setCustomId(`create_ticket_modal_${department.toLowerCase()}`)
        .setTitle(`Ticket erstellen - ${department}`)
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('grund_input').setLabel('Grund').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('patient_input').setLabel('Patient').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('telefon_input').setLabel('Telefon').setStyle(TextInputStyle.Short).setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('sonstiges_input').setLabel('Sonstiges').setStyle(TextInputStyle.Paragraph).setRequired(false)
            )
        );
    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('create_ticket_modal_')) {
    const abteilung = interaction.customId.split('_')[3].charAt(0).toUpperCase() + interaction.customId.split('_')[3].slice(1);
    const grund = interaction.fields.getTextInputValue('grund_input')?.trim();
    const patient = interaction.fields.getTextInputValue('patient_input')?.trim();
    const telefon = interaction.fields.getTextInputValue('telefon_input')?.trim();
    const sonstiges = interaction.fields.getTextInputValue('sonstiges_input')?.trim();

    if (!grund || !patient) {
      await interaction.reply({ content: 'Grund und Patient sind erforderlich.', ephemeral: true });
      return;
    }

    const departmentConfigEntry = departmentConfig[abteilung];
    if (!departmentConfigEntry) {
      await interaction.reply({ content: `Ungültige Abteilung: ${abteilung}`, ephemeral: true });
      return;
    }

    const channel = await interaction.guild.channels.create({
      name: `${patient.replace(/ /g, '-')}`,
      type: 0,
      parent: departmentConfigEntry.categoryId,
      permissionOverwrites: [
        { id: interaction.guild.id, deny: ['ViewChannel'] },
        { id: departmentConfigEntry.memberRoleId, allow: ['ViewChannel', 'SendMessages'] },
      ],
    });

    const data = {
      abteilung, grund, patient, telefon, sonstiges, abteilungPing: `<@&${departmentConfigEntry.memberRoleId}>`,
      buttonMessageId: null, appointmentMessageId: null, completedMessageId: null,
      avpsMessageId: null, embedMessageId: null,
      appointmentDate: null, appointmentTime: null, acceptedBy: null, avpsLink: null,
      appointmentCompleted: false, isClosed: false, lastReset: false, callAttempt: false
    };

    ticketDataStore.set(channel.id, data);
    saveTicketData();

    const embed = new EmbedBuilder()
        .setTitle(`Behandlungsanfrage für ${data.abteilungPing}`)
        .setColor(0x480007)
        .addFields(createEmbedFields(data, {}));

    const embedMessage = await channel.send({
      content: `Eine neue Behandlungsanfrage (${data.abteilungPing})`,
      embeds: [embed],
      components: getButtonRows(data),
    });

    data.embedMessageId = embedMessage.id;
    saveTicketData();

    const confirmationEmbed = new EmbedBuilder()
        .setTitle('Ticket erfolgreich erstellt')
        .setColor(0x00FF00)
        .addFields([
          { name: 'Abteilung', value: data.abteilungPing, inline: false },
          { name: 'Grund', value: grund, inline: false },
          { name: 'Patient', value: patient, inline: false },
          { name: 'Telefon', value: telefon || 'Nicht angegeben', inline: false },
          { name: 'Sonstiges', value: sonstiges || 'Nicht angegeben', inline: false },
        ]);

    await interaction.reply({ embeds: [confirmationEmbed], ephemeral: true });
    await updateChannelName(channel, data);
  }

  if (interaction.isButton() && interaction.customId === 'close_ticket_button') {
    const ticketData = ticketDataStore.get(interaction.channel.id);
    if (!ticketData) {
      await interaction.reply({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
      return;
    }

    const department = ticketData.abteilung;
    const config = departmentConfig[department];
    await interaction.channel.permissionOverwrites.edit(config.memberRoleId, { SendMessages: false });
    await interaction.channel.permissionOverwrites.edit(config.leaderRoleId, { ViewChannel: true, SendMessages: true });
    await interaction.channel.permissionOverwrites.edit('1378976725903343657', { ViewChannel: true, SendMessages: true });
    await interaction.channel.permissionOverwrites.edit('1378976807432359986', { ViewChannel: true, SendMessages: true });

    ticketData.isClosed = true;
    saveTicketData();

    const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
    await embedMessage.edit({ components: getButtonRows(ticketData) });
    await updateChannelName(interaction.channel, ticketData);
    await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat das Ticket geschlossen.`);
    await interaction.deferUpdate();
  }

  if (interaction.isButton() && interaction.customId === 'reopen_ticket_button') {
    const ticketData = ticketDataStore.get(interaction.channel.id);
    if (!ticketData) {
      await interaction.reply({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
      return;
    }

    const config = departmentConfig[ticketData.abteilung];
    await interaction.channel.permissionOverwrites.edit(config.memberRoleId, { SendMessages: true });

    ticketData.isClosed = false;
    saveTicketData();

    const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
    await embedMessage.edit({ components: getButtonRows(ticketData) });
    await updateChannelName(interaction.channel, ticketData);
    await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat das Ticket wieder geöffnet.`);
    await interaction.deferUpdate();
  }

  if (interaction.isButton() && interaction.customId === 'delete_ticket_button') {
    const ticketData = ticketDataStore.get(interaction.channel.id);
    if (!ticketData) {
      await interaction.reply({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
      return;
    }

    const config = departmentConfig[ticketData.abteilung];
    const member = interaction.member;
    const isAdmin = member.roles.cache.has('1378976725903343657') || member.roles.cache.has('1378976807432359986');
    const isLeader = member.roles.cache.has(config.leaderRoleId);
    const canDelete = isAdmin || (isLeader && ticketData.isClosed);

    if (!canDelete) {
      await interaction.reply({ content: 'Du hast keine Berechtigung, dieses Ticket zu löschen. Nur Admins oder Abteilungsleiter (bei geschlossenen Tickets) dürfen löschen.', ephemeral: true });
      return;
    }

    archiveTicketData(interaction.channel.id, ticketData);
    const logChannel = bot.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel) await logChannel.send(`Ticket ${interaction.channel.id} wurde von ${interaction.user} gelöscht. Abteilung: ${ticketData.abteilung}, Patient: ${ticketData.patient}`);
    await interaction.channel.delete();
    ticketDataStore.delete(interaction.channel.id);
    saveTicketData();
  }

  if (interaction.isButton() && interaction.customId === 'takeover_ticket_button') {
    const modal = new ModalBuilder()
        .setCustomId('takeover_user_modal')
        .setTitle('Benutzer auswählen')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('user_input').setLabel('Nickname oder Nummer').setStyle(TextInputStyle.Short).setRequired(true)
            )
        );
    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'takeover_user_modal') {
    await interaction.deferUpdate();
    const userInput = interaction.fields.getTextInputValue('user_input')?.trim();
    const { mention: selectedUser, nickname } = await findUserInGuild(interaction.guild, userInput);
    const ticketData = ticketDataStore.get(interaction.channel.id);
    if (!ticketData) return;

    ticketData.acceptedBy = selectedUser;
    ticketData.nickname = nickname;
    ticketData.lastReset = false;
    saveTicketData();

    const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
    const updatedEmbed = new EmbedBuilder()
        .setTitle(embedMessage.embeds[0].title)
        .setColor(embedMessage.embeds[0].color)
        .addFields(createEmbedFields(ticketData, {}));
    await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
    await updateChannelName(interaction.channel, ticketData);
    await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat das Ticket ${selectedUser} zugewiesen.`);
  }

  if (interaction.isButton() && interaction.customId === 'call_attempt_button') {
    const ticketData = ticketDataStore.get(interaction.channel.id);
    if (!ticketData) return;
    ticketData.callAttempt = true;
    ticketData.lastReset = false;
    saveTicketData();
    await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat versucht anzurufen.`);
    const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
    const updatedEmbed = new EmbedBuilder()
        .setTitle(embedMessage.embeds[0].title)
        .setColor(embedMessage.embeds[0].color)
        .addFields(createEmbedFields(ticketData, {}));
    await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
    await updateChannelName(interaction.channel, ticketData);
    await interaction.deferUpdate();
  }

  if (interaction.isButton() && interaction.customId === 'schedule_appointment_button') {
    const modal = new ModalBuilder()
        .setCustomId('schedule_appointment_modal')
        .setTitle('Termin festlegen')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('date_input').setLabel('Datum (DD.MM.YYYY)').setStyle(TextInputStyle.Short).setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('time_input').setLabel('Uhrzeit (z.B. 14:30)').setStyle(TextInputStyle.Short).setRequired(false)
            )
        );
    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'schedule_appointment_modal') {
    const ticketData = ticketDataStore.get(interaction.channel.id);
    if (!ticketData) return;

    let date = interaction.fields.getTextInputValue('date_input')?.trim() || ticketData.appointmentDate || new Date().toLocaleDateString('de-DE');
    let time = interaction.fields.getTextInputValue('time_input')?.trim() || ticketData.appointmentTime || new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    ticketData.appointmentDate = date;
    ticketData.appointmentTime = time;
    ticketData.appointmentCompleted = false;
    ticketData.lastReset = false;
    ticketData.callAttempt = false; // Entfernt ☎️ bei Termin
    saveTicketData();

    const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
    const updatedEmbed = new EmbedBuilder()
        .setTitle(embedMessage.embeds[0].title)
        .setColor(embedMessage.embeds[0].color)
        .addFields(createEmbedFields(ticketData, {}));
    await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
    await updateChannelName(interaction.channel, ticketData);
    await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat einen Termin erstellt: ${date} - ${time}`);
    await interaction.deferUpdate();
  }

  if (interaction.isButton() && interaction.customId === 'no_show_button') {
    const ticketData = ticketDataStore.get(interaction.channel.id);
    if (!ticketData) return;

    ticketData.appointmentDate = null;
    ticketData.appointmentTime = null;
    ticketData.appointmentCompleted = false;
    ticketData.lastReset = false;
    saveTicketData();

    const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
    const updatedEmbed = new EmbedBuilder()
        .setTitle(embedMessage.embeds[0].title)
        .setColor(embedMessage.embeds[0].color)
        .addFields(createEmbedFields(ticketData, {}));
    await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
    await updateChannelName(interaction.channel, ticketData);
    await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat angegeben, dass der Patient nicht zum Termin erschienen ist.`);
    await interaction.deferUpdate();
  }

  if (interaction.isButton() && interaction.customId === 'reschedule_appointment_button') {
    const modal = new ModalBuilder()
        .setCustomId('reschedule_appointment_modal')
        .setTitle('Termin umlegen')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('date_input').setLabel('Neues Datum (DD.MM.YYYY)').setStyle(TextInputStyle.Short).setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('time_input').setLabel('Neue Uhrzeit (z.B. 14:30)').setStyle(TextInputStyle.Short).setRequired(false)
            )
        );
    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'reschedule_appointment_modal') {
    const ticketData = ticketDataStore.get(interaction.channel.id);
    if (!ticketData) return;

    let date = interaction.fields.getTextInputValue('date_input')?.trim() || ticketData.appointmentDate;
    let time = interaction.fields.getTextInputValue('time_input')?.trim() || ticketData.appointmentTime;

    ticketData.appointmentDate = date;
    ticketData.appointmentTime = time;
    ticketData.appointmentCompleted = false;
    ticketData.lastReset = false;
    saveTicketData();

    const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
    const updatedEmbed = new EmbedBuilder()
        .setTitle(embedMessage.embeds[0].title)
        .setColor(embedMessage.embeds[0].color)
        .addFields(createEmbedFields(ticketData, {}));
    await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
    await updateChannelName(interaction.channel, ticketData);
    await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat den Termin umgelegt: ${date} - ${time}`);
    await interaction.deferUpdate();
  }

  if (interaction.isButton() && interaction.customId === 'appointment_completed_button') {
    const ticketData = ticketDataStore.get(interaction.channel.id);
    if (!ticketData) return;

    ticketData.appointmentCompleted = true;
    ticketData.lastReset = false;
    saveTicketData();

    const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
    const updatedEmbed = new EmbedBuilder()
        .setTitle(embedMessage.embeds[0].title)
        .setColor(embedMessage.embeds[0].color)
        .addFields(createEmbedFields(ticketData, {}));
    await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
    await updateChannelName(interaction.channel, ticketData);
    await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat den Termin erledigt.`);
    await interaction.deferUpdate();
  }

  if (interaction.isButton() && interaction.customId === 'avps_link_button') {
    const modal = new ModalBuilder()
        .setCustomId('avps_link_modal')
        .setTitle('AVPS Akte hinterlegen')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('link_input').setLabel('Link zur AVPS Akte').setStyle(TextInputStyle.Short).setRequired(true)
            )
        );
    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'avps_link_modal') {
    const ticketData = ticketDataStore.get(interaction.channel.id);
    if (!ticketData) return;

    ticketData.avpsLink = interaction.fields.getTextInputValue('link_input')?.trim();
    ticketData.lastReset = false;
    saveTicketData();

    const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
    const updatedEmbed = new EmbedBuilder()
        .setTitle(embedMessage.embeds[0].title)
        .setColor(embedMessage.embeds[0].color)
        .addFields(createEmbedFields(ticketData, {}));
    await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
    await updateChannelName(interaction.channel, ticketData);
    await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat die AVPS Akte hinterlegt: ${ticketData.avpsLink}`);
    await interaction.deferUpdate();
  }

  if (interaction.isButton() && interaction.customId === 'edit_avps_link_button') {
    const modal = new ModalBuilder()
        .setCustomId('edit_avps_link_modal')
        .setTitle('AVPS Akte bearbeiten')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('link_input').setLabel('Neuer Link zur AVPS Akte').setStyle(TextInputStyle.Short).setRequired(true)
            )
        );
    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'edit_avps_link_modal') {
    const ticketData = ticketDataStore.get(interaction.channel.id);
    if (!ticketData) return;

    ticketData.avpsLink = interaction.fields.getTextInputValue('link_input')?.trim();
    ticketData.lastReset = false;
    saveTicketData();

    const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
    const updatedEmbed = new EmbedBuilder()
        .setTitle(embedMessage.embeds[0].title)
        .setColor(embedMessage.embeds[0].color)
        .addFields(createEmbedFields(ticketData, {}));
    await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
    await updateChannelName(interaction.channel, ticketData);
    await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat die AVPS Akte bearbeitet: ${ticketData.avpsLink}`);
    await interaction.deferUpdate();
  }

  if (interaction.isButton() && interaction.customId === 'delete_avps_link_button') {
    const ticketData = ticketDataStore.get(interaction.channel.id);
    if (!ticketData) return;

    ticketData.avpsLink = null;
    ticketData.lastReset = false;
    saveTicketData();

    const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
    const updatedEmbed = new EmbedBuilder()
        .setTitle(embedMessage.embeds[0].title)
        .setColor(embedMessage.embeds[0].color)
        .addFields(createEmbedFields(ticketData, {}));
    await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
    await updateChannelName(interaction.channel, ticketData);
    await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat die AVPS Akte gelöscht.`);
    await interaction.deferUpdate();
  }

  if (interaction.isButton() && interaction.customId === 'reset_ticket_button') {
    const ticketData = ticketDataStore.get(interaction.channel.id);
    if (!ticketData) return;

    ticketData.acceptedBy = null;
    ticketData.nickname = null;
    ticketData.appointmentDate = null;
    ticketData.appointmentTime = null;
    ticketData.appointmentCompleted = false;
    ticketData.avpsLink = null;
    ticketData.lastReset = true;
    ticketData.callAttempt = false;
    saveTicketData();

    const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
    const updatedEmbed = new EmbedBuilder()
        .setTitle(embedMessage.embeds[0].title)
        .setColor(embedMessage.embeds[0].color)
        .addFields(createEmbedFields(ticketData, {}));
    await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
    await updateChannelName(interaction.channel, ticketData);
    await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat das Ticket zurückgesetzt.`);
    await interaction.deferUpdate();
  }
});

// === START ===
bot.login(BOT_TOKEN).catch(err => console.error('(Bot) Login Fehler:', err));