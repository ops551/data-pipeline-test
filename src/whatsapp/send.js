const { Client, LocalAuth } = require('whatsapp-web.js');
const { getPendingWhatsAppLeads, appendSentWhatsapp } = require('./csv.js');
const { generateWhatsAppMessage } = require('./ai.js');

const BATCH_LIMIT = parseInt(process.env.WHATSAPP_BATCH_SIZE) || 5;

// Simple sleep function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runWhatsAppOutreach() {
    console.log('Fetching WhatsApp candidates...');
    const candidates = getPendingWhatsAppLeads({ limit: BATCH_LIMIT });

    if (candidates.length === 0) {
        console.log('No pending WhatsApp candidates found. Exiting.');
        return;
    }

    console.log(`Found ${candidates.length} candidates. Initializing client...`);

    const client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('ready', async () => {
        console.log('WhatsApp Client is READY! Starting outreach...');

        for (const lead of candidates) {
            try {
                console.log(`\nProcessing: ${lead.company_name} (${lead.target_phone})`);
                
                // 1. Generate Message
                const msg = await generateWhatsAppMessage({
                    companyName: lead.company_name,
                    sicCodes: lead.sic_codes // Usually not in leads.csv directly but ai.js handles missing gracefully
                });

                // 2. Send Message
                console.log(`Sending message to ${lead.target_phone}...`);
                await client.sendMessage(lead.target_phone, msg);
                
                // 3. Mark as Sent
                appendSentWhatsapp({
                    company_number: lead.company_number,
                    company_name: lead.company_name,
                    phone_number: lead.target_phone,
                    status: 'sent',
                    message_preview: msg.substring(0, 50) + '...'
                });

                console.log(`✅ Success for ${lead.company_name}`);

                // 4. Delay (10-20 seconds) to avoid spam filters
                const delay = Math.floor(Math.random() * 10000) + 10000;
                console.log(`Sleeping for ${Math.round(delay/1000)}s...`);
                await sleep(delay);

            } catch (error) {
                console.error(`❌ Failed to send to ${lead.company_name}:`, error.message);
            }
        }

        console.log('\nBatch complete. Closing client...');
        await client.destroy();
        process.exit(0);
    });

    client.on('auth_failure', () => {
        console.error('WhatsApp authentication failed! Please run node src/whatsapp/setup.js again.');
        process.exit(1);
    });

    client.initialize();
}

// Run if called directly
if (require.main === module) {
    runWhatsAppOutreach();
}

module.exports = { runWhatsAppOutreach };
