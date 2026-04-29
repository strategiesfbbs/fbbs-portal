'use strict';

const TERM_MONTHS = {
  '3 mo': 3,
  '6 mo': 6,
  '9 mo': 9,
  '12 mo': 12,
  '18 mo': 18,
  '1 yr': 12,
  '2 yr': 24,
  '3 yr': 36,
  '4 yr': 48,
  '5 yr': 60,
  '7 yr': 84,
  '10 yr': 120
};

function toIsoDate(mdy) {
  const [m, d, y] = mdy.split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function parseBrokeredCdRateSheetText(text) {
  const result = { asOfDate: null, terms: [], warnings: [] };
  const lines = String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
  const seen = new Set();

  for (const line of lines) {
    if (!result.asOfDate) {
      const dateMatch = line.match(/^(\d{1,2}\/\d{1,2}\/\d{4})$/);
      if (dateMatch) result.asOfDate = toIsoDate(dateMatch[1]);
    }

    const rangeMatch = line.match(/^((?:3|6|9|12|18)\s+mo|(?:1|2|3|4|5|7|10)\s+yr)\s+(\d+(?:\.\d+)?)%\s*-\s*(\d+(?:\.\d+)?)%/i);
    if (!rangeMatch) continue;

    const label = rangeMatch[1].replace(/\s+/g, ' ').toLowerCase();
    const months = TERM_MONTHS[label];
    if (!months || seen.has(months)) continue;

    const low = Number(rangeMatch[2]);
    const high = Number(rangeMatch[3]);
    if (!Number.isFinite(low) || !Number.isFinite(high)) continue;

    seen.add(months);
    result.terms.push({
      label: label.replace(/\bmo\b/, 'mo').replace(/\byr\b/, 'yr'),
      months,
      low,
      mid: Number(((low + high) / 2).toFixed(3)),
      high
    });
  }

  result.terms.sort((a, b) => a.months - b.months);
  if (result.terms.length === 0) {
    result.warnings.push('No brokered CD all-in cost ranges were found.');
  }

  return result;
}

module.exports = { parseBrokeredCdRateSheetText };
