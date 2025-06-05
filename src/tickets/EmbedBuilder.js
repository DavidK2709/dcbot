const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Config = require('../config/Config');
const Helpers = require('../utils/Helpers');
const Logger = require('../utils/Logger');

const getButtonRows = (ticketData) => {
    const timestamp = Helpers.getTimestamp();
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
            ? new ButtonBuilder().setCustomId('takeover_ticket_button').setLabel('Ticket neuvergeben').setStyle(ButtonStyle.Text)
            : new ButtonBuilder().setCustomId('takeover_ticket_button').setLabel('Ticket vergeben').setStyle(ButtonStyle.Danger);

        const row1Components = [
            new ButtonBuilder().setCustomId('call_attempt_button').setLabel('Versucht anzurufen').setStyle(ButtonStyle.Danger),
            takeoverButton
        ];

        if (ticketData.acceptedBy && !ticketData.appointmentDate && !ticketData.appointmentTime) {
            row1Components.push(
                new ButtonBuilder().setCustomId('schedule_appointment_button').setLabel('Termin festlegen').setStyle(ButtonStyle.Danger)
            );
        }

        if (row1Components.length < 5) {
            row1Components.push(
                ticketData.preis
                    ? new ButtonBuilder().setCustomId('edit_preis_button').setLabel('Preis bearbeiten').setStyle(ButtonStyle.Text)
                    : new ButtonBuilder().setCustomId('set_preis_button').setLabel('Preis festlegen').setStyle(ButtonStyle.Danger)
            );
        }

        rows.push(new ActionRowBuilder().addComponents(row1Components));

        if (ticketData.appointmentDate && ticketData.appointmentTime && !ticketData.appointmentCompleted && rows.length < 5) {
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('no_show_button').setLabel('Nicht erschienen').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('reschedule_appointment_button').setLabel('Termin umlegen').setStyle(ButtonStyle.Text),
                new ButtonBuilder().setCustomId('appointment_completed_button').setLabel('Termin erledigt').setStyle(ButtonStyle.Success)
            ));
        }

        if (!ticketData.avpsLink && ticketData.appointmentCompleted && rows.length < 5) {
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('avps_link_button').setLabel('AVPS Akte hinterlegen').setStyle(ButtonStyle.Danger)
            ));
        } else if (ticketData.avpsLink && rows.length < 5) {
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('edit_avps_link_button').setLabel('AVPS Akte bearbeiten').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('delete_avps_link_button').setLabel('Akte löschen').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('akte_ausgegeben_button').setLabel('Akte herausgegeben').setStyle(ButtonStyle.Success)
            ));
        }

        if (rows.length < 5) {
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('close_ticket_button').setLabel('Schließen').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('reset_ticket_button').setLabel('Zurücksetzen').setStyle(ButtonStyle.Text).setDisabled(isResetDisabled)
            ));
        }

        return rows.slice(0, 5);
    } catch (err) {
        console.error(`[${timestamp}] (Bot) Fehler beim Erstellen der Button Rows:`, err);
        Logger.error(`Fehler beim Erstellen der Button Rows: ${err.message}`);
        return [];
    }
};

const createEmbedFields = (ticketData) => {
    const reasonMapping = Config.TICKET_REASONS[ticketData.grund];
    const isAutomaticTicket = reasonMapping && Object.keys(Config.TICKET_REASONS).includes(ticketData.grund);
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

    let appointmentIndex = 0;
    if (ticketData.followupAppointments && ticketData.followupAppointments.length > 0) {
        ticketData.followupAppointments.forEach((appt, index) => {
            const fieldName = index === 0 ? 'Termin' : `Termin ${index + 1}`;
            fields.push({
                name: fieldName,
                value: `${appt.date} - ${appt.time}`
            });
            appointmentIndex = index + 1;
        });
    }

    if (ticketData.appointmentDate && ticketData.appointmentTime && !ticketData.appointmentCompleted) {
        const fieldName = appointmentIndex === 0 ? 'Termin' : `Termin ${appointmentIndex + 1}`;
        fields.push({
            name: fieldName,
            value: `${ticketData.appointmentDate} - ${ticketData.appointmentTime}`
        });
    }

    if (ticketData.acceptedBy) fields.push({ name: 'Übernommen von', value: ticketData.acceptedBy, inline: false });

    if (isAutomaticTicket && reasonMapping.preis) {
        fields.push({ name: 'Preis', value: Helpers.formatPrice(reasonMapping.preis), inline: false });
    } else if (ticketData.preis) {
        fields.push({ name: 'Preis', value: Helpers.formatPrice(ticketData.preis), inline: false });
    }

    if (ticketData.avpsLink) fields.push({ name: 'AVPS-Akte', value: ticketData.avpsLink });

    return fields;
};

const updateEmbedMessage = async (channel, ticketData) => {
    const timestamp = Helpers.getTimestamp();
    try {
        if (!ticketData.embedMessageIds || !ticketData.embedMessageIds.length) {
            console.log(`[${timestamp}] (Bot) Keine embedMessageIds für Kanal ${channel.id}, erstelle neues Embed.`);
            Logger.log(`Keine embedMessageIds für Kanal ${channel.id}, erstelle neues Embed.`);
            const newEmbed = new EmbedBuilder()
                .setFields(createEmbedFields(ticketData))
                .setColor(Config.EMBED_COLOR || 0x480007)
                .setTitle(`Behandlungsanfrage für ${ticketData.abteilung}`);
            const sentMessage = await channel.send({
                embeds: [newEmbed],
                components: getButtonRows(ticketData)
            });
            ticketData.embedMessageIds = [sentMessage.id];
            Logger.log(`Neues Embed erstellt in Kanal ${channel.id} mit ID ${sentMessage.id}.`);
            console.log(`[${timestamp}] (Bot) Neues Embed erstellt in Kanal ${channel.id} mit ID ${sentMessage.id}.`);
            return sentMessage.id;
        }

        const embedMessageId = ticketData.embedMessageIds[0];
        let embedMessage;
        try {
            embedMessage = await channel.messages.fetch(embedMessageId);
        } catch (err) {
            console.error(`[${timestamp}] (Bot) Fehler beim Abrufen der Nachricht ${embedMessageId} in Kanal ${channel.id}:`, err.message);
            Logger.error(`Fehler beim Abrufen der Nachricht ${embedMessageId} in Kanal ${channel.id}: ${err.message}`);
        }

        if (!embedMessage || !embedMessage.embeds || !embedMessage.embeds.length) {
            console.log(`[${timestamp}] (Bot) Kein gültiges Embed in Nachricht ${embedMessageId} (Kanal ${channel.id}), erstelle neues Embed.`);
            Logger.log(`Kein gültiges Embed in Nachricht ${embedMessageId} (Kanal ${channel.id}), erstelle neues Embed.`);
            const newEmbed = new EmbedBuilder()
                .setFields(createEmbedFields(ticketData))
                .setColor(Config.EMBED_COLOR || 0x480007)
                .setTitle(`Behandlungsanfrage für ${ticketData.abteilung}`);
            const sentMessage = await channel.send({
                embeds: [newEmbed],
                components: getButtonRows(ticketData)
            });
            ticketData.embedMessageIds = [sentMessage.id];
            Logger.log(`Neues Embed erstellt in Kanal ${channel.id} mit ID ${sentMessage.id}.`);
            console.log(`[${timestamp}] (Bot) Neues Embed erstellt in Kanal ${channel.id} mit ID ${sentMessage.id}.`);
            return sentMessage.id;
        }

        const updatedEmbed = new EmbedBuilder()
            .setFields(createEmbedFields(ticketData))
            .setColor(Config.EMBED_COLOR || 0x480007)
            .setTitle(`Behandlungsanfrage für ${ticketData.abteilung}`);
        await embedMessage.edit({
            embeds: [updatedEmbed],
            components: getButtonRows(ticketData)
        });
        Logger.log(`Embed in Kanal ${channel.id} aktualisiert (Nachricht ${embedMessageId}).`);
        console.log(`[${timestamp}] (Bot) Embed in Kanal ${channel.id} aktualisiert (Nachricht ${embedMessageId}).`);
        return embedMessageId;
    } catch (err) {
        console.error(`[${timestamp}] (Bot) Fehler in updateEmbedMessage für Kanal ${channel.id}:`, err.message);
        Logger.error(`Fehler in updateEmbedMessage für Kanal ${channel.id}: ${err.message}`);
        const newEmbed = new EmbedBuilder()
            .setFields(createEmbedFields(ticketData))
            .setColor(Config.EMBED_COLOR || 0x480007)
            .setTitle(`Behandlungsanfrage für ${ticketData.abteilung}`);
        const sentMessage = await channel.send({
            embeds: [newEmbed],
            components: getButtonRows(ticketData)
        });
        ticketData.embedMessageIds = [sentMessage.id];
        Logger.log(`Fallback: Neues Embed erstellt in Kanal ${channel.id} mit ID ${sentMessage.id}.`);
        console.log(`[${timestamp}] (Bot) Fallback: Neues Embed erstellt in Kanal ${channel.id} mit ID ${sentMessage.id}.`);
        return sentMessage.id;
    }
};

module.exports = { getButtonRows, createEmbedFields, updateEmbedMessage };