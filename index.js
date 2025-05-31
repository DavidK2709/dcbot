require('dotenv').config();
const { Client } = require("discord.js-selfbot-v13");
const { Client: BotClient, GatewayIntentBits, EmbedBuilder, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");

// === CONFIG ===
const USER_TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_GUILD = process.env.ALLOWED_GUILD;
const ALLOWED_CATEGORY_ID = process.env.ALLOWED_CATEGORY_ID;
const TRIGGER_CHANNEL_ID = process.env.TRIGGER_CHANNEL_ID;
const BOT_USER_ID = process.env.BOT_USER_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;
const TICKET_TOOL_BOT_ID = process.env.TICKET_TOOL_BOT_ID;

// In-Memory-Speicher für Ticket-Daten und Nachrichten-IDs
const ticketDataStore = new Map();

// Timestamp-Helferfunktion
const getTimestamp = () => {
  const now = new Date();
  return now.toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).replace(', ', ' - ');
};

// Helferfunktion: Suche Benutzer im Server
const findUserInGuild = async (guild, username) => {
  try {
    const members = await guild.members.fetch();
    const cleanUsername = username.replace(/\[[\d+]\]\s*/g, '').trim(); // Entferne [XX]
    const member = members.find(m =>
        m.displayName.replace(/\[[\d+]\]\s*/g, '').toLowerCase() === cleanUsername.toLowerCase() ||
        m.user.username.toLowerCase() === cleanUsername.toLowerCase()
    );
    return member ? `<@${member.user.id}>` : username;
  } catch (err) {
    console.error('(Bot) Fehler beim Abrufen der Mitgliederliste:', err);
    return username;
  }
};

const userbot = new Client({
  checkUpdate: false
});

const bot = new BotClient({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message]
});

// === Userbot: Ticket erstellen, Benutzer hinzufügen, Ticket umbenennen ===
userbot.on('ready', () => {
  console.log(`(Userbot) Eingeloggt als ${userbot.user.tag}`);
});

userbot.on('messageCreate', async (message) => {
  if (message.channel.id !== TRIGGER_CHANNEL_ID) return;
  if (message.author.id !== BOT_USER_ID) return;

  const lines = message.content.split('\n').map(line => line.trim());

  const data = {
    abteilung: '',
    grund: '',
    patient: '',
    telefon: '',
    sonstiges: '',
    buttonMessageId: null,
    appointmentMessageId: null,
    completedMessageId: null,
    avpsMessageId: null,
    embedMessageId: null
  };

  lines.forEach(line => {
    const match = line.match(/>\s\*\*(.+?):\*\*\s(.+)/);
    if (match) {
      const key = match[1].toLowerCase();
      const value = match[2].trim();
      if (data.hasOwnProperty(key)) {
        data[key] = value;
      }
    }
  });

  if (data.grund && data.patient) {
    const ticketName = `{${data.grund}_${data.patient}}`;
    try {
      await message.channel.send(`$ticket ${ticketName}`);
      console.log(`(Userbot) Befehl gesendet: $ticket ${ticketName}`);
      ticketDataStore.set(message.id, data);
    } catch (err) {
      console.error('(Userbot) Fehler beim Erstellen eines Tickets:', err);
    }
  } else {
    console.log('(Userbot) Fehler beim Erstellen eines Tickets: Grund oder Patient fehlt');
  }
});

// === Userbot: $add, $rename und Ticket Tool Nachrichten löschen ===
userbot.on('channelCreate', async (channel) => {
  if (channel.parentId !== ALLOWED_CATEGORY_ID) return;

  console.log(`(Userbot) Ticket-Kanal erkannt: ${channel.name} (${channel.id})`);

  setTimeout(async () => {
    try {
      const latestTicketData = Array.from(ticketDataStore.entries()).pop();
      if (!latestTicketData) {
        setTimeout(async () => {
          try {
            const messages = await channel.messages.fetch({ limit: 10 });
            const guild = channel.guild;
            if (!guild) {
              console.error('(Userbot) Fehler: Guild nicht verfügbar');
              return;
            }

            const sorted = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            const ticket_user_first_message = messages.first();
            if (!ticket_user_first_message) {
              console.log('(Userbot) Keine Nachrichten im Kanal gefunden');
              return;
            }

            const ticket_user_id_match = ticket_user_first_message.content.match(/<@&(\d+)>/);
            const ticket_user_id = ticket_user_id_match ? ticket_user_id_match[1] : null;
            console.log('(Userbot) Ticket Rollen-ID:', ticket_user_id);

            if (!ticket_user_id) {
              console.log('(Userbot) Keine Rollen-ID in der ersten Nachricht gefunden');
              return;
            }

            const role = guild.roles.cache.get(ticket_user_id);
            const ticket_user_desc = role ? role.name.replace(/\s+/g, '-') : null;
            console.log('(Userbot) Rollenname:', ticket_user_desc);

            for (const msg of sorted.values()) {
              if (msg.embeds.length > 0) {
                msg.embeds.forEach(embed => {
                  if (!embed.description) {
                    return;
                  }

                  const desc = embed.description;
                  const patientMatch = desc.match(/\*\*Patientenname:\*\* ```\s*([\s\S]*?)```/);
                  const concernMatch = desc.match(/\*\*Anliegen:\*\* ```\s*([\s\S]*?)```/);

                  const patient = patientMatch ? patientMatch[1].trim() : null;
                  const concern = concernMatch ? concernMatch[1].trim() : null;

                  if (patient && concern) {
                    const allowedpatient = patient.replace(/[, ]/g, '');
                    const allowedconcern = concern.replace(/[, ]/g, '');
                    const renameCommand = `$rename ticket_${ticket_user_desc}_${allowedconcern}_${allowedpatient}`;
                    console.log(`(Userbot) Renaming Channel mit: ${renameCommand}`);
                    channel.send(renameCommand);
                  } else {
                    console.log('(Userbot) Patient oder Anliegen Fehlerhaft');
                    console.log('(Userbot) Patient:', patient);
                    console.log('(Userbot) Concern:', concern);
                  }
                });
              }
            }
          } catch (err) {
            console.error('(Userbot) Fehler beim Auslesen & Umbenennen eines Tickets:', err);
          }
        }, 3000);
        return;
      }

      const [, data] = latestTicketData;
      const bereinigteID = data.abteilung.replace(/[<@>]/g, '');

      if (bereinigteID) {
        await channel.send(`$add ${bereinigteID}`);
        console.log(`(Userbot) Benutzer hinzugefügt: $add ${bereinigteID}`);
      } else {
        console.log('(Userbot) Fehler: Ungültige oder fehlende Benutzer-ID in data.abteilung:', bereinigteID);
      }

      setTimeout(async () => {
        try {
          if (data.grund) {
            await channel.send(`$rename ${data.grund}`);
            console.log(`(Userbot) Ticket umbenannt: $rename ${data.grund} _ ${data.patient}`);
          } else {
            console.log('(Userbot) Fehler: Kein Grund für Umbenennung vorhanden.');
          }

          // Lösche die ersten beiden Ticket Tool Nachrichten
          const messages = await channel.messages.fetch({ limit: 10 });
          const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
          let ticketToolMessages = Array.from(sortedMessages.filter(msg => msg.author.id === TICKET_TOOL_BOT_ID).values()).slice(0, 2);

          for (const msg of ticketToolMessages) {
            try {
              await msg.delete();
              console.log(`(Userbot) Ticket Tool Nachricht gelöscht: ${msg.id}`);
            } catch (err) {
              console.error(`(Userbot) Fehler beim Löschen der Nachricht ${msg.id}:`, err);
            }
          }
        } catch (err) {
          console.error('(Userbot) Fehler beim Umbenennen oder Löschen:', err);
        }
      }, 2000);
    } catch (err) {
      console.error('(Userbot) Fehler beim Hinzufügen:', err);
    }
  }, 3000);
});

// === Richtiger Bot: Embed und Buttons in neuem Ticket-Kanal senden ===
bot.on('ready', () => {
  console.log(`(Bot) Bot eingeloggt als ${bot.user.tag}`);
});

// Interaction-Handler für Buttons und Modals
bot.on('interactionCreate', async (interaction) => {
  // Button: Ticket annehmen
  if (interaction.isButton() && interaction.customId === 'accept_ticket_button') {
    try {
      const user = interaction.user;
      const ticketData = Array.from(ticketDataStore.values()).find(data => data.buttonMessageId === interaction.message.id);

      if (ticketData && ticketData.embedMessageId) {
        try {
          const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
          const currentEmbed = embedMessage.embeds[0];
          const newEmbed = new EmbedBuilder()
              .setTitle(currentEmbed.title)
              .setColor(currentEmbed.color)
              .addFields(
                  { name: '', value: currentEmbed.fields[0].value },
                  { name: '', value: currentEmbed.fields[1].value },
                  { name: '', value: currentEmbed.fields[2].value },
                  { name: '', value: `**Angenommen von:** <@${user.id}>` }
              );

          await embedMessage.edit({ embeds: [newEmbed] });
          console.log(`(Bot) Embed aktualisiert mit 'Angenommen von' in Nachricht ${ticketData.embedMessageId}`);
        } catch (fetchError) {
          console.error(`(Bot) Fehler beim Abrufen/Bearbeiten der Embed-Nachricht ${ticketData.embedMessageId}:`, fetchError);
          await interaction.channel.send({ content: `[${getTimestamp()}] Warnung: Embed-Nachricht nicht gefunden. Aktion fortgesetzt.` });
        }
      } else {
        console.warn(`(Bot) Keine embedMessageId für Kanal ${interaction.channel.id}`);
        await interaction.channel.send({ content: `[${getTimestamp()}] Warnung: Embed-Nachricht nicht verfügbar. Aktion fortgesetzt.` });
      }

      // Aktualisiere Buttons: Entferne "Ticket annehmen", füge "Ticket übernehmen" hinzu
      if (ticketData && ticketData.buttonMessageId) {
        try {
          const buttonMessage = await interaction.channel.messages.fetch(ticketData.buttonMessageId);
          const row = new ActionRowBuilder()
              .addComponents(
                  new ButtonBuilder()
                      .setCustomId('call_attempt_button')
                      .setLabel('Versucht anzurufen')
                      .setStyle(ButtonStyle.Danger),
                  new ButtonBuilder()
                      .setCustomId('schedule_appointment_button')
                      .setLabel('Termin festlegen')
                      .setStyle(ButtonStyle.Danger),
                  new ButtonBuilder()
                      .setCustomId('close_ticket_button')
                      .setLabel('Schließen')
                      .setStyle(ButtonStyle.Danger),
                  new ButtonBuilder()
                      .setCustomId('takeover_ticket_button')
                      .setLabel('Ticket übernehmen')
                      .setStyle(ButtonStyle.Secondary)
              );
          await buttonMessage.edit({ components: [row] });
          console.log(`(Bot) Buttons aktualisiert: Ticket annehmen entfernt, Ticket übernehmen hinzugefügt in Nachricht ${ticketData.buttonMessageId}`);
        } catch (fetchError) {
          console.error(`(Bot) Fehler beim Abrufen/Bearbeiten der Button-Nachricht ${ticketData.buttonMessageId}:`, fetchError);
          await interaction.channel.send({ content: `[${getTimestamp()}] Warnung: Button-Nachricht nicht gefunden. Aktion fortgesetzt.` });
        }
      }

      // Log-Nachricht
      await interaction.channel.send({
        content: `[${getTimestamp()}] <@${user.id}> hat das Ticket <@${user.id}> zugeordnet.`
      });

      await interaction.deferUpdate();
      console.log(`(Bot) Ticket angenommen von ${user.tag} in Kanal ${interaction.channel.id}`);
    } catch (err) {
      console.error('(Bot) Fehler beim Verarbeiten der Button-Interaktion (accept_ticket):', err);
      await interaction.channel.send({ content: `[${getTimestamp()}] Fehler beim Annehmen des Tickets. Bitte versuche es erneut.` });
    }
  }

  // Button: Ticket übernehmen
  if (interaction.isButton() && interaction.customId === 'takeover_ticket_button') {
    try {
      const modal = new ModalBuilder()
          .setCustomId('takeover_ticket_modal')
          .setTitle('Ticket übernehmen');

      const userInput = new TextInputBuilder()
          .setCustomId('user_input')
          .setLabel('Neuer Benutzer (optional, sonst du)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

      const userRow = new ActionRowBuilder().addComponents(userInput);
      modal.addComponents(userRow);

      await interaction.showModal(modal);
      console.log(`(Bot) Modal für Ticket übernehmen von ${interaction.user.tag} geöffnet`);
    } catch (err) {
      console.error('(Bot) Fehler beim Öffnen des Modals (takeover_ticket):', err);
    }
  }

  // Button: Versucht anzurufen
  if (interaction.isButton() && interaction.customId === 'call_attempt_button') {
    try {
      const user = interaction.user;
      const timestamp = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
      const message = `[${getTimestamp()}] ${user} hat versucht am ${timestamp} anzurufen.`;
      await interaction.channel.send({ content: message });
      await interaction.deferUpdate();
      console.log(`(Bot) Button geklickt von ${user.tag} in Kanal ${interaction.channel.id}: ${message}`);
    } catch (err) {
      console.error('(Bot) Fehler beim Verarbeiten der Button-Interaktion (call_attempt):', err);
    }
  }

  // Button: Termin festlegen
  if (interaction.isButton() && interaction.customId === 'schedule_appointment_button') {
    try {
      const modal = new ModalBuilder()
          .setCustomId('schedule_appointment_modal')
          .setTitle('Termin festlegen');

      const dateInput = new TextInputBuilder()
          .setCustomId('date_input')
          .setLabel('Datum (DD.MM.YYYY, z.B. 31.05.2025)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

      const timeInput = new TextInputBuilder()
          .setCustomId('time_input')
          .setLabel('Uhrzeit (z.B. 14:30)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

      const dateRow = new ActionRowBuilder().addComponents(dateInput);
      const timeRow = new ActionRowBuilder().addComponents(timeInput);

      modal.addComponents(dateRow, timeRow);

      await interaction.showModal(modal);
      console.log(`(Bot) Modal für Termin festlegen von ${interaction.user.tag} geöffnet`);
    } catch (err) {
      console.error('(Bot) Fehler beim Öffnen des Modals (schedule_appointment):', err);
    }
  }

  // Button: Schließen
  if (interaction.isButton() && interaction.customId === 'close_ticket_button') {
    try {
      const row = new ActionRowBuilder()
          .addComponents(
              new ButtonBuilder()
                  .setCustomId('confirm_close_yes')
                  .setLabel('Ja')
                  .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                  .setCustomId('confirm_close_no')
                  .setLabel('Nein')
                  .setStyle(ButtonStyle.Danger)
          );

      await interaction.reply({
        content: 'Willst du das Ticket wirklich schließen?',
        components: [row],
        ephemeral: true
      });
      console.log(`(Bot) Ephemere Bestätigungsnachricht für Schließen von ${interaction.user.tag} gesendet`);
    } catch (err) {
      console.error('(Bot) Fehler beim Senden der ephemeren Bestätigungsnachricht (close_ticket):', err);
    }
  }

  // Button: Bestätigung Ja (Schließen)
  if (interaction.isButton() && interaction.customId === 'confirm_close_yes') {
    try {
      const user = interaction.user;
      await userbot.channels.cache.get(interaction.channel.id).send('$close');
      await interaction.update({
        content: 'Ticket wird geschlossen.',
        components: [],
        ephemeral: true
      });
      console.log(`(Bot) Bestätigung Ja von ${user.tag}, $close gesendet in Kanal ${interaction.channel.id}`);
    } catch (err) {
      console.error('(Bot) Fehler beim Verarbeiten der Bestätigung Ja (confirm_close_yes):', err);
    }
  }

  // Button: Bestätigung Nein (Schließen)
  if (interaction.isButton() && interaction.customId === 'confirm_close_no') {
    try {
      const user = interaction.user;
      await interaction.update({
        content: 'Ticket-Schließung abgebrochen.',
        components: [],
        ephemeral: true
      });
      console.log(`(Bot) Bestätigung Nein von ${user.tag}, Schließung abgebrochen in Kanal ${interaction.channel.id}`);
    } catch (err) {
      console.error('(Bot) Fehler beim Verarbeiten der Bestätigung Nein (confirm_close_no):', err);
    }
  }

  // Button: Nicht zum Termin erschienen (unter Termin-Nachricht)
  if (interaction.isButton() && interaction.customId === 'no_show_button') {
    try {
      const user = interaction.user;
      const message = `[${getTimestamp()}] ${user} hat angegeben, dass der Patient nicht zum Termin erschienen ist.`;
      await interaction.channel.send({ content: message });

      // Entferne Buttons unter der Termin-Nachricht
      const ticketData = Array.from(ticketDataStore.values()).find(data => data.appointmentMessageId);
      if (ticketData && ticketData.appointmentMessageId) {
        try {
          const appointmentMessage = await interaction.channel.messages.fetch(ticketData.appointmentMessageId);
          await appointmentMessage.edit({ components: [] });
          console.log(`(Bot) Buttons unter Termin-Nachricht ${ticketData.appointmentMessageId} entfernt`);
        } catch (fetchError) {
          console.error(`(Bot) Fehler beim Abrufen/Bearbeiten der Termin-Nachricht ${ticketData.appointmentMessageId}:`, fetchError);
        }
      }

      // Reaktiviere "Versucht anzurufen" und "Termin festlegen" in der ursprünglichen Button-Nachricht
      if (ticketData && ticketData.buttonMessageId) {
        try {
          const buttonMessage = await interaction.channel.messages.fetch(ticketData.buttonMessageId);
          const row = new ActionRowBuilder()
              .addComponents(
                  new ButtonBuilder()
                      .setCustomId('call_attempt_button')
                      .setLabel('Versucht anzurufen')
                      .setStyle(ButtonStyle.Danger),
                  new ButtonBuilder()
                      .setCustomId('schedule_appointment_button')
                      .setLabel('Termin festlegen')
                      .setStyle(ButtonStyle.Danger),
                  new ButtonBuilder()
                      .setCustomId('close_ticket_button')
                      .setLabel('Schließen')
                      .setStyle(ButtonStyle.Danger),
                  new ButtonBuilder()
                      .setCustomId('takeover_ticket_button')
                      .setLabel('Ticket übernehmen')
                      .setStyle(ButtonStyle.Secondary)
              );
          await buttonMessage.edit({ components: [row] });
          console.log(`(Bot) Versucht anzurufen und Termin festlegen reaktiviert in Nachricht ${ticketData.buttonMessageId}`);
        } catch (fetchError) {
          console.error(`(Bot) Fehler beim Abrufen/Bearbeiten der Button-Nachricht ${ticketData.buttonMessageId}:`, fetchError);
          await interaction.channel.send({ content: `[${getTimestamp()}] Warnung: Ursprüngliche Button-Nachricht nicht gefunden. Aktion fortgesetzt.` });
        }
      }

      await interaction.deferUpdate();
      console.log(`(Bot) Button geklickt von ${user.tag} in Kanal ${interaction.channel.id}: ${message}`);
    } catch (err) {
      console.error('(Bot) Fehler beim Verarbeiten der Button-Interaktion (no_show):', err);
    }
  }

  // Button: Termin umlegen
  if (interaction.isButton() && interaction.customId === 'reschedule_appointment_button') {
    try {
      const modal = new ModalBuilder()
          .setCustomId('reschedule_appointment_modal')
          .setTitle('Termin umlegen');

      const dateInput = new TextInputBuilder()
          .setCustomId('date_input')
          .setLabel('Neues Datum (DD.MM.YYYY, z.B. 31.05.2025)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

      const timeInput = new TextInputBuilder()
          .setCustomId('time_input')
          .setLabel('Neue Uhrzeit (z.B. 14:30)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

      const dateRow = new ActionRowBuilder().addComponents(dateInput);
      const timeRow = new ActionRowBuilder().addComponents(timeInput);

      modal.addComponents(dateRow, timeRow);

      await interaction.showModal(modal);
      console.log(`(Bot) Modal für Termin umlegen von ${interaction.user.tag} geöffnet`);
    } catch (err) {
      console.error('(Bot) Fehler beim Öffnen des Modals (reschedule_appointment):', err);
    }
  }

  // Button: Termin erledigt
  if (interaction.isButton() && interaction.customId === 'appointment_completed_button') {
    try {
      const user = interaction.user;
      const message = `[${getTimestamp()}] ${user} hat den Termin erledigt.`;
      const completedMessage = await interaction.channel.send({ content: message });

      // Speichere "Termin erledigt"-Nachricht-ID
      const ticketData = Array.from(ticketDataStore.values()).find(data => data.buttonMessageId);
      if (ticketData) {
        ticketData.completedMessageId = completedMessage.id;
      }

      // Entferne Buttons unter der Termin-Nachricht
      if (ticketData && ticketData.appointmentMessageId) {
        try {
          const appointmentMessage = await interaction.channel.messages.fetch(ticketData.appointmentMessageId);
          await appointmentMessage.edit({ components: [] });
          console.log(`(Bot) Buttons unter Termin-Nachricht ${ticketData.appointmentMessageId} entfernt`);
        } catch (fetchError) {
          console.error(`(Bot) Fehler beim Abrufen/Bearbeiten der Termin-Nachricht ${ticketData.appointmentMessageId}:`, fetchError);
        }
      }

      // Behalte nur "Schließen" und füge "Ticket zurücksetzen" in der ursprünglichen Nachricht
      if (ticketData && ticketData.buttonMessageId) {
        try {
          const buttonMessage = await interaction.channel.messages.fetch(ticketData.buttonMessageId);
          const row = new ActionRowBuilder()
              .addComponents(
                  new ButtonBuilder()
                      .setCustomId('close_ticket_button')
                      .setLabel('Schließen')
                      .setStyle(ButtonStyle.Danger),
                  new ButtonBuilder()
                      .setCustomId('reset_ticket_button')
                      .setLabel('Ticket zurücksetzen')
                      .setStyle(ButtonStyle.Secondary),
                  new ButtonBuilder()
                      .setCustomId('avps_link_button')
                      .setLabel('AVPS Akte hinterlegen')
                      .setStyle(ButtonStyle.Danger),
                  new ButtonBuilder()
                      .setCustomId('takeover_ticket_button')
                      .setLabel('Ticket übernehmen')
                      .setStyle(ButtonStyle.Secondary)
              );
          await buttonMessage.edit({ components: [row] });
          console.log(`(Bot) Nur Schließen, Ticket zurücksetzen, AVPS Akte hinterlegen und Ticket übernehmen in Nachricht ${ticketData.buttonMessageId}`);
        } catch (fetchError) {
          console.error(`(Bot) Fehler beim Abrufen/Bearbeiten der Button-Nachricht ${ticketData.buttonMessageId}:`, fetchError);
          await interaction.channel.send({ content: `[${getTimestamp()}] Warnung: Ursprüngliche Button-Nachricht nicht gefunden. Aktion fortgesetzt.` });
        }
      }

      await interaction.deferUpdate();
      console.log(`(Bot) Termin erledigt von ${user.tag} in Kanal ${interaction.channel.id}`);
    } catch (err) {
      console.error('(Bot) Fehler beim Verarbeiten der Button-Interaktion (appointment_completed):', err);
    }
  }

  // Button: AVPS Akte hinterlegen
  if (interaction.isButton() && interaction.customId === 'avps_link_button') {
    try {
      const modal = new ModalBuilder()
          .setCustomId('avps_link_modal')
          .setTitle('AVPS Akte hinterlegen');

      const linkInput = new TextInputBuilder()
          .setCustomId('link_input')
          .setLabel('Link zur AVPS Akte')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

      const linkRow = new ActionRowBuilder().addComponents(linkInput);
      modal.addComponents(linkRow);

      await interaction.showModal(modal);
      console.log(`(Bot) Modal für AVPS Akte von ${interaction.user.tag} geöffnet`);
    } catch (err) {
      console.error('(Bot) Fehler beim Öffnen des Modals (avps_link):', err);
    }
  }

  // Button: AVPS Akte bearbeiten
  if (interaction.isButton() && interaction.customId === 'edit_avps_link_button') {
    try {
      const modal = new ModalBuilder()
          .setCustomId('edit_avps_link_modal')
          .setTitle('AVPS Akte bearbeiten');

      const linkInput = new TextInputBuilder()
          .setCustomId('link_input')
          .setLabel('Neuer Link zur AVPS Akte')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

      const linkRow = new ActionRowBuilder().addComponents(linkInput);
      modal.addComponents(linkRow);

      await interaction.showModal(modal);
      console.log(`(Bot) Modal für AVPS Akte bearbeiten von ${interaction.user.tag} geöffnet`);
    } catch (err) {
      console.error('(Bot) Fehler beim Öffnen des Modals (edit_avps_link):', err);
    }
  }

  // Button: Ticket zurücksetzen
  if (interaction.isButton() && interaction.customId === 'reset_ticket_button') {
    try {
      const user = interaction.user;
      await interaction.channel.send({ content: `[${getTimestamp()}] ${user} hat das Ticket zurückgesetzt.\n──────────` });

      // Entferne Buttons unter Termin-Nachricht
      const ticketData = Array.from(ticketDataStore.values()).find(data => data.buttonMessageId);
      if (ticketData && ticketData.appointmentMessageId) {
        try {
          const appointmentMessage = await interaction.channel.messages.fetch(ticketData.appointmentMessageId);
          await appointmentMessage.edit({ components: [] });
          console.log(`(Bot) Buttons unter Termin-Nachricht ${ticketData.appointmentMessageId} entfernt (Reset)`);
        } catch (fetchError) {
          console.error(`(Bot) Fehler beim Abrufen/Bearbeiten der Termin-Nachricht ${ticketData.appointmentMessageId}:`, fetchError);
        }
      }

      // Entferne Buttons unter "Termin erledigt"-Nachricht
      if (ticketData && ticketData.completedMessageId) {
        try {
          const completedMessage = await interaction.channel.messages.fetch(ticketData.completedMessageId);
          await completedMessage.edit({ components: [] });
          console.log(`(Bot) Buttons unter Termin erledigt-Nachricht ${ticketData.completedMessageId} entfernt (Reset)`);
        } catch (fetchError) {
          console.error(`(Bot) Fehler beim Abrufen/Bearbeiten der Termin erledigt-Nachricht ${ticketData.completedMessageId}:`, fetchError);
        }
      }

      // Entferne Buttons unter AVPS-Nachricht
      if (ticketData && ticketData.avpsMessageId) {
        try {
          const avpsMessage = await interaction.channel.messages.fetch(ticketData.avpsMessageId);
          await avpsMessage.edit({ components: [] });
          console.log(`(Bot) Buttons unter AVPS-Nachricht ${ticketData.avpsMessageId} entfernt (Reset)`);
        } catch (fetchError) {
          console.error(`(Bot) Fehler beim Abrufen/Bearbeiten der AVPS-Nachricht ${ticketData.avpsMessageId}:`, fetchError);
        }
      }

      // Setze Buttons auf Ursprungszustand
      if (ticketData && ticketData.buttonMessageId) {
        try {
          const buttonMessage = await interaction.channel.messages.fetch(ticketData.buttonMessageId);
          const row = new ActionRowBuilder()
              .addComponents(
                  new ButtonBuilder()
                      .setCustomId('call_attempt_button')
                      .setLabel('Versucht anzurufen')
                      .setStyle(ButtonStyle.Danger),
                  new ButtonBuilder()
                      .setCustomId('schedule_appointment_button')
                      .setLabel('Termin festlegen')
                      .setStyle(ButtonStyle.Danger),
                  new ButtonBuilder()
                      .setCustomId('close_ticket_button')
                      .setLabel('Schließen')
                      .setStyle(ButtonStyle.Danger),
                  new ButtonBuilder()
                      .setCustomId('accept_ticket_button')
                      .setLabel('Ticket annehmen')
                      .setStyle(ButtonStyle.Success)
              );
          await buttonMessage.edit({ components: [row] });
          console.log(`(Bot) Buttons zurückgesetzt in Nachricht ${ticketData.buttonMessageId}`);
        } catch (fetchError) {
          console.error(`(Bot) Fehler beim Abrufen/Bearbeiten der Button-Nachricht ${ticketData.buttonMessageId}:`, fetchError);
          await interaction.channel.send({ content: `[${getTimestamp()}] Warnung: Ursprüngliche Button-Nachricht nicht gefunden. Buttons zurückgesetzt.` });
        }
      }

      // Setze Embed zurück (entferne "Angenommen von")
      if (ticketData && ticketData.embedMessageId) {
        try {
          const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
          const currentEmbed = embedMessage.embeds[0];
          const newEmbed = new EmbedBuilder()
              .setTitle(currentEmbed.title)
              .setColor(currentEmbed.color)
              .addFields(
                  { name: '', value: currentEmbed.fields[0].value },
                  { name: '', value: currentEmbed.fields[1].value },
                  { name: '', value: currentEmbed.fields[2].value }
              );
          await embedMessage.edit({ embeds: [newEmbed] });
          console.log(`(Bot) Embed zurückgesetzt (Angenommen von entfernt) in Nachricht ${ticketData.embedMessageId}`);
        } catch (fetchError) {
          console.error(`(Bot) Fehler beim Abrufen/Bearbeiten der Embed-Nachricht ${ticketData.embedMessageId}:`, fetchError);
        }
      }

      await interaction.deferUpdate();
      console.log(`(Bot) Ticket zurückgesetzt von ${user.tag} in Kanal ${interaction.channel.id}`);
    }catch (err) {
      console.error('(Bot) Fehler beim Verarbeiten der Button-Interaktion (reset_ticket):', err);
    }
  }

  // Modal-Submit: Termin festlegen
  if (interaction.isModalSubmit() && interaction.customId === 'schedule_appointment_modal') {
    try {
      const date = interaction.fields.getTextInputValue('date_input')?.trim() || '';
      const time = interaction.fields.getTextInputValue('time_input')?.trim() || '';
      const user = interaction.user;

      // Validiere Datum (DD.MM.YYYY)
      const dateRegex = /^\d{2}\.\d{2}\.\d{4}$/;
      if (date && !dateRegex.test(date)) {
        await interaction.channel.send({ content: `${user}, ungültiges Datumsformat. Bitte verwende DD.MM.YYYY (z.B. 31.05.2025).` });
        await interaction.deferUpdate();
        console.log(`(Bot) Ungültiges Datumsformat von ${user.tag} in Kanal ${interaction.channel.id}`);
        return;
      }

      // Wenn leer, verwende aktuelles Datum/Uhrzeit
      const now = new Date();
      const finalDate = date || now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const finalTime = time || now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

      const message = `[${getTimestamp()}] ${user} hat einen Termin erstellt:\n- Datum: ${finalDate}\n- Uhrzeit: ${finalTime}`;

      // Neue Buttons für Termin-Nachricht
      const row = new ActionRowBuilder()
          .addComponents(
              new ButtonBuilder()
                  .setCustomId('no_show_button')
                  .setLabel('Nicht zum Termin erschienen')
                  .setStyle(ButtonStyle.Danger),
              new ButtonBuilder()
                  .setCustomId('reschedule_appointment_button')
                  .setLabel('Termin umlegen')
                  .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                  .setCustomId('appointment_completed_button')
                  .setLabel('Termin erledigt')
                  .setStyle(ButtonStyle.Success)
          );

      const appointmentMessage = await interaction.channel.send({ content: message, components: [row] });

      // Speichere Termin-Nachricht-ID
      const ticketData = Array.from(ticketDataStore.values()).find(data => data.buttonMessageId);
      if (ticketData) {
        ticketData.appointmentMessageId = appointmentMessage.id;
      } else {
        console.warn(`(Bot) Kein ticketData gefunden für Kanal ${interaction.channel.id}`);
      }

      // Entferne "Versucht anzurufen" und "Termin festlegen" aus ursprünglicher Nachricht
      if (ticketData && ticketData.buttonMessageId) {
        try {
          const buttonMessage = await interaction.channel.messages.fetch(ticketData.buttonMessageId);
          const updateRow = new ActionRowBuilder()
              .addComponents(
                  new ButtonBuilder()
                      .setCustomId('close_ticket_button')
                      .setLabel('Schließen')
                      .setStyle(ButtonStyle.Danger),
                  new ButtonBuilder()
                      .setCustomId('takeover_ticket_button')
                      .setLabel('Ticket übernehmen')
                      .setStyle(ButtonStyle.Secondary)
              );
          await buttonMessage.edit({ components: [updateRow] });
          console.log(`(Bot) Versucht anzurufen und Termin festlegen entfernt aus Nachricht ${ticketData.buttonMessageId}`);
        } catch (fetchError) {
          console.error(`(Bot) Fehler beim Abrufen/Bearbeiten der Button-Nachricht ${ticketData.buttonMessageId}:`, fetchError);
          await interaction.channel.send({ content: `[${getTimestamp()}] Warnung: Ursprüngliche Button-Nachricht nicht gefunden. Termin wurde trotzdem erstellt.` });
        }
      } else {
        console.warn(`(Bot) Keine buttonMessageId in ticketData für Kanal ${interaction.channel.id}`);
        await interaction.channel.send({ content: `[${getTimestamp()}] Warnung: Ursprüngliche Button-Nachricht nicht verfügbar. Termin wurde trotzdem erstellt.` });
      }

      await interaction.deferUpdate();
      console.log(`(Bot) Modal-Submit von ${user.tag} in Kanal ${interaction.channel.id}: ${message}`);
    } catch (err) {
      console.error('(Bot) Fehler beim Verarbeiten des Modal-Submits (schedule_appointment):', err);
      try {
        await interaction.channel.send({ content: `[${getTimestamp()}] Fehler beim Erstellen des Termins. Bitte versuche es erneut.` });
        await interaction.deferUpdate();
      } catch (sendError) {
        console.error('(Bot) Fehler beim Senden der Fehlermeldung:', sendError);
      }
    }
  }

  // Modal-Submit: Termin umlegen
  if (interaction.isModalSubmit() && interaction.customId === 'reschedule_appointment_modal') {
    try {
      const date = interaction.fields.getTextInputValue('date_input')?.trim() || '';
      const time = interaction.fields.getTextInputValue('time_input')?.trim() || '';
      const user = interaction.user;

      // Validiere Datum (DD.MM.YYYY)
      const dateRegex = /^\d{2}\.\d{2}\.\d{4}$/;
      if (date && !dateRegex.test(date)) {
        await interaction.channel.send({ content: `${user}, ungültiges Datumsformat. Bitte verwende DD.MM.YYYY (z.B. 31.05.2025).` });
        await interaction.deferUpdate();
        console.log(`(Bot) Ungültiges Datumsformat von ${user.tag} in Kanal ${interaction.channel.id}`);
        return;
      }

      // Wenn leer, verwende aktuelles Datum/Uhrzeit
      const now = new Date();
      const finalDate = date || now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const finalTime = time || now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

      const message = `[${getTimestamp()}] ${user} hat einen Termin erstellt:\n- Datum: ${finalDate}\n- Uhrzeit: ${finalTime}`;

      // Aktualisiere Termin-Nachricht
      const ticketData = Array.from(ticketDataStore.values()).find(data => data.appointmentMessageId);
      if (ticketData && ticketData.appointmentMessageId) {
        try {
          const appointmentMessage = await interaction.channel.messages.fetch(ticketData.appointmentMessageId);
          const row = new ActionRowBuilder()
              .addComponents(
                  new ButtonBuilder()
                      .setCustomId('no_show_button')
                      .setLabel('Nicht zum Termin erschienen')
                      .setStyle(ButtonStyle.Danger),
                  new ButtonBuilder()
                      .setCustomId('reschedule_appointment_button')
                      .setLabel('Termin umlegen')
                      .setStyle(ButtonStyle.Secondary),
                  new ButtonBuilder()
                      .setCustomId('appointment_completed_button')
                      .setLabel('Termin erledigt')
                      .setStyle(ButtonStyle.Success)
              );
          await appointmentMessage.edit({ content: message, components: [row] });
          console.log(`(Bot) Termin-Nachricht ${ticketData.appointmentMessageId} aktualisiert`);
        } catch (fetchError) {
          console.error(`(Bot) Fehler beim Abrufen/Bearbeiten der Termin-Nachricht ${ticketData.appointmentMessageId}:`, fetchError);
          await interaction.channel.send({ content: `[${getTimestamp()}] Warnung: Termin-Nachricht nicht gefunden. Neuer Termin wurde trotzdem erstellt.` });
        }
      }

      await interaction.deferUpdate();
      console.log(`(Bot) Modal-Submit (reschedule) von ${user.tag} in Kanal ${interaction.channel.id}: ${message}`);
    } catch (err) {
      console.error('(Bot) Fehler beim Verarbeiten des Modal-Submits (reschedule_appointment):', err);
    }
  }

  // Modal-Submit: AVPS Akte hinterlegen
  if (interaction.isModalSubmit() && interaction.customId === 'avps_link_modal') {
    try {
      const link = interaction.fields.getTextInputValue('link_input')?.trim();
      const user = interaction.user;
      const message = `[${getTimestamp()}] ${user} hat die AVPS Akte hinterlegt: ${link}`;

      // Füge "AVPS Akte bearbeiten"-Button hinzu
      const editRow = new ActionRowBuilder()
          .addComponents(
              new ButtonBuilder()
                  .setCustomId('edit_avps_link_button')
                  .setLabel('AVPS Akte bearbeiten')
                  .setStyle(ButtonStyle.Secondary)
          );

      const avpsMessage = await interaction.channel.send({ content: message, components: [editRow] });

      // Speichere AVPS-Nachricht-ID
      const ticketData = Array.from(ticketDataStore.values()).find(data => data.buttonMessageId);
      if (ticketData) {
        ticketData.avpsMessageId = avpsMessage.id;
      }

      // Entferne "AVPS Akte hinterlegen" aus ursprünglicher Nachricht
      if (ticketData && ticketData.buttonMessageId) {
        try {
          const buttonMessage = await interaction.channel.messages.fetch(ticketData.buttonMessageId);
          const row = new ActionRowBuilder()
              .addComponents(
                  new ButtonBuilder()
                      .setCustomId('close_ticket_button')
                      .setLabel('Schließen')
                      .setStyle(ButtonStyle.Danger),
                  new ButtonBuilder()
                      .setCustomId('reset_ticket_button')
                      .setLabel('Ticket zurücksetzen')
                      .setStyle(ButtonStyle.Secondary),
                  new ButtonBuilder()
                      .setCustomId('takeover_ticket_button')
                      .setLabel('Ticket übernehmen')
                      .setStyle(ButtonStyle.Secondary)
              );
          await buttonMessage.edit({ components: [row] });
          console.log(`(Bot) AVPS Akte hinterlegen entfernt aus Nachricht ${ticketData.buttonMessageId}`);
        } catch (fetchError) {
          console.error(`(Bot) Fehler beim Abrufen/Bearbeiten der Button-Nachricht ${ticketData.buttonMessageId}:`, fetchError);
          await interaction.channel.send({ content: `[${getTimestamp()}] Warnung: Ursprüngliche Button-Nachricht nicht gefunden. Aktion fortgesetzt.` });
        }
      }

      await interaction.deferUpdate();
      console.log(`(Bot) Modal-Submit (AVPS) von ${user.tag} in Kanal ${interaction.channel.id}: ${message}`);
    } catch (err) {
      console.error('(Bot) Fehler beim Verarbeiten des Modal-Submits (avps_link):', err);
    }
  }

  // Modal-Submit: AVPS Akte bearbeiten
  if (interaction.isModalSubmit() && interaction.customId === 'edit_avps_link_modal') {
    try {
      const newLink = interaction.fields.getTextInputValue('link_input')?.trim();
      const user = interaction.user;

      // Aktualisiere AVPS-Nachricht
      const ticketData = Array.from(ticketDataStore.values()).find(data => data.avpsMessageId);
      if (ticketData && ticketData.avpsMessageId) {
        try {
          const avpsMessage = await interaction.channel.messages.fetch(ticketData.avpsMessageId);
          const editRow = new ActionRowBuilder()
              .addComponents(
                  new ButtonBuilder()
                      .setCustomId('edit_avps_link_button')
                      .setLabel('AVPS Akte bearbeiten')
                      .setStyle(ButtonStyle.Secondary)
              );
          await avpsMessage.edit({ content: `[${getTimestamp()}] ${user} hat die AVPS Akte hinterlegt: ${newLink}`, components: [editRow] });
          console.log(`(Bot) AVPS-Nachricht ${ticketData.avpsMessageId} aktualisiert`);
        } catch (fetchError) {
          console.error(`(Bot) Fehler beim Abrufen/Bearbeiten der AVPS-Nachricht ${ticketData.avpsMessageId}:`, fetchError);
          await interaction.channel.send({ content: `[${getTimestamp()}] Warnung: AVPS-Nachricht nicht gefunden. Bearbeitung fehlgeschlagen.` });
        }
      }

      // Sende Bearbeitungsnachricht
      await interaction.channel.send({ content: `[${getTimestamp()}] ${user} hat die AVPS Akte bearbeitet` });

      await interaction.deferUpdate();
      console.log(`(Bot) Modal-Submit (edit AVPS) von ${user.tag} in Kanal ${interaction.channel.id}: Neuer Link ${newLink}`);
    } catch (err) {
      console.error('(Bot) Fehler beim Verarbeiten des Modal-Submits (edit_avps_link):', err);
      try {
        await interaction.channel.send({ content: `[${getTimestamp()}] Fehler beim Bearbeiten der AVPS Akte. Bitte versuche es erneut.` });
        await interaction.deferUpdate();
      } catch (sendError) {
        console.error('(Bot) Fehler beim Senden der Fehlermeldung:', sendError);
      }
    }
  }

  // Modal-Submit: Ticket übernehmen
  if (interaction.isModalSubmit() && interaction.customId === 'takeover_ticket_modal') {
    try {
      const userInput = interaction.fields.getTextInputValue('user_input')?.trim();
      const user = interaction.user;
      let newUser = userInput ? await findUserInGuild(interaction.guild, userInput) : `<@${user.id}>`;

      // Aktualisiere Embed
      const ticketData = Array.from(ticketDataStore.values()).find(data => data.buttonMessageId);
      if (ticketData && ticketData.embedMessageId) {
        try {
          const embedMessage = await interaction.channel.messages.fetch(ticketData.embedMessageId);
          const currentEmbed = embedMessage.embeds[0];
          const newEmbed = new EmbedBuilder()
              .setTitle(currentEmbed.title)
              .setColor(currentEmbed.color)
              .addFields(
                  { name: '', value: currentEmbed.fields[0].value },
                  { name: '', value: currentEmbed.fields[1].value },
                  { name: '', value: currentEmbed.fields[2].value },
                  { name: '', value: `**Angenommen von:** ${newUser}` }
              );

          await embedMessage.edit({ embeds: [newEmbed] });
          console.log(`(Bot) Embed aktualisiert mit 'Angenommen von ${newUser}' in Nachricht ${ticketData.embedMessageId}`);
        } catch (fetchError) {
          console.error(`(Bot) Fehler beim Abrufen/Bearbeiten der Embed-Nachricht ${ticketData.embedMessageId}:`, fetchError);
          await interaction.channel.send({ content: `[${getTimestamp()}] Warnung: Embed-Nachricht nicht gefunden. Aktion fortgesetzt.` });
        }
      } else {
        console.warn(`(Bot) Keine embedMessageId für Kanal ${interaction.channel.id}`);
        await interaction.channel.send({ content: `[${getTimestamp()}] Warnung: Embed-Nachricht nicht verfügbar. Aktion fortgesetzt.` });
      }

      // Log-Nachricht
      await interaction.channel.send({
        content: `[${getTimestamp()}] <@${user.id}> hat das Ticket ${newUser} zugeordnet.`
      });

      await interaction.deferUpdate();
      console.log(`(Bot) Modal-Submit (takeover) von ${user.tag} in Kanal ${interaction.channel.id}: Übernommen von ${newUser}`);
    } catch (err) {
      console.error('(Bot) Fehler beim Verarbeiten des Modal-Submits (takeover_ticket):', err);
      try {
        await interaction.channel.send({ content: `[${getTimestamp()}] Fehler beim Übernehmen des Tickets. Bitte versuche es erneut.` });
        await interaction.deferUpdate();
      } catch (sendError) {
        console.error('(Bot) Fehler beim Senden der Fehlermeldung:', sendError);
      }
    }
  }
});

bot.on('channelCreate', async (channel) => {
  if (channel.parentId !== ALLOWED_CATEGORY_ID) return;

  console.log(`(Bot) Neuer Ticket-Kanal: ${channel.name} (${channel.id})`);

  setTimeout(async () => {
    try {
      const latestTicketData = Array.from(ticketDataStore.entries()).pop();

      if (!latestTicketData) {
        console.log('(Bot) Userticket, keine Buttons.');
        return;
      }

      // Buttons erstellen (nur für automatisierte Tickets)
      const row = new ActionRowBuilder()
          .addComponents(
              new ButtonBuilder()
                  .setCustomId('call_attempt_button')
                  .setLabel('Versucht anzurufen')
                  .setStyle(ButtonStyle.Danger),
              new ButtonBuilder()
                  .setCustomId('schedule_appointment_button')
                  .setLabel('Termin festlegen')
                  .setStyle(ButtonStyle.Danger),
              new ButtonBuilder()
                  .setCustomId('close_ticket_button')
                  .setLabel('Schließen')
                  .setStyle(ButtonStyle.Danger),
              new ButtonBuilder()
                  .setCustomId('accept_ticket_button')
                  .setLabel('Ticket annehmen')
                  .setStyle(ButtonStyle.Success)
          );

      const ticketReasons = {
        ticket_arbeitsmedizinisches_polizei: 'Arbeitsmedizinisches Gutachten Polizeibewerber',
        ticket_arbeitsmedizinisches_jva: 'Arbeitsmedizinisches Gutachten JVA/Wachschutz',
        ticket_arbeitsmedizinisches_ammunation: 'Arbeitsmedizinisches Gutachten Ammunation',
        ticket_arbeitsmedizinisches_mediziner: 'Arbeitsmedizinisches Gutachten Mediziner'
      };

      const [, data] = latestTicketData;

      const content = "Eine neues Ticket für: " + ticketReasons[data.grund] + ". (" + data.abteilung + ")";

      const embed = new EmbedBuilder()
          .setTitle(ticketReasons[data.grund] || 'Neues Ticket')
          .addFields(
              { name: '', value: '**Name:** ' + data.patient },
              { name: '', value: '**Telefon:** ' + data.telefon },
              { name: '', value: '**Sonstiges:** ' + data.sonstiges }
          )
          .setColor(0x480007);

      const embedMessage = await channel.send({ content: content, embeds: [embed] });
      data.embedMessageId = embedMessage.id;
      console.log(`(Bot) Embed in Kanal ${channel.id} gesendet, ID: ${embedMessage.id}`);

      // Sende Buttons als letzte Aktion
      const buttonMessage = await channel.send({ components: [row] });
      data.buttonMessageId = buttonMessage.id;
      console.log(`(Bot) Buttons für automatisiertes Ticket in Kanal ${channel.id} gesendet, ID: ${buttonMessage.id}`);
    } catch (err) {
      console.error('(Bot) Fehler beim Senden des Embeds oder Buttons:', err);
    }
  }, 7000);
});

// === Start ===
console.log('USER_TOKEN:', USER_TOKEN ? 'Geladen' : 'Nicht definiert');
console.log('BOT_TOKEN:', BOT_TOKEN ? 'Geladen' : 'Nicht definiert');
console.log('BOT_USER_ID:', BOT_USER_ID ? 'Geladen' : 'Nicht definiert');
console.log('ALLOWED_GUILD:', ALLOWED_GUILD ? 'Geladen' : 'Nicht definiert');
console.log('ALLOWED_CATEGORY_ID:', ALLOWED_CATEGORY_ID ? 'Geladen' : 'Nicht definiert');
console.log('TRIGGER_CHANNEL_ID:', TRIGGER_CHANNEL_ID ? 'Geladen' : 'Nicht definiert');
console.log('TICKET_TOOL_BOT_ID:', TICKET_TOOL_BOT_ID ? 'Geladen' : 'Nicht definiert');

userbot.login(USER_TOKEN).catch(err => console.error('(Userbot) Login Fehler:', err));
bot.login(BOT_TOKEN).catch(err => console.error('(Bot) Login Fehler:', err));