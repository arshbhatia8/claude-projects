import { Store, LocalAdapter, memoryStorage } from '../src/core/store.js';
import { setNow } from '../src/core/util.js';

export const NOW = '2026-10-16T10:00:00+05:30';
setNow(NOW);

export async function newStore(seed = {}) {
  const storage = memoryStorage();
  for (const [coll, docs] of Object.entries(seed)) storage.setItem('jobhunt:v1:' + coll, JSON.stringify(docs));
  const store = new Store(new LocalAdapter(storage));
  await store.start();
  return { store, storage };
}

/** A job document shaped exactly like the scheduled job search writes them (fictional data). */
export function taskJob(over = {}) {
  return {
    appliedOn: '', category: 'PM', company: 'Acme Pay', ctc: 'Not disclosed', employmentType: 'Full-time',
    experience: '2–3 yrs', foundOn: '2026-10-16', freshness: '24h',
    link: 'https://www.linkedin.com/jobs/view/4400000001/', listedAt: '2026-10-15T16:45:00+05:30', listedTimeKnown: true,
    location: 'Bengaluru (Hybrid)', match: 88, note: 'Payments platform', region: 'India', source: 'LinkedIn',
    status: 'Not applied', statusSource: 'Gmail', title: 'Product Manager – Payments', ...over,
  };
}

export const CSV = `Job Title,Company,Location,Source,Posted,Salary,Experience,Job URL,Job ID
Product Manager,Nimbus Labs,Pune (Remote),Naukri,2026-10-14,₹18–25 LPA,2-4 years,https://www.naukri.com/job-listings-pm-nimbus-123?src=alert,REQ-77
Associate Product Manager,Orbit Finance,Mumbai,Indeed,2026-10-12,Not disclosed,1-3 yrs,https://in.indeed.com/viewjob?jk=abc123&from=serp,
Business Analyst,Kite Retail,Chennai,Wellfound,2026-10-10,,3+ years,https://wellfound.com/jobs/999-business-analyst,BA-1
`;
