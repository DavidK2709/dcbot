const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const CONFIG = require("../config/Config");
const { getTimestamp } = require("../utils/Helpers");
const Ticket = require("../tickets/Ticket");
const TicketManager = require('../tickets/TicketManager');
const handleInteraction = require('./interactionHandler');

class BotClient extends Client {
    constructor(ticketManager) {
        super({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
        });
        this.ticketManager = new TicketManager();
    }

    async start() {
        this.on('ready', this.onReady.bind(this));
        this.on('messageCreate', this.onMessageCreate.bind(this));
        this.on('interactionCreate', async (interaction) => {
            await handleInteraction(interaction, this.ticketManager, this);
        });
        await this.login(CONFIG.BOT_TOKEN);
    }

    async onReady() {
        console.log(`(Bot) Eingeloggt als ${this.user.tag} auf Server ${this.guilds.cache.map(g => g.name).join(', ')}`);
        await this.ticketManager.initializeTickets(this);

        const formChannel = this.channels.cache.get(CONFIG.FORM_CHANNEL_ID);
        if (!formChannel) {
            console.error(`(Bot) Kanal mit ID ${CONFIG.FORM_CHANNEL_ID} nicht gefunden oder nicht zugänglich. Verfügbare Server: ${this.guilds.cache.map(g => `${g.name} (${g.id})`).join(', ')}`);
            return;
        }

        console.log(`(Bot) Kanal gefunden: ${formChannel.name} (${formChannel.id})`);
        try {
            const messages = await formChannel.messages.fetch({ limit: 100 });
            console.log(`(Bot) ${messages.size} Nachrichten im Kanal geladen`);

            const botMessages = messages.filter(msg => msg.author.id === this.user.id && msg.components.length > 0);
            if (botMessages.size > 1) {
                const messagesToDelete = botMessages.map(msg => msg).slice(1);
                for (const msg of messagesToDelete) {
                    await msg.delete();
                    console.log(`(Bot) Alte Ticketformular-Nachricht gelöscht: ${msg.id}`);
                }
            }

            const otherMessages = messages.filter(msg => msg.author.id !== this.user.id || !msg.components.length);
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
                    .setDescription(
                        '**Hilfe bei Fachbereichszuordnung:**\n\n' +
                        '**Station:**\n' +
                        '- DNA-Test\n' +
                        '- Altersbestimmung\n' +
                        '- Nachuntersuchungen\n' +
                        '- Medizinische Gutachten\n' +
                        '- Schmerzen\n\n' +
                        '**Arbeitsmedizin:**\n' +
                        '- Gutachten für Polizeibewerber, JVA-Wächter, Ammunationsmitarbeiter\n' +
                        '- Erste-Hilfe Kurs\n' +
                        '- Jobtechnische Gutachten\n\n' +
                        '**Psychologie:**\n' +
                        '- Waffenschein\n' +
                        '- Namensänderungen\n' +
                        '- MPU\n' +
                        '- Paartherapie\n' +
                        '- Psychologische Gutachten\n' +
                        '- Angststörungen\n' +
                        '- Traumabewältigung\n\n' +
                        '**Bitte wähle den gewünschten Fachbereich aus:**'
                    )
                    .setColor(0x480007);

                const sentMessage = await formChannel.send({ embeds: [embed], components: [row] });
                console.log(`(Bot) Neue Ticketformular-Nachricht gesendet in Kanal ${formChannel.name} (${formChannel.id}) mit ID ${sentMessage.id}`);
            } else {
                console.log(`(Bot) Ticketformular-Nachricht bereits vorhanden in Kanal ${formChannel.name} (${formChannel.id})`);
            }
        } catch (error) {
            console.error(`(Bot) Fehler beim Verarbeiten des Kanals ${CONFIG.FORM_CHANNEL_ID}:`, error);
        }
    }

    async onMessageCreate(message) {
        console.log(`(Bot) Nachricht empfangen in Kanal ${message.channel?.id || 'unbekannt'}: ${message.content}`);
        if (!message.channel || message.channel.id !== CONFIG.TRIGGER_CHANNEL_ID || message.author.id !== CONFIG.BOT_USER_ID) return;

        const data = {
            abteilung: '', grund: '', patient: '', telefon: '', sonstiges: '', abteilungPing: '',
            buttonMessageId: null, appointmentMessageId: null, completedMessageId: null,
            avpsMessageId: null, embedMessageId: null,
            appointmentDate: null, appointmentTime: null, originalAppointmentDate: null, originalAppointmentTime: null,
            acceptedBy: null, avpsLink: null,
            appointmentCompleted: false, isClosed: false, lastReset: false, callAttempt: false,
            preis: null, followupAppointments: []
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
                        const department = Object.keys(CONFIG.DEPARTMENTS).find(
                            dept => CONFIG.DEPARTMENTS[dept].memberRoleId === roleId
                        );
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
                } else if (field === 'datum') {
                    data.originalAppointmentDate = value;
                } else if (field === 'uhrzeit') {
                    data.originalAppointmentTime = value;
                }
            }
        }

        if (!data.grund || !data.patient || !data.abteilung || !CONFIG.DEPARTMENTS[data.abteilung]) {
            console.log(`(Bot) Fehler: Grund, Patient oder ungültige Abteilung fehlt in Kanal ${message.channel.id}`);
            return;
        }

        const departmentConfig = CONFIG.DEPARTMENTS[data.abteilung];
        const reasonMapping = CONFIG.TICKET_REASONS[data.grund];
        if (reasonMapping) {
            data.preis = reasonMapping.preis;
        }
        const ticket = new Ticket(null, data);
        const channelName = ticket.getChannelName();
        const guild = message.guild;

        let channel;
        try {
            channel = await guild.channels.create({
                name: channelName,
                type: 0,
                parent: departmentConfig.categoryId,
                permissionOverwrites: [
                    { id: guild.id, deny: ['ViewChannel'] },
                    { id: departmentConfig.memberRoleId, allow: ['ViewChannel', 'SendMessages'] }
                ]
            });

            CONFIG.ADMIN_ROLES.forEach(roleId => {
                channel.permissionOverwrites.create(roleId, { ViewChannel: true, SendMessages: true });
            });
        } catch (err) {
            console.error(`(Bot) Fehler beim Erstellen des Kanals in Guild ${guild.id}:`, err);
            return;
        }

        ticket.channelId = channel.id;
        this.ticketManager.setTicket(channel.id, ticket);

        const embed = ticket.getEmbed();
        const components = ticket.getButtonRows();

        try {
            const embedMessage = await channel.send({
                content: `Eine neue Behandlungsanfrage (${ticket.abteilungPing || ticket.abteilung})`,
                embeds: [embed],
                components: components,
            });
            ticket.embedMessageId = embedMessage.id;
            this.ticketManager.setTicket(channel.id, ticket);
            console.log(`(Bot) Embed-Nachricht erfolgreich gesendet in Kanal ${channel.id}`);
        } catch (err) {
            console.error(`(Bot) Fehler beim Senden der Embed-Nachricht in Kanal ${channel.id}:`, err);
            await channel.delete().catch(deleteErr => console.error(`(Bot) Fehler beim Löschen des fehlerhaften Kanals ${channel.id}:`, deleteErr));
            this.ticketManager.deleteTicket(channel.id);
            return;
        }

        console.log(`(Bot) Ticket erstellt und Embed gesendet in ${channel.name} (${channel.id})`);
    }
}

module.exports = BotClient;