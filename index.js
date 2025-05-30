require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Events, MessageEmbed } = require("discord.js-selfbot-v13");
const { Client: BotClient, GatewayIntentBits: BotIntents, EmbedBuilder } = require("discord.js");

const userbot = new Client();

const bot = new BotClient({
  intents: [BotIntents.Guilds, BotIntents.GuildMessages, BotIntents.MessageContent],
  partials: [Partials.Channel]
});

// === CONFIG ===
const USER_TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_GUILD = process.env.ALLOWED_GUILD;
const ALLOWED_CATEGORY_ID = process.env.ALLOWED_CATEGORY_ID;
const TRIGGER_CHANNEL_ID = process.env.TRIGGER_CHANNEL_ID;
const BOT_USER_ID = process.env.BOT_USER_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;


// === Login Userbot===
userbot.on('ready', () => {
  console.log(`Eingeloggt als ${userbot.user.tag}`);
  console.log('TRIGGER_CHANNEL_ID:' + TRIGGER_CHANNEL_ID);
  console.log('BOT_USER_ID:' + BOT_USER_ID);
});

userbot.on('message', (message) => {

  const targetUserId = '1376941250799997059';
  if (message.channel.id !== TRIGGER_CHANNEL_ID){
	return;
  };
  if (message.author.id !== BOT_USER_ID) {
	return;
}
  
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

  sendEmbedMessage(data);

  console.log('Gefundene Daten:', data);
});


// === Neuer Ticket-Channel in Kategorie ===
userbot.on('channelCreate', (channel) => {
  if (channel.parentId === ALLOWED_CATEGORY_ID) {
    console.log(`Neuer Ticket-Channel: ${channel.name} (${channel.id})`);
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
userbot.login(USER_TOKEN);


// === Richtiger Bot ===
bot.on("ready", () => {
  console.log(`Richtiger Bot eingeloggt als ${bot.user.tag}`);
});

async function sendEmbedMessage(daten) {
  try {
    const channel = await bot.channels.fetch(TRIGGER_CHANNEL_ID);

    const embed = new EmbedBuilder()
        .setTitle("Neues Ticket")
        .addFields(
            { name: "Patientenname", value: daten.patientenname || "Keine Angabe", inline: false },
            { name: "Anliegen", value: daten.anliegen || "Keine Angabe", inline: false },
            { name: "Aktivitätszeit", value: daten.aktivitätszeit || "Keine Angabe", inline: false },
            { name: "Telefonnummer für Rückfragen", value: daten.telefonnummer || "Keine Angabe", inline: false }
        )
        .setColor(0x2b2d31);

    await channel.send({ embeds: [embed] });
    console.log("Embed gesendet!");
  } catch (err) {
    console.error("Fehler beim Embed-Senden:", err);
  }
}

bot.login(process.env.BOT_TOKEN);

