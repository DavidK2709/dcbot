require('dotenv').config();

const CONFIG = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    BOT_USER_ID: process.env.BOT_USER_ID,
    ALLOWED_GUILD: process.env.ALLOWED_GUILD,
    TRIGGER_CHANNEL_ID: process.env.TRIGGER_CHANNEL_ID,
    LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID,
    FORM_CHANNEL_ID: process.env.FORM_CHANNEL_ID,
    PSYCHOLOGIE_LOG_CHANNEL_ID: process.env.PSYCHOLOGIE_LOG_CHANNEL_ID,
    STATION_LOG_CHANNEL_ID: process.env.STATION_LOG_CHANNEL_ID,
    STATION_TREATMENT_CHANNEL_ID: process.env.STATION_TREATMENT_CHANNEL_ID,
    ARBEITSMEDIZIN_LOG_CHANNEL_ID: process.env.ARBEITSMEDIZIN_LOG_CHANNEL_ID,
    ADMIN_ROLES: process.env.ADMIN_ROLES ? process.env.ADMIN_ROLES.split(',').map(id => id.trim()) : [],
    DEPARTMENTS: process.env.DEPARTMENTS ? JSON.parse(process.env.DEPARTMENTS) : {},
    rettungsdienst_rollen: process.env.RETTUNGSDIENST_ROLLEN ? process.env.RETTUNGSDIENST_ROLLEN.split(',').map(id => id.trim()) : [],
    TICKET_REASONS: {
        ticket_arbeitsmedizinisches_pol: { internalKey: 'gutachten-polizei-patient', displayName: 'Arbeitsmedizinisches Gutachten Polizeibewerber', preis: '5000' },
        ticket_arbeitsmedizinisches_jva: { internalKey: 'gutachten-jva-patient', displayName: 'Arbeitsmedizinisches Gutachten JVA/Wachschutz', preis: '5000' },
        ticket_arbeitsmedizinisches_ammunation: { internalKey: 'gutachten-ammunation-patient', displayName: 'Arbeitsmedizinisches Gutachten Ammunation', preis: '2500' },
        ticket_arbeitsmedizinisches_mediziner: { internalKey: 'gutachten-mediziner-patient', displayName: 'Arbeitsmedizinisches Gutachten Mediziner', preis: '0' },
        ticket_psychologie_bundeswehr: { internalKey: 'gutachten-bundeswehr-patient', displayName: 'Psychologisches Gutachten Bundeswehr', preis: '5000' },
        ticket_psychologie_jva: { internalKey: 'gutachten-jva-patient', displayName: 'Psychologisches Gutachten JVA', preis: '5000' },
    }
};

module.exports = CONFIG;