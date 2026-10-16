// Freshness and verification labels. Posting date and discovery date stay separate.
// Age alone never marks a job closed: only you can mark it Closed.
import { toDay, daysBetween, today } from './util.js';

export function freshnessOf(job, meta = {}, ref = today()) {
  const posted = toDay(job.listedAt);
  const found = toDay(job.foundOn) || toDay(job.createdAt);
  const deadline = toDay(meta.deadline || job.deadline);
  const verifiedOn = toDay(meta.lastVerifiedAt);
  const verification = meta.verification || 'Unverified';
  const labels = [];

  const foundAge = found ? daysBetween(found, ref) : null;
  const postedAge = posted ? daysBetween(posted, ref) : null;
  const verifiedAge = verifiedOn ? daysBetween(verifiedOn, ref) : null;

  if (verification === 'Closed') labels.push({ key: 'closed', text: 'Closed', tone: 'muted', why: 'You marked this listing closed' });
  if (foundAge != null && foundAge <= 2 && !meta.reviewed) labels.push({ key: 'new', text: 'Newly discovered', tone: 'accent', why: `Found ${foundAge === 0 ? 'today' : foundAge + ' day(s) ago'}` });
  if (verification === 'Verified open' && verifiedAge != null && verifiedAge <= 7) labels.push({ key: 'verified', text: 'Recently verified', tone: 'good', why: `You checked it was open on ${verifiedOn}` });
  if (verification === 'Possibly expired') labels.push({ key: 'expired', text: 'Possibly expired', tone: 'warn', why: 'You flagged this listing as possibly expired' });
  else if (verification !== 'Closed' && postedAge != null && postedAge > 30 && !(verifiedAge != null && verifiedAge <= 14)) {
    labels.push({ key: 'expired', text: 'Possibly expired', tone: 'warn', why: `Posted ${postedAge} days ago and not re-checked in 14 days. It may still be open.` });
  }
  if (verification === 'Unverified') labels.push({ key: 'unverified', text: 'Unverified', tone: 'muted', why: 'Nobody has confirmed this listing is still open' });
  else if (verification === 'Verified open' && (verifiedAge == null || verifiedAge > 7)) labels.push({ key: 'needs', text: 'Needs verification', tone: 'muted', why: verifiedOn ? `Last checked ${verifiedOn}` : 'No check date recorded' });
  if (deadline) {
    const d = daysBetween(ref, deadline);
    if (d < 0) labels.push({ key: 'deadline-passed', text: 'Deadline passed', tone: 'bad', why: `Deadline was ${deadline}` });
    else if (d <= 3) labels.push({ key: 'deadline-soon', text: d === 0 ? 'Deadline today' : `Deadline in ${d}d`, tone: 'warn', why: `Apply by ${deadline}` });
  }
  return { posted, found, deadline, postedAge, foundAge, verification, verifiedOn, labels };
}
