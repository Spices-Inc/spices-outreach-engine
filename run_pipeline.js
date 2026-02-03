const { execSync } = require('child_process');

const agents = [
    { file: 'agent1_scout_new.js', name: 'Scout', desc: 'Finding companies via SerpAPI' },
    { file: 'agent2_geographer.js', name: 'Geographer', desc: 'Getting addresses via Google Places' },
    { file: 'agent3_menu_miner.js', name: 'Menu Miner', desc: 'Scraping menus for spice keywords' },
    { file: 'agent5_investigator.js', name: 'Investigator', desc: 'Finding contacts via LinkedIn' },
    { file: 'agent7_qualifier.js', name: 'Qualifier', desc: 'Scoring and filtering leads' },
    { file: 'agent6_writer_pro.js', name: 'Writer', desc: 'Generating email sequences' }
];

console.log('\n========================================');
console.log('🌶️  SPICES INC LEAD PIPELINE');
console.log('========================================\n');

let completed = 0;
let failed = 0;

agents.forEach((agent, index) => {
    const step = index + 1;
    console.log(`[${step}/6] ${agent.name}: ${agent.desc}`);
    
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
    console.log('📁 Output: final_leads_for_pipedrive.json');
    console.log('👉 Next step: Push to Apollo\n');
}