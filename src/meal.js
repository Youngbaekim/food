// 끼니 구분 — 아침(11시 이전) · 점심(16시 이전) · 저녁(16시 및 그 이후)
export const SLOTS = { b: '아침', l: '점심', d: '저녁' };
export const SLOT_ORDER = ['b', 'l', 'd'];
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const p2 = (n) => String(n).padStart(2, '0');

export function slotOf(time /* 'HH:MM' */) {
  const h = Number(String(time).slice(0, 2));
  if (h < 11) return 'b';
  if (h < 16) return 'l';
  return 'd';
}

/** Date → { date:'YYYY-MM-DD', time:'HH:MM' } (기기 현지 시각) */
export function splitNow(d = new Date()) {
  return { date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, time: `${p2(d.getHours())}:${p2(d.getMinutes())}` };
}

/** 기록 ID = 날짜_끼니 → 같은 날 같은 끼니는 1건만 존재 */
export const mealId = (date, slot) => `${date}_${slot}`;

export function weekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  return WD[new Date(y, m - 1, d).getDay()];
}

/** 기본 제목: 2026.11.07 (토) 점심 */
export const baseTitle = (r) => `${r.date.replace(/-/g, '.')} (${weekday(r.date)}) ${SLOTS[r.slot] || ''}`;
