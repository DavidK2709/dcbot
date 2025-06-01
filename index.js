require('dotenv').config();
const { Client } = require("discord.js-selfbot-v13");
const { Client: BotClient, GatewayIntentBits, EmbedBuilder, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");

// === CONFIG ===
const { DISCORD_TOKEN: USER_TOKEN, BOT_TOKEN, BOT_USER_ID, ALLOWED_GUILD, ALLOWED_CATEGORY_ID, TRIGGER_CHANNEL_ID, TICKET_TOOL_BOT_ID, TICKET_CREATOR_BOT_ID } = process.env;
const ticketDataStore = new Map();

// Timestamp-Helferfunktion
const getTimestamp = () => new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(', ', ' - ');

// Benutzer im Server suchen (nach Nummer oder Nickname)
const findUserInGuild = async (guild, input) => {
  try {
    const members = await guild.members.fetch();
    const cleanInput = input.trim();
    let member;

    // Prüfe, ob die Eingabe eine Zahl ist (z.B. "8" oder "08")
    const isNumber = /^\d+$/.test(cleanInput);
    if (isNumber) {
      const formattedNumber = cleanInput.padStart(2, '0'); // z.B. "8" -> "08"
      member = members.find(m => {
        const match = m.displayName.match(/\[(\d+)\]/);
        return match && match[1] === formattedNumber;
      });
      return member ? { mention: `<@${member.user.id}>`, nickname: member.displayName } : { mention: cleanInput, nickname: cleanInput };
    }

    // Suche nach Nickname
    member = members.find(m => m.displayName.replace(/\[[\d+]\]\s*/g, '').toLowerCase() === cleanInput.toLowerCase());
    return member ? { mention: `<@${member.user.id}>`, nickname: member.displayName } : { mention: cleanInput, nickname: cleanInput };
  } catch (err) {
    console.error(`(Bot) Fehler beim Abrufen der Mitgliederliste in ${guild.name} (${guild.id}):`, err);
    return { mention: cleanInput, nickname: cleanInput };
  }
};

// Button-Zeilen basierend auf Ticket-Daten erstellen
const getButtonRows = (ticketData) => {
  if (ticketData.isClosed) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('reopen_ticket_button').setLabel('Ticket wieder öffnen').setStyle(ButtonStyle.Success)
    )];
  }

  const hasInteraction = ticketData.acceptedBy || ticketData.appointmentDate || ticketData.appointmentTime || ticketData.avpsLink;
  const isResetDisabled = !hasInteraction || ticketData.lastReset; // Button deaktivieren, wenn keine Interaktion oder zuletzt zurückgesetzt
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

  const rows = [new ActionRowBuilder().addComponents(row1Components)];

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

// Embed-Felder in der gewünschten Reihenfolge erstellen
const createEmbedFields = (ticketData, ticketReasons) => {
  const fields = [
    { name: 'Abteilung', value: ticketData.abteilung || 'Nicht angegeben' },
    { name: 'Grund', value: ticketReasons[ticketData.grund] || ticketData.grund || 'Nicht angegeben' },
    { name: 'Patient', value: ` ${ticketData.patient || 'Nicht angegeben'}` },
    { name: 'Telefon', value: ticketData.telefon || 'Nicht angegeben' },
    { name: 'Sonstiges', value: ticketData.sonstiges || 'Nicht angegeben' }
  ];

  if (ticketData.acceptedBy) {
    fields.push({ name: 'Übernommen von', value: ticketData.acceptedBy, inline: true });
  }

  if (ticketData.appointmentDate && ticketData.appointmentTime) {
    fields.push({ name: 'Termin', value: ` ${ticketData.appointmentDate} -  ${ticketData.appointmentTime}` });
  }

  if (ticketData.avpsLink) {
    fields.push({ name: 'AVPS-Akte', value: ` ${ticketData.avpsLink}` });
  }

  return fields;
};

const userbot = new Client({ checkUpdate: false });
const bot = new BotClient({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel, Partials.Message]
});

// === Userbot: Ticket erstellen, Benutzer hinzufügen, Ticket umbenennen ===
userbot.on('ready', () => console.log(`(Userbot) Eingeloggt als ${userbot.user.tag}`));

userbot.on('messageCreate', async (message) => {
  if (message.channel.id !== TRIGGER_CHANNEL_ID || message.author.id !== BOT_USER_ID) return;

  const data = {
    abteilung: '', grund: '', patient: '', telefon: '', sonstiges: '', abteilungPing: '',
    buttonMessageId: null, appointmentMessageId: null, completedMessageId: null,
    avpsMessageId: null, embedMessageId: null,
    appointmentDate: null, appointmentTime: null, acceptedBy: null, avpsLink: null,
    appointmentCompleted: false, isClosed: false, lastReset: false
  };

  // Parsing der Nachricht
  const lines = message.content.split('\n').map(line => line.trim());
  for (const line of lines) {
    const match = line.match(/>\s\*\*(.+?):\*\*\s(.+)/);
    if (match) {
      const field = match[1].toLowerCase();
      const value = match[2].trim();
      if (field === 'abteilung') {
        // Extrahiere Rollen-ID aus Ping (z.B. <@&123456789>)
        const roleIdMatch = value.match(/<@&(\d+)>/);
        if (roleIdMatch) {
          const roleId = roleIdMatch[1];
          const role = message.guild?.roles.cache.get(roleId);
          data.abteilung = role ? role.name.replace(/[^a-zA-Z0-9-]/g, '-') : 'Nicht angegeben';
          data.abteilungPing = `<@&${roleId}>`;
        } else {
          data.abteilung = value.replace(/[^a-zA-Z0-9-]/g, '-');
          data.abteilungPing = value;
        }
      } else if (['grund', 'patient', 'telefon', 'sonstiges'].includes(field)) {
        data[field] = value;
      }
    }
  }

  if (!data.grund || !data.patient) {
    console.log(`(Userbot) Fehler: Grund oder Patient fehlt in Kanal ${message.channel.name} (${message.channel.id})`, message.content);
    return;
  }

  const ticketName = `{${data.grund}_${data.patient}}`;
  try {
    await message.channel.send(`$ticket ${ticketName}`);
    console.log(`(Userbot) Befehl gesendet: $ticket ${ticketName} in Kanal ${message.channel.name} (${message.channel.id})`);
    ticketDataStore.set(message.id, data);
    console.log(`(Userbot) Ticket-Daten gespeichert für Nachricht ${message.id}:`, data);
  } catch (err) {
    console.error(`(Userbot) Fehler beim Erstellen eines Tickets in Kanal ${message.channel.name} (${message.channel.id}):`, err);
  }
});

userbot.on('channelCreate', async (channel) => {
  if (channel.parentId !== ALLOWED_CATEGORY_ID) return;

  console.log(`(Userbot) Ticket-Kanal erkannt: ${channel.name} (${channel.id})`);

  setTimeout(async () => {
    try {
      // Hole die Nachrichten im Kanal (max. 10)
      const messages = await channel.messages.fetch({ limit: 10 });
      const firstMessage = messages.first();

      if (!firstMessage) {
        console.log(`(Userbot) Keine Nachrichten in Kanal ${channel.name} (${channel.id})`);
        return;
      }

      console.log(`(Userbot) Erste Nachricht in Kanal ${channel.name} (${channel.id}): Autor=${firstMessage.author.id}, Inhalt=${firstMessage.content}, Embeds=${firstMessage.embeds.length}`);

      const data = {
        abteilung: '', grund: '', patient: '', telefon: '', sonstiges: '', abteilungPing: '',
        buttonMessageId: null, appointmentMessageId: null, completedMessageId: null,
        avpsMessageId: null, embedMessageId: null,
        appointmentDate: null, appointmentTime: null, acceptedBy: null, avpsLink: null,
        appointmentCompleted: false, isClosed: false, lastReset: false
      };

      // Prüfe, ob es ein manuelles Ticket ist (Nachricht von TICKET_TOOL_BOT_ID mit gültigem Embed)
      let isManualTicket = false;
      let cleanAbteilung = 'Nicht angegeben'; // Für manuelle Tickets
      if (firstMessage.author.id === TICKET_TOOL_BOT_ID) {
        const embed = firstMessage.embeds.find(e => e.description);
        if (embed && embed.description) {
          const desc = embed.description;
          const patientMatch = desc.match(/\*\*Patientenname:\*\* ```\s*([\s\S]*?)```/);
          const concernMatch = desc.match(/\*\*Anliegen:\*\* ```\s*([\s\S]*?)```/);
          if (patientMatch && concernMatch) {
            isManualTicket = true;
            data.patient = patientMatch[1].trim() || 'Nicht angegeben';
            data.grund = concernMatch[1].trim() || 'Nicht angegeben';
            data.sonstiges = desc.match(/\*\*Aktivitätszeiten:\*\* ```\s*([\s\S]*?)```/)?.[1].trim() || 'Nicht angegeben';
            data.telefon = desc.match(/\*\*Telfonnummer für Rückfragen:\*\* ```\s*([\s\S]*?)```/)?.[1].trim() || 'Nicht angegeben';

            // Extrahiere Rollenname und Ping
            const roleIdMatch = firstMessage.content.match(/<@&(\d+)>/);
            const roleId = roleIdMatch ? roleIdMatch[1] : null;
            if (roleId) {
              const role = await channel.guild.roles.fetch(roleId).catch((err) => {
                console.error(`(Userbot) Fehler beim Abrufen der Rolle ${roleId}:`, err);
                return null;
              });
              data.abteilung = role ? `<@&${roleId}>` : 'Nicht angegeben';
              data.abteilungPing = role ? `<@&${roleId}>` : 'Nicht angegeben';
              cleanAbteilung = role ? role.name.replace(/[^a-zA-Z0-9-]/g, '-') : 'Nicht angegeben';
            } else {
              data.abteilung = 'Nicht angegeben';
              data.abteilungPing = 'Nicht angegeben';
            }

            ticketDataStore.set(firstMessage.id, data);
            console.log(`(Userbot) Daten aus Embed extrahiert und in ticketDataStore gespeichert für Nachricht ${firstMessage.id} in Kanal ${channel.name} (${channel.id})`, data);
          }
        }
      }

      // Automatisches Ticket: Verwende ticketDataStore-Daten
      if (!isManualTicket) {
        const latestTicketData = Array.from(ticketDataStore.entries())
            .reverse()
            .find(([_, data]) => data.grund && data.patient);
        if (!latestTicketData) {
          console.log(`(Userbot) Keine Ticket-Daten für automatisches Ticket in Kanal ${channel.name} (${channel.id})`);
          return;
        }
        Object.assign(data, latestTicketData[1]);

        // Setze Abteilung als Ping
        if (data.abteilungPing && data.abteilungPing !== 'Nicht angegeben') {
          const roleIdMatch = data.abteilungPing.match(/<@&(\d+)>/);
          const roleId = roleIdMatch ? roleIdMatch[1] : null;
          if (roleId) {
            const role = await channel.guild.roles.fetch(roleId).catch((err) => {
              console.error(`(Userbot) Fehler beim Abrufen der Rolle ${roleId} für automatisches Ticket:`, err);
              return null;
            });
            data.abteilung = `<@&${roleId}>`;
            console.log(`(Userbot) Rolle aufgelöst für automatisches Ticket: ${role ? role.name : 'Nicht gefunden'} (${roleId})`);
          } else {
            data.abteilung = 'Nicht angegeben';
          }
        } else {
          data.abteilung = 'Nicht angegeben';
        }
        console.log(`(Userbot) Automatische Ticket-Daten geladen für Kanal ${channel.name} (${channel.id})`, data);
      }

      // Benutzer hinzufügen
      let roleId = null;
      if (isManualTicket) {
        const roleIdMatch = firstMessage.content.match(/<@&(\d+)>/);
        roleId = roleIdMatch ? roleIdMatch[1] : null;
      } else if (data.abteilungPing && data.abteilungPing !== 'Nicht angegeben') {
        const roleIdMatch = data.abteilungPing.match(/<@&(\d+)>/);
        roleId = roleIdMatch ? roleIdMatch[1] : null;
      }
      if (roleId) {
        await channel.send(`$add ${roleId}`);
        console.log(`(Userbot) Rolle hinzugefügt: $add ${roleId} in Kanal ${channel.name} (${channel.id})`);
      }

      // Ticket umbenennen
      setTimeout(async () => {
        try {
          if (data.patient) {
            const cleanPatient = data.patient.replace(/[, ]/g, '');
            const ticketName = isManualTicket
                ? `ticket_${cleanAbteilung}_${cleanPatient}`
                : `${data.grund}_${cleanPatient}`;
            await channel.send(`$rename ${ticketName}`);
            console.log(`(Userbot) Ticket umbenannt: ${ticketName} in Kanal ${channel.name} (${channel.id})`);
          }

          // Lösche Ticket-Tool-Nachrichten
          const messages = await channel.messages.fetch({ limit: 10 });
          const ticketToolMessages = messages.filter(msg => msg.author.id === TICKET_TOOL_BOT_ID).first(2);

          for (const msg of ticketToolMessages) {
            await msg.delete();
            console.log(`(Userbot) Ticket Tool Nachricht gelöscht: ${msg.id} in Kanal ${channel.name} (${channel.id})`);
          }
        } catch (err) {
          console.error(`(Userbot) Fehler beim Umbenennen/Löschen in Kanal ${channel.name} (${channel.id}):`, err);
        }
      }, 2000);
    } catch (err) {
      console.error(`(Userbot) Fehler beim Verarbeiten des Kanals ${channel.name} (${channel.id}):`, err);
    }
  }, 3000);
});

// === Bot: Embed und Buttons in neuem Ticket-Kanal ===
bot.on('ready', () => console.log(`(Bot) Eingeloggt als ${bot.user.tag}`));

bot.on('channelCreate', async (channel) => {
  if (channel.parentId !== ALLOWED_CATEGORY_ID) return;

  console.log(`(Bot) Neuer Ticket-Kanal: ${channel.name} (${channel.id})`);

  setTimeout(async () => {
    try {
      const latestTicketData = Array.from(ticketDataStore.entries()).pop();
      if (!latestTicketData) {
        console.log(`(Bot) Keine Ticket-Daten in Kanal ${channel.name} (${channel.id})`);
        return;
      }

      const [, data] = latestTicketData;
      const ticketReasons = {
        ticket_arbeitsmedizinisches_polizei: 'Arbeitsmedizinisches Gutachten Polizeibewerber',
        ticket_arbeitsmedizinisches_jva: 'Arbeitsmedizinisches Gutachten JVA/Wachschutz',
        ticket_arbeitsmedizinisches_ammunation: 'Arbeitsmedizinisches Gutachten Ammunation',
        ticket_arbeitsmedizinisches_mediziner: 'Arbeitsmedizinisches Gutachten Mediziner'
      };

      // Prüfe, ob es ein automatisches Ticket ist
      const isAutomaticTicket = Object.keys(ticketReasons).includes(data.grund);
      const embedTitle = isAutomaticTicket
          ? `Behandlungsanfrage für ${ticketReasons[data.grund] || data.grund}`
          : `Behandlungsanfrage für ${data.abteilung.replace(/<@&(\d+)>/, 'Abteilung')}`;

      // Felder ohne inline, damit sie untereinander angezeigt werden
      const fields = [
        { name: 'Abteilung', value: data.abteilungPing || 'Nicht angegeben', inline: false },
        { name: 'Grund', value: isAutomaticTicket ? ticketReasons[data.grund] || data.grund : data.grund || 'Nicht angegeben', inline: false },
        { name: 'Patient', value: data.patient || 'Nicht angegeben', inline: false },
        { name: 'Telefon', value: data.telefon || 'Nicht angegeben', inline: false },
        { name: 'Sonstiges', value: data.sonstiges || 'Nicht angegeben', inline: false }
      ];

      const embed = new EmbedBuilder()
          .setTitle(embedTitle)
          .setColor(0x480007)
          .addFields(fields);

      const embedMessage = await channel.send({
        content: `Eine neue Behandlungsanfrage (${data.abteilungPing})`,
        embeds: [embed],
        components: getButtonRows(data)
      });

      data.embedMessageId = embedMessage.id;
      data.buttonMessageId = embedMessage.id;
      console.log(`(Bot) Embed mit Buttons gesendet: ${embedMessage.id} in Kanal ${channel.name} (${channel.id})`);
    } catch (err) {
      console.error(`(Bot) Fehler beim Senden des Embeds in Kanal ${channel.name} (${channel.id}):`, err);
    }
  }, 7000);
});

// === Interaction Handlers ===
bot.on('interactionCreate', async (interaction) => {
  const channelName = interaction.channel?.name || 'Unbekannt';
  const channelId = interaction.channel?.id || 'Unbekannt';
  const userTag = interaction.user?.tag || 'Unbekannt';
  const ticketReasons = {
    ticket_arbeitsmedizinisches_polizei: 'Arbeitsmedizinisches Gutachten Polizeibewerber',
    ticket_arbeitsmedizinisches_jva: 'Arbeitsmedizinisches Gutachten JVA/Wachschutz',
    ticket_arbeitsmedizinisches_ammunation: 'Arbeitsmedizinisches Gutachten Ammunation',
    ticket_arbeitsmedizinisches_mediziner: 'Arbeitsmedizinisches Gutachten Mediziner'
  };

  // Button: Ticket vergeben
  if (interaction.isButton() && interaction.customId === 'takeover_ticket_button') {
    try {
      const modal = new ModalBuilder()
          .setCustomId('takeover_user_modal')
          .setTitle('Benutzer auswählen')
          .addComponents(
              new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                      .setCustomId('user_input')
                      .setLabel('Nickname oder Nummer (z.B. 30 für [30])')
                      .setStyle(TextInputStyle.Short)
                      .setRequired(true)
              )
          );

      await interaction.showModal(modal);
      console.log(`(Bot) Modal für Benutzerauswahl geöffnet in Kanal ${channelName} (${channelId}) von ${userTag}`);
    } catch (err) {
      console.error(`(Bot) Fehler beim Öffnen des Modals (takeover_user) in Kanal ${channelName} (${channelId}) von ${userTag}:`, err);
      await interaction.reply({ content: 'Fehler beim Öffnen des Modals. Bitte versuche es erneut.', ephemeral: true });
    }
  }

  // Modal-Submit: Benutzerübernahme
  if (interaction.isModalSubmit() && interaction.customId === 'takeover_user_modal') {
    try {
      await interaction.deferUpdate();
      const userInput = interaction.fields.getTextInputValue('user_input')?.trim();
      const { mention: selectedUser, nickname } = await findUserInGuild(interaction.guild, userInput);
      const currentUserMention = `<@${interaction.user.id}>`;

      const ticketData = Array.from(ticketDataStore.values()).find(data => data.embedMessageId);
      if (!ticketData) {
        console.warn(`(Bot) Kein ticketData in Kanal ${channelName} (${channelId}) von ${userTag}`);
        await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true }).catch(() => {});
        return;
      }

      let embedMessage;
      try {
        embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
      } catch (err) {
        if (err.code === 10008) {
          const newEmbed = new EmbedBuilder()
              .setTitle(`Behandlungsanfrage für ${ticketData.abteilung}`)
              .setColor('#FF0000')
              .addFields(createEmbedFields(ticketData, ticketReasons));
          embedMessage = await interaction.channel.send({ embeds: [newEmbed], components: getButtonRows(ticketData) });
          ticketData.embedMessageId = embedMessage.id;
          console.log(`(Bot) Neue Embedded-Nachricht erstellt: ${ticketData.embedMessageId} in Kanal ${channelName} (${channelId})`);
        } else {
          throw err;
        }
      }

      ticketData.acceptedBy = selectedUser;
      ticketData.nickname = nickname;
      ticketData.lastReset = false; // Reset-Status zurücksetzen, da eine neue Interaktion erfolgt ist
      const currentEmbed = embedMessage.embeds[0];
      const updatedEmbed = new EmbedBuilder()
          .setTitle(currentEmbed.title)
          .setColor(currentEmbed.color)
          .addFields(createEmbedFields(ticketData, ticketReasons));

      await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
      const messageContent = selectedUser === currentUserMention
          ? `[${getTimestamp()}] ${currentUserMention} hat das Ticket übernommen.`
          : `[${getTimestamp()}] ${currentUserMention} hat das Ticket ${selectedUser} zugewiesen.`;
      await interaction.channel.send({ content: messageContent });
      console.log(`(Bot) Embed aktualisiert (Benutzerübernahme) in Nachricht ${ticketData.embedMessageId} in Kanal ${channelName} (${channelId}) von ${userTag}`);
    } catch (err) {
      console.error(`(Bot) Fehler beim Modal-Submit (takeover_user) in Kanal ${channelName} (${channelId}) von ${userTag}:`, err);
      await interaction.followUp({ content: 'Fehler beim Übernehmen des Tickets.', ephemeral: true }).catch(() => {});
    }
  }

  // Button: Versucht anzurufen
  if (interaction.isButton() && interaction.customId === 'call_attempt_button') {
    try {
      const timestamp = getTimestamp();
      await interaction.channel.send(`[${timestamp}] ${interaction.user} hat versucht anzurufen.`);
      const ticketData = Array.from(ticketDataStore.values()).find(data => data.embedMessageId === interaction.message.id);
      if (ticketData) {
        ticketData.lastReset = false; // Reset-Status zurücksetzen, da eine neue Interaktion erfolgt ist
        const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
        await embedMessage.edit({ embeds: [embedMessage.embeds[0]], components: getButtonRows(ticketData) });
      }
      await interaction.deferUpdate();
      console.log(`(Bot) Button geklickt (call_attempt) in Kanal ${channelName} (${channelId}) von ${userTag}`);
    } catch (err) {
      console.error(`(Bot) Fehler bei Button (call_attempt) in Kanal ${channelName} (${channelId}) von ${userTag}:`, err);
    }
  }

  // Button: Termin festlegen
  if (interaction.isButton() && interaction.customId === 'schedule_appointment_button') {
    try {
      const modal = new ModalBuilder()
          .setCustomId('schedule_appointment_modal')
          .setTitle('Termin festlegen')
          .addComponents(
              new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                      .setCustomId('date_input')
                      .setLabel('Datum (DD.MM.YYYY, z.B. 31.05.2025)')
                      .setStyle(TextInputStyle.Short)
                      .setRequired(false)
              ),
              new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                      .setCustomId('time_input')
                      .setLabel('Uhrzeit (z.B. 14:30)')
                      .setStyle(TextInputStyle.Short)
                      .setRequired(false)
              )
          );

      await interaction.showModal(modal);
      console.log(`(Bot) Modal für Termin festlegen geöffnet in Kanal ${channelName} (${channelId}) von ${userTag}`);
    } catch (err) {
      console.error(`(Bot) Fehler beim Öffnen des Modals (schedule_appointment) in Kanal ${channelName} (${channelId}) von ${userTag}:`, err);
    }
  }

  // Button: Schließen (direktes Schließen ohne Bestätigung)
  if (interaction.isButton() && interaction.customId === 'close_ticket_button') {
    try {
      // Sende den $close Befehl
      await userbot.channels.cache.get(interaction.channel.id).send('$close');
      console.log(`(Bot) $close Befehl gesendet in Kanal ${channelName} (${channelId}) von ${userTag}`);

      const ticketData = Array.from(ticketDataStore.values()).find(data => data.embedMessageId);
      if (ticketData && ticketData.embedMessageId) {
        try {
          const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
          ticketData.isClosed = true;
          await embedMessage.edit({ embeds: [embedMessage.embeds[0]], components: getButtonRows(ticketData) });
          console.log(`(Bot) Embed aktualisiert (Ticket geschlossen) in Nachricht ${ticketData.embedMessageId} in Kanal ${channelName} (${channelId})`);
        } catch (err) {
          if (err.code !== 10008) throw err;
          console.warn(`(Bot) Nachricht ${ticketData.embedMessageId} nicht gefunden in Kanal ${channelName} (${channelId})`);
        }
      }

      // Sende die normale Bestätigungsnachricht
      await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat das Ticket geschlossen.`);
      console.log(`(Bot) Normale Bestätigungsnachricht gesendet in Kanal ${channelName} (${channelId})`);

      // Cleanup nach 10 Sekunden
      setTimeout(async () => {
        try {
          if (!ticketData || !ticketData.embedMessageId || !TICKET_TOOL_BOT_ID) {
            console.warn('(Bot) Ungültige Konfiguration oder fehlende ticketData.embedMessageId – überspringe Cleanup');
            return;
          }

          console.log(`(Bot) Cleanup gestartet.`);

          // Hole die Nachrichten im Channel (max. 100)
          const messages = await interaction.channel.messages.fetch({ limit: 100 });

          // Filtere alle Nachrichten von TICKET_TOOL_BOT_ID
          const ticketToolMessages = messages.filter(msg => {
            const isTicketTool = msg.author.id === TICKET_TOOL_BOT_ID;
            const isNotCreatorEmbed = msg.author.id !== TICKET_CREATOR_BOT_ID;
            const isNotEmbedMsg = msg.id !== ticketData.embedMessageId;
            return isTicketTool && isNotCreatorEmbed && isNotEmbedMsg;
          });

          console.log(`(Bot) Gefundene Nachrichten von TICKET_TOOL_BOT_ID: ${ticketToolMessages.size} in Kanal ${channelName} (${channelId})`);
          console.log(`→ Zu löschende IDs: ${ticketToolMessages.map(m => m.id).join(', ')}`);

          // Lösche die gefilterten Nachrichten
          for (const msg of ticketToolMessages.values()) {
            try {
              await msg.delete();
              console.log(`(Bot) Nachricht gelöscht: ${msg.id} (Embed: ${msg.embeds.length > 0}) in Kanal ${channelName} (${channelId})`);
            } catch (deleteErr) {
              console.error(`(Bot) Fehler beim Löschen der Nachricht ${msg.id} in Kanal ${channelName} (${channelId}):`, deleteErr);
            }
          }
        } catch (err) {
          console.error(`(Bot) Fehler beim Laden oder Löschen von TICKET_TOOL Nachrichten in Kanal ${channelName} (${channelId}):`, err);
        }
      }, 10000);

      console.log(`(Bot) Ticket geschlossen in Kanal ${channelName} (${channelId}) von ${userTag}`);
    } catch (err) {
      console.error(`(Bot) Fehler beim Schließen in Kanal ${channelName} (${channelId}) von ${userTag}:`, err);
      await interaction.reply({ content: 'Fehler beim Schließen des Tickets.', ephemeral: true }).catch(() => {});
    }
  }

  // Button: Ticket wieder öffnen
  if (interaction.isButton() && interaction.customId === 'reopen_ticket_button') {
    try {
      console.log(`(Bot) Verarbeitung für Interaktion in Kanal ${channelName} (${channelId}) von ${userTag}`);

      // Prüfe, ob die Nachricht noch existiert, bevor wir etwas tun
      const originalMessageId = interaction.message.id;
      try {
        await interaction.channel.messages.fetch(originalMessageId);
        console.log(`(Bot) Nachricht ${originalMessageId} existiert vor der Aktion in Kanal ${channelName} (${channelId})`);
      } catch (err) {
        console.error(`(Bot) Nachricht ${originalMessageId} existiert nicht mehr vor der Aktion:`, err);
      }

      // Sende den $open Befehl
      await userbot.channels.cache.get(interaction.channel.id).send('$open');
      console.log(`(Bot) $open Befehl gesendet in Kanal ${channelName} (${channelId}) von ${userTag}`);

      // Sende die Benachrichtigung
      await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat das Ticket wieder geöffnet.`);

      // Finde das entsprechende ticketData
      const ticketData = Array.from(ticketDataStore.entries())
          .find(([_, data]) => data.embedMessageId === originalMessageId)?.[1];
      if (ticketData) {
        ticketData.isClosed = false; // Setze das Ticket auf "offen"
        const updatedComponents = getButtonRows(ticketData); // Hole die neuen Buttons
        await interaction.message.edit({ components: updatedComponents });
        console.log(`(Bot) Buttons aktualisiert für Nachricht ${originalMessageId} in Kanal ${channelName} (${channelId})`);
      } else {
        console.warn(`(Bot) Kein ticketData für Nachricht ${originalMessageId} gefunden in Kanal ${channelName} (${channelId})`);
      }

      // Teste mit deferReply statt deferUpdate
      await interaction.deferReply({ ephemeral: true });
      await interaction.followUp({ content: 'Ticket erfolgreich wieder geöffnet.', ephemeral: true });

      // Cleanup nach 8 Sekunden
      setTimeout(async () => {
        try {
          if (!ticketData || !ticketData.embedMessageId || !TICKET_TOOL_BOT_ID) {
            console.warn('(Bot) Ungültige Konfiguration oder fehlende ticketData.embedMessageId – überspringe Cleanup');
            return;
          }

          // Hole die Nachrichten im Channel (max. 100)
          const messages = await interaction.channel.messages.fetch({ limit: 100 });

          // Filtere alle Nachrichten von TICKET_TOOL_BOT_ID
          const ticketToolMessages = messages.filter(msg => {
            const isTicketTool = msg.author.id === TICKET_TOOL_BOT_ID;
            const isNotCreatorEmbed = msg.author.id !== TICKET_CREATOR_BOT_ID;
            const isNotEmbedMsg = msg.id !== ticketData.embedMessageId; // Schütze die Haupt-Embed-Nachricht
            return isTicketTool && isNotCreatorEmbed && isNotEmbedMsg;
          });

          console.log(`(Bot) Gefundene Nachrichten von TICKET_TOOL_BOT_ID: ${ticketToolMessages.size} in Kanal ${channelName} (${channelId})`);
          console.log(`→ Zu löschende IDs: ${ticketToolMessages.map(m => m.id).join(', ')}`);

          // Lösche die gefilterten Nachrichten
          for (const msg of ticketToolMessages.values()) {
            try {
              await msg.delete();
              console.log(`(Bot) Nachricht gelöscht: ${msg.id} (Embed: ${msg.embeds.length > 0}) in Kanal ${channelName} (${channelId})`);
            } catch (deleteErr) {
              console.error(`(Bot) Fehler beim Löschen der Nachricht ${msg.id} in Kanal ${channelName} (${channelId}):`, deleteErr);
            }
          }
        } catch (err) {
          console.error(`(Bot) Fehler beim Laden oder Löschen von TICKET_TOOL Nachrichten in Kanal ${channelName} (${channelId}):`, err);
        }
      }, 6000);

      // Lösche die ephemeral Reply nach 5 Sekunden
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      console.log(`(Bot) Benachrichtigung gesendet in Kanal ${channelName} (${channelId}) von ${userTag}`);
    } catch (err) {
      console.error(`(Bot) Fehler beim Wiederöffnen in Kanal ${channelName} (${channelId}) von ${userTag}:`, err);
      await interaction.followUp({ content: 'Fehler beim Wiederöffnen des Tickets: ' + err.message, ephemeral: true }).catch(() => {});
    }
  }

  // Button: Ticket zurücksetzen
  if (interaction.isButton() && interaction.customId === 'reset_ticket_button') {
    try {
      const ticketData = Array.from(ticketDataStore.values()).find(data => data.embedMessageId === interaction.message.id);
      if (ticketData && ticketData.embedMessageId) {
        // Zurücksetzen der Interaktionen
        ticketData.acceptedBy = null;
        ticketData.nickname = null;
        ticketData.appointmentDate = null;
        ticketData.appointmentTime = null;
        ticketData.appointmentCompleted = false;
        ticketData.avpsLink = null;
        ticketData.lastReset = true; // Setze lastReset auf true, um weiteren Reset zu verhindern

        const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
        const currentEmbed = embedMessage.embeds[0];
        const updatedEmbed = new EmbedBuilder()
            .setTitle(currentEmbed.title)
            .setColor(currentEmbed.color)
            .addFields(createEmbedFields(ticketData, ticketReasons));
        await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
        console.log(`(Bot) Embed zurückgesetzt in Nachricht ${ticketData.embedMessageId} in Kanal ${channelName} (${channelId})`);

        // Nachricht mit durchgezogenem Strich senden
        await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat das Ticket zurückgesetzt.\n──────────────────────────`);
      }

      await interaction.deferUpdate();
      console.log(`(Bot) Ticket zurückgesetzt in Kanal ${channelName} (${channelId}) von ${userTag}`);
    } catch (err) {
      console.error(`(Bot) Fehler beim Zurücksetzen des Tickets in Kanal ${channelName} (${channelId}) von ${userTag}:`, err);
      await interaction.followUp({ content: 'Fehler beim Zurücksetzen des Tickets.', ephemeral: true }).catch(() => {});
    }
  }

  // Button: Nicht zum Termin erschienen
  if (interaction.isButton() && interaction.customId === 'no_show_button') {
    try {
      const ticketData = Array.from(ticketDataStore.values()).find(data => data.embedMessageId === interaction.message.id);
      if (ticketData && ticketData.embedMessageId) {
        ticketData.appointmentDate = null;
        ticketData.appointmentTime = null;
        ticketData.appointmentCompleted = false;
        ticketData.lastReset = false; // Reset-Status zurücksetzen, da eine neue Interaktion erfolgt ist
        const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
        const currentEmbed = embedMessage.embeds[0];
        const updatedEmbed = new EmbedBuilder()
            .setTitle(currentEmbed.title)
            .setColor(currentEmbed.color)
            .addFields(createEmbedFields(ticketData, ticketReasons));
        await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
        console.log(`(Bot) Embed aktualisiert (Termin entfernt) in Nachricht ${ticketData.embedMessageId} in Kanal ${channelName} (${channelId})`);
      }

      await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat angegeben, dass der Patient nicht zum Termin erschienen ist.`);
      await interaction.deferUpdate();
      console.log(`(Bot) Button geklickt (no_show) in Kanal ${channelName} (${channelId}) von ${userTag}`);
    } catch (err) {
      console.error(`(Bot) Fehler bei Button (no_show) in Kanal ${channelName} (${channelId}) von ${userTag}:`, err);
    }
  }

  // Button: Termin umlegen
  if (interaction.isButton() && interaction.customId === 'reschedule_appointment_button') {
    try {
      const modal = new ModalBuilder()
          .setCustomId('reschedule_appointment_modal')
          .setTitle('Termin umlegen')
          .addComponents(
              new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                      .setCustomId('date_input')
                      .setLabel('Neues Datum (DD.MM.YYYY, z.B. 31.05.2025)')
                      .setStyle(TextInputStyle.Short)
                      .setRequired(false)
              ),
              new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                      .setCustomId('time_input')
                      .setLabel('Neue Uhrzeit (z.B. 14:30)')
                      .setStyle(TextInputStyle.Short)
                      .setRequired(false)
              )
          );

      await interaction.showModal(modal);
      console.log(`(Bot) Modal für Termin umlegen geöffnet in Kanal ${channelName} (${channelId}) von ${userTag}`);
    } catch (err) {
      console.error(`(Bot) Fehler beim Öffnen des Modals (reschedule_appointment) in Kanal ${channelName} (${channelId}) von ${userTag}:`, err);
    }
  }

  // Button: Termin erledigt
  if (interaction.isButton() && interaction.customId === 'appointment_completed_button') {
    try {
      const ticketData = Array.from(ticketDataStore.values()).find(data => data.embedMessageId === interaction.message.id);
      if (ticketData && ticketData.embedMessageId) {
        ticketData.appointmentCompleted = true;
        ticketData.lastReset = false; // Reset-Status zurücksetzen, da eine neue Interaktion erfolgt ist
        const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
        const currentEmbed = embedMessage.embeds[0];
        const updatedEmbed = new EmbedBuilder()
            .setTitle(currentEmbed.title)
            .setColor(currentEmbed.color)
            .addFields(createEmbedFields(ticketData, ticketReasons));
        await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
        console.log(`(Bot) Embed aktualisiert (Termin erledigt) in Nachricht ${ticketData.embedMessageId} in Kanal ${channelName} (${channelId})`);
      }

      await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat den Termin erledigt.`);
      await interaction.deferUpdate();
      console.log(`(Bot) Termin erledigt in Kanal ${channelName} (${channelId}) von ${userTag}`);
    } catch (err) {
      console.error(`(Bot) Fehler bei Button (appointment_completed) in Kanal ${channelName} (${channelId}) von ${userTag}:`, err);
    }
  }

  // Button: AVPS Akte hinterlegen
  if (interaction.isButton() && interaction.customId === 'avps_link_button') {
    try {
      const modal = new ModalBuilder()
          .setCustomId('avps_link_modal')
          .setTitle('AVPS Akte hinterlegen')
          .addComponents(
              new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                      .setCustomId('link_input')
                      .setLabel('Link zur AVPS Akte')
                      .setStyle(TextInputStyle.Short)
                      .setRequired(true)
              )
          );

      await interaction.showModal(modal);
      console.log(`(Bot) Modal für AVPS Akte geöffnet in Kanal ${channelName} (${channelId}) von ${userTag}`);
    } catch (err) {
      console.error(`(Bot) Fehler beim Öffnen des Modals (avps_link) in Kanal ${channelName} (${channelId}) von ${userTag}:`, err);
    }
  }

  // Button: AVPS Akte bearbeiten
  if (interaction.isButton() && interaction.customId === 'edit_avps_link_button') {
    try {
      const modal = new ModalBuilder()
          .setCustomId('edit_avps_link_modal')
          .setTitle('AVPS Akte bearbeiten')
          .addComponents(
              new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                      .setCustomId('link_input')
                      .setLabel('Neuer Link zur AVPS Akte')
                      .setStyle(TextInputStyle.Short)
                      .setRequired(true)
              )
          );

      await interaction.showModal(modal);
      console.log(`(Bot) Modal für AVPS Akte bearbeiten geöffnet in Kanal ${channelName} (${channelId}) von ${userTag}`);
    } catch (err) {
      console.error(`(Bot) Fehler beim Öffnen des Modals (edit_avps_link) in Kanal ${channelName} (${channelId}) von ${userTag}:`, err);
    }
  }

  // Button: AVPS Akte löschen
  if (interaction.isButton() && interaction.customId === 'delete_avps_link_button') {
    try {
      const ticketData = Array.from(ticketDataStore.values()).find(data => data.embedMessageId === interaction.message.id);
      if (ticketData && ticketData.embedMessageId) {
        ticketData.avpsLink = null;
        ticketData.lastReset = false; // Reset-Status zurücksetzen, da eine neue Interaktion erfolgt ist
        const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
        const currentEmbed = embedMessage.embeds[0];
        const updatedEmbed = new EmbedBuilder()
            .setTitle(currentEmbed.title)
            .setColor(currentEmbed.color)
            .addFields(createEmbedFields(ticketData, ticketReasons));
        await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
        console.log(`(Bot) AVPS Link gelöscht in Nachricht ${ticketData.embedMessageId} in Kanal ${channelName} (${channelId})`);
      }

      await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat die AVPS Akte gelöscht.`);
      await interaction.deferUpdate();
      console.log(`(Bot) AVPS Akte gelöscht in Kanal ${channelName} (${channelId}) von ${userTag}`);
    } catch (err) {
      console.error(`(Bot) Fehler beim Löschen der AVPS Akte in Kanal ${channelName} (${channelId}) von ${userTag}:`, err);
    }
  }

  // Modal-Submit: Termin festlegen
  if (interaction.isModalSubmit() && interaction.customId === 'schedule_appointment_modal') {
    try {
      let date = interaction.fields.getTextInputValue('date_input')?.trim() || '';
      let time = interaction.fields.getTextInputValue('time_input')?.trim() || '';
      const user = interaction.user;

      const ticketData = Array.from(ticketDataStore.values()).find(data => data.embedMessageId === interaction.message.id);
      if (!ticketData || !ticketData.embedMessageId) {
        await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
        console.warn(`(Bot) Kein ticketData in Kanal ${channelName} (${channelId}) von ${userTag}`);
        return;
      }

      const now = new Date();
      const defaultDate = now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const defaultTime = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

      // Behalte alte Werte, wenn Eingaben leer sind
      if (!date && ticketData.appointmentDate) {
        date = ticketData.appointmentDate;
      }
      if (!time && ticketData.appointmentTime) {
        time = ticketData.appointmentTime;
      }

      // Setze aktuelles Datum/Uhrzeit, wenn keine Werte vorhanden sind
      const finalDate = date || ticketData.appointmentDate || defaultDate;
      const finalTime = time || ticketData.appointmentTime || defaultTime;

      const dateRegex = /^\d{2}\.\d{2}\.\d{4}$/;
      if (date && !dateRegex.test(date)) {
        await interaction.channel.send(`[${getTimestamp()}] ${user.tag}, ungültiges Datumsformat. Bitte verwende DD.MM.YYYY. Alter Wert wird beibehalten.`);
        console.log(`(Bot) Ungültiges Datumsformat in Kanal ${channelName} (${channelId}) von ${userTag}`);
      } else {
        ticketData.appointmentDate = finalDate;
        ticketData.appointmentTime = finalTime;
        ticketData.appointmentCompleted = false;
        ticketData.lastReset = false; // Reset-Status zurücksetzen, da eine neue Interaktion erfolgt ist

        const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
        const currentEmbed = embedMessage.embeds[0];
        const updatedEmbed = new EmbedBuilder()
            .setTitle(currentEmbed.title)
            .setColor(currentEmbed.color)
            .addFields(createEmbedFields(ticketData, ticketReasons));
        await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
        console.log(`(Bot) Embed aktualisiert mit Termin in Nachricht ${ticketData.embedMessageId} in Kanal ${channelName} (${channelId})`);

        await interaction.channel.send(`[${getTimestamp()}] ${user} hat einen Termin erstellt: Datum ${finalDate}, Uhrzeit ${finalTime}`);
      }

      await interaction.deferUpdate();
      console.log(`(Bot) Modal-Submit (schedule_appointment) in Kanal ${channelName} (${channelId}) von ${userTag}`);
    } catch (err) {
      console.error(`(Bot) Fehler bei Modal-Submit (schedule_appointment) in Kanal ${channelName} (${channelId}) von ${userTag}:`, err);
      await interaction.followUp({ content: 'Fehler beim Erstellen des Termins.', ephemeral: true });
    }
  }

  // Modal-Submit: Termin umlegen
  if (interaction.isModalSubmit() && interaction.customId === 'reschedule_appointment_modal') {
    try {
      let date = interaction.fields.getTextInputValue('date_input')?.trim() || '';
      let time = interaction.fields.getTextInputValue('time_input')?.trim() || '';
      const user = interaction.user;

      const ticketData = Array.from(ticketDataStore.values()).find(data => data.embedMessageId === interaction.message.id);
      if (!ticketData || !ticketData.embedMessageId) {
        await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
        console.warn(`(Bot) Kein ticketData in Kanal ${channelName} (${channelId}) von ${userTag}`);
        return;
      }

      const now = new Date();
      const defaultDate = now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const defaultTime = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

      // Behalte alte Werte, wenn Eingaben leer sind
      if (!date && ticketData.appointmentDate) {
        date = ticketData.appointmentDate;
      }
      if (!time && ticketData.appointmentTime) {
        time = ticketData.appointmentTime;
      }

      // Setze aktuelles Datum/Uhrzeit, wenn keine Werte vorhanden sind
      const finalDate = date || ticketData.appointmentDate || defaultDate;
      const finalTime = time || ticketData.appointmentTime || defaultTime;

      const dateRegex = /^\d{2}\.\d{2}\.\d{4}$/;
      if (date && !dateRegex.test(date)) {
        await interaction.channel.send(`[${getTimestamp()}] ${user.tag}, ungültiges Datumsformat. Bitte verwende DD.MM.YYYY. Alter Wert wird beibehalten.`);
        console.log(`(Bot) Ungültiges Datumsformat in Kanal ${channelName} (${channelId}) von ${userTag}`);
      } else {
        ticketData.appointmentDate = finalDate;
        ticketData.appointmentTime = finalTime;
        ticketData.appointmentCompleted = false;
        ticketData.lastReset = false; // Reset-Status zurücksetzen, da eine neue Interaktion erfolgt ist

        const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
        const currentEmbed = embedMessage.embeds[0];
        const updatedEmbed = new EmbedBuilder()
            .setTitle(currentEmbed.title)
            .setColor(currentEmbed.color)
            .addFields(createEmbedFields(ticketData, ticketReasons));
        await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
        console.log(`(Bot) Embed aktualisiert mit neuem Termin in Nachricht ${ticketData.embedMessageId} in Kanal ${channelName} (${channelId})`);

        await interaction.channel.send(`[${getTimestamp()}] ${user} hat den Termin umgelegt: Datum ${finalDate}, Uhrzeit ${finalTime}`);
      }

      await interaction.deferUpdate();
      console.log(`(Bot) Modal-Submit (reschedule_appointment) in Kanal ${channelName} (${channelId}) von ${userTag}`);
    } catch (err) {
      console.error(`(Bot) Fehler bei Modal-Submit (reschedule_appointment) in Kanal ${channelName} (${channelId}) von ${userTag}:`, err);
      await interaction.followUp({ content: 'Fehler beim Umlegen des Termins.', ephemeral: true });
    }
  }

  // Modal-Submit: AVPS Akte hinterlegen
  if (interaction.isModalSubmit() && interaction.customId === 'avps_link_modal') {
    try {
      const link = interaction.fields.getTextInputValue('link_input')?.trim();
      const user = interaction.user;
      const ticketData = Array.from(ticketDataStore.values()).find(data => data.embedMessageId === interaction.message.id);
      if (ticketData && ticketData.embedMessageId) {
        ticketData.avpsLink = link;
        ticketData.lastReset = false; // Reset-Status zurücksetzen, da eine neue Interaktion erfolgt ist
        const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
        const currentEmbed = embedMessage.embeds[0];
        const updatedEmbed = new EmbedBuilder()
            .setTitle(currentEmbed.title)
            .setColor(currentEmbed.color)
            .addFields(createEmbedFields(ticketData, ticketReasons));
        await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
        console.log(`(Bot) Embed aktualisiert mit AVPS Link in Nachricht ${ticketData.embedMessageId} in Kanal ${channelName} (${channelId})`);
      }

      await interaction.channel.send(`[${getTimestamp()}] ${user} hat die AVPS Akte hinterlegt: ${link}`);
      await interaction.deferUpdate();
      console.log(`(Bot) Modal-Submit (avps_link) in Kanal ${channelName} (${channelId}) von ${userTag}`);
    } catch (err) {
      console.error(`(Bot) Fehler bei Modal-Submit (avps_link) in Kanal ${channelName} (${channelId}) von ${userTag}:`, err);
      await interaction.followUp({ content: 'Fehler beim Hinterlegen der AVPS Akte.', ephemeral: true });
    }
  }

// Modal-Submit: AVPS Akte bearbeiten
  if (interaction.isModalSubmit() && interaction.customId === 'edit_avps_link_modal') {
    try {
      const newLink = interaction.fields.getTextInputValue('link_input')?.trim();
      const user = interaction.user;
      const ticketData = Array.from(ticketDataStore.values()).find(data => data.embedMessageId === interaction.message.id);
      if (ticketData && ticketData.embedMessageId) {
        ticketData.avpsLink = newLink;
        ticketData.lastReset = false; // Reset-Status zurücksetzen, da eine neue Interaktion erfolgt ist
        const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
        const currentEmbed = embedMessage.embeds[0];
        const updatedEmbed = new EmbedBuilder()
            .setTitle(currentEmbed.title)
            .setColor(currentEmbed.color)
            .addFields(createEmbedFields(ticketData, ticketReasons));
        await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
        console.log(`(Bot) Embed aktualisiert mit neuem AVPS Link in Nachricht ${ticketData.embedMessageId} in Kanal ${channelName} (${channelId})`);
      }

      await interaction.channel.send(`[${getTimestamp()}] ${user} hat die AVPS Akte bearbeitet: ${newLink}`);
      await interaction.deferUpdate();
      console.log(`(Bot) Modal-Submit (edit_avps_link) in Kanal ${channelName} (${channelId}) von ${userTag}`);
    } catch (err) {
      console.error(`(Bot) Fehler bei Modal-Submit (edit_avps_link) in Kanal ${channelName} (${channelId}) von ${userTag}:`, err);
      await interaction.followUp({ content: 'Fehler beim Bearbeiten der AVPS Akte.', ephemeral: true });
    }
  }
});

// === Start ===
console.log('USER_TOKEN:', USER_TOKEN ? 'Geladen' : 'Nicht definiert');
console.log('BOT_TOKEN:', BOT_TOKEN ? 'Geladen' : 'Nicht definiert');
console.log('BOT_USER_ID:', BOT_USER_ID ? 'Geladen' : 'Nicht definiert');
console.log('ALLOWED_GUILD:', ALLOWED_GUILD ? 'Geladen' : 'Nicht definiert');
console.log('ALLOWED_CATEGORY_ID:', ALLOWED_CATEGORY_ID ? 'Geladen' : 'Nicht definiert');
console.log('TRIGGER_CHANNEL_ID:', TRIGGER_CHANNEL_ID ? 'Geladen' : 'Nicht definiert');
console.log('TICKET_TOOL_BOT_ID:', TICKET_TOOL_BOT_ID ? 'Geladen' : 'Nicht definiert');
console.log('TICKET_CREATOR_BOT_ID:', TICKET_CREATOR_BOT_ID ? 'Geladen' : 'Nicht definiert');

userbot.login(USER_TOKEN).catch(err => console.error('(Userbot) Login Fehler:', err));
bot.login(BOT_TOKEN).catch(err => console.error('(Bot) Login Fehler:', err));