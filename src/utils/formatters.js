const UKRAINIAN_MONTHS = [
  "січня", "лютого", "березня", "квітня", "травня", "червня",
  "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"
];

/**
 * Форматує дату у вигляд "21 серпня 2026 р."
 */
export function formatUkrainianDate(dateInput) {
  let date = new Date(dateInput);
  if (isNaN(date.getTime())) {
    date = new Date();
  }
  return `${date.getDate()} ${UKRAINIAN_MONTHS[date.getMonth()]} ${date.getFullYear()} р.`;
}

/**
 * Парсить дату з різних форматів: DD.MM.YYYY, DD.MM.YY, DD.MM, DD/MM, YYYY-MM-DD
 */
export function parseFlexibleDate(str) {
  if (!str) return null;
  str = str.trim();

  const now = new Date();
  const currentYear = now.getFullYear();

  // Підтримка DD.MM.YYYY, DD.MM.YY, DD.MM, DD/MM, DD-MM тощо
  const match = str.match(/^(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    let year = match[3] ? parseInt(match[3], 10) : currentYear;

    if (year < 100) year += 2000;

    const d = new Date(year, month, day);
    if (!isNaN(d.getTime()) && d.getMonth() === month && d.getDate() === day) {
      return d;
    }
  }

  const isoDate = new Date(str);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  return null;
}

/**
 * Замінює крапку на кому для чисел (для бланків ТТН)
 */
export function formatNumberComma(val) {
  if (val === null || val === undefined || isNaN(val)) return '';
  return val.toString().replace('.', ',');
}

/**
 * Розраховує брутто та тару за заданим нетто
 */
export function calculateWeights(netto, totalBrutto = 39.8) {
  if (!netto || isNaN(netto)) {
    return { netto: null, tare: null, brutto: totalBrutto };
  }
  const n = parseFloat(netto);
  const tare = parseFloat((totalBrutto - n).toFixed(2));
  return { netto: n, tare, brutto: totalBrutto };
}

/**
 * Екранування HTML спецсимволів
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
