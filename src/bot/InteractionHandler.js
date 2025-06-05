const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const CONFIG = require("../config/Config");
const { getTimestamp, findUserInGuild, formatPrice, getCurrentDateTime, retryOnRateLimit } = require("../utils/Helpers");
const Ticket = require("../tickets/Ticket");
const DatabaseManager = require("../database/DatabaseManager");

async function handleInteraction(interaction, ticketManager) {
    console.log('(Bot) Interaktion empfangen: ' + interaction.customId + ' in Kanal ' + (interaction.channel?.id || 'unbekannt'));
    try {
        if (!ticketManager.getTicket(interaction.channel?.id) && !interaction.customId.startsWith('create_ticket_')) {
            console.error('(Bot) Ticket-Daten für Kanal ' + (interaction.channel?.id || 'unbekannt') + ' nicht gefunden.');
            await interaction.channel.send('Ticket-Daten nicht gefunden.');
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
            await interaction.deferReply({ ephemeral: true });
            const abteilung = interaction.customId.split('_')[3].charAt(0).toUpperCase() + interaction.customId.split('_')[3].slice(1);
            const grund = interaction.fields.getTextInputValue('grund_input')?.trim();
            const patient = interaction.fields.getTextInputValue('patient_input')?.trim();
            const telefon = interaction.fields.getTextInputValue('telefon_input')?.trim();
            const sonstiges = interaction.fields.getTextInputValue('sonstiges_input')?.trim();

            if (!grund || !patient || !telefon) {
                await interaction.editReply({ content: 'Grund, Patient und Telefon sind erforderlich.', ephemeral: true });
                return;
            }

            const departmentConfig = CONFIG.DEPARTMENTS[abteilung];
            if (!departmentConfig) {
                await interaction.editReply({ content: `Ungültige Abteilung: ${abteilung}`, ephemeral: true });
                return;
            }

            const permissionOverwrites = [
                { id: interaction.guild.id, deny: ['ViewChannel'] },
                { id: departmentConfig.memberRoleId, allow: ['ViewChannel', 'SendMessages'] }
            ];

            const reasonMapping = CONFIG.TICKET_REASONS[grund];
            if (!reasonMapping) {
                CONFIG.rettungsdienst_rollen.forEach(roleId => {
                    permissionOverwrites.push({ id: roleId, allow: ['ViewChannel', 'SendMessages'] });
                });
            }

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
                permissionOverwrites
            });

            const data = {
                abteilung, grund, patient, telefon, sonstiges, abteilungPing: `<@&${departmentConfig.memberRoleId}>`,
                createdBy: `<@${interaction.user.id}>`,
                buttonMessageId: null, appointmentMessageId: null, completedMessageId: null,
                avpsMessageId: null, embedMessageId: null,
                appointmentDate: null, appointmentTime: null, originalAppointmentDate: null, originalAppointmentTime: null,
                acceptedBy: null, avpsLink: null,
                appointmentCompleted: false, isClosed: false, lastReset: false, callAttempt: false,
                preis: reasonMapping ? reasonMapping.preis : null,
                followupAppointments: []
            };

            const ticket = new Ticket(channel.id, data);
            ticketManager.setTicket(channel.id, ticket);

            const embed = ticket.getEmbed();
            const components = ticket.getButtonRows();

            const embedMessage = await channel.send({
                content: `Eine neue Behandlungsanfrage (${ticket.abteilungPing})`,
                embeds: [embed],
                components: components,
            });

            ticket.embedMessageId = embedMessage.id;
            ticketManager.setTicket(channel.id, ticket);

            await interaction.editReply({ content: `[${getTimestamp()}] Ticket erfolgreich erstellt für ${patient} (${abteilung}).`, ephemeral: true });
            return;
        }

        if (interaction.isButton() && interaction.customId === 'close_ticket_button') {
            await interaction.deferReply({ ephemeral: true });
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                await interaction.editReply({ content: 'Ticket nicht gefunden.', ephemeral: true });
                return;
            }

            ticket.isClosed = true;
            ticketManager.setTicket(interaction.channel.id, ticket);

            // Schließnachricht im Ticket-Kanal
            const closeMessage = `[${getTimestamp()}] <@${interaction.user.id}> hat das Ticket geschlossen.`;
            try {
                await interaction.channel.send({ content: closeMessage });
            } catch (err) {
                console.error(`(Bot) Fehler beim Senden der Schließnachricht in Kanal ${interaction.channel.id}:`, err);
                await interaction.editReply({ content: 'Fehler beim Senden der Schließnachricht.', ephemeral: true });
                return;
            }

            // Embed und Buttons aktualisieren
            const embed = ticket.getEmbed();
            const components = ticket.getButtonRows();
            try {
                const embedMessage = await interaction.channel.messages.fetch(ticket.embedMessageId);
                await embedMessage.edit({ embeds: [embed], components });
            } catch (err) {
                console.error(`(Bot) Fehler beim Aktualisieren der Embed-Nachricht ${ticket.embedMessageId}:`, err);
            }

            // Log-Nachrichten senden
            const logChannel = interaction.guild.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
            if (logChannel) {
                const logMessage = `[${getTimestamp()}] Ticket ${interaction.channel.id} wurde von <@${interaction.user.id}> geschlossen. Abteilung: ${ticket.abteilung}, Patient: ${ticket.patient}`;
                try {
                    await logChannel.send(logMessage);
                } catch (err) {
                    console.error(`(Bot) Fehler beim Senden der Log-Nachricht in Kanal ${CONFIG.LOG_CHANNEL_ID}:`, err);
                }
            }

            // Abteilungsspezifische Log-Nachrichten
            let departmentLogChannelId;
            if (ticket.abteilung === 'Psychologie') {
                departmentLogChannelId = CONFIG.PSYCHOLOGIE_LOG_CHANNEL_ID;
            } else if (ticket.abteilung === 'Arbeitsmedizin') {
                departmentLogChannelId = CONFIG.ARBEITSMEDIZIN_LOG_CHANNEL_ID;
            } else if (ticket.abteilung === 'Station') {
                departmentLogChannelId = CONFIG.STATION_LOG_CHANNEL_ID;
            }

            if (departmentLogChannelId) {
                const departmentLogChannel = interaction.guild.channels.cache.get(departmentLogChannelId);
                if (departmentLogChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('Ticket geschlossen')
                        .setColor(0x480007)
                        .addFields(
                            { name: 'Abteilung', value: ticket.abteilung, inline: true },
                            { name: 'Patient', value: ticket.patient, inline: true },
                            { name: 'Grund', value: ticket.grund || 'Nicht angegeben', inline: true },
                            { name: 'Geschlossen von', value: `<@${interaction.user.id}>`, inline: true },
                            { name: 'Preis', value: ticket.preis ? formatPrice(ticket.preis) : 'Nicht angegeben', inline: true },
                            { name: 'AVPS-Akte', value: ticket.avpsLink || 'Nicht angegeben', inline: true }
                        )
                        .setTimestamp();
                    try {
                        await departmentLogChannel.send({ embeds: [logEmbed] });
                    } catch (err) {
                        console.error(`(Bot) Fehler beim Senden der Abteilungs-Log-Nachricht in Kanal ${departmentLogChannelId}:`, err);
                    }
                }
            }

            // Stationäre Behandlungen (falls Preis > 0)
            if (ticket.abteilung === 'Station' && ticket.preis && parseInt(ticket.preis) > 0) {
                const stationTreatmentChannel = interaction.guild.channels.cache.get(CONFIG.STATION_TREATMENT_CHANNEL_ID);
                if (stationTreatmentChannel) {
                    const treatmentEmbed = new EmbedBuilder()
                        .setTitle('Stationäre Behandlung')
                        .setColor(0x480007)
                        .addFields(
                            { name: 'Patient', value: ticket.patient, inline: true },
                            { name: 'Grund', value: ticket.grund || 'Nicht angegeben', inline: true },
                            { name: 'Preis', value: formatPrice(ticket.preis), inline: true },
                            { name: 'Geschlossen von', value: `<@${interaction.user.id}>`, inline: true }
                        )
                        .setTimestamp();
                    try {
                        await stationTreatmentChannel.send({ embeds: [treatmentEmbed] });
                    } catch (err) {
                        console.error(`(Bot) Fehler beim Senden der stationären Behandlungs-Nachricht in Kanal ${CONFIG.STATION_TREATMENT_CHANNEL_ID}:`, err);
                    }
                }
            }

            // Kanal asynchron umbenennen
            retryOnRateLimit(async () => {
                console.log(`(Bot) Asynchrone Umbenennung gestartet für Kanal ${interaction.channel.id} zu ${ticket.getChannelName()}`);
                await ticketManager.updateChannelName(client, ticket); // client korrekt übergeben
                console.log(`(Bot) Kanal ${interaction.channel.id} erfolgreich umbenannt`);
                return true;
            }, 3).catch(() => {
                console.warn(`(Bot) Asynchrone Umbenennung für Kanal ${interaction.channel.id} fehlgeschlagen, fahre fort`);
            });

            await interaction.editReply({ content: `[${getTimestamp()}] Ticket erfolgreich geschlossen.`, ephemeral: true });
        }

        if (interaction.isButton() && interaction.customId === 'reopen_ticket_button') {
            await interaction.deferUpdate();
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                await interaction.channel.send('Ticket-Daten nicht gefunden.');
                return;
            }

            const config = CONFIG.DEPARTMENTS[ticket.abteilung];
            await interaction.channel.permissionOverwrites.edit(config.memberRoleId, { SendMessages: true });

            CONFIG.rettungsdienst_rollen.forEach(roleId => {
                interaction.channel.permissionOverwrites.edit(roleId, { SendMessages: true });
            });

            ticket.isClosed = false;
            ticketManager.setTicket(interaction.channel.id, ticket);

            await ticketManager.updateChannelName(interaction.channel, ticket);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat das Ticket wieder geöffnet.`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'delete_ticket_button') {
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                await interaction.reply({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            const config = CONFIG.DEPARTMENTS[ticket.abteilung];
            const member = interaction.member;
            const isAdmin = CONFIG.ADMIN_ROLES.some(roleId => member.roles.cache.has(roleId));
            const isLeader = member.roles.cache.has(config.leaderRoleId);
            const canDelete = isAdmin || (isLeader && ticket.isClosed);

            if (!canDelete) {
                await interaction.reply({ content: 'Du hast keine Berechtigung, dieses Ticket zu löschen. Nur Admins oder Abteilungsleiter (bei geschlossenen Tickets) dürfen löschen.', ephemeral: true });
                return;
            }

            let logMessage;
            const isPsychOrArbeitsmedizin = ticket.abteilung === 'Psychologie' || ticket.abteilung === 'Arbeitsmedizin';
            const loggable = isPsychOrArbeitsmedizin
                ? ticket.acceptedBy && ticket.grund && ticket.avpsLink && ticket.preis
                : ticket.acceptedBy && ticket.grund && ticket.avpsLink;

            if (!loggable) {
                logMessage = isPsychOrArbeitsmedizin
                    ? 'Ticket wird nicht geloggt, da erforderliche Werte (Ticket angenommen, Grund, AVPS Akte, Preis) fehlen.'
                    : 'Ticket wird nicht geloggt, da erforderliche Werte (Ticket angenommen, Grund, AVPS Akte) fehlen.';
            } else {
                if (ticket.abteilung === 'Psychologie') {
                    logMessage = `Ticket wird im Psychologie-Log  <@&(${CONFIG.PSYCHOLOGIE_LOG_CHANNEL_ID})> geloggt.`;
                } else if (ticket.abteilung === 'Arbeitsmedizin') {
                    logMessage = `Ticket wird im Arbeitsmedizin-Log <@&(${CONFIG.ARBEITSMEDIZIN_LOG_CHANNEL_ID})> geloggt.`;
                } else if (ticket.abteilung === 'Station') {
                    logMessage = ticket.preis && parseInt(ticket.preis) > 0
                        ? `Ticket wird im Station-Log  <@&(${CONFIG.STATION_LOG_CHANNEL_ID})> geloggt.`
                        : `Ticket wird in Stationäre Behandlungen  <@&(${CONFIG.STATION_TREATMENT_CHANNEL_ID})> geloggt.`;
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
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                await interaction.reply({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            DatabaseManager.archiveTicket(interaction.channel.id, ticket);

            const reasonMapping = CONFIG.TICKET_REASONS[ticket.grund];
            const isAutomaticTicket = reasonMapping && Object.keys(CONFIG.TICKET_REASONS).includes(ticket.grund);
            const embedTitle = isAutomaticTicket ? `Behandlungsanfrage für ${reasonMapping.displayName}` : `Behandlungsanfrage für ${ticket.abteilung}`;
            const logEmbed = new EmbedBuilder()
                .setTitle(embedTitle)
                .setColor(0x480007)
                .addFields(ticket.createEmbedFields());

            const bot = interaction.client;
            const logChannel = bot.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
            if (logChannel) {
                await logChannel.send(`[${getTimestamp()}] Ticket ${interaction.channel.id} wurde von ${interaction.user} gelöscht. Abteilung: ${ticket.abteilung}, Patient: ${ticket.patient}`);
                await logChannel.send({ embeds: [logEmbed] });
            }

            const isPsychOrArbeitsmedizin = ticket.abteilung === 'Psychologie' || ticket.abteilung === 'Arbeitsmedizin';
            const loggable = isPsychOrArbeitsmedizin
                ? ticket.acceptedBy && ticket.grund && ticket.avpsLink && ticket.preis
                : ticket.acceptedBy && ticket.grund && ticket.avpsLink;

            if (loggable) {
                const specificLogEmbed = new EmbedBuilder()
                    .setTitle(`Behandlung von ${ticket.patient}`)
                    .setColor(0x480007)
                    .addFields([
                        { name: 'Name:', value: ticket.acceptedBy },
                        { name: 'Grund', value: reasonMapping ? reasonMapping.displayName : ticket.grund },
                        { name: 'Preis', value: formatPrice(ticket.preis) || 'Nicht angegeben' },
                        { name: 'Akte', value: ticket.avpsLink }
                    ]);

                if (ticket.abteilung === 'Psychologie') {
                    const psychoLogChannel = bot.channels.cache.get(CONFIG.PSYCHOLOGIE_LOG_CHANNEL_ID);
                    if (psychoLogChannel) {
                        await psychoLogChannel.send({ embeds: [specificLogEmbed] });
                    }
                } else if (ticket.abteilung === 'Arbeitsmedizin') {
                    const arbeitsmedizinLogChannel = bot.channels.cache.get(CONFIG.ARBEITSMEDIZIN_LOG_CHANNEL_ID);
                    if (arbeitsmedizinLogChannel) {
                        await arbeitsmedizinLogChannel.send({ embeds: [specificLogEmbed] });
                    }
                } else if (ticket.abteilung === 'Station') {
                    const targetChannelId = ticket.preis && parseInt(ticket.preis) > 0
                        ? CONFIG.STATION_LOG_CHANNEL_ID
                        : CONFIG.STATION_TREATMENT_CHANNEL_ID;
                    const stationLogChannel = bot.channels.cache.get(targetChannelId);
                    if (stationLogChannel) {
                        const stationEmbed = new EmbedBuilder()
                            .setTitle(`Behandlung von ${ticket.patient}`)
                            .setColor(0x480007)
                            .addFields([
                                { name: 'Name:', value: ticket.acceptedBy },
                                { name: 'Grund', value: reasonMapping ? reasonMapping.displayName : ticket.grund },
                                { name: 'Akte', value: ticket.avpsLink }
                            ]);
                        if (ticket.preis && parseInt(ticket.preis) > 0) {
                            stationEmbed.addFields([{ name: 'Preis', value: formatPrice(ticket.preis) }]);
                        }
                        await stationLogChannel.send({ embeds: [stationEmbed] });
                    }
                }
            }

            ticketManager.deleteTicket(interaction.channel.id);
            await interaction.channel.delete();
            return;
        }

        if (interaction.isButton() && interaction.customId === 'cancel_delete_button') {
            await interaction.channel.send('Löschvorgang abgebrochen.');
            return;
        }

        if (interaction.isButton() && interaction.customId === 'takeover_ticket_button') {
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
                    console.log(`(Bot) Benutzer gefunden: ${data.mention}`);
                } catch (err) {
                    console.error(`(Bot) Fehler beim Suchen des Benutzers ${userInput} in Kanal ${interaction.channel.id}:`, err);
                    await interaction.reply({ content: `Benutzer ${userInput} konnte nicht gefunden werden.`, ephemeral: true });
                    return;
                }
            }

            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei takeover_user_modal.`);
                await interaction.reply({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            ticket.acceptedBy = userData.map(u => u.mention).join('\n');
            ticket.nickname = userData.map(u => u.nickname).join('\n');
            ticket.lastReset = false;
            ticketManager.setTicket(interaction.channel.id, ticket);

            await ticketManager.updateChannelName(interaction.channel, ticket);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat das Ticket an ${userData.map(u => u.mention).join(', ')} neu vergeben.`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'call_attempt_button') {
            await interaction.deferUpdate();
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei call_attempt_button.`);
                await interaction.channel.send('Ticket-Daten nicht gefunden.');
                return;
            }

            ticket.callAttempt = true;
            ticket.lastReset = false;
            ticketManager.setTicket(interaction.channel.id, ticket);

            await ticketManager.updateChannelName(interaction.channel, ticket);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat versucht anzurufen.`);
            return;
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
                        new TextInputBuilder().setCustomId('time_input').setLabel('Uhrzeit (HH:MM)').setStyle(TextInputStyle.Short).setRequired(false)
                    )
                );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'schedule_appointment_modal') {
            await interaction.deferUpdate();
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei schedule_appointment_modal.`);
                await interaction.channel.send('Ticket-Daten nicht gefunden.');
                return;
            }

            let date = interaction.fields.getTextInputValue('date_input')?.trim();
            let time = interaction.fields.getTextInputValue('time_input')?.trim();

            if (!date || !time) {
                const { date: currentDate, time: currentTime } = getCurrentDateTime();
                date = date || currentDate;
                time = time || currentTime;
            }

            ticket.appointmentDate = date;
            ticket.appointmentTime = time;
            ticket.appointmentCompleted = false;
            ticketManager.setTicket(interaction.channel.id, ticket);

            await ticketManager.updateChannelName(interaction.channel, ticket);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat einen Termin festgelegt: ${date} - ${time}`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'appointment_completed_button') {
            await interaction.deferUpdate();
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei appointment_completed_button.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            if (ticket.appointmentDate && ticket.appointmentTime) {
                if (!ticket.followupAppointments) ticket.followupAppointments = [];
                ticket.followupAppointments.push({ date: ticket.appointmentDate, time: ticket.appointmentTime });
                ticket.appointmentDate = null;
                ticket.appointmentTime = null;
                ticket.appointmentCompleted = true;
                ticketManager.setTicket(interaction.channel.id, ticket);

                await ticketManager.updateChannelName(interaction.channel, ticket);
                await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat den Termin erledigt.`);
            }
            return;
        }

        if (interaction.isButton() && interaction.customId === 'schedule_followup_button') {
            const modal = new ModalBuilder()
                .setCustomId('schedule_followup_modal')
                .setTitle('Folgetermin festlegen')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('date_input').setLabel('Datum (DD.MM.YYYY)').setStyle(TextInputStyle.Short).setRequired(false)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('time_input').setLabel('Uhrzeit (HH:MM)').setStyle(TextInputStyle.Short).setRequired(false)
                    )
                );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'schedule_followup_modal') {
            await interaction.deferUpdate();
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei schedule_followup_modal.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            let date = interaction.fields.getTextInputValue('date_input')?.trim();
            let time = interaction.fields.getTextInputValue('time_input')?.trim();

            if (!date || !time) {
                const { date: currentDate, time: currentTime } = getCurrentDateTime();
                date = date || currentDate;
                time = time || currentTime;
            }

            ticket.appointmentDate = date;
            ticket.appointmentTime = time;
            ticket.appointmentCompleted = false;
            ticketManager.setTicket(interaction.channel.id, ticket);

            await ticketManager.updateChannelName(interaction.channel, ticket);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat einen Folgetermin festgelegt: ${date} - ${time}`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'avps_link_button') {
            const modal = new ModalBuilder()
                .setCustomId('avps_link_modal')
                .setTitle('AVPS Akte hinterlegen')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('link_input').setLabel('AVPS-Link').setStyle(TextInputStyle.Short).setRequired(true)
                    )
                );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'avps_link_modal') {
            await interaction.deferUpdate();
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei avps_link_modal.`);
                await interaction.channel.send('Ticket-Daten nicht gefunden.');
                return;
            }

            const link = interaction.fields.getTextInputValue('link_input')?.trim();
            if (!link) {
                await interaction.channel.send('Ein gültiger AVPS-Link ist erforderlich.');
                return;
            }

            ticket.avpsLink = link;
            ticketManager.setTicket(interaction.channel.id, ticket);

            await ticketManager.updateChannelName(interaction.channel, ticket);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat einen AVPS-Link hinterlegt: ${link}`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'set_preis_button') {
            const modal = new ModalBuilder()
                .setCustomId('set_preis_modal')
                .setTitle('Preis festlegen')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('preis_input')
                            .setLabel('Preis (in €, nur Ganzzahlen)')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                            .setPlaceholder('Leer lassen, um Preis zu löschen')
                    )
                );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'set_preis_modal') {
            await interaction.deferUpdate();
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei set_preis_modal.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            const preis = interaction.fields.getTextInputValue('preis_input')?.trim();
            if (!preis) {
                ticket.preis = null;
            } else {
                const num = parseFloat(preis);
                if (isNaN(num) || !Number.isInteger(num) || num < 0) {
                    await interaction.followUp({ content: 'Bitte gib eine gültige Ganzzahl ein (z. B. 0, 100).', ephemeral: true });
                    return;
                }
                ticket.preis = parseInt(preis);
            }

            ticketManager.setTicket(interaction.channel.id, ticket);

            await ticketManager.updateChannelName(interaction.channel, ticket);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat den Preis ${preis ? 'festgelegt: ' + formatPrice(preis) : 'gelöscht'}.`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'edit_preis_button') {
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei edit_preis_button.`);
                await interaction.reply({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            const modal = new ModalBuilder()
                .setCustomId('edit_preis_modal')
                .setTitle('Preis bearbeiten')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('preis_input')
                            .setLabel('Neuer Preis (in €, nur Ganzzahlen)')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                            .setValue(ticket.preis ? ticket.preis.toString() : '')
                            .setPlaceholder('Leer lassen, um Preis zu löschen')
                    )
                );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'edit_preis_modal') {
            await interaction.deferUpdate();
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei edit_preis_modal.`);
                await interaction.followUp({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            const preis = interaction.fields.getTextInputValue('preis_input')?.trim();
            if (!preis) {
                ticket.preis = null;
            } else {
                const num = parseFloat(preis);
                if (isNaN(num) || !Number.isInteger(num) || num < 0) {
                    await interaction.followUp({ content: 'Bitte gib eine gültige Ganzzahl ein (z. B. 0, 100).', ephemeral: true });
                    return;
                }
                ticket.preis = parseInt(preis);
            }

            ticketManager.setTicket(interaction.channel.id, ticket);

            await ticketManager.updateChannelName(interaction.channel, ticket);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat den Preis ${preis ? 'bearbeitet: ' + formatPrice(preis) : 'gelöscht'}.`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'edit_avps_link_button') {
            const modal = new ModalBuilder()
                .setCustomId('edit_avps_link_modal')
                .setTitle('AVPS Akte bearbeiten')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('link_input').setLabel('Neuer AVPS-Link').setStyle(TextInputStyle.Short).setRequired(true)
                    )
                );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'edit_avps_link_modal') {
            await interaction.deferUpdate();
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei edit_avps_link_modal.`);
                await interaction.channel.send('Ticket-Daten nicht gefunden.');
                return;
            }

            const link = interaction.fields.getTextInputValue('link_input')?.trim();
            if (!link) {
                await interaction.channel.send('Ein gültiger AVPS-Link ist erforderlich.');
                return;
            }

            ticket.avpsLink = link;
            ticketManager.setTicket(interaction.channel.id, ticket);

            await ticketManager.updateChannelName(interaction.channel, ticket);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat den AVPS-Link bearbeitet: ${link}`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'delete_avps_link_button') {
            await interaction.deferUpdate();
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei delete_avps_link_button.`);
                await interaction.channel.send('Ticket-Daten nicht gefunden.');
                return;
            }

            ticket.avpsLink = null;
            ticketManager.setTicket(interaction.channel.id, ticket);

            await ticketManager.updateChannelName(interaction.channel, ticket);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat den AVPS-Link gelöscht.`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'akte_ausgegeben_button') {
            await interaction.deferUpdate();
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei akte_ausgegeben_button.`);
                await interaction.reply({ content: 'Ticket-Daten nicht gefunden.', ephemeral: true });
                return;
            }

            ticket.akteAusgegeben = true;
            ticketManager.setTicket(interaction.channel.id, ticket);

            await ticketManager.updateChannelName(interaction.channel, ticket);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat die Akte herausgegeben.`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'no_show_button') {
            await interaction.deferUpdate();
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei no_show_button.`);
                await interaction.channel.send('Ticket-Daten nicht gefunden.');
                return;
            }

            ticket.appointmentDate = null;
            ticket.appointmentTime = null;
            ticket.appointmentCompleted = false;
            ticketManager.setTicket(interaction.channel.id, ticket);

            await ticketManager.updateChannelName(interaction.channel, ticket);
            await interaction.reply(`[${getTimestamp()}] ${interaction.user} hat den Termin als nicht erschienen markiert.`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'reschedule_appointment_button') {
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei reschedule_appointment_button`);
                await interaction.reply('Ticket-Daten nicht gefunden.');
                return;
            }

            const modal = new ModalBuilder()
                .setCustomId('reschedule_appointment_modal')
                .setTitle('Termin umlegen')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('date_input').setLabel('Datum (DD.MM.YYYY)').setStyle(TextInputStyle.Short).setRequired(false)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('time_input').setLabel('Uhrzeit (HH:MM)').setStyle(TextInputStyle.Short).setRequired(false)
                    )
                );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'reschedule_appointment_modal') {
            await interaction.deferUpdate();
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei reschedule_appointment_modal.`);
                await interaction.channel.send('Ticket-Daten nicht gefunden.');
                return;
            }

            let date = interaction.fields.getTextInputValue('date_input')?.trim();
            let time = interaction.fields.getTextInputValue('time_input')?.trim();

            if (!date || !time) {
                const { date: currentDate, time: currentTime } = getCurrentDateTime();
                date = date || currentDate;
                time = time || currentTime;
            }

            ticket.appointmentDate = date;
            ticket.appointmentTime = time;
            ticket.appointmentCompleted = false;
            ticketManager.setTicket(interaction.channel.id, ticket);

            await ticketManager.updateChannelName(interaction.channel, ticket);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat den Termin umgelegt: ${date} - ${time}`);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'reset_ticket_button') {
            await interaction.deferUpdate();
            const ticket = ticketManager.getTicket(interaction.channel.id);
            if (!ticket) {
                console.error(`(Bot) Ticket-Daten für Kanal ${interaction.channel.id} nicht gefunden bei reset_ticket_button.`);
                await interaction.channel.send('Ticket-Daten nicht gefunden.');
                return;
            }

            ticket.acceptedBy = null;
            ticket.appointmentDate = null;
            ticket.appointmentTime = null;
            ticket.originalAppointmentDate = null;
            ticket.originalAppointmentTime = null;
            ticket.appointmentCompleted = false;
            ticket.avpsLink = null;
            ticket.callAttempt = false;
            ticket.preis = null;
            ticket.followupAppointments = [];
            ticket.lastReset = true;
            ticketManager.setTicket(interaction.channel.id, ticket);

            await ticketManager.updateChannelName(interaction.channel, ticket);
            await interaction.channel.send(`[${getTimestamp()}] ${interaction.user} hat das Ticket zurückgesetzt.`);
            return;
        }
    } catch (err) {
        console.error(`(Bot) Unerwarteter Fehler in interactionCreate für Kanal ${interaction.channel?.id || 'unbekannt'}:`, err);
        if (!interaction.deferred && !interaction.replied) {
            await interaction.channel.send('Ein Fehler ist aufgetreten. Bitte versuche es erneut.');
        }
    }
}

module.exports = handleInteraction;