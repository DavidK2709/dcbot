require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const client = new Client();

// === CONFIG ===
const USER_TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_GUILD = '893588861744201779';
const ALLOWED_CHANNEL = '1376936775762841691';
const ALLOWED_CATEGORY_ID = '1376937159939981393';

// === Login ===
client.on('ready', () => {
  console.log(`Eingeloggt als ${client.user.tag}`);
});

// === Trigger "arbeitsmedizin" ===
client.on('messageCreate', (message) => {
  if (!message.guild || message.author.id === client.user.id || message.author.bot) return;

  if (
    message.guild.id === ALLOWED_GUILD &&
    message.channel.id === ALLOWED_CHANNEL &&
    message.content.toLowerCase().includes('arbeitsmedizin')
  ) {
    console.log(`Trigger erkannt von ${message.author.username}: ${message.content}`);
    message.channel.send('$ticket');
  }
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

