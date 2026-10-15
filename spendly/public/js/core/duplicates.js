// Flags Gmail candidates that look like something already recorded, e.g. a
// forwarded alert, or an expense you already entered by hand.

const direction = (type) => (type === 'income' || type === 'refund' ? 'in' : type === 'expense' ? 'out' : type);

function dayGap(a, b) {
  return Math.abs(Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5;
}

/** Returns { reason, transactionId?, candidateId? } or null. */
export function possibleDuplicate(db, candidate) {
  const p = candidate.parsed;
  const imported = db.transactions.find((t) => t.gmailMessageId === candidate.messageId);
  if (imported) return { reason: 'Already imported from this email', transactionId: imported.id };
  if (!p) return null;
  if (p.reference) {
    const sameRef = db.transactions.find((t) => t.externalRef && t.externalRef.toUpperCase() === p.reference);
    if (sameRef) return { reason: `Same reference (${p.reference}) as a recorded transaction`, transactionId: sameRef.id };
    const twin = db.gmailCandidates.find((c) => c.id !== candidate.id && c.status !== 'rejected' && c.parsed?.reference === p.reference);
    if (twin) return { reason: `Another email has the same reference (${p.reference}) — possibly a forwarded alert`, candidateId: twin.id };
  }
  const date = p.date || candidate.emailDate;
  if (date) {
    const near = db.transactions.find(
      (t) => !t.sample && t.amount === p.amount && direction(t.type) === direction(p.type) && dayGap(t.date, date) <= 1
    );
    if (near) return { reason: 'Same amount within a day of a recorded transaction', transactionId: near.id };
  }
  return null;
}
