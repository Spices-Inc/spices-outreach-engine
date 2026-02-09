const { execSync } = require('child_process');

const agents = [
    { file: 'agent1_scout_new.js', name: 'Scout', desc: 'Finding companies via SerpAPI' },
    { file: 'agent2_geographer.js', name: 'Geographer', desc: 'Getting addresses via Google Places' },
    { file: 'agent3_menu_miner.js', name: 'Menu Miner', desc: 'Scraping menus for spice keywords' },
    { file: 'agent5_investigator.js', name: 'Investigator', desc: 'Finding contacts via LinkedIn' },
    { file: 'agent7_qualifier.js', name: 'Qualifier', desc: 'Scoring and filtering leads' },
    { file: 'agent6_writer_pro.js', name: 'Writer', desc: 'Generating personalized emails' },
    { file: 'agent8_sheets_pusher.js', name: 'Sheets Pusher', desc: 'Pushing leads to Google Sheet' }
];

const totalSteps = agents.length;

console.log('\n========================================');
console.log('🌶️  SPICES INC LEAD PIPELINE');
console.log('========================================\n');

let completed = 0;
let failed = 0;

agents.forEach((agent, index) => {
    const step = index + 1;
    console.log(`[${step}/${totalSteps}] ${agent.name}: ${agent.desc}`);
    
    try {
        execSync(`node ${agent.file}`, { stdio: 'inherit' });
        console.log(`✅ ${agent.name} complete\n`);
        completed++;
    } catch (error) {
        console.log(`❌ ${agent.name} FAILED\n`);
        failed++;
    }
});

console.log('========================================');
console.log(`🏁 PIPELINE COMPLETE: ${completed} succeeded, ${failed} failed`);
console.log('========================================\n');

if (failed === 0) {
    console.log('📋 Leads pushed to Google Sheet — ready for Rob\'s 5:45 AM review');
    console.log('👉 Next step: Rob reviews sheet, then run Agent 9 + 10 to push approved leads to Apollo\n');
}