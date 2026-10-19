const { isValidEmailAddress } = require('../emailAddress');
const {
  DEFAULT_SENT_LEADS_PATH,
  DEFAULT_FOLLOWUPS_PATH,
  readLeads,
  readFollowUps
} = require('./csv');

const MAX_FOLLOWUP_AGE_DAYS = 10;
const DEFAULT_MAX_DAILY_FOLLOWUPS = 100;

const TOUCH_INTERVALS = Object.freeze({
  touch2: 3 * 24 * 60 * 60 * 1000, // 72 hours after initial outreach (Day 3)
  touch3: 4 * 24 * 60 * 60 * 1000  // 96 hours after follow-up 1 (Day 7)
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
function getEligibleFollowUps(
  sentLeadsPath = DEFAULT_SENT_LEADS_PATH,
  followUpsPath = DEFAULT_FOLLOWUPS_PATH,
  options = {}
) {
  const now = options.now instanceof Date
    ? options.now
    : (typeof options.now === 'string' || typeof options.now === 'number' ? new Date(options.now) : new Date());

  const maxAgeDays = typeof options.maxAgeDays === 'number' ? options.maxAgeDays : MAX_FOLLOWUP_AGE_DAYS;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const touch2DelayMs = typeof options.touch2DelayMs === 'number' ? options.touch2DelayMs : TOUCH_INTERVALS.touch2;
  const touch3DelayMs = typeof options.touch3DelayMs === 'number' ? options.touch3DelayMs : TOUCH_INTERVALS.touch3;
  const limit = typeof options.limit === 'number' ? options.limit : DEFAULT_MAX_DAILY_FOLLOWUPS;

  const sentLeads = readLeads(sentLeadsPath);
  if (sentLeads.length === 0) {
    return {
      eligible: [],
      totalEligible: 0,
      agedOutCount: 0,
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
    const touch1Fup = previousFollowUps.find(f => f.followup_number === 1);
    const touch2Fup = previousFollowUps.find(f => f.followup_number === 2);

    // Case A: Eligible for Touch 2 (Follow-up 1)
    if (!touch1Fup) {
      if (leadAgeMs >= touch2DelayMs) {
        seenCandidates.add(candidateKey);
        eligibleCandidates.push({
          company_number: compNum,
          company_name: lead.company_name || '',
          person_name: lead.person_name || '',
          sent_to: sentTo,
          due_touch: 2,
          followup_number: 1,
          touch1_sent_at: lead.sent_at,
          sort_timestamp: touch1Date.getTime(),
          in_reply_to: lead.message_id || '',
          lead_record: lead
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
            company_name: lead.company_name || '',
            person_name: lead.person_name || '',
            sent_to: sentTo,
            due_touch: 3,
            followup_number: 2,
            touch1_sent_at: lead.sent_at,
            touch2_sent_at: touch1Fup.sent_at,
            sort_timestamp: touch2Date.getTime(),
            in_reply_to: touch1Fup.message_id || lead.message_id || '',
            lead_record: lead
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
    touch2Count,
    touch3Count
  };
}

module.exports = {
  MAX_FOLLOWUP_AGE_DAYS,
  DEFAULT_MAX_DAILY_FOLLOWUPS,
  TOUCH_INTERVALS,
  getEligibleFollowUps
};
