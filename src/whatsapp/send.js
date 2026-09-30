const { Client, LocalAuth } = require('whatsapp-web.js');
const { getPendingWhatsAppLeads, appendSentWhatsapp } = require('./csv.js');
const { generateWhatsAppMessage } = require('./ai.js');
const { normalizeToWhatsAppId } = require('./format.js');

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

    client.once('ready', async () => {
        console.log('WhatsApp Client is READY! Starting outreach...');

        for (const lead of candidates) {
            try {
                console.log(`\nProcessing: ${lead.company_name} (${lead.target_phone})`);
                
                const jid = normalizeToWhatsAppId(lead.target_phone);
                if (!jid) {
                    console.log(`⏭️  Skipping - Invalid format`);
                    continue;
                }

                // 1. Check Registration First!
                const isRegistered = await client.isRegisteredUser(jid);
                if (!isRegistered) {
                    console.log(`⏭️  Skipping ${lead.target_phone} - Not registered on WhatsApp.`);
                    appendSentWhatsapp({
                        company_number: lead.company_number,
                        company_name: lead.company_name,
                        phone_number: lead.target_phone,
                        status: 'no_whatsapp',
                        message_preview: 'Skipped - no WhatsApp account'
                    });
                    continue;
                }

                // 2. Generate Message (only for valid users)
                const msg = await generateWhatsAppMessage({
                    companyName: lead.company_name,
                    sicCodes: lead.sic_codes
                });

                // 3. Send Message
                console.log(`Sending message to ${lead.target_phone}...`);
                await client.sendMessage(jid, msg);
                
                // 4. Mark as Sent
                appendSentWhatsapp({
                    company_number: lead.company_number,
                    company_name: lead.company_name,
                    phone_number: lead.target_phone,
                    status: 'sent',
                    message_preview: msg.substring(0, 50) + '...'
                });

                console.log(`✅ Success for ${lead.company_name}`);

                // 5. Delay
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
