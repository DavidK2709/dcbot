const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const CONFIG = require("../config/Config");
const { formatPrice } = require("../utils/Helpers");

class Ticket {
    constructor(channelId, data) {
        this.channelId = channelId;
        this.abteilung = data.abteilung || '';
        this.grund = data.grund || '';
        this.patient = data.patient || '';
        this.telefon = data.telefon || '';
        this.sonstiges = data.sonstiges || '';
        this.abteilungPing = data.abteilungPing || '';
        this.createdBy = data.createdBy || null;
        this.buttonMessageId = data.buttonMessageId || null;
        this.appointmentMessageId = data.appointmentMessageId || null;
        this.completedMessageId = data.completedMessageId || null;
        this.avpsMessageId = data.avpsMessageId || null;
        this.embedMessageId = data.embedMessageId || null;
        this.appointmentDate = data.appointmentDate || null;
        this.appointmentTime = data.appointmentTime || null;
        this.originalAppointmentDate = data.originalAppointmentDate || null;
        this.originalAppointmentTime = data.originalAppointmentTime || null;
        this.acceptedBy = data.acceptedBy || null;
        this.nickname = data.nickname || null;
        this.avpsLink = data.avpsLink || null;
        this.appointmentCompleted = data.appointmentCompleted || false;
        this.isClosed = data.isClosed || false;
        this.lastReset = data.lastReset || false;
        this.callAttempt = data.callAttempt || false;
        this.preis = data.preis || null;
        this.followupAppointments = data.followupAppointments || [];
        this.akteAusgegeben = data.akteAusgegeben || false;
    }

    getChannelName() {
        const reasonMapping = CONFIG.TICKET_REASONS[this.grund];
        const isAutomaticTicket = reasonMapping && Object.keys(CONFIG.TICKET_REASONS).includes(this.grund);
        const baseName = isAutomaticTicket
            ? `${reasonMapping.internalKey.split('-').slice(0, -1).join('-')}-${this.patient.replace(/ /g, '-')}`
            : `${this.patient.replace(/ /g, '-')}-${this.grund.replace(/ /g, '-')}`;
        const symbol = this.isClosed ? '🔒' : '🕓';
        return `${symbol} ${baseName}`.slice(0, 100);
    }

    getButtonRows() {
        const rows = [];

        if (this.isClosed) {
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('reopen_ticket_button').setLabel('Ticket wieder öffnen').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('delete_ticket_button').setLabel('Ticket löschen').setStyle(ButtonStyle.Danger)
            ));
            return rows;
        }

        const hasInteraction = this.acceptedBy || this.appointmentDate || this.appointmentTime || this.avpsLink || this.preis;
        const isResetDisabled = !hasInteraction || this.lastReset;
        const takeoverButton = this.acceptedBy
            ? new ButtonBuilder().setCustomId('takeover_ticket_button').setLabel('Ticket neuvergeben').setStyle(ButtonStyle.Secondary)
            : new ButtonBuilder().setCustomId('takeover_ticket_button').setLabel('Ticket vergeben').setStyle(ButtonStyle.Danger);

        const row1Components = [
            new ButtonBuilder().setCustomId('call_attempt_button').setLabel('Versucht anzurufen').setStyle(ButtonStyle.Danger),
            takeoverButton
        ];

        if (this.acceptedBy && !this.appointmentDate && !this.appointmentTime) {
            row1Components.push(
                new ButtonBuilder().setCustomId('schedule_appointment_button').setLabel('Termin festlegen').setStyle(ButtonStyle.Danger)
            );
        }

        if (row1Components.length < 5) {
            row1Components.push(
                this.preis
                    ? new ButtonBuilder().setCustomId('edit_preis_button').setLabel('Preis bearbeiten').setStyle(ButtonStyle.Secondary)
                    : new ButtonBuilder().setCustomId('set_preis_button').setLabel('Preis festlegen').setStyle(ButtonStyle.Danger)
            );
        }

        rows.push(new ActionRowBuilder().addComponents(row1Components));

        if (this.appointmentDate && this.appointmentTime && !this.appointmentCompleted && rows.length < 5) {
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('no_show_button').setLabel('Nicht erschienen').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('reschedule_appointment_button').setLabel('Termin umlegen').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('appointment_completed_button').setLabel('Termin erledigt').setStyle(ButtonStyle.Success)
            ));
        }

        if (!this.avpsLink && this.appointmentCompleted && rows.length < 5) {
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('avps_link_button').setLabel('AVPS Akte hinterlegen').setStyle(ButtonStyle.Danger)
            ));
        } else if (this.avpsLink && rows.length < 5) {
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('edit_avps_link_button').setLabel('AVPS Akte bearbeiten').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('delete_avps_link_button').setLabel('Akte löschen').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('akte_ausgegeben_button').setLabel('Akte herausgegeben').setStyle(ButtonStyle.Success)
            ));
        }

        if (rows.length < 5) {
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('close_ticket_button').setLabel('Schließen').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('reset_ticket_button').setLabel('Zurücksetzen').setStyle(ButtonStyle.Secondary).setDisabled(isResetDisabled)
            ));
        }

        return rows.slice(0, 5);
    }

    createEmbedFields() {
        const reasonMapping = CONFIG.TICKET_REASONS[this.grund];
        const isAutomaticTicket = reasonMapping && Object.keys(CONFIG.TICKET_REASONS).includes(this.grund);
        const fields = [
            { name: 'Abteilung', value: this.abteilungPing || 'Nicht angegeben' },
        ];

        if (!isAutomaticTicket && this.createdBy) {
            fields.push({ name: 'Erstellt von', value: this.createdBy });
        }

        fields.push(
            { name: 'Grund', value: reasonMapping ? reasonMapping.displayName : this.grund || 'Nicht angegeben' },
            { name: 'Patient', value: this.patient || 'Nicht angegeben' },
            { name: 'Telefon', value: this.telefon || 'Nicht angegeben' },
            { name: 'Sonstiges', value: this.sonstiges || 'Nicht angegeben' }
        );

        let appointmentIndex = 0;
        if (this.followupAppointments && this.followupAppointments.length > 0) {
            this.followupAppointments.forEach((appt, index) => {
                const fieldName = index === 0 ? 'Termin' : `Termin ${index + 1}`;
                fields.push({
                    name: fieldName,
                    value: `${appt.date} - ${appt.time}`
                });
                appointmentIndex = index + 1;
            });
        }

        if (this.appointmentDate && this.appointmentTime && !this.appointmentCompleted) {
            const fieldName = appointmentIndex === 0 ? 'Termin' : `Termin ${appointmentIndex + 1}`;
            fields.push({
                name: fieldName,
                value: `${this.appointmentDate} - ${this.appointmentTime}`
            });
        }

        if (this.acceptedBy) fields.push({ name: 'Übernommen von', value: this.acceptedBy, inline: false });

        if (isAutomaticTicket && reasonMapping.preis) {
            fields.push({ name: 'Preis', value: formatPrice(reasonMapping.preis), inline: false });
        } else if (this.preis) {
            fields.push({ name: 'Preis', value: formatPrice(this.preis), inline: false });
        }

        if (this.avpsLink) fields.push({ name: 'AVPS-Akte', value: this.avpsLink });

        return fields;
    }

    getEmbed() {
        const reasonMapping = CONFIG.TICKET_REASONS[this.grund];
        const isAutomaticTicket = reasonMapping && Object.keys(CONFIG.TICKET_REASONS).includes(this.grund);
        const embedTitle = isAutomaticTicket ? `Behandlungsanfrage für ${reasonMapping.displayName}` : `Behandlungsanfrage für ${this.abteilung}`;
        return new EmbedBuilder()
            .setTitle(embedTitle)
            .setColor(0x480007)
            .addFields(this.createEmbedFields());
    }

    toJSON() {
        return {
            abteilung: this.abteilung,
            grund: this.grund,
            patient: this.patient,
            telefon: this.telefon,
            sonstiges: this.sonstiges,
            abteilungPing: this.abteilungPing,
            createdBy: this.createdBy,
            buttonMessageId: this.buttonMessageId,
            appointmentMessageId: this.appointmentMessageId,
            completedMessageId: this.completedMessageId,
            avpsMessageId: this.avpsMessageId,
            embedMessageId: this.embedMessageId,
            appointmentDate: this.appointmentDate,
            appointmentTime: this.appointmentTime,
            originalAppointmentDate: this.originalAppointmentDate,
            originalAppointmentTime: this.originalAppointmentTime,
            acceptedBy: this.acceptedBy,
            nickname: this.nickname,
            avpsLink: this.avpsLink,
            appointmentCompleted: this.appointmentCompleted,
            isClosed: this.isClosed,
            lastReset: this.lastReset,
            callAttempt: this.callAttempt,
            preis: this.preis,
            followupAppointments: this.followupAppointments,
            akteAusgegeben: this.akteAusgegeben
        };
    }
}

module.exports = Ticket;