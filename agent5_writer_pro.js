const fs = require('fs');
const nodemailer = require('nodemailer');

try {
    // 1. DATA INPUT: Load the diagnosed leads
    const leads = JSON.parse(fs.readFileSync('./outputs/agent2_final_leads.json'));

    // 2. LOGISTICS LOGIC: 1-Day vs 2-Day SCF Check
    const getTransitTime = (scf) => {
        if (!scf) return { text: "within two days", days: 2 };
        const isOneDay = scf.startsWith('17') || scf.startsWith('18') || scf.startsWith('19');
        return isOneDay ? { text: "tomorrow", days: 1 } : { text: "within two days", days: 2 };
    };

    console.log(`✍️ Agent 5: Generating your 5 Custom Emails for ${leads.length} leads...`);

    // 3. GENERATE THE REPORT CONTENT
    let reportContent = "☀️ SPICES, INC. DAILY LEAD REPORT\n";
    reportContent += "==================================================\n\n";

    const dailyBatch = leads.slice(0, 5).map((lead, index) => {
        const transit = getTransitTime(lead.scf || "000");
        const city = lead.city || "your area";
        const person = lead.found_person || "there";
        const company = lead.company_name;

        reportContent += `TARGET #${index + 1}: ${company} (${person})\n`;
        reportContent += `PAIN SCORE: ${lead.pain_score}% | TRANSIT: ${transit.days} Day(s)\n`;
        reportContent += `--------------------------------------------------\n`;
        
        // EMAIL 1: The Prep Schedule Hook
        reportContent += `SUBJECT: Protecting the ${company} prep schedule\n\n`;
        reportContent += `Hi ${person},\n\nWe work with meal-prep operators up and down the East Coast that run tight weekly production cycles and can’t afford to let an occasional out-of-stock spice become a frequent disruption in their kitchen.\n\nSince you're running ${company} out of ${city} near our Northumberland, PA facility, you will typically see your order at your kitchen door ${transit.text}.\n\n— Rob\n\n`;
        reportContent += `==================================================\n\n`;

        return lead;
    });

    // 4. THE OUTLOOK MAILMAN
    async function sendReport() {
        let transporter = nodemailer.createTransport({
            host: "smtp.office365.com",
            port: 587,
            secure: false, 
            auth: {
                user: "greg@spicesinc.com", 
                pass: "Mur11990" 
            },
            tls: { ciphers: 'SSLv3', rejectUnauthorized: false }
        });

        await transporter.sendMail({
            from: '"Spices Inc. Agent Swarm" <greg@spicesinc.com>',
            to: "greg@spicesinc.com", 
            subject: `☀️ Spices Inc. Leads: ${new Date().toLocaleDateString()}`,
            text: reportContent
        });
        
        console.log("✅ SUCCESS! The 5 daily emails have been sent to greg@spicesinc.com");
    }

    sendReport().catch(err => {
        console.error("❌ Email Failed. Check your Outlook password in the code.");
        console.error(err);
    });

} catch (e) {
    console.log("❌ Error: Check if agent2_final_leads.json exists in your outputs folder.");
}