const fs = require('fs');
const path = require('path');

const protocol = {
    // 1. Initializer: Standard Header for every Agent
    init: (agentName, version) => {
        const metadata = {
            name: agentName,
            version: version,
            startTime: new Date().toISOString()
        };
        console.log(`\n🚀 [${metadata.name} v${metadata.version}] Starting sequence...`);
        return metadata;
    },

    // 2. Central Logger: Carlea's Audit Trail
    logStatus: (agentName, status, details) => {
        const logEntry = {
            timestamp: new Date().toISOString(),
            agent: agentName,
            status: status,
            details: details
        };
        const logDir = path.join(__dirname, '../logs');
        const logPath = path.join(logDir, 'master_agent_log.json');
        
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
        fs.appendFileSync(logPath, JSON.stringify(logEntry) + "\n");
        
        const emoji = status === "SUCCESS" ? "✅" : (status === "ERROR" ? "❌" : "🛡️");
        console.log(`${emoji} [${agentName}] ${status}: ${details}`);
    },

    // 3. Infrastructure Check: Ensures Rob Snyder's code has folders to write to
    ensureDirs: () => {
        const dirs = ['./outputs', './logs'];
        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        });
    }
};

module.exports = protocol;
