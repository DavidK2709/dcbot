const fs = require('fs');

const getTimestamp = () => new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(', ', ' - ');

const getCurrentDateTime = () => {
    const now = new Date();
    const date = now.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = now.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
    return { date, time };
};

async function retryOnRateLimit(operation, maxRetries = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (err) {
            lastError = err;
            if (err.code === 429 && attempt < maxRetries) {
                const retryAfter = err.response?.headers['retry-after'] ? parseFloat(err.response.headers['retry-after']) * 1000 : 1000;
                console.warn(`(Bot) Rate-Limit erreicht, warte ${retryAfter}ms (Versuch ${attempt}/${maxRetries}). Bucket: ${err.response?.headers['x-ratelimit-bucket']}, Scope: ${err.response?.headers['x-ratelimit-scope']}, Limit: ${err.response?.headers['x-ratelimit-limit']}, Remaining: ${err.response?.headers['x-ratelimit-remaining']}`);
                await new Promise(resolve => setTimeout(resolve, retryAfter));
            } else {
                console.error(`(Bot) Fehler bei Operation (Versuch ${attempt}/${maxRetries}):`, err);
                if (err.code === 429) {
                    console.log(`(Bot) Rate-Limit-Details: Retry-After: ${err.response?.headers['retry-after']}s, Bucket: ${err.response?.headers['x-ratelimit-bucket']}, Scope: ${err.response?.headers['x-ratelimit-scope']}`);
                }
            }
        }
    }
    console.error(`(Bot) Alle ${maxRetries} Versuche fehlgeschlagen, gebe null zurück. Letzter Fehler:`, lastError);
    return null;
}

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
    if (price === null || price === undefined) return 'Nicht angegeben';
    const num = parseInt(price);
    if (isNaN(num)) return 'Ungültig';
    return `€${num.toLocaleString('de-DE')}`;
};

module.exports = {
    getTimestamp,
    getCurrentDateTime,
    retryOnRateLimit,
    findUserInGuild,
    formatPrice
};