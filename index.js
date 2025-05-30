require('dotenv').config();
const { Client } = require("discord.js-selfbot-v13");
const { Client: BotClient, GatewayIntentBits, EmbedBuilder, Partials } = require("discord.js");

// === CONFIG ===
const USER_TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_GUILD = process.env.ALLOWED_GUILD;
const ALLOWED_CATEGORY_ID = process.env.ALLOWED_CATEGORY_ID;
const TRIGGER_CHANNEL_ID = process.env.TRIGGER_CHANNEL_ID;
const BOT_USER_ID = process.env.BOT_USER_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;

// In-Memory-Speicher für Ticket-Daten
const ticketDataStore = new Map();

const userbot = new Client({
  checkUpdate: false
});

const bot = new BotClient({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

// === Userbot: Ticket erstellen, Benutzer hinzufügen, Ticket umbenennen ===
userbot.on('ready', () => {
  console.log(`Userbot eingeloggt als ${userbot.user.tag}`);
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
    sonstiges: ''
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
      console.log(`Ticket-Befehl gesendet: $ticket ${ticketName}`);

      ticketDataStore.set(message.id, data);
    } catch (err) {
      console.error('Fehler beim Erstellen des Tickets:', err);
    }
  } else {
    console.log('Fehler: Grund oder Patient fehlt');
  }
});

// === Userbot: $add und $rename im neuen Ticket-Kanal ===
userbot.on('channelCreate', async (channel) => {
  if (channel.parentId !== ALLOWED_CATEGORY_ID) return;

  console.log(`Neuer Ticket-Kanal: ${channel.name} (${channel.id})`);

  setTimeout(async () => {
    try {
      const latestTicketData = Array.from(ticketDataStore.entries()).pop();
      if (!latestTicketData) {
        setTimeout(async () => {
          try {
            const messages = await channel.messages.fetch({ limit: 10 });
            const guild = channel.guild;
            if (!guild) {
              console.error('Fehler: Guild nicht verfügbar');
              return;
            }

            const sorted = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            const ticket_user_first_message = messages.first();
            if (!ticket_user_first_message) {
              console.log('Keine Nachrichten im Kanal gefunden');
              return;
            }

            const ticket_user_id_match = ticket_user_first_message.content.match(/<@&(\d+)>/);
            const ticket_user_id = ticket_user_id_match ? ticket_user_id_match[1] : null;
            console.log('Ticket Rollen-ID:', ticket_user_id);

            if (!ticket_user_id) {
              console.log('Keine Rollen-ID in der ersten Nachricht gefunden');
              return;
            }

            const role = guild.roles.cache.get(ticket_user_id);
            const ticket_user_desc = role ? role.name.replace(/\s+/g, '-') : null;
            console.log('Rollenname:', ticket_user_desc);

            for (const msg of sorted.values()) {
              if (msg.embeds.length > 0) {
                msg.embeds.forEach(embed => {
                  if (!embed.description) {
                    console.log('Kein description, skip');
                    return;
                  }

                  const desc = embed.description;
                  const patientMatch = desc.match(/\*\*Patientenname:\*\* ```\s*([\s\S]*?)```/);
                  const concernMatch = desc.match(/\*\*Anliegen:\*\* ```\s*([\s\S]*?)```/);

                  const patient = patientMatch ? patientMatch[1].trim() : null;
                  const concern = concernMatch ? concernMatch[1].trim() : null;
                  console.log('Patient und Anliegen geloggt: ');
                  console.log('Patient:', patient);
                  console.log('Concern:', concern);

                  if (patient && concern) {
                    const allowedpatient = patient.replace(/[, ]/g, '');
                    const allowedconcern = concern.replace(/[, ]/g, '');

                    const renameCommand = `$rename ticket_${ticket_user_desc}_${allowedconcern}_${allowedpatient}`;
                    console.log(`Renaming Channel mit: ${renameCommand}`);
                    channel.send(renameCommand);
                  } else {
                    console.log('Patient oder Anliegen Fehlerhaft');
                    console.log('Patient:', patient);
                    console.log('Concern:', concern);
                  }
                });
              }
            }

          } catch (err) {
            console.error('Fehler beim Auslesen & Umbenennen:', err);
          }
        }, 3000);
        return;
      }

      const [, data] = latestTicketData;
      const bereinigteID = data.abteilung.replace(/[<@>]/g, '');

      if (bereinigteID) {
        await channel.send(`$add ${bereinigteID}`);
        console.log(`Benutzer hinzugefügt: $add ${bereinigteID}`);
      } else {
        console.log('Fehler: Ungültige oder fehlende Benutzer-ID in data.abteilung:', bereinigteID);
      }

      setTimeout(async () => {
        try {
          if (data.grund) {
            await channel.send(`$rename ${data.grund}`);
            console.log(`Ticket umbenannt: $rename ${data.grund}`);
          } else {
            console.log('Fehler: Kein grund für Umbenennung vorhanden.');
          }
        } catch (err) {
          console.error('Fehler beim Umbenennen:', err);
        }
      }, 2000); // 2 Sekunden Verzögerung nach $add
    } catch (err) {
      console.error('Fehler beim Hinzufügen:', err);
    }
  }, 3000);
});

// === Richtiger Bot: Embed in neuem Ticket-Kanal senden ===
bot.on('ready', () => {
  console.log(`Richtiger Bot eingeloggt als ${bot.user.tag}`);
});

bot.on('channelCreate', async (channel) => {
  if (channel.parentId !== ALLOWED_CATEGORY_ID) return;

  console.log(`Neuer Ticket-Kanal (Bot): ${channel.name} (${channel.id})`);

  setTimeout(async () => {
    try {
      const latestTicketData = Array.from(ticketDataStore.entries()).pop();
      if (!latestTicketData) {
        console.log('Bot: Erstelle kein Embedded, da Userticket.');
        return;
      }
      const ticketReasons = {
        ticket_arbeitsmedizinisches_polizei: 'Arbeitsmedizinisches Gutachten Polizeibewerber',
        ticket_arbeitsmedizinisches_jva: 'Arbeitsmedizinisches Gutachten JVA/Wachschutz',
        ticket_arbeitsmedizinisches_ammunation: 'Arbeitsmedizinisches Gutachten Ammunation',
        ticket_arbeitsmedizinisches_mediziner: 'Arbeitsmedizinisches Gutachten Mediziner'
      };

      const [, data] = latestTicketData;

      const rolePing = data.abteilung && data.abteilung.match(/<@&\d+>/) ? data.abteilung : null;

      if(content != null){
        const content = `${rolePing} eine neue Behandlungsanfrage.`;
      } else {
        const content = 'Eine neue Behandlungsanfrage.';
      }


      const embed = new EmbedBuilder()
          .setTitle(ticketReasons[data.grund]  ||  'Neues Ticket')
          .addFields(
              { name: '', value: '**Name:** ' + data.patient},
              { name: '', value: '**Telefon:** ' + data.telefon},
              { name: '', value: '**Sonstiges:** ' + data.sonstiges},
          )
          .setColor(0x480007);

      await channel.send({content, embeds: [embed] });

      console.log(`Embed in Kanal ${channel.id} gesendet.`);

      // Daten aus dem Store entfernen, nachdem das Embed gesendet wurde
      ticketDataStore.delete(latestTicketData[0]);
    } catch (err) {
      console.error('Fehler beim Senden des Embeds:', err);
    }
  }, 7000);
});

// === Start ===
console.log('USER_TOKEN:', USER_TOKEN ? 'Geladen' : 'Nicht definiert');
console.log('BOT_TOKEN:', BOT_TOKEN ? 'Geladen' : 'Nicht definiert');
userbot.login(USER_TOKEN).catch(err => console.error('Userbot Login Fehler:', err));
bot.login(BOT_TOKEN).catch(err => console.error('Bot Login Fehler:', err));