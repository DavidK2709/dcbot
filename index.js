require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const client = new Client();

// === CONFIG ===
const USER_TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_GUILD = process.env.ALLOWED_GUILD;
const ALLOWED_CATEGORY_ID = process.env.ALLOWED_CATEGORY_ID;
const TRIGGER_CHANNEL_ID = process.env.TRIGGER_CHANNEL_ID;
const BOT_USER_ID = process.env.BOT_USER_ID;

// === Login ===
client.on('ready', () => {
  console.log(`Eingeloggt als ${client.user.tag}`);
});

client.on('message', (message) => {
  const targetUserId = '1376941250799997059';

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
    if (line.toLowerCase().startsWith('abteilung:')) {
      data.abteilung = line.split(':')[1].trim();
    }
    if (line.toLowerCase().startsWith('grund:')) {
      data.grund = line.split(':')[1].trim();
    }
    if (line.toLowerCase().startsWith('patient:')) {
      data.patient = line.split(':')[1].trim();
    }
    if (line.toLowerCase().startsWith('telefon:')) {
      data.telefon = line.split(':')[1].trim();
    }
    if (line.toLowerCase().startsWith('sonstiges:')) {
      data.sonstiges = line.split(':')[1].trim();
    }
  });

  console.log('Gefundene Daten:', data);
});


// === Neuer Ticket-Channel in Kategorie ===
client.on('channelCreate', (channel) => {
  if (channel.parentId === ALLOWED_CATEGORY_ID) {
    console.log(`📁 Neuer Ticket-Channel: ${channel.name} (${channel.id})`);

    setTimeout(async () => {
      try {
        const messages = await channel.messages.fetch({ limit: 10 });
        const sorted = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        for (const msg of sorted.values()) {
          if (msg.embeds.length > 0) {
            msg.embeds.forEach(embed => {
              const desc = embed.description || '';
              const patientMatch = desc.match(/\*\*Patientenname:\*\* ```([\s\S]*?)```/);
              const concernMatch = desc.match(/\*\*Anliegen:\*\* ```([\s\S]*?)```/);

              const patient = patientMatch ? patientMatch[1].trim() : null;
              const concern = concernMatch ? concernMatch[1].trim() : null;

              if (patient && concern) {
                const renameCommand = `$rename ${patient} - ${concern}`;
                console.log(`Renaming Channel mit: ${renameCommand}`);
                channel.send(renameCommand);
              }
            });
          }
        }

      } catch (err) {
        console.error('Fehler beim Auslesen & Umbenennen:', err);
      }
    }, 3000); // ggf. auf 5000 erhöhen, falls Embeds später kommen
  }
});

// === Start ===
client.login(USER_TOKEN);

