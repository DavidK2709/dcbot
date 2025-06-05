const fs = require('fs').promises;
const path = require('path');

class BackupManager {
    constructor() {
        this.backupDir = path.join(__dirname, '..', '..', 'database', 'backups', 'corrupted_files');
    }

    async ensureBackupDir() {
        try {
            await fs.mkdir(this.backupDir, { recursive: true });
            console.log(`(Bot) Backup-Verzeichnis ${this.backupDir} erstellt oder überprüft`);
        } catch (err) {
            console.error(`(Bot) Fehler beim Erstellen des Backup-Verzeichnisses ${this.backupDir}:`, err);
            throw err;
        }
    }

    async backupCorruptedFile(filePath, content) {
        await this.ensureBackupDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); // z. B. 2025-06-05T15-17-12
        const fileName = `corrupted_${path.basename(filePath, '.json')}_${timestamp}.json`;
        const backupPath = path.join(this.backupDir, fileName);

        try {
            await fs.writeFile(backupPath, content || '');
            console.log(`(Bot) Backup der korrupten Datei erstellt: ${backupPath}`);
            return backupPath;
        } catch (err) {
            console.error(`(Bot) Fehler beim Erstellen des Backups ${backupPath}:`, err);
            throw err;
        }
    }
}

module.exports = BackupManager;