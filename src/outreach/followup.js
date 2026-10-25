const fs = require('node:fs');
const path = require('node:path');
const { isValidEmailAddress } = require('../emailAddress');
const { isTargetSic: defaultIsTargetSic } = require('../enrich/sic');
const { parseCSV } = require('../enrich/csvParser');
const {
  DEFAULT_SENT_LEADS_PATH,
  DEFAULT_FOLLOWUPS_PATH,
  DEFAULT_COMPANIES_PATH,
  readLeads,
  readFollowUps,
  appendFollowUp
} = require('./csv');
const { loadFollowUpSmtpConfig, sendEmail, isSmtpQuotaExceeded } = require('./email');
const {
  formatCleanCompanyName,
  extractFirstName,
  isTechOrSoftwareCompany,
  classifySector
} = require('./ai');

const MAX_FOLLOWUP_AGE_DAYS = 10;
const DEFAULT_MAX_DAILY_FOLLOWUPS = 100;

const TOUCH_INTERVALS = Object.freeze({
  touch2: 3 * 24 * 60 * 60 * 1000, // 72 hours after initial outreach (Day 3)
  touch3: 4 * 24 * 60 * 60 * 1000  // 96 hours after follow-up 1 (Day 7)
});

const FOLLOWUP_SECTOR_TEMPLATES = Object.freeze({
  car_showroom: Object.freeze({
    sector: 'car_showroom',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried.',
    touch2Hook: 'automating vehicle showcase Reels, social scheduling, and 24/7 test-drive bookings',
    hook: 'automating vehicle showcase Reels, social scheduling, and 24/7 test-drive bookings',
    breakupPhrase: 'vehicle showcase automation & test-drive booking systems',
    touch3Phrase: 'vehicle showcase automation & test-drive booking systems'
  }),
  watch_showroom: Object.freeze({
    sector: 'watch_showroom',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried.',
    touch2Hook: 'macro wrist-roll video Reels, social scheduling, and private VIP boutique viewings',
    hook: 'macro wrist-roll video Reels, social scheduling, and private VIP boutique viewings',
    breakupPhrase: 'timepiece showcase automation & private boutique viewing systems',
    touch3Phrase: 'timepiece showcase automation & private boutique viewing systems'
  }),
  bike_showroom: Object.freeze({
    sector: 'bike_showroom',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried.',
    touch2Hook: 'bike walkaround Reels, exhaust sound clips, and automated test-ride bookings',
    hook: 'bike walkaround Reels, exhaust sound clips, and automated test-ride bookings',
    breakupPhrase: 'motorbike showcase automation & test-ride booking systems',
    touch3Phrase: 'motorbike showcase automation & test-ride booking systems'
  }),
  detailing: Object.freeze({
    sector: 'detailing',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried.',
    touch2Hook: '50/50 paint correction Reels, ceramic coating showcases, and 24/7 WhatsApp bay booking',
    hook: '50/50 paint correction Reels, ceramic coating showcases, and 24/7 WhatsApp bay booking',
    breakupPhrase: 'detailing studio content automation & WhatsApp slot booking',
    touch3Phrase: 'detailing studio content automation & WhatsApp slot booking'
  }),
  aesthetics_clinic: Object.freeze({
    sector: 'aesthetics_clinic',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried.',
    touch2Hook: 'treatment transformation Reels, open cancellation Stories, and consultation bookings',
    hook: 'treatment transformation Reels, open cancellation Stories, and consultation bookings',
    breakupPhrase: 'aesthetic clinic growth automation & consultation booking systems',
    touch3Phrase: 'aesthetic clinic growth automation & consultation booking systems'
  }),
  dentistry: Object.freeze({
    sector: 'dentistry',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried.',
    touch2Hook: 'smile makeover reveal Reels, patient review Stories, and assessment bookings',
    hook: 'smile makeover reveal Reels, patient review Stories, and assessment bookings',
    breakupPhrase: 'dental practice patient booking & smile transformation showcases',
    touch3Phrase: 'dental practice patient booking & smile transformation showcases'
  }),
  kitchen_interior: Object.freeze({
    sector: 'kitchen_interior',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried.',
    touch2Hook: 'room reveal Reels, craftsmanship Stories, and free home design visit bookings',
    hook: 'room reveal Reels, craftsmanship Stories, and free home design visit bookings',
    breakupPhrase: 'bespoke interior project showcases & design visit automation',
    touch3Phrase: 'bespoke interior project showcases & design visit automation'
  }),
  estate_agent: Object.freeze({
    sector: 'estate_agent',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried.',
    touch2Hook: 'property walkthrough Reels, listing Stories, and automated viewing bookings',
    hook: 'property walkthrough Reels, listing Stories, and automated viewing bookings',
    breakupPhrase: 'property walkthrough automation & viewing booking systems',
    touch3Phrase: 'property walkthrough automation & viewing booking systems'
  }),
  fitness: Object.freeze({
    sector: 'fitness',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried.',
    touch2Hook: 'transformation Reels, daily motivation Stories, and automated trial pass bookings',
    hook: 'transformation Reels, daily motivation Stories, and automated trial pass bookings',
    breakupPhrase: 'fitness studio member acquisition & trial pass booking automation',
    touch3Phrase: 'fitness studio member acquisition & trial pass booking automation'
  }),
  wedding_events: Object.freeze({
    sector: 'wedding_events',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried.',
    touch2Hook: 'cinematic wedding highlight Reels, date availability checker, and viewing bookings',
    hook: 'cinematic wedding highlight Reels, date availability checker, and viewing bookings',
    breakupPhrase: 'wedding venue showcase automation & date booking systems',
    touch3Phrase: 'wedding venue showcase automation & date booking systems'
  }),
  pet_grooming: Object.freeze({
    sector: 'pet_grooming',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried.',
    touch2Hook: 'grooming transformation Reels, daily salon Stories, and 24/7 WhatsApp slot booking',
    hook: 'grooming transformation Reels, daily salon Stories, and 24/7 WhatsApp slot booking',
    breakupPhrase: 'pet grooming appointment automation & salon showcase systems',
    touch3Phrase: 'pet grooming appointment automation & salon showcase systems'
  }),
  ecommerce: Object.freeze({
    sector: 'ecommerce',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried.',
    touch2Hook: 'product showcase Reels, 24/7 WhatsApp cart recovery, and mobile checkout speed',
    hook: 'product showcase Reels, 24/7 WhatsApp cart recovery, and mobile checkout speed',
    breakupPhrase: 'e-commerce showcase Reels & WhatsApp checkout recovery systems',
    touch3Phrase: 'e-commerce showcase Reels & WhatsApp checkout recovery systems'
  }),
  trades: Object.freeze({
    sector: 'trades',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried.',
    touch2Hook: 'before-and-after job Reels, 24/7 on-site WhatsApp quoting, and instant mobile job booking',
    hook: 'before-and-after job Reels, 24/7 on-site WhatsApp quoting, and instant mobile job booking',
    breakupPhrase: 'trade showcase Reels & 24/7 WhatsApp quote booking systems',
    touch3Phrase: 'trade showcase Reels & 24/7 WhatsApp quote booking systems'
  }),
  hospitality: Object.freeze({
    sector: 'hospitality',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried.',
    touch2Hook: 'dish highlight Reels, daily special Stories, and 24/7 WhatsApp table reservations',
    hook: 'dish highlight Reels, daily special Stories, and 24/7 WhatsApp table reservations',
    breakupPhrase: 'dining showcase Reels & WhatsApp table reservation systems',
    touch3Phrase: 'dining showcase Reels & WhatsApp table reservation systems'
  }),
  healthcare: Object.freeze({
    sector: 'healthcare',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried.',
    touch2Hook: 'patient education Reels, 24/7 WhatsApp appointment bookings, and intake form automation',
    hook: 'patient education Reels, 24/7 WhatsApp appointment bookings, and intake form automation',
    breakupPhrase: 'clinic educational Reels & 24/7 WhatsApp patient booking systems',
    touch3Phrase: 'clinic educational Reels & 24/7 WhatsApp patient booking systems'
  }),
  b2b: Object.freeze({
    sector: 'b2b',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried.',
    touch2Hook: 'insight Reels, 24/7 WhatsApp consultation booking, and automated client onboarding',
    hook: 'insight Reels, 24/7 WhatsApp consultation booking, and automated client onboarding',
    breakupPhrase: 'firm case study Reels & client onboarding automation',
    touch3Phrase: 'firm case study Reels & client onboarding automation'
  }),
  tech: Object.freeze({
    sector: 'tech',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried under client deadlines.',
    touch2Hook: 'handling backend API integrations and workload overflow',
    hook: 'handling backend API integrations and workload overflow',
    breakupPhrase: 'backend automation & API integrations',
    touch3Phrase: 'backend automation & API integrations'
  }),
  general: Object.freeze({
    sector: 'general',
    touch2Intro: 'Just floating my previous note back to the top of your inbox in case it got buried.',
    touch2Hook: 'showcase Reels, 24/7 WhatsApp enquiry booking, and fast mobile website conversion',
    hook: 'showcase Reels, 24/7 WhatsApp enquiry booking, and fast mobile website conversion',
    breakupPhrase: 'service showcase Reels & WhatsApp appointment booking systems',
    touch3Phrase: 'service showcase Reels & WhatsApp appointment booking systems'
  })
});

/**
 * Identifies leads eligible for follow-up outreach (Touch 2 or Touch 3).
 *
 * Rules:
 * 1. Expiry Cutoff: Leads sent > maxAgeDays ago (default 10 days) are marked aged_out and skipped.
 * 2. Touch 2 (Follow-up 1): Eligible when touch 1 was sent >= 72 hours ago and no followup_number=1 exists.
 * 3. Touch 3 (Breakup Note): Eligible when touch 2 was sent >= 96 hours ago and no followup_number=2 exists.
 * 4. Recency Priority: Freshest leads are prioritized first.
 * 5. Limit: Caps daily follow-ups to limit (default 100).
 */
function getCompanyFromMap(map, compNum) {
  if (!map || !compNum) return {};
  if (map instanceof Map || typeof map.get === 'function') {
    return map.get(compNum) || {};
  }
  return map[compNum] || {};
}

function getEligibleFollowUps(
  sentLeadsPath = DEFAULT_SENT_LEADS_PATH,
  followUpsPath = DEFAULT_FOLLOWUPS_PATH,
  optionsOrCompaniesPath = {}
) {
  const options = typeof optionsOrCompaniesPath === 'string'
    ? { companiesPath: optionsOrCompaniesPath }
    : (optionsOrCompaniesPath || {});

  const now = options.now instanceof Date
    ? options.now
    : (typeof options.now === 'string' || typeof options.now === 'number' ? new Date(options.now) : new Date());

  const maxAgeDays = typeof options.maxAgeDays === 'number' ? options.maxAgeDays : MAX_FOLLOWUP_AGE_DAYS;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const touch2DelayMs = typeof options.touch2DelayMs === 'number' ? options.touch2DelayMs : TOUCH_INTERVALS.touch2;
  const touch3DelayMs = typeof options.touch3DelayMs === 'number' ? options.touch3DelayMs : TOUCH_INTERVALS.touch3;
  const limit = typeof options.limit === 'number' ? options.limit : DEFAULT_MAX_DAILY_FOLLOWUPS;
  const requireMessageId = options.requireMessageId !== false;
  const isTargetSic = typeof options.isTargetSic === 'function' ? options.isTargetSic : defaultIsTargetSic;
  const filterNonTargetSics = options.filterNonTargetSics !== false;

  let companiesMap = options.companiesMap;
  if (!companiesMap) {
    let resolvedCompaniesPath = options.companiesPath;
    if (!resolvedCompaniesPath) {
      const siblingPath = path.join(path.dirname(sentLeadsPath), 'companies.csv');
      if (fs.existsSync(siblingPath)) {
        resolvedCompaniesPath = siblingPath;
      } else {
        resolvedCompaniesPath = DEFAULT_COMPANIES_PATH;
      }
    }
    if (resolvedCompaniesPath && fs.existsSync(resolvedCompaniesPath)) {
      try {
        const parsed = parseCSV(resolvedCompaniesPath);
        companiesMap = new Map(
          parsed.map(c => [String(c.company_number || '').trim(), c])
        );
      } catch (err) {
        companiesMap = new Map();
      }
    } else {
      companiesMap = new Map();
    }
  }

  const sentLeads = readLeads(sentLeadsPath);
  if (sentLeads.length === 0) {
    return {
      eligible: [],
      totalEligible: 0,
      agedOutCount: 0,
      missingMessageIdCount: 0,
      nonTargetSicCount: 0,
      touch2Count: 0,
      touch3Count: 0
    };
  }

  const existingFollowUps = readFollowUps(followUpsPath);
  const followUpMap = new Map();

  for (const f of existingFollowUps) {
    const key = `${f.company_number}:${f.sent_to.toLowerCase()}`;
    if (!followUpMap.has(key)) {
      followUpMap.set(key, []);
    }
    followUpMap.get(key).push(f);
  }

  let agedOutCount = 0;
  let missingMessageIdCount = 0;
  let nonTargetSicCount = 0;
  const eligibleCandidates = [];
  const seenCandidates = new Set();

  for (const lead of sentLeads) {
    const compNum = String(lead.company_number || '').trim();
    if (!compNum) continue;

    const rawSentTo = lead.sent_to
      ? String(lead.sent_to).split(/[;,]/)[0]
      : (lead.emails ? String(lead.emails).split(/[;,]/)[0] : '');
    const sentTo = rawSentTo.trim();

    if (!sentTo || !isValidEmailAddress(sentTo)) continue;

    const candidateKey = `${compNum}:${sentTo.toLowerCase()}`;
    if (seenCandidates.has(candidateKey)) continue;

    const touch1Date = new Date(lead.sent_at);
    if (isNaN(touch1Date.getTime())) continue;

    const leadAgeMs = now.getTime() - touch1Date.getTime();
    if (leadAgeMs < 0) continue; // Future timestamp safeguard

    // 1. Expiry Cutoff: Leads older than maxAgeDays are aged out (e.g. 15-20 days old)
    if (leadAgeMs > maxAgeMs) {
      agedOutCount++;
      continue;
    }

    const previousFollowUps = followUpMap.get(candidateKey) || [];

    // Opt-out / Unsubscribe Guard:
    // If the lead or any previous follow-up is marked unsubscribed, opt_out, or do_not_contact, skip!
    const isOptedOut =
      /unsub|opt_?out|do_not_contact|block|suppress/i.test(String(lead.status || '')) ||
      previousFollowUps.some(f => /unsub|opt_?out|do_not_contact|block|suppress/i.test(String(f.status || '')));

    if (isOptedOut) {
      continue;
    }

    // Threading Guard: Skip leads missing original message_id to prevent unthreaded emails
    const rawMessageId = lead.message_id ? String(lead.message_id).trim() : '';
    if (requireMessageId && !rawMessageId) {
      missingMessageIdCount++;
      continue;
    }

    // SIC Protection Shield Gate:
    const companyInfo = getCompanyFromMap(companiesMap, compNum);
    const companySics = lead.sic_codes || companyInfo.sic_codes || '';
    if (filterNonTargetSics && companySics && !isTargetSic(companySics)) {
      nonTargetSicCount++;
      continue;
    }

    const touch1Fup = previousFollowUps.find(f => f.followup_number === 1);
    const touch2Fup = previousFollowUps.find(f => f.followup_number === 2);

    const mergedLeadRecord = { ...companyInfo, ...lead, sic_codes: companySics };

    // Case A: Eligible for Touch 2 (Follow-up 1)
    if (!touch1Fup) {
      if (leadAgeMs >= touch2DelayMs) {
        seenCandidates.add(candidateKey);
        eligibleCandidates.push({
          company_number: compNum,
          company_name: lead.company_name || companyInfo.company_name || '',
          person_name: lead.person_name || companyInfo.person_name || '',
          sent_to: sentTo,
          due_touch: 2,
          followup_number: 1,
          touch1_sent_at: lead.sent_at,
          sort_timestamp: touch1Date.getTime(),
          in_reply_to: lead.message_id || '',
          lead_record: mergedLeadRecord
        });
      }
      continue;
    }

    // Case B: Eligible for Touch 3 (Follow-up 2 / Breakup note)
    if (touch1Fup && !touch2Fup) {
      const touch2Date = new Date(touch1Fup.sent_at);
      if (!isNaN(touch2Date.getTime())) {
        const touch2AgeMs = now.getTime() - touch2Date.getTime();
        if (touch2AgeMs >= touch3DelayMs) {
          seenCandidates.add(candidateKey);
          eligibleCandidates.push({
            company_number: compNum,
            company_name: lead.company_name || companyInfo.company_name || '',
            person_name: lead.person_name || companyInfo.person_name || '',
            sent_to: sentTo,
            due_touch: 3,
            followup_number: 2,
            touch1_sent_at: lead.sent_at,
            touch2_sent_at: touch1Fup.sent_at,
            sort_timestamp: touch2Date.getTime(),
            in_reply_to: touch1Fup.message_id || lead.message_id || '',
            lead_record: mergedLeadRecord
          });
        }
      }
    }
  }

  // 2. Recency Sorting: Freshest leads get first priority
  eligibleCandidates.sort((a, b) => b.sort_timestamp - a.sort_timestamp);

  const totalEligible = eligibleCandidates.length;
  const touch2Count = eligibleCandidates.filter(c => c.due_touch === 2).length;
  const touch3Count = eligibleCandidates.filter(c => c.due_touch === 3).length;

  const limitedCandidates = limit > 0
    ? eligibleCandidates.slice(0, limit)
    : eligibleCandidates;

  return {
    eligible: limitedCandidates,
    totalEligible,
    agedOutCount,
    missingMessageIdCount,
    nonTargetSicCount,
    touch2Count,
    touch3Count
  };
}

/**
 * Normalizes subject for threaded emails (e.g. "Re: Original Subject").
 * Idempotent: avoids duplicate "Re: Re: " prefixes.
 * If originalSubject is missing, gracefully falls back to "Re: Quick question - <CompanyName>".
 */
function formatThreadSubject(originalSubject, fallbackContext = '') {
  const clean = String(originalSubject || '').trim();
  if (clean) {
    if (/^re:\s*/i.test(clean)) {
      return clean;
    }
    return `Re: ${clean}`;
  }
  const cleanFallback = String(fallbackContext || '').trim();
  if (cleanFallback && cleanFallback.toLowerCase() !== 'there') {
    return `Re: Quick question - ${cleanFallback}`;
  }
  return 'Re: Quick question';
}

/**
 * Generates personalized, persona-aware Touch 2 and Touch 3 follow-up copy.
 *
 * Rules:
 * - Touch 2 (Day 3-5 Quick Bump): Short 2-sentence note floating the original email back to top.
 * - Touch 3 (Day 7-10 Breakup Note): Polite 2-sentence closure note gracefully closing the loop.
 * - Persona aware: Tech companies get backend/API overflow pitch; non-tech get enquiry automation/social pitch.
 * - Clean signature: Nahid + verified Website & GitHub, zero WhatsApp.
 */
function generateFollowUpEmail(candidate, options = {}) {
  const leadRec = candidate.lead_record || {};
  const companyRec = candidate.company_record || options.companyRec || {};
  const compName = candidate.company_name || leadRec.company_name || companyRec.company_name || '';
  const cleanCompany = formatCleanCompanyName(compName) || 'there';
  const rawPerson = candidate.person_name || leadRec.person_name || companyRec.person_name || '';
  const firstName = extractFirstName(rawPerson);

  const greeting = firstName ? `Hey ${firstName},` : `Hey ${cleanCompany},`;

  const combinedContext = { ...leadRec, ...companyRec, ...candidate };

  const isTech = options.isTech !== undefined
    ? Boolean(options.isTech)
    : (options.sector === 'tech' || isTechOrSoftwareCompany(combinedContext));

  const sector = options.sector || (isTech ? 'tech' : classifySector(combinedContext));
  const sectorTemplate = FOLLOWUP_SECTOR_TEMPLATES[sector] || FOLLOWUP_SECTOR_TEMPLATES.general;

  const touch = candidate.due_touch === 3 ? 3 : 2;

  let body = '';
  if (touch === 2) {
    const defaultIntro = isTech
      ? 'Just floating my previous note back to the top of your inbox in case it got buried under client deadlines.'
      : 'Just floating my previous note back to the top of your inbox in case it got buried.';
    const intro = sectorTemplate.touch2Intro || defaultIntro;
    const hook = sectorTemplate.touch2Hook || sectorTemplate.hook;
    const qualifier = isTech ? 'if relevant' : 'if helpful';

    body = [
      intro,
      `Would love to share a quick 2-minute overview on ${hook} ${qualifier}.`,
      'Worth a brief 5-minute chat sometime this week?'
    ].join('\n\n');
  } else {
    // Touch 3: Breakup Note
    const defaultBreakup = isTech
      ? 'backend automation & API integrations'
      : 'web infrastructure & business automation';
    const breakupPhrase = sectorTemplate.breakupPhrase || sectorTemplate.touch3Phrase || defaultBreakup;

    body = [
      'Wanted to follow up one last time before closing the loop. I realize you might be focused on other priorities right now, so I will not follow up further.',
      `If you ever need a hand with ${breakupPhrase} down the road, feel free to reach out anytime.`
    ].join('\n\n');
  }

  const senderName = options.senderName || 'Nahid';
  const roleTitle = isTech ? 'Backend & Automation Developer' : 'Web Design & Business Automation';
  const signatureLines = [
    'Best regards,',
    senderName,
    roleTitle,
    'Website: https://nahid-yf63.onrender.com/',
    'GitHub: https://github.com/Nahid625'
  ];
  const signature = signatureLines.join('\n');

  const text = `${greeting}\n\n${body}\n\n${signature}`;

  const originalSubject = leadRec.subject || candidate.subject || options.originalSubject || '';
  const subject = formatThreadSubject(originalSubject, cleanCompany);
  const inReplyTo = candidate.in_reply_to || leadRec.message_id || options.inReplyTo || '';

  return {
    subject,
    text,
    due_touch: touch,
    followup_number: candidate.followup_number || (touch === 3 ? 2 : 1),
    inReplyTo,
    references: inReplyTo,
    isTech,
    sector
  };
}

function getDailyFollowUpCount(followUpsPath = DEFAULT_FOLLOWUPS_PATH, now = new Date()) {
  const followUps = readFollowUps(followUpsPath);
  if (!Array.isArray(followUps) || followUps.length === 0) return 0;
  const dateStr = (now instanceof Date ? now : new Date(now)).toISOString().slice(0, 10);
  return followUps.filter(f => f.sent_at && String(f.sent_at).slice(0, 10) === dateStr).length;
}

/**
 * Executes follow-up email dispatch via Account 2.
 *
 * Rules:
 * 1. Checks Account 2 credentials via loadFollowUpSmtpConfig.
 * 2. Enforces Daily Quota Cap: gracefully skips if today's send count reached dailyCap.
 * 3. Fetches eligible follow-ups (Touch 2 & 3 within 10-day active window).
 * 4. Enforces rate-limiting delay between sends.
 * 5. Passes enableHtml: true for Resend 1x1 open tracking.
 * 6. Appends each sent follow-up atomically to follow_ups.csv.
 * 7. Supports dry-run and test-email redirection.
 */
async function runFollowUpPipeline(options = {}, deps = {}) {
  const env = options.env || process.env;
  const logger = deps.logger || options.logger || console;
  const sleepFn = deps.sleepFn || ((ms) => new Promise(res => setTimeout(res, ms)));
  const sendEmailFn = deps.sendEmail || sendEmail;
  const appendFollowUpFn = deps.appendFollowUp || appendFollowUp;

  const sentLeadsPath = options.sentLeadsPath || DEFAULT_SENT_LEADS_PATH;
  const followUpsPath = options.followUpsPath || DEFAULT_FOLLOWUPS_PATH;
  const isDryRun = Boolean(options.dryRun || options['dry-run']);
  const testEmail = options.testEmail || options['test-email'];
  const delayMs = typeof options.delayMs === 'number' ? options.delayMs : 2000;
  const limit = typeof options.limit === 'number' ? options.limit : DEFAULT_MAX_DAILY_FOLLOWUPS;
  const isMock = Boolean(
    options.mock ||
    options['mock'] ||
    isDryRun ||
    (deps.sendEmail && !options.transporter)
  );

  const smtpConfig = loadFollowUpSmtpConfig(env, { mock: isMock, ...options });
  if (!smtpConfig.enabled) {
    logger.log(`[FollowUp] Account 2 not configured (${smtpConfig.reason}). Skipping follow-ups.`);
    return {
      success: false,
      skipped: true,
      reason: smtpConfig.reason,
      eligible: 0,
      sent: 0,
      failed: 0,
      details: []
    };
  }

  const now = options.now instanceof Date
    ? options.now
    : (typeof options.now === 'string' || typeof options.now === 'number' ? new Date(options.now) : new Date());

  const todayUtcStr = now.toISOString().slice(0, 10);
  const pool = (smtpConfig.pool && smtpConfig.pool.length > 0) ? smtpConfig.pool : [smtpConfig.config];
  const defaultDailyCap = pool.length * 100;
  const dailyCap = typeof options.dailyCap === 'number'
    ? options.dailyCap
    : (parseInt(process.env.FOLLOWUP_DAILY_CAP, 10) || defaultDailyCap);

  // Check how many follow-ups were sent today (UTC calendar day)
  const sentTodayCount = getDailyFollowUpCount(followUpsPath, now);

  if (sentTodayCount >= dailyCap && !options.ignoreDailyCap && !isDryRun) {
    logger.log(`[FollowUp] Daily quota cap reached for today (${sentTodayCount}/${dailyCap} sent on ${todayUtcStr}). Skipping run to prevent Resend delivery failures.`);
    return {
      success: true,
      skipped: true,
      reason: 'daily_cap_reached',
      sentToday: sentTodayCount,
      dailyCap,
      eligible: 0,
      sent: 0,
      failed: 0,
      details: []
    };
  }

  const remainingDailyCapacity = Math.max(0, dailyCap - sentTodayCount);
  const effectiveLimit = Math.min(limit, remainingDailyCapacity > 0 ? remainingDailyCapacity : limit);

  const eligibilityResult = getEligibleFollowUps(sentLeadsPath, followUpsPath, {
    now,
    limit: effectiveLimit,
    maxAgeDays: options.maxAgeDays,
    touch2DelayMs: options.touch2DelayMs,
    touch3DelayMs: options.touch3DelayMs,
    companiesPath: options.companiesPath,
    companiesMap: options.companiesMap,
    isTargetSic: deps.isTargetSic || options.isTargetSic,
    filterNonTargetSics: options.filterNonTargetSics
  });

  if (eligibilityResult.nonTargetSicCount > 0) {
    logger.log(`[FollowUp] skipped non-target SIC: ${eligibilityResult.nonTargetSicCount}`);
  }

  const candidates = eligibilityResult.eligible;
  if (candidates.length === 0) {
    logger.log(`[FollowUp] No eligible follow-ups due (total sent leads checked, aged out: ${eligibilityResult.agedOutCount}, missing message_id: ${eligibilityResult.missingMessageIdCount}).`);
    return {
      success: true,
      eligible: 0,
      sent: 0,
      failed: 0,
      agedOut: eligibilityResult.agedOutCount,
      missingMessageId: eligibilityResult.missingMessageIdCount,
      nonTargetSic: eligibilityResult.nonTargetSicCount,
      details: []
    };
  }

  logger.log(`[FollowUp] Found ${candidates.length} eligible follow-up candidates (Touch 2: ${eligibilityResult.touch2Count}, Touch 3: ${eligibilityResult.touch3Count}, skipped without message_id: ${eligibilityResult.missingMessageIdCount}).`);

  let currentAccountIndex = 0;
  let sentCount = 0;
  let failedCount = 0;
  let quotaExhausted = false;
  const details = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const emailData = generateFollowUpEmail(candidate, options);
    const recipient = testEmail || candidate.sent_to;

    if (isDryRun) {
      logger.log(`[DRY-RUN] [${i + 1}/${candidates.length}] Would send Touch ${candidate.due_touch} (Follow-up #${candidate.followup_number}) to ${recipient} (Company: ${candidate.company_name})`);
      logger.log(`          Subject: ${emailData.subject}`);
      logger.log(`          In-Reply-To: ${emailData.inReplyTo || 'none'}`);
      sentCount++;
      details.push({
        company_number: candidate.company_number,
        sent_to: candidate.sent_to,
        followup_number: candidate.followup_number,
        due_touch: candidate.due_touch,
        status: 'dry_run',
        subject: emailData.subject,
        messageId: `dry-run-${Date.now()}`
      });
      continue;
    }

    let sendSuccess = false;
    while (!sendSuccess && currentAccountIndex < pool.length) {
      const activeAccount = pool[currentAccountIndex];
      try {
        logger.log(`[FollowUp] [${i + 1}/${candidates.length}] Sending Touch ${candidate.due_touch} (Follow-up #${candidate.followup_number}) to ${recipient} via [Account #${currentAccountIndex + 1}: ${activeAccount.from}]...`);
        const sendResult = await sendEmailFn(
          {
            to: recipient,
            subject: emailData.subject,
            text: emailData.text,
            inReplyTo: emailData.inReplyTo,
            references: emailData.references,
            enableHtml: true, // Enables Resend 1x1 Open Tracking Pixel injection!
            headers: {
              'X-Campaign': 'uk-companies-followup',
              'X-Touch-Number': String(candidate.due_touch),
              'X-FollowUp-Number': String(candidate.followup_number)
            }
          },
          activeAccount
        );

        const messageId = sendResult && sendResult.messageId ? sendResult.messageId : '';
        const sentAt = new Date().toISOString();

        appendFollowUpFn(followUpsPath, {
          company_number: candidate.company_number,
          sent_to: candidate.sent_to,
          followup_number: candidate.followup_number,
          sent_at: sentAt,
          message_id: messageId,
          in_reply_to: emailData.inReplyTo,
          sender_account: activeAccount.from || 'account-2',
          status: 'sent'
        });

        sentCount++;
        details.push({
          company_number: candidate.company_number,
          sent_to: candidate.sent_to,
          followup_number: candidate.followup_number,
          due_touch: candidate.due_touch,
          status: 'sent',
          subject: emailData.subject,
          messageId
        });

        sendSuccess = true;
      } catch (err) {
        if (isSmtpQuotaExceeded(err)) {
          logger.log(`[FollowUp] Account #${currentAccountIndex + 1} (${activeAccount.from}) daily quota reached or exhausted (${err.message}).`);
          currentAccountIndex++;
          if (currentAccountIndex < pool.length) {
            logger.log(`[FollowUp] Automatically failing over to Account #${currentAccountIndex + 1} (${pool[currentAccountIndex].from})...`);
            continue; // retry sending current candidate with the next account!
          } else {
            logger.log(`[FollowUp] All available follow-up accounts (${pool.length}) exhausted their daily quota. Cleanly breaking loop to prevent spam.`);
            quotaExhausted = true;
            failedCount++;
            details.push({
              company_number: candidate.company_number,
              sent_to: candidate.sent_to,
              followup_number: candidate.followup_number,
              due_touch: candidate.due_touch,
              status: 'quota_exhausted',
              error: err.message
            });
            break;
          }
        } else {
          failedCount++;
          logger.error(`[FollowUp] Failed sending follow-up to ${candidate.sent_to}: ${err.message}`);
          details.push({
            company_number: candidate.company_number,
            sent_to: candidate.sent_to,
            followup_number: candidate.followup_number,
            due_touch: candidate.due_touch,
            status: 'failed',
            error: err.message
          });
          break; // individual error, proceed to next candidate
        }
      }
    }

    if (quotaExhausted) {
      break; // cleanly terminate pipeline!
    }

    // Inter-email delay to avoid spam filters and respect provider rate limits
    if (sendSuccess && i < candidates.length - 1 && delayMs > 0) {
      await sleepFn(delayMs);
    }
  }

  logger.log(`[FollowUp] Pipeline finished. Sent: ${sentCount}, Failed: ${failedCount}, Total Eligible: ${candidates.length}${quotaExhausted ? ' (Stopped early due to quota exhaustion)' : ''}.`);

  return {
    success: true,
    eligible: candidates.length,
    sent: sentCount,
    failed: failedCount,
    nonTargetSic: eligibilityResult.nonTargetSicCount,
    quotaExhausted,
    details
  };
}

module.exports = {
  MAX_FOLLOWUP_AGE_DAYS,
  DEFAULT_MAX_DAILY_FOLLOWUPS,
  TOUCH_INTERVALS,
  FOLLOWUP_SECTOR_TEMPLATES,
  getEligibleFollowUps,
  getDailyFollowUpCount,
  formatThreadSubject,
  generateFollowUpEmail,
  runFollowUpPipeline
};
