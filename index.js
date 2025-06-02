require('dotenv').config();
const { Client: BotClient, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const fs = require('fs');

// === CONFIG ===
const CONFIG = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    BOT_USER_ID: process.env.BOT_USER_ID,
    ALLOWED_GUILD: process.env.ALLOWED_GUILD,
    TRIGGER_CHANNEL_ID: process.env.TRIGGER_CHANNEL_ID,
    LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID,
    FORM_CHANNEL_ID: process.env.FORM_CHANNEL_ID,
    PSYCHOLOGIE_LOG_CHANNEL_ID: '1196090077974106252',
    STATION_LOG_CHANNEL_ID: '1196118857862107227',
    STATION_TREATMENT_CHANNEL_ID: '993954860733054976',
    ARBEITSMEDIZIN_LOG_CHANNEL_ID: '1248411084864356392',
    ADMIN_ROLES: ['893588861744201783', '1378935141862477855'],
    DEPARTMENTS: {
        'Arbeitsmedizin': {
            categoryId: '1378846063766671420',
            memberRoleId: '1248410238365728801',
            leaderRoleId: '1310249339867758682'
        },
        'Psychologie': {
            categoryId: '1378846177969311775',
            memberRoleId: '987267100026470431',
            leaderRoleId: '1043561042627788853'
        },
        'Station': {
            categoryId: '1378846356436684960',
            memberRoleId: '893588861744201787',
            leaderRoleId: '1283118800224653422'
        }
    },
    rettungsdienst_rollen: [
        '893588861744201786', // Rettungsdienst
        '1009513539414790195'  // Aushilfskräfte
    ],
    TICKET_REASONS: {
        ticket_arbeitsmedizinisches_pol: { internalKey: 'gutachten-polizei-patient', displayName: 'Arbeitsmedizinisches Gutachten Polizeibewerber', preis: '5000' },
        ticket_arbeitsmedizinisches_jva: { internalKey: 'gutachten-jva-patient', displayName: 'Arbeitsmedizinisches Gutachten JVA/Wachschutz', preis: '5000' },
        ticket_arbeitsmedizinisches_ammunation: { internalKey: 'gutachten-ammunation-patient', displayName: 'Arbeitsmedizinisches Gutachten Ammunation', preis: '2500' },
        ticket_arbeitsmedizinisches_mediziner: { internalKey: 'gutachten-mediziner-patient', displayName: 'Arbeitsmedizinisches Gutachten Mediziner', preis: '0' },
        ticket_psycholgie_bundeswehr: { internalKey: 'gutachten-bundeswehr-patient', displayName: 'Psychologisches Gutachten Bundeswehr', preis: '5000' },
        ticket_psychologie_jva: { internalKey: 'gutachten-jva-patient', displayName: 'Psychologisches Gutachten JVA', preis: '5000' },
    }
};

const ticketDataStore = new Map();

// === HELPER FUNCTIONS ===
const getTimestamp = () => new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(', ', ' - ');

const retryOnRateLimit = async (operation, maxRetries = 3, delay = 10000) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (err) {
            if (err.code === 429 && attempt < maxRetries) {
                console.log(`(Bot) Rate-Limit erreicht. Warte ${delay / 1000} Sekunden (Versuch ${attempt}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw err;
        }
    }
};

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
        console.error(`(Bot) Fehler in findUserInGuild für Guild ${guild.id}:`, err);
        return { mention: input, nickname: input };
    }
};

const formatPrice = (price) => {
    if (!price) return null;
    return parseInt(price).toLocaleString('de-DE') + ' €';
};

const getChannelName = (ticketData) => {
    const reasonMapping = CONFIG.TICKET_REASONS[ticketData.grund];
    const isAutomaticTicket = reasonMapping && Object.keys(CONFIG.TICKET_REASONS).includes(ticketData.grund);
    const baseName = isAutomaticTicket
        ? `${reasonMapping.internalKey.split('-').slice(0, -1).join('-')}-${ticketData.patient.replace(/ /g, '-')}`
        : `${ticketData.patient.replace(/ /g, '-')}-${ticketData.grund.replace(/ /g, '-')}`;
    const symbol = ticketData.isClosed ? '🔒' : '🕓';
    return `${symbol} ${baseName}`.slice(0, 100);
};

const updateChannelName = async (channel, ticketData) => {
    try {
        const newName = getChannelName(ticketData);
        console.log(`(Bot) Versuche, Kanalnamen zu ${newName} zu aktualisieren`);
        await retryOnRateLimit(() => channel.setName(newName));
        console.log(`(Bot) Kanalnamen erfolgreich auf ${newName} aktualisiert`);
    } catch (err) {
        console.error(`(Bot) Fehler beim Aktualisieren des Kanalnamens für Kanal ${channel.id}:`, err);
    }
};

const getButtonRows = (ticketData) => {
    try {
        const rows = [];

        if (ticketData.isClosed) {
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('reopen_ticket_button').setLabel('Ticket wieder öffnen').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('delete_ticket_button').setLabel('Ticket löschen').setStyle(ButtonStyle.Danger)
            ));
            return rows;
        }

        const hasInteraction = ticketData.acceptedBy || ticketData.appointmentDate || ticketData.appointmentTime || ticketData.avpsLink || ticketData.preis;
        const isResetDisabled = !hasInteraction || ticketData.lastReset;
        const takeoverButton = ticketData.acceptedBy
            ? new ButtonBuilder().setCustomId('takeover_ticket_button').setLabel('Ticket neuvergeben').setStyle(ButtonStyle.Secondary)
            : new ButtonBuilder().setCustomId('takeover_ticket_button').setLabel('Ticket vergeben').setStyle(ButtonStyle.Danger);

        const row1Components = [
            new ButtonBuilder().setCustomId('call_attempt_button').setLabel('Versucht anzurufen').setStyle(ButtonStyle.Danger),
            takeoverButton,
            new ButtonBuilder().setCustomId('close_ticket_button').setLabel('Schließen').setStyle(ButtonStyle.Danger)
        ];

        if (ticketData.acceptedBy && !ticketData.appointmentDate && !ticketData.appointmentTime) {
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

        if (ticketData.appointmentCompleted && (!ticketData.appointmentDate || !ticketData.appointmentTime)) {
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('schedule_followup_button').setLabel('Folgetermin festlegen').setStyle(ButtonStyle.Danger)
            ));
        }

        if (ticketData.avpsLink) {
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('edit_avps_link_button').setLabel('AVPS Akte bearbeiten').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('delete_avps_link_button').setLabel('Akte löschen').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('akte_ausgegeben_button').setLabel('Akte wurde herausgegeben').setStyle(ButtonStyle.Success)
            ));
        } else {
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('avps_link_button').setLabel('AVPS Akte hinterlegen').setStyle(ButtonStyle.Danger)
            ));
        }

        const preisButton = ticketData.preis
            ? new ButtonBuilder().setCustomId('edit_preis_button').setLabel('Preis bearbeiten').setStyle(ButtonStyle.Secondary)
            : new ButtonBuilder().setCustomId('set_preis_button').setLabel('Preis festlegen').setStyle(ButtonStyle.Danger);

        rows.push(new ActionRowBuilder().addComponents(
            preisButton
        ));

        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('reset_ticket_button').setLabel('Ticket zurücksetzen').setStyle(ButtonStyle.Secondary).setDisabled(isResetDisabled)
        ));

        return rows;
    } catch (err) {
        console.error('(Bot) Fehler beim Erstellen der Button Rows:', err);
        return [];
    }
};

const createEmbedFields = (ticketData) => {
    const reasonMapping = CONFIG.TICKET_REASONS[ticketData.grund];
    const isAutomaticTicket = reasonMapping && Object.keys(CONFIG.TICKET_REASONS).includes(ticketData.grund);
    const fields = [
        { name: 'Abteilung', value: ticketData.abteilungPing || 'Nicht angegeben' },
    ];

    if (!isAutomaticTicket && ticketData.createdBy) {
        fields.push({ name: 'Erstellt von', value: ticketData.createdBy });
    }

    fields.push(
        { name: 'Grund', value: reasonMapping ? reasonMapping.displayName : ticketData.grund || 'Nicht angegeben' },
        { name: 'Patient', value: ticketData.patient || 'Nicht angegeben' },
        { name: 'Telefon', value: ticketData.telefon || 'Nicht angegeben' },
        { name: 'Sonstiges', value: ticketData.sonstiges || 'Nicht angegeben' }
    );

    if (ticketData.acceptedBy) fields.push({ name: 'Übernommen von', value: ticketData.acceptedBy, inline: true });
    if (ticketData.preis) fields.push({ name: 'Preis', value: formatPrice(ticketData.preis), inline: false });
    if (ticketData.appointmentDate && ticketData.appointmentTime) {
        fields.push({ name: 'Termin', value: ticketData.appointmentDate + ' - ' + ticketData.appointmentTime });
    }
    if (ticketData.followupAppointments && ticketData.followupAppointments.length > 0) {
        ticketData.followupAppointments.forEach((appt, index) => {
            fields.push({ name: 'Folgetermin ' + (index + 1), value: appt.date + ' - ' + appt.time });
        });
    }
    if (ticketData.avpsLink) fields.push({ name: 'AVPS-Akte', value: ticketData.avpsLink });

    return fields;
};

const updateEmbedMessage = async (channel, ticketData) => {
    try {
        const embedMessage = await channel.messages.fetch(ticketData.embedMessageId);
        const updatedEmbed = new EmbedBuilder()
            .setTitle(embedMessage.embeds[0].title)
            .setColor(embedMessage.embeds[0].color)
            .addFields(createEmbedFields(ticketData));
        await embedMessage.edit({ embeds: [updatedEmbed], components: getButtonRows(ticketData) });
        console.log('(Bot) Embed-Nachricht erfolgreich aktualisiert in Kanal ' + channel.id);
    } catch (err) {
        console.error('(Bot) Fehler beim Bearbeiten der Embed-Nachricht in Kanal ' + channel.id + ':', err);
    }
};

const saveTicketData = () => {
    try {
        const data = Array.from(ticketDataStore.entries()).map(([key, value]) => ({ key, value }));
        fs.writeFileSync('tickets.json', JSON.stringify(data, null, 2));
        console.log('(Bot) Ticket-Daten erfolgreich gespeichert.');
    } catch (err) {
        console.error('(Bot) Fehler beim Speichern der Ticket-Daten:', err);
    }
};

const loadTicketData = async (bot) => {
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

        for (const [channelId, ticketData] of ticketDataStore) {
            try {
                const channel = bot.channels.cache.get(channelId);
                if (channel) {
                    await updateEmbedMessage(channel, ticketData);
                    await updateChannelName(channel, ticketData);
                    console.log(`(Bot) Embed und Kanalname für Ticket ${channelId} aktualisiert.`);
                } else {
                    console.log(`(Bot) Kanal ${channelId} nicht gefunden, überspringe Aktualisierung.`);
                }
            } catch (err) {
                console.error(`(Bot) Fehler beim Aktualisieren von Ticket ${channelId}:`, err);
            }
        }
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
    await loadTicketData(bot);

    const formChannel = bot.channels.cache.get(CONFIG.FORM_CHANNEL_ID);
    if (!formChannel) {
        console.error(`(Bot) Kanal mit ID ${CONFIG.FORM_CHANNEL_ID} nicht gefunden oder nicht zugänglich. Verfügbare Server: ${bot.guilds.cache.map(g => `${g.name} (${g.id})`).join(', ')}`);
        return;
    }

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
});

bot.on('messageCreate', async (message) => {
    console.log(`(Bot) Nachricht empfangen in Kanal ${message.channel?.id || 'unbekannt'}: ${message.content}`);
    if (!message.channel || message.channel.id !== CONFIG.TRIGGER_CHANNEL_ID || message.author.id !== CONFIG.BOT_USER_ID) return;

    const data = {
        abteilung: '', grund: '', patient: '', telefon: '', sonstiges: '', abteilungPing: '',
        buttonMessageId: null, appointmentMessageId: null, completedMessageId: null,
        avpsMessageId: null, embedMessageId: null,
        appointmentDate: null, appointmentTime: null, acceptedBy: null, avpsLink: null,
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
    const channelName = getChannelName(data);
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

    ticketDataStore.set(channel.id, data);
    saveTicketData();

    const reasonMappingEmbed = CONFIG.TICKET_REASONS[data.grund];
    const isAutomaticTicket = reasonMappingEmbed && Object.keys(CONFIG.TICKET_REASONS).includes(data.grund);
    const embedTitle = isAutomaticTicket ? `Behandlungsanfrage für ${reasonMappingEmbed.displayName}` : `Behandlungsanfrage für ${data.abteilung}`;
    const embed = new EmbedBuilder()
        .setTitle(embedTitle)
        .setColor(0x480007)
        .addFields(createEmbedFields(data));

    let embedMessage;
    try {
        embedMessage = await channel.send({
            content: `Eine neue Behandlungsanfrage (${data.abteilungPing || data.abteilung})`,
            embeds: [embed],
            components: getButtonRows(data),
        });
        data.embedMessageId = embedMessage.id;
        console.log(`(Bot) Embed-Nachricht erfolgreich gesendet in Kanal ${channel.id}`);
    } catch (err) {
        console.error(`(Bot) Fehler beim Senden der Embed-Nachricht in Kanal ${channel.id}:`, err);
        await channel.delete().catch(deleteErr => console.error(`(Bot) Fehler beim Löschen des fehlerhaften Kanals ${channel.id}:`, deleteErr));
        ticketDataStore.delete(channel.id);
        saveTicketData();
        return;
    }

    saveTicketData();
    console.log(`(Bot) Ticket erstellt und Embed gesendet in ${channel.name} (${channel.id})`);
});

bot.on('interactionCreate', async (interaction) => {
    console.log('(Bot) Interaktion empfangen: ' + interaction.customId + ' in Kanal ' + (interaction.channel?.id || 'unbekannt'));
    try {
        if (!ticketDataStore.has(interaction.channel?.id) && !interaction.customId.startsWith('create_ticket_')) {
            console.error('(Bot) Ticket-Daten für Kanal ' + (interaction.channel?.id || 'unbekannt') + ' nicht gefunden.');
            await interaction.reply({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
            return;
        }

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
                        new TextInputBuilder()
                            .setCustomId('telefon_input')
                            .setLabel('Telefon')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setValue("01726 ")
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('sonstiges_input').setLabel('Sonstiges').setStyle(TextInputStyle.Paragraph).setRequired(false)
                    )
                );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('create_ticket_modal_')) {
            const abteilung = interaction.customId.split('_')[3].charAt(0).toUpperCase() + interaction.customId.split('_')[3].slice(1);
            const grund = interaction.fields.getTextInputValue('grund_input')?.trim();
            const patient = interaction.fields.getTextInputValue('patient_input')?.trim();
            const telefon = interaction.fields.getTextInputValue('telefon_input')?.trim();
            const sonstiges = interaction.fields.getTextInputValue('sonstiges_input')?.trim();

            if (!grund || !patient || !telefon) {
                 await interaction.reply({ content: 'Grund, Patient und Telefon sind erforderlich.', ephemeral: true });
                return;
            }

            const departmentConfig = CONFIG.DEPARTMENTS[abteilung];
            if (!departmentConfig) {
                await interaction.reply({ content: `Ungültige Abteilung: ${abteilung}`, ephemeral: true });
                return;
            }

            const permissionOverwrites = [
                { id: interaction.guild.id, deny: ['ViewChannel'] },
                { id: departmentConfig.memberRoleId, allow: ['ViewChannel', 'SendMessages'] }
            ];

            CONFIG.rettungsdienst_rollen.forEach(roleId => {
                permissionOverwrites.push({ id: roleId, allow: ['ViewChannel', 'SendMessages'] });
            });

            CONFIG.ADMIN_ROLES.forEach(roleId => {
                permissionOverwrites.push({ id: roleId, allow: ['ViewChannel', 'SendMessages'] });
            });

            const maxGrundLength = 25;
            const truncatedGrund = grund.length > maxGrundLength ? grund.substring(0, maxGrundLength) : grund;
            const formattedGrund = truncatedGrund.replace(/ /g, '-');
            const channelName = `🕓-${patient.replace(/ /g, '-')}-${formattedGrund}`;

            const channel = await interaction.guild.channels.create({
                name: channelName,
                type: 0,
                parent: departmentConfig.categoryId,
                permissionOverwrites: permissionOverwrites
            });

            const data = {
                abteilung, grund, patient, telefon, sonstiges, abteilungPing: `<@&${departmentConfig.memberRoleId}>`,
                createdBy: `<@${interaction.user.id}>`,
                buttonMessageId: null, appointmentMessageId: null, completedMessageId: null,
                avpsMessageId: null, embedMessageId: null,
                appointmentDate: null, appointmentTime: null, acceptedBy: null, avpsLink: null,
                appointmentCompleted: false, isClosed: false, lastReset: false, callAttempt: false,
                preis: null, followupAppointments: []
            };

            ticketDataStore.set(channel.id, data);
            saveTicketData();

            const embed = new EmbedBuilder()
                .setTitle(`Behandlungsanfrage für ${data.abteilung}`)
                .setColor(0x480007)
                .addFields(createEmbedFields(data));

            const embedMessage = await channel.send({
                content: `Eine neue Behandlungsanfrage (${data.abteilungPing})`,
                embeds: [embed],
                components: getButtonRows(data),
            });

            data.embedMessageId = embedMessage.id;
            saveTicketData();

            const confirmationEmbed = new EmbedBuilder()
                .setTitle('Ticket erfolgreich erstellt')
                .setColor(0x480007)
                .addFields([
                    { name: 'Abteilung', value: data.abteilungPing, inline: false },
                    { name: 'Grund', value: grund, inline: false },
                    { name: 'Patient', value: patient, inline: false },
                    { name: 'Telefon', value: telefon, inline: false },
                    { name: 'Sonstiges', value: sonstiges || 'Nicht angegeben', inline: false },
                ]);

            await interaction.reply({ embeds: [confirmationEmbed], ephemeral: true });
            return;
        }

        if (interaction.isButton() && interaction.customId === 'close_ticket_button') {
            await interaction.deferUpdate();
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            const department = ticketData.abteilung;
            const config = CONFIG.DEPARTMENTS[department];
            await interaction.channel.permissionOverwrites.edit(config.memberRoleId, { SendMessages: false });
            await interaction.channel.permissionOverwrites.edit(config.leaderRoleId, { ViewChannel: true, SendMessages: true });

            CONFIG.rettungsdienst_rollen.forEach(roleId => {
                interaction.channel.permissionOverwrites.edit(roleId, { SendMessages: false });
            });

            for (const roleId of CONFIG.ADMIN_ROLES) {
                await interaction.channel.permissionOverwrites.edit(roleId, { ViewChannel: true, SendMessages: true });
            }

            ticketData.isClosed = true;
            saveTicketData();

            await updateEmbedMessage(interaction.channel, ticketData);
            await updateChannelName(interaction.channel, ticketData);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat das Ticket geschlossen.`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'reopen_ticket_button') {
            await interaction.deferUpdate();
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            const config = CONFIG.DEPARTMENTS[ticketData.abteilung];
            await interaction.channel.permissionOverwrites.edit(config.memberRoleId, { SendMessages: true });

            CONFIG.rettungsdienst_rollen.forEach(roleId => {
                interaction.channel.permissionOverwrites.edit(roleId, { SendMessages: true });
            });

            ticketData.isClosed = false;
            saveTicketData();

            await updateEmbedMessage(interaction.channel, ticketData);
            await updateChannelName(interaction.channel, ticketData);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat das Ticket wieder geöffnet.`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'delete_ticket_button') {
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                await interaction.reply({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            const config = CONFIG.DEPARTMENTS[ticketData.abteilung];
            const member = interaction.member;
            const isAdmin = CONFIG.ADMIN_ROLES.some(roleId => member.roles.cache.has(roleId));
            const isLeader = member.roles.cache.has(config.leaderRoleId);
            const canDelete = isAdmin || (isLeader && ticketData.isClosed);

            if (!canDelete) {
                await interaction.reply({ content: 'Du hast keine Berechtigung, dieses Ticket zu löschen. Nur Admins oder Abteilungsleiter (bei geschlossenen Tickets) dürfen löschen.', ephemeral: true });
                return;
            }

            const loggable = ticketData.acceptedBy && ticketData.grund && ticketData.avpsLink;
            let logMessage = 'Ticket wird nicht geloggt, da erforderliche Werte (acceptedBy, grund, avpsLink) fehlen.';
            if (loggable) {
                if (ticketData.abteilung === 'Psychologie') {
                    logMessage = `Ticket wird im Psychologie-Log (${CONFIG.PSYCHOLOGIE_LOG_CHANNEL_ID}) geloggt.`;
                } else if (ticketData.abteilung === 'Arbeitsmedizin') {
                    logMessage = `Ticket wird im Arbeitsmedizin-Log (${CONFIG.ARBEITSMEDIZIN_LOG_CHANNEL_ID}) geloggt.`;
                } else if (ticketData.abteilung === 'Station') {
                    logMessage = ticketData.preis && parseInt(ticketData.preis) > 0
                        ? `Ticket wird im Station-Log (${CONFIG.STATION_LOG_CHANNEL_ID}) geloggt.`
                        : `Ticket wird in Stationäre Behandlungen (${CONFIG.STATION_TREATMENT_CHANNEL_ID}) geloggt.`;
                }
            }

            const confirmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('confirm_delete_button').setLabel('Ticket löschen').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('cancel_delete_button').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary)
            );

            await interaction.reply({
                content: `Möchtest du das Ticket wirklich löschen? ${logMessage}`,
                components: [confirmRow],
                ephemeral: true
            });
            return;
        }

        if (interaction.isButton() && interaction.customId === 'confirm_delete_button') {
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                await interaction.reply({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            archiveTicketData(interaction.channel.id, ticketData);

            const reasonMapping = CONFIG.TICKET_REASONS[ticketData.grund];
            const isAutomaticTicket = reasonMapping && Object.keys(CONFIG.TICKET_REASONS).includes(ticketData.grund);
            const embedTitle = isAutomaticTicket ? `Behandlungsanfrage für ${reasonMapping.displayName}` : `Behandlungsanfrage für ${ticketData.abteilung}`;
            const logEmbed = new EmbedBuilder()
                .setTitle(embedTitle)
                .setColor(0x480007)
                .addFields(createEmbedFields(ticketData));

            const logChannel = bot.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
            if (logChannel) {
                await logChannel.send(`Ticket ${interaction.channel.id} wurde von ${interaction.user} gelöscht. Abteilung: ${ticketData.abteilung}, Patient: ${ticketData.patient}`);
                await logChannel.send({ embeds: [logEmbed] });
            }

            if (ticketData.acceptedBy && ticketData.grund && ticketData.avpsLink) {
                const specificLogEmbed = new EmbedBuilder()
                    .setTitle(`Neues Gutachten für ${ticketData.patient}`)
                    .setColor(0x480007)
                    .addFields([
                        { name: 'Name des Gutachters', value: ticketData.acceptedBy },
                        { name: 'Grund', value: reasonMapping ? reasonMapping.displayName : ticketData.grund },
                        { name: 'Preis', value: formatPrice(ticketData.preis) || 'Nicht angegeben' },
                        { name: 'Akte', value: ticketData.avpsLink }
                    ]);

                if (ticketData.abteilung === 'Psychologie') {
                    const psychoLogChannel = bot.channels.cache.get(CONFIG.PSYCHOLOGIE_LOG_CHANNEL_ID);
                    if (psychoLogChannel) {
                        await psychoLogChannel.send({ embeds: [specificLogEmbed] });
                    }
                } else if (ticketData.abteilung === 'Arbeitsmedizin') {
                    const arbeitsmedizinLogChannel = bot.channels.cache.get(CONFIG.ARBEITSMEDIZIN_LOG_CHANNEL_ID);
                    if (arbeitsmedizinLogChannel) {
                        await arbeitsmedizinLogChannel.send({ embeds: [specificLogEmbed] });
                    }
                } else if (ticketData.abteilung === 'Station') {
                    const targetChannelId = ticketData.preis && parseInt(ticketData.preis) > 0
                        ? CONFIG.STATION_LOG_CHANNEL_ID
                        : CONFIG.STATION_TREATMENT_CHANNEL_ID;
                    const stationLogChannel = bot.channels.cache.get(targetChannelId);
                    if (stationLogChannel) {
                        const stationEmbed = new EmbedBuilder()
                            .setTitle(`Neues Gutachten für ${ticketData.patient}`)
                            .setColor(0x480007)
                            .addFields([
                                { name: 'Name des Gutachters', value: ticketData.acceptedBy },
                                { name: 'Grund', value: reasonMapping ? reasonMapping.displayName : ticketData.grund },
                                { name: 'Akte', value: ticketData.avpsLink }
                            ]);
                        if (ticketData.preis && parseInt(ticketData.preis) > 0) {
                            stationEmbed.addFields([{ name: 'Preis', value: formatPrice(ticketData.preis) }]);
                        }
                        await stationLogChannel.send({ embeds: [stationEmbed] });
                    }
                }
            }

            ticketDataStore.delete(interaction.channel.id); // Korrigierter Fehler: ticketData.delete -> ticketDataStore.delete
            saveTicketData();
            await interaction.channel.delete();
            await interaction.reply({ content: 'Ticket erfolgreich gelöscht.', ephemeral: true });
            return;
        }

        if (interaction.isButton() && interaction.customId === 'cancel_delete_button') {
            await interaction.reply({ content: 'Löschvorgang abgebrochen.', ephemeral: true });
            return;
        }

        if (interaction.isButton() && interaction.customId === 'takeover_ticket_button') { // Korrigierter Fehler: takeover_user_modal -> takeover_ticket_button
            const modal = new ModalBuilder()
                .setCustomId('takeover_user_modal')
                .setTitle('Benutzer auswählen')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('user_input')
                            .setLabel('Benutzer/Dienstnummer (mit ; trennen)')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    )
                );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'takeover_user_modal') {
            await interaction.deferUpdate();
            console.log(`(Bot) Verarbeite takeover_user_modal für Kanal ${interaction.channel.id}`);
            const userInputs = interaction.fields.getTextInputValue('user_input')?.trim().split(';').map(u => u.trim());
            const userData = [];

            for (const userInput of userInputs) {
                try {
                    const data = await findUserInGuild(interaction.guild, userInput);
                    userData.push(data);
                    console.log(`(Bot) Benutzer gefunden: ${data.mention}`); // Korrigierter Fehler: data.ticket -> data.mention
                } catch (err) {
                    console.error(`(Bot) Fehler beim Suchen des Benutzers ${userInput} in Kanal ${interaction.channel.id}:`, err);
                    await interaction.followUp({ content: `Benutzer ${userInput} konnte nicht gefunden werden.`, ephemeral: true });
                    return;
                }
            }

            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei takeover_user_modal.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            ticketData.acceptedBy = userData.map(u => u.mention).join(', '); // Korrigierter Fehler: u.ticket -> u.mention
            ticketData.nickname = userData.map(u => u.nickname).join(', ');
            ticketData.lastReset = false;
            saveTicketData();

            await updateEmbedMessage(interaction.channel, ticketData);
            await updateChannelName(interaction.channel, ticketData);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat das Ticket ${ticketData.acceptedBy} zugewendet.`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'call_attempt_button') {
            await interaction.deferUpdate();
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei call_attempt_button.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            ticketData.callAttempt = true;
            ticketData.lastReset = false;
            saveTicketData();

            await updateEmbedMessage(interaction.channel, ticketData);
            await updateChannelName(interaction.channel, ticketData);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat versucht anzurufen.`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'schedule_appointment_button') {
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei schedule_appointment_button.`);
                await interaction.reply({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

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
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'schedule_appointment_modal') {
            await interaction.deferUpdate();
            console.log(`(Bot) Verarbeite schedule_appointment_modal für Kanal ${interaction.channel.id}`);
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei schedule_appointment_modal.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            let date = interaction.fields.getTextInputValue('date_input')?.trim() || ticketData.appointmentDate || new Date().toLocaleDateString('de');
            let timeInput = interaction.fields.getTextInputValue('time_input')?.trim();
            let time;
            if (!timeInput) {
                const now = new Date();
                now.setHours(now.getHours() + 2);
                time = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            } else {
                time = timeInput;
            }

            ticketData.appointmentDate = date;
            ticketData.appointmentTime = time;
            ticketData.appointmentCompleted = false;
            ticketData.lastReset = false;
            ticketData.callAttempt = false;
            saveTicketData();

            await updateEmbedMessage(interaction.channel, ticketData);
            await updateChannelName(interaction.channel, ticketData);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat einen Termin erstellt: ${date} - ${time}`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'no_show_button') {
            await interaction.deferUpdate();
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei no_show_button.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            ticketData.appointmentDate = null;
            ticketData.appointmentTime = null;
            ticketData.appointmentCompleted = false;
            ticketData.lastReset = false;
            saveTicketData();

            await updateEmbedMessage(interaction.channel, ticketData);
            await updateChannelName(interaction.channel, ticketData);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat angegeben, dass der Patient nicht zum Termin erschienen ist.`);
            return;
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
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'reschedule_appointment_modal') {
            await interaction.deferUpdate();
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei reschedule_appointment_modal.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            let date = interaction.fields.getTextInputValue('date_input')?.trim() || ticketData.appointmentDate;
            let time = interaction.fields.getTextInputValue('time_input')?.trim() || ticketData.appointmentTime;

            ticketData.appointmentDate = date;
            ticketData.appointmentTime = time;
            ticketData.appointmentCompleted = false;
            ticketData.lastReset = false;
            saveTicketData();

            await updateEmbedMessage(interaction.channel, ticketData);
            await updateChannelName(interaction.channel, ticketData);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat den Termin umgelegt: ${date} - ${time}`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'appointment_completed_button') {
            await interaction.deferUpdate(); // Hinzugefügt, um konsistent zu sein
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei appointment_completed_button.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            if (ticketData.appointmentDate && ticketData.appointmentTime) {
                ticketData.followupAppointments = ticketData.followupAppointments || [];
                ticketData.followupAppointments.push({ date: ticketData.appointmentDate, time: ticketData.appointmentTime });
                ticketData.appointmentDate = null;
                ticketData.appointmentTime = null;
            }

            ticketData.appointmentCompleted = true;
            ticketData.lastReset = false;
            saveTicketData();

            await updateEmbedMessage(interaction.channel, ticketData);
            await updateChannelName(interaction.channel, ticketData);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat den Termin erledigt.`);
            await interaction.followUp({ content: 'Termin erledigt.', ephemeral: true }); // Geändert von .reply zu .followUp, da deferUpdate verwendet wird
            return;
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
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'avps_link_modal') {
            await interaction.deferUpdate();
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei avps_link_modal.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            ticketData.avpsLink = interaction.fields.getTextInputValue('link_input')?.trim();
            ticketData.lastReset = false;
            saveTicketData();

            await updateEmbedMessage(interaction.channel, ticketData);
            await updateChannelName(interaction.channel, ticketData);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat die AVPS Akte hinterlegt: ${ticketData.avpsLink}`);
            return;
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
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'edit_avps_link_modal') {
            await interaction.deferUpdate();
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei edit_avps_link_modal.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            ticketData.avpsLink = interaction.fields.getTextInputValue('link_input')?.trim();
            ticketData.lastReset = false;
            saveTicketData();

            await updateEmbedMessage(interaction.channel, ticketData);
            await updateChannelName(interaction.channel, ticketData);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat die AVPS Akte bearbeitet: ${ticketData.avpsLink}`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'delete_avps_link_button') {
            await interaction.deferUpdate();
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei delete_avps_link_button.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            ticketData.avpsLink = null;
            ticketData.lastReset = false;
            saveTicketData();

            await updateEmbedMessage(interaction.channel, ticketData);
            await updateChannelName(interaction.channel, ticketData);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat die AVPS Akte gelöscht.`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'akte_ausgegeben_button') {
            await interaction.deferUpdate();
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei akte_ausgegeben_button.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat die Akte an den Patienten ausgehändigt.`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'set_preis_button') {
            const modal = new ModalBuilder()
                .setCustomId('set_preis_modal')
                .setTitle('Preis festlegen')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('preis_input').setLabel('Preis').setStyle(TextInputStyle.Short).setRequired(false)
                    )
                );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'set_preis_modal') {
            await interaction.deferUpdate();
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei set_preis_modal.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            const preis = interaction.fields.getTextInputValue('preis_input')?.trim();
            ticketData.preis = preis ? parseInt(preis) : undefined;
            ticketData.lastReset = false;
            saveTicketData();

            await updateEmbedMessage(interaction.channel, ticketData);
            await updateChannelName(interaction.channel, ticketData);
            await interaction.channel.send(
                preis
                    ? `[${getTimestamp()}] ${interaction.user} hat den Preis auf ${formatPrice(preis)} festgelegt.`
                    : `[${getTimestamp()}] ${interaction.user} hat den Preis entfernt.`
            );
            await interaction.followUp({ content: preis ? 'Preis festgelegt.' : 'Preis entfernt.', ephemeral: true });
            return;
        }

        if (interaction.isButton() && interaction.customId === 'edit_preis_button') {
            const modal = new ModalBuilder()
                .setCustomId('edit_preis_modal')
                .setTitle('Preis bearbeiten')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('preis_input').setLabel('Neuer Preis').setStyle(TextInputStyle.Short).setRequired(false)
                    )
                );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'edit_preis_modal') {
            await interaction.deferUpdate();
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei edit_preis_modal.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            const preis = interaction.fields.getTextInputValue('preis_input')?.trim();
            ticketData.preis = preis ? parseInt(preis) : undefined;
            ticketData.lastReset = false;
            saveTicketData();

            await updateEmbedMessage(interaction.channel, ticketData);
            await updateChannelName(interaction.channel, ticketData);
            await interaction.channel.send(
                preis
                    ? `[${getTimestamp()}] ${interaction.user} hat den Preis auf ${formatPrice(preis)} bearbeitet.`
                    : `[${getTimestamp()}] ${interaction.user} hat den Preis entfernt.`
            );
            await interaction.followUp({ content: preis ? 'Preis bearbeitet.' : 'Preis entfernt.', ephemeral: true });
            return;
        }

        if (interaction.isButton() && interaction.customId === 'schedule_followup_button') {
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei schedule_followup_button.`);
                await interaction.reply({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            const modal = new ModalBuilder()
                .setCustomId('schedule_followup_modal')
                .setTitle('Folgetermin festlegen')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('date_input').setLabel('Datum (DD.MM.YYYY)').setStyle(TextInputStyle.Short).setRequired(false)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('time_input').setLabel('Uhrzeit (z.B. 14:30)').setStyle(TextInputStyle.Short).setRequired(false)
                    )
                );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'schedule_followup_modal') {
            await interaction.deferUpdate();
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei schedule_followup_modal.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            let date = interaction.fields.getTextInputValue('date_input')?.trim() || new Date().toLocaleDateString('de-DE');
            let timeInput = interaction.fields.getTextInputValue('time_input')?.trim();
            let time;
            if (!timeInput) {
                const now = new Date();
                now.setHours(now.getHours() + 2);
                time = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            } else {
                time = timeInput;
            }

            ticketData.appointmentDate = date;
            ticketData.appointmentTime = time;
            ticketData.appointmentCompleted = false;
            ticketData.lastReset = false;
            saveTicketData();

            await updateEmbedMessage(interaction.channel, ticketData);
            await updateChannelName(interaction.channel, ticketData);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat einen Folgetermin erstellt: ${date} - ${time}`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'reset_ticket_button') {
            await interaction.deferUpdate();
            const ticketData = ticketDataStore.get(interaction.channel.id);
            if (!ticketData) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei reset_ticket_button.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            ticketData.acceptedBy = null;
            ticketData.nickname = null;
            ticketData.appointmentDate = null;
            ticketData.appointmentTime = null;
            ticketData.appointmentCompleted = false;
            ticketData.avpsLink = null;
            ticketData.callAttempt = false;
            ticketData.preis = null;
            ticketData.followupAppointments = [];
            ticketData.lastReset = true;
            saveTicketData();

            await updateEmbedMessage(interaction.channel, ticketData);
            await updateChannelName(interaction.channel, ticketData);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat das Ticket zurückgesetzt.`);
            return;
        }
    } catch (err) {
        console.error(`(Bot) Unerwarteter Fehler in interactionCreate für Kanal ${interaction.channel?.id || 'unbekannt'}:`, err);
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ content: 'Ein Fehler ist aufgetreten. Bitte versuche es erneut.', ephemeral: true }).catch(e => console.error('(Bot) Fehler beim Senden der Fehlerantwort:', e));
        }
    }
});

bot.login(CONFIG.BOT_TOKEN);