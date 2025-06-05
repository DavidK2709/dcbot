const { retryOnRateLimit } = require("../utils/Helpers");
const DatabaseManager = require("../database/DatabaseManager");
const Ticket = require("./Ticket");

class TicketManager {
    constructor() {
        this.tickets = new Map();
        this.db = new DatabaseManager();
    }

    async loadTickets() {
        const tickets = await this.db.loadTickets();
        return tickets || []; // Fallback auf leeres Array
    }

    async saveTickets() {
        const ticketsArray = Array.from(this.tickets.entries()).map(([channelId, ticket]) => ({
            channelId,
            data: ticket.data // Direkt ticket.data verwenden
        }));
        await this.db.saveTickets(ticketsArray);
    }

    getTicket(channelId) {
        return this.tickets.get(channelId);
    }

    setTicket(channelId, ticket) {
        this.tickets.set(channelId, ticket);
        this.saveTickets();
    }

    deleteTicket(channelId) {
        this.tickets.delete(channelId);
        this.saveTickets();
    }

    async updateEmbedMessage(client, ticket) {
        try {
            const channel = client.channels.cache.get(ticket.channelId) || await client.channels.fetch(ticket.channelId);
            if (!channel) {
                console.warn(`(Bot) Kanal ${ticket.channelId} nicht gefunden, überspringe Embed-Aktualisierung`);
                return;
            }
            const embed = ticket.getEmbed();
            const components = ticket.getButtonRows();
            const message = await channel.messages.fetch(ticket.embedMessageId).catch(() => null);
            if (message) {
                await message.edit({ embeds: [embed], components });
                console.log(`(Bot) Embed-Nachricht ${ticket.embedMessageId} in Kanal ${ticket.channelId} aktualisiert`);
            }
        } catch (err) {
            console.error(`(Bot) Fehler beim Aktualisieren der Embed-Nachricht für Ticket ${ticket.channelId}:`, err);
        }
    }

    async updateChannelName(client, ticket) {
        try {
            const channel = client.channels.cache.get(ticket.channelId) || await client.channels.fetch(ticket.channelId);
            if (!channel) {
                console.warn(`(Bot) Kanal ${ticket.channelId} nicht gefunden, überspringe Kanalumbenennung`);
                return;
            }
            await channel.setName(ticket.getChannelName());
        } catch (err) {
            console.error(`(Bot) Fehler beim Umbenennen des Kanals ${ticket.channelId}:`, err);
        }
    }

    async initializeTickets(client) {
        console.log(`(Bot) Initialisiere Tickets...`);
        const tickets = await this.loadTickets();
        if (!Array.isArray(tickets)) {
            console.warn(`(Bot) Keine gültigen Ticket-Daten geladen (kein Array), überspringe Initialisierung`);
            return;
        }

        if (tickets.length === 0) {
            console.log(`(Bot) Keine Tickets zum Initialisieren vorhanden`);
            return;
        }

        // Tickets in Batches von 10 verarbeiten
        const batchSize = 10;
        for (let i = 0; i < tickets.length; i += batchSize) {
            const batch = tickets.slice(i, i + batchSize);
            const promises = batch.map(async (ticketEntry) => {
                try {
                    const { channelId, data } = ticketEntry;
                    const ticket = new Ticket(channelId, data);
                    const channel = await retryOnRateLimit(async () => {
                        return await client.channels.fetch(channelId);
                    }, 3);
                    if (!channel) {
                        console.warn(`(Bot) Kanal ${channelId} nicht gefunden, lösche Ticket`);
                        this.deleteTicket(channelId);
                        return;
                    }

                    this.tickets.set(channelId, ticket);

                    // Embed-Nachricht aktualisieren
                    const embedUpdated = await retryOnRateLimit(async () => {
                        await this.updateEmbedMessage(client, ticket);
                        return true;
                    }, 3);
                    if (embedUpdated === null) {
                        console.warn(`(Bot) Embed-Aktualisierung für Ticket ${channelId} fehlgeschlagen, fahre fort`);
                    }

                    // Kanalnamen asynchron aktualisieren
                    retryOnRateLimit(async () => {
                        console.log(`(Bot) Asynchrone Umbenennung gestartet für Kanal ${channelId} zu ${ticket.getChannelName()}`);
                        await this.updateChannelName(client, ticket);
                        console.log(`(Bot) Kanal ${channelId} erfolgreich umbenannt`);
                    }, 3).catch(err => {
                        console.error(`(Bot) Asynchrone Umbenennung fehlgeschlagen für Kanal ${channelId}:`, err);
                        if (err.code === 429) {
                            console.log(`(Bot) Rate-Limit-Details: Retry-After: ${err.response?.headers['retry-after']}s, Bucket: ${err.response?.headers['x-ratelimit-bucket']}, Scope: ${err.response?.headers['x-ratelimit-scope']}`);
                        }
                    });
                } catch (err) {
                    console.error(`(Bot) Fehler beim Initialisieren des Tickets ${ticketEntry.channelId}:`, err);
                    if (err.code === 429) {
                        console.log(`(Bot) Rate-Limit-Details: Retry-After: ${err.response?.headers['retry-after']}s, Bucket: ${err.response?.headers['x-ratelimit-bucket']}, Scope: ${err.response?.headers['x-ratelimit-scope']}`);
                    }
                }
            });

            await Promise.all(promises);
            // Verzögerung zwischen Batches
            if (i + batchSize < tickets.length) {
                console.log(`(Bot) Warte 1000ms vor dem nächsten Batch`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        console.log(`(Bot) Ticket-Initialisierung abgeschlossen`);
    }
}

module.exports = TicketManager;