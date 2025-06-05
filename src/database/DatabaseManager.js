const fs = require('fs').promises;
const path = require('path');
const BackupManager = require('./BackupManager');

class DatabaseManager {
    constructor() {
        this.ticketsFilePath = path.join(__dirname, '..', '..', 'database', 'tickets.json');
        this.backupManager = new BackupManager();
    }

    async loadTickets() {
        console.log(`(Bot) Lade Tickets aus ${this.ticketsFilePath}...`);
        try {
            const data = await fs.readFile(this.ticketsFilePath, 'utf8');
            if (!data.trim()) {
                console.warn(`(Bot) Tickets-Datei ist leer, erstelle Backup und gebe leeres Array zurück`);
                await this.backupManager.backupCorruptedFile(this.ticketsFilePath, data);
                await this.saveTickets([]);
                return [];
            }
            const tickets = JSON.parse(data);
            if (!Array.isArray(tickets)) {
                console.warn(`(Bot) Ungültige Tickets-Daten (kein Array), erstelle Backup und gebe leeres Array zurück`);
                await this.backupManager.backupCorruptedFile(this.ticketsFilePath, data);
                await this.saveTickets([]);
                return [];
            }
            // Validierung der Ticket-Struktur
            for (const item of tickets) {
                if (!item.channelId || !item.data) {
                    console.warn(`(Bot) Ungültiges Ticket-Format in tickets.json, erstelle Backup und gebe leeres Array zurück`);
                    await this.backupManager.backupCorruptedFile(this.ticketsFilePath, data);
                    await this.saveTickets([]);
                    return [];
                }
            }
            console.log(`(Bot) Ticket-Daten erfolgreich geladen: ${tickets.length} Tickets`);
            return tickets;
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.warn(`(Bot) Tickets-Datei ${this.ticketsFilePath} nicht gefunden, erstelle neue Datei`);
                await this.saveTickets([]);
                return [];
            } else {
                console.error(`(Bot) Fehler beim Laden der Tickets:`, err);
                try {
                    const data = await fs.readFile(this.ticketsFilePath, 'utf8').catch(() => '');
                    await this.backupManager.backupCorruptedFile(this.ticketsFilePath, data);
                    await this.saveTickets([]);
                    console.log(`(Bot) tickets.json zurückgesetzt auf leeres Array`);
                } catch (backupErr) {
                    console.error(`(Bot) Fehler beim Erstellen des Backups oder Zurücksetzen der Datei:`, backupErr);
                }
                return [];
            }
        }
    }

    async saveTickets(tickets) {
        try {
            await fs.writeFile(this.ticketsFilePath, JSON.stringify(tickets || [], null, 2));
            console.log(`(Bot) Tickets erfolgreich gespeichert in ${this.ticketsFilePath}`);
        } catch (err) {
            console.error(`(Bot) Fehler beim Speichern der Tickets:`, err);
        }
    }

    static archiveTicket(channelId, ticket) {
        let archivedTickets = [];
        try {
            if (fs.existsSync('./database/archive_tickets.json')) {
                const archivedData = fs.readFileSync('./database/archive_tickets.json', 'utf8');
                archivedTickets = JSON.parse(archivedData);
                if (!Array.isArray(archivedTickets)) throw new Error('Ungültiges Format in archive_tickets.json');
            }
        } catch (err) {
            console.error('Fehler beim Laden von archive_tickets.json:', err);
            archivedTickets = [];
        }
        archivedTickets.push({ channelId, data: ticket.toJSON(), archivedAt: new Date().toISOString() });
        fs.writeFileSync('./database/archive_tickets.json', JSON.stringify(archivedTickets, null, 2));
        console.log(`(Bot) Ticket ${channelId} erfolgreich in archive_tickets.json archiviert.`);
    }

    static archiveErrorTicket(channelId, ticket) {
        let errorTickets = [];
        try {
            if (fs.existsSync('./database/error_tickets.json')) {
                const errorData = fs.readFileSync('./database/error_tickets.json', 'utf8');
                errorTickets = JSON.parse(errorData);
                if (!Array.isArray(errorTickets)) {
                    console.error('(Bot) Ungültiges Format in error_tickets.json, initialisiere als leeres Array.');
                    errorTickets = [];
                }
            }
        } catch (err) {
            console.error('(Bot) Fehler beim Laden von error_tickets.json:', err);
            errorTickets = [];
        }
        errorTickets.push({ channelId, data: ticket.toJSON(), archivedAt: new Date().toISOString() });
        try {
            fs.writeFileSync('./database/error_tickets.json', JSON.stringify(errorTickets, null, 2));
            console.log(`(Bot) Ticket ${channelId} erfolgreich in error_tickets.json archiviert.`);
        } catch (err) {
            console.error('(Bot) Fehler beim Speichern von error_tickets.json:', err);
        }
    }
}

module.exports = DatabaseManager;