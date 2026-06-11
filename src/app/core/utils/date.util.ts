const SQ_SHORT = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj'];
const SQ_LONG  = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'];
const SQ_WEEKDAY = ['E Diel', 'E Hënë', 'E Martë', 'E Mërkurë', 'E Enjte', 'E Premte', 'E Shtunë'];

function toDate(ts: any): Date {
  return ts?.toDate ? ts.toDate() : new Date(ts ?? 0);
}

/** "9 Qer 2026" / "9 Jun 2026" */
export function fmtDateShort(ts: any, lang: string): string {
  const d = toDate(ts);
  if (!ts) return '';
  if (lang === 'sq') return `${d.getDate()} ${SQ_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "9 Qer" / "9 Jun" */
export function fmtDateDay(ts: any, lang: string): string {
  const d = toDate(ts);
  if (!ts) return '';
  if (lang === 'sq') return `${d.getDate()} ${SQ_SHORT[d.getMonth()]}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "9 Qer, 14:35" / "9 Jun, 14:35" */
export function fmtDateWithTime(ts: any, lang: string): string {
  const d = toDate(ts);
  if (!ts) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (lang === 'sq') return `${d.getDate()} ${SQ_SHORT[d.getMonth()]}, ${hh}:${mm}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** "E Martë, 9 Qershor 2026" / "Tuesday, 9 June 2026" */
export function fmtDateFull(ts: any, lang: string): string {
  const d = toDate(ts);
  if (!ts) return '';
  if (lang === 'sq') return `${SQ_WEEKDAY[d.getDay()]}, ${d.getDate()} ${SQ_LONG[d.getMonth()]} ${d.getFullYear()}`;
  return d.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/** "Qershor 2026" / "June 2026" */
export function fmtMonthYear(ts: any, lang: string): string {
  const d = toDate(ts);
  if (!ts) return '';
  if (lang === 'sq') return `${SQ_LONG[d.getMonth()]} ${d.getFullYear()}`;
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}
