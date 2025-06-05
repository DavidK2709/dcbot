const BotClient = require('./bot/BotClient');
const handleInteraction = require('./bot/interactionHandler');
const TicketManager = require('./tickets/TicketManager');

const ticketManager = new TicketManager();
const bot = new BotClient(ticketManager);

bot.on('interactionCreate', (interaction) => handleInteraction(interaction, ticketManager));

bot.start();