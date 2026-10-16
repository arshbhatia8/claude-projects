// Turns a hiring-related email into a structured event, deterministically.
//   classifyEmail({from, subject, snippet, excerpt, receivedAt}) →
//     {type, company, role, requisitionId, deadline, deadlineTime, interviewDate, interviewTime, confidence, evidence, reasons}
// Types: applied | assessment | interview | reschedule | rejection | offer | info_request | recruiter | marketing | other
// Nothing is guessed: a date is only returned when the email states it.
import { str, toDay, addDays } from './util.js';

const ATS = /(greenhouse|lever\.co|hire\.lever|myworkday|workday|smartrecruiters|ashbyhq|icims|successfactors|taleo|jobvite|freshteam|zohorecruit|keka|darwinbox|breezy|recruitee|workable|bamboohr|personio|teamtailor|hirist|iimjobs|instahyre|cutshort|wellfound|angel\.co|naukri|foundit|monster|indeed|linkedin|glassdoor|ziprecruiter|dice|hackerrank|hackerearth|codility|codesignal|testgorilla|mettl|imocha|calendly|goodtime|gem\.com|beamery|sendgrid|mailchimp|amazonses|mandrillapp)/i;
const FREE_MAIL = /^(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|me|proton|protonmail|rediffmail|aol|zoho)\./i;
const ASSESS_PLATFORMS = /hackerrank|hackerearth|codility|codesignal|testgorilla|mettl|imocha|coderbyte|karat|vervoe|criteria corp|shl\b|aon assessment|harver|pymetrics/i;

const T = {
  offer: /\b(pleased|delighted|happy|excited|thrilled) to (offer|extend (you )?(an|the|a formal)? ?offer)|\boffer letter\b|\bletter of offer\b|\boffer of employment\b|\bemployment offer\b|\bjob offer\b(?! alert)/i,
  offerFalse: /special offer|offer (valid|ends|expires)|limited[- ]time offer|% off|cashback|pre-?approved|credit card|loan offer|exclusive offer/i,
  rejection: /\bunfortunately\b[^.]{0,160}\b(not|won't|will not|unable|other candidates|another candidate|decided)|\bregret to inform\b|\b(not|won't|will not) be (moving|proceeding|progressing) (forward|further|ahead)|\b(decided|chosen|chose) to (move|proceed|go) (forward |ahead )?with (other|another|a different)|\bnot (been )?selected\b|\bposition has (now )?been filled\b|\bno longer (being )?considered\b|\bunable to (offer|move forward|progress)\b|\bnot (a|the right) (fit|match) (for|at) this time\b|\bwe will not be (moving|proceeding)\b|\bpursue other candidates\b/i,
  reschedule: /\breschedul(e|ed|ing)\b[^.]{0,80}\b(interview|call|meeting|conversation)|\b(interview|call)\b[^.]{0,60}\breschedul/i,
  interview: /\binvite you (to|for) (an? |the )?(interview|conversation|call|chat|discussion|round)|\binterview (invitation|invite|request|schedul|confirmation|confirmed|slot|details)|\bschedule (an? |the |your )?(interview|call|conversation|chat)|\b(availability|available) for (an? |the )?(interview|call|conversation)|\bnext (round|step is an interview|stage of (the|our) (interview|hiring) process)|\binterview (has been )?(scheduled|booked|confirmed)\b|\b(first|second|third|technical|final|hr|hiring manager|panel|phone|video) (round|interview)\b|\bcalendly\.com\b|\bshortlisted for (the )?(interview|next round)/i,
  assessment: /\b(online |coding |technical |skills? |product )?(assessment|test|challenge|assignment|case study|take[- ]home)\b[^.]{0,80}\b(invite|invitation|link|complete|attempt|take|submit|deadline|due|within|by)\b|\b(complete|attempt|take|submit)\b[^.]{0,60}\b(assessment|online test|coding test|assignment|case study|take[- ]home)\b/i,
  infoRequest: /\b(could|can|would) you (please )?(share|send|provide|confirm|fill)|\b(please|kindly) (share|send|provide|submit|confirm|fill|complete) (your|the|us|a|an|this)\b[^.]{0,60}\b(details|documents?|form|information|availability|expected|notice period|ctc|salary|resume|cv|references?|id|portfolio)|\badditional (information|details|documents)\b|\bdocuments? required\b/i,
  applied: /\bthank(s| you) for (applying|your application|submitting your application|your interest in (the )?(role|position|opening|job))|\bapplication (has been |was |is )?(received|submitted|sent|successfully submitted|complete)\b|\bwe('ve| have) (successfully )?received your application\b|\byour application (to|for|with|at) [^.]{2,80} (has been|was|is) (received|submitted|sent)|\byour application was sent to\b|\bsuccessfully applied\b|\byou (have )?applied (to|for)\b|\bapplication confirmation\b|\bconfirmation of (your )?application\b/i,
  recruiter: /\b(came across|found|saw) your (profile|resume|cv)|\bare you (open|interested) (to|in) (new|a|exploring)|\bi('m| am) (a |the )?(recruiter|talent|hiring)|\b(exciting|great) (opportunity|role|opening)\b[^.]{0,80}\b(interested|open|connect)/i,
  marketingWords: /\b(job alerts?|jobs for you|recommended (jobs|for you)|new jobs|jobs (matching|near)|hiring now|apply now|top companies|walk-?in|registration|complete (your )?(registration|profile)|\d+% profile|webinar|course|certification|masterclass|upskill|% off|offer ends|cashback|credit (card|limit)|loan|pre-?approved|premium|subscription|reward points|email alerts)\b/i,
  marketingStrong: /\b(job alerts?|jobs you may be interested in|recommended jobs|people also viewed|new jobs for you|jobs similar to)\b|\bregistration fee\b|\bcomplete (your )?registration\b|\bpay(ment)? (of )?(rs\.?|₹|inr)\s?\d/i,
};

const STOP_CO = /^(the|our|us|your|a|an|this|team|role|position|job|company|organization|organisation|opportunity|you|we|it|interest|application|hiring team|recruiting team|careers?|talent acquisition)$/i;
function cleanCompany(s) {
  let c = str(s).replace(/[“”"'’]+/g, '').replace(/\s+/g, ' ').trim();
  c = c.replace(/^(the )/i, '').replace(/[\s,.:;!?|–—-]+$/, '');
  c = c.replace(/\s+(team|careers|recruiting|recruitment|talent acquisition|talent|hiring team|hr|people team|jobs|hiring)$/i, '');
  if (!c || c.length < 2 || c.length > 60 || STOP_CO.test(c) || /\d{4,}/.test(c) || c.split(' ').length > 6) return '';
  return c;
}
function cleanRole(s) {
  let r = str(s).replace(/[“”"'’]+/g, '').replace(/\s+/g, ' ').trim().replace(/[\s,.:;!?|–—-]+$/, '');
  r = r.replace(/^(the|a|an|our)\s+/i, '').replace(/\s+(role|position|opening|job|vacancy)$/i, '');
  if (!r || r.length < 3 || r.length > 90 || r.split(' ').length > 12) return '';
  if (!/(manager|analyst|engineer|consultant|owner|lead|specialist|associate|developer|designer|scientist|architect|director|officer|executive|intern|program|product|operations|solutions?|apm|tpm|pm\b)/i.test(r)) return '';
  return r;
}

const ROLE_PATTERNS = [
  /\byour application was sent to [^\n]+\n+(?=\s*([^\n]{3,80})\n)/i,
  /\b(?:position|role) of ([^.;\n]{3,80}?) (?:at|with)\b/i,
  /\b(?:for|to) the (?:role|position) of ([^.,;\n]{3,80})/i,
  /\b(?:for|to) the ([^.;\n]{3,80}?) (?:role|position|opening|vacancy)\b/i,
  /\bapplication (?:for|to) (?:the )?([^.;\n]{3,80}?) (?:role|position|at|with)\b/i,
  /\bapplying (?:for|to) (?:the )?([^.;\n]{3,80}?) (?:role|position|at|with)\b/i,
  /\b(?:indeed|naukri|linkedin) application:\s*([^\n|]{3,80})/i,
  /\binterest in (?:the )?([^.;\n]{3,80}?) (?:role|position|opening) at\b/i,
  /^\s*(?:re:\s*)?([^|\n–—-]{3,80}?)\s+(?:at|@)\s+[A-Z][^|\n]{1,40}$/i,
];
const COMPANY_PATTERNS = [
  /\b(?:position|role) of [^.;\n]{3,80}? (?:at|with) ([A-Z][^\n.!,|]{1,60})/,
  /\byour application was sent to ([^\n.!|]{2,60})/i,
  /\b(?:thank(?:s| you) for (?:applying|your application|your interest|submitting your application))(?: (?:to|at|with|for)(?: (?:the )?[^.;\n]{2,80}? (?:role|position) at)?) ([A-Z][^\n.!,|]{1,60})/,
  /\b(?:your )?application (?:to|at|with) ([A-Z][^\n.!,|]{1,60}?)(?: (?:has|was|is|for)\b|[.!,\n]|$)/,
  /\b(?:role|position|opening|job) (?:at|with) ([A-Z][^\n.!,|]{1,60}?)(?:[.!,;\n]| (?:has|was|is|and|we|in)\b|$)/,
  /\binterest in (?:joining |working (?:at|with) )([A-Z][^\n.!,|]{1,60}?)(?:[.!,;\n]| (?:and|we)\b|$)/,
  /\b(?:join(?:ing)?|team at|careers at|hiring at) ([A-Z][A-Za-z0-9&.' -]{1,40}?)(?:[.!,;\n]| (?:as|and|team|family|we)\b|$)/,
  /\bfrom (?:the )?([A-Z][A-Za-z0-9&.' -]{1,40}?) (?:talent acquisition|recruiting|recruitment|hiring|people|hr) team\b/,
];

function fromParts(from) {
  const s = str(from);
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const email = (m ? m[2] : s).trim().toLowerCase();
  const name = (m ? m[1] : '').trim();
  const domain = (email.split('@')[1] || '').toLowerCase();
  return { name, email, domain };
}
/** A company name from the sender: "Razorpay Recruiting" → Razorpay; careers@razorpay.com → Razorpay. */
function companyFromSender({ name, domain }) {
  if (name && !/no-?reply|notification|alerts?|support|mailer|team$|^jobs$/i.test(name)) {
    const m = name.match(/^(.{2,40}?)\s*(?:[-|@·,]\s*)?(?:recruiting|recruitment|talent(?: acquisition)?|careers|hiring(?: team)?|hr|people(?: team)?|jobs|ta team)\b/i)
      || name.match(/\b(?:at|@)\s+(.{2,40})$/i);
    if (m) { const c = cleanCompany(m[1]); if (c) return { company: c, how: 'sender name' }; }
  }
  if (domain && !ATS.test(domain) && !FREE_MAIL.test(domain)) {
    const parts = domain.split('.').filter((p) => !/^(mail|email|e|careers|jobs|hr|talent|recruit|recruiting|notifications?|no-?reply|co|com|in|io|org|net|ai|tech|app|us|uk|sg|ae)$/.test(p));
    const base = parts[parts.length - 1] || parts[0];
    if (base && base.length > 1) return { company: base.charAt(0).toUpperCase() + base.slice(1), how: 'sender domain', fromDomain: true };
  }
  return null;
}

// ---------- dates ----------
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const DOWS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const pad = (n) => String(n).padStart(2, '0');
function clock(h, m, ap) {
  let hh = +h;
  if (ap) { ap = ap.toLowerCase(); hh = hh % 12 + (ap.startsWith('p') ? 12 : 0); }
  if (hh > 23 || +(m || 0) > 59) return '';
  return `${pad(hh)}:${pad(+(m || 0))}`;
}
/** Finds explicit dates (with optional time) in text, at or after the email date. */
export function findDates(text, refDay) {
  const out = [];
  const s = str(text);
  const year0 = +refDay.slice(0, 4);
  const mk = (y, mo, d) => {
    if (!mo || !d || d > 31) return '';
    let yy = y ? +y : year0;
    if (yy < 100) yy += 2000;
    let day = `${yy}-${pad(mo)}-${pad(d)}`;
    if (!y && day < refDay && refDay.slice(5) > '10-31' && mo <= 2) day = `${yy + 1}-${pad(mo)}-${pad(d)}`;
    return day;
  };
  const timeRe = '(?:\\s*(?:,|at|@|from)?\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)|\\s*(?:,|at|@|from)\\s*(\\d{1,2})[:.](\\d{2})(?!\\s*(?:am|pm)))?';
  const res = [
    // 21 October 2026, 21st Oct, 21 Oct at 3 PM
    new RegExp(`\\b(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?\\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?,?\\s*(\\d{4})?${timeRe}`, 'gi'),
    // October 21, 2026 / Oct 21 at 3pm
    new RegExp(`\\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?,?\\s*(\\d{4})?${timeRe}`, 'gi'),
    // 21/10/2026 (Indian day-first)
    new RegExp(`\\b(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{2,4})${timeRe}`, 'gi'),
  ];
  let m;
  while ((m = res[0].exec(s))) { const d = mk(m[3], MONTHS[m[2].toLowerCase().slice(0, 4)] || MONTHS[m[2].toLowerCase().slice(0, 3)], +m[1]); if (d) out.push({ date: d, time: m[4] ? clock(m[4], m[5], m[6]) : m[7] ? clock(m[7], m[8]) : '', index: m.index }); }
  while ((m = res[1].exec(s))) { const d = mk(m[3], MONTHS[m[1].toLowerCase().slice(0, 4)] || MONTHS[m[1].toLowerCase().slice(0, 3)], +m[2]); if (d) out.push({ date: d, time: m[4] ? clock(m[4], m[5], m[6]) : m[7] ? clock(m[7], m[8]) : '', index: m.index }); }
  while ((m = res[2].exec(s))) { if (+m[2] > 12) continue; const d = mk(m[3], +m[2], +m[1]); if (d) out.push({ date: d, time: m[4] ? clock(m[4], m[5], m[6]) : m[7] ? clock(m[7], m[8]) : '', index: m.index }); }
  // Weekday names ("on Thursday at 4 PM") resolve to the next such day after the email.
  const wd = /\b(?:on|this|next|coming)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s*,?\s*(?:at|@)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm))?/gi;
  while ((m = wd.exec(s))) {
    const target = DOWS.indexOf(m[1].toLowerCase());
    const cur = new Date(refDay + 'T00:00:00Z').getUTCDay();
    let delta = (target - cur + 7) % 7; if (delta === 0) delta = 7;
    out.push({ date: addDays(refDay, delta), time: m[2] ? clock(m[2], m[3], m[4]) : '', index: m.index, weekday: true });
  }
  return out.filter((x) => x.date >= refDay && x.date <= addDays(refDay, 120)).sort((a, b) => a.index - b.index);
}
/** "within 48 hours", "within 3 days" → a deadline counted from the email date. */
function relativeDeadline(text, refDay) {
  const m = str(text).match(/\bwithin (?:the next )?(\d{1,3}|one|two|three|four|five|seven)\s*(hours?|hrs?|days?|business days?|working days?)/i);
  if (!m) return null;
  const n = { one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7 }[m[1].toLowerCase()] || +m[1];
  const days = /hour|hr/i.test(m[2]) ? Math.ceil(n / 24) : n;
  return { date: addDays(refDay, days), phrase: m[0] };
}

// ---------- main ----------
export function classifyEmail(msg) {
  const from = fromParts(msg.from || msg.sender);
  const subject = str(msg.subject).slice(0, 300);
  const body = str(msg.excerpt || msg.body || '').slice(0, 6000);
  const snippet = str(msg.snippet).slice(0, 400);
  const text = `${subject}\n${snippet}\n${body}`;
  const refDay = toDay(msg.receivedAt || msg.date) || toDay(new Date());
  const reasons = [];

  const isMarketing = ((/\bunsubscribe\b/i.test(text) && T.marketingWords.test(text)) || T.marketingStrong.test(text)) && !T.rejection.test(text) && !T.interview.test(subject);
  let type = 'other';
  let evidence = '';
  const hit = (re) => { const m = text.match(re); if (m) evidence = m[0].slice(0, 120); return !!m; };
  if (hit(T.offer) && !T.offerFalse.test(text)) type = 'offer';
  else if (hit(T.rejection)) type = 'rejection';
  else if (hit(T.reschedule)) type = 'reschedule';
  else if (hit(T.interview)) type = 'interview';
  else if (hit(T.assessment) || (ASSESS_PLATFORMS.test(from.domain + ' ' + text) && /\b(invite|invitation|test|assessment|challenge)\b/i.test(text) && (evidence = 'assessment platform'))) type = 'assessment';
  else if (hit(T.applied)) type = 'applied';
  else if (hit(T.infoRequest)) type = 'info_request';
  else if (hit(T.recruiter)) type = 'recruiter';
  if (isMarketing && type !== 'rejection' && type !== 'offer' && type !== 'interview') { reasons.push('Looks like a newsletter, job alert or promotion'); type = 'marketing'; }
  // A job board's "apply now" blast often says "your application"; a real confirmation names a company.
  if (type === 'applied' && /\bsubmit your application now\b|\bapply now\b/i.test(text)) { type = 'marketing'; reasons.push('Asks you to apply, so it is not a confirmation'); }

  // Company
  let company = '', companyHow = '';
  const all = (re, src) => [...src.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
  outer: for (const re of COMPANY_PATTERNS) {
    for (const m of all(re, text)) { const c = cleanCompany(m[1]); if (c) { company = c; companyHow = 'email text'; break outer; } }
  }
  const sender = companyFromSender(from);
  if (!company && sender) { company = sender.company; companyHow = sender.how; }
  // Role
  let role = '';
  outerR: for (const re of ROLE_PATTERNS) {
    for (const m of all(re, re.source.startsWith('^') ? subject : text)) { const r = cleanRole(m[1]); if (r) { role = r; break outerR; } }
  }
  const reqM = text.match(/\b(?:req(?:uisition)?\.?\s*(?:id|no\.?|number|#)?|job\s*(?:id|code|ref(?:erence)?|no\.?)|reference\s*(?:id|no\.?|number)?)\s*[:#-]?\s*([A-Z]{0,6}[-_]?\d{3,}[A-Z0-9-]*)\b/i);
  const requisitionId = reqM ? reqM[1] : '';

  // Dates (only explicit ones)
  let deadline = '', deadlineTime = '', interviewDate = '', interviewTime = '', deadlinePhrase = '';
  if (type === 'assessment') {
    const near = body.match(/\b(?:by|before|deadline|due|expires?|no later than|valid (?:till|until)|complete (?:it )?by)\b[^\n]{0,80}/i);
    const d = near ? findDates(near[0], refDay)[0] : null;
    if (d) { deadline = d.date; deadlineTime = d.time; deadlinePhrase = near[0].slice(0, 80); }
    else { const r = relativeDeadline(text, refDay); if (r) { deadline = r.date; deadlinePhrase = r.phrase; } }
  }
  if (type === 'interview' || type === 'reschedule') {
    const dates = findDates(body || snippet, refDay).filter((x) => x.time || !x.weekday);
    // Only commit to a date when the email gives exactly one candidate (several = a list of options to choose from).
    const uniq = [...new Set(dates.map((d) => d.date + ' ' + d.time))];
    if (uniq.length === 1) { interviewDate = dates[0].date; interviewTime = dates[0].time; }
    else if (uniq.length > 1) reasons.push('Several dates offered; none recorded');
  }

  // Confidence
  const strong = { offer: 0.55, rejection: 0.55, interview: 0.5, reschedule: 0.5, assessment: 0.5, applied: 0.55, info_request: 0.35, recruiter: 0.3, marketing: 0.9, other: 0.1 }[type];
  let confidence = strong;
  if (['marketing', 'other'].includes(type)) confidence = type === 'marketing' ? 0.9 : 0.1;
  else {
    if (company) confidence += companyHow === 'email text' ? 0.3 : companyHow === 'sender name' ? 0.22 : 0.12;
    if (role) confidence += 0.12;
    if (requisitionId) confidence += 0.05;
    if (ATS.test(from.domain) && !/linkedin|indeed|naukri/i.test(from.domain) && type !== 'recruiter') confidence += 0.03;
  }
  confidence = Math.min(0.99, Math.round(confidence * 100) / 100);
  return {
    type, company, companyHow, role, requisitionId, deadline, deadlineTime, deadlinePhrase, interviewDate, interviewTime,
    confidence, evidence, reasons, fromEmail: from.email, fromName: from.name, fromDomain: from.domain, refDay,
  };
}

/** Gmail search used for both the page sync and the scheduled sync. */
export function gmailQuery(afterDay) {
  const terms = '(subject:(application OR applying OR applied OR interview OR assessment OR assignment OR "case study" OR offer OR candidature OR "next steps" OR shortlisted OR test) OR "thank you for applying" OR "your application" OR "application received" OR "regret to inform" OR "moving forward" OR "invite you" OR hackerrank OR codility OR hackerearth OR testgorilla OR mettl)';
  const after = afterDay ? ` after:${afterDay.replace(/-/g, '/')}` : ' newer_than:30d';
  return `${terms}${after} -category:promotions -category:social -in:sent -in:chats`;
}

export const EVENT_LABEL = {
  applied: 'Application confirmed', assessment: 'Assessment invitation', interview: 'Interview invitation', reschedule: 'Interview rescheduled',
  rejection: 'Rejection', offer: 'Offer', info_request: 'Request for information', recruiter: 'Recruiter message', marketing: 'Promotion / job alert', other: 'Not a hiring update',
};
