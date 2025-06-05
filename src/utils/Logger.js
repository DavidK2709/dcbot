class Logger {
    static getTimestamp() {
        return new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    static log(message) {
        console.log(`[${this.getTimestamp()}] (Bot) ${message}`);
    }

    static error(message) {
        console.error(`[${this.getTimestamp()}] (Bot) Fehler: ${message}`);
    }

    static warn(message) {
        console.warn(`[${this.getTimestamp()}] (Bot) Warnung: ${message}`);
    }
}

module.exports = Logger;