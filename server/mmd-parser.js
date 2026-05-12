'use strict';

function parseMmdDate(text) {
  const m = String(text || '').match(/\b(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\b/i);
  if (!m) return null;
  return `${m[4]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
}

function rateValues(segment) {
  return String(segment || '').match(/\d+\.\d{2}/g)?.map(Number) || [];
}

function parseMmdCurveText(text) {
  const result = {
    asOfDate: parseMmdDate(text),
    coupon: null,
    curve: [],
    treasuryRatios: [],
    notes: [],
    warnings: []
  };

  const couponMatch = String(text || '').match(/\((\d+(?:\.\d+)?)%\s*Coupon\)/i);
  if (couponMatch) result.coupon = Number(couponMatch[1]);

  const sourceText = String(text || '');
  const firstCurveHeader = sourceText.search(/YEAR\s+AAA\s+P\/R/i);
  const monthlyHeader = sourceText.search(/YEAR\s*JAN\s*FEB\s*MAR/i);
  const curveText = firstCurveHeader >= 0
    ? sourceText.slice(firstCurveHeader, monthlyHeader > firstCurveHeader ? monthlyHeader : undefined)
    : sourceText.split(/YEAR\s*JAN\s*FEB\s*MAR/i)[0] || '';

  for (const line of curveText.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
    const m = line.match(/^(\d{1,2})\s*(20\d{2})(.+)$/);
    if (!m) continue;
    const term = Number(m[1]);
    const maturityYear = Number(m[2]);
    const values = rateValues(m[3]);
    if (!term || !maturityYear || values.length < 1) continue;
    const row = {
      term,
      label: `${term}Y`,
      maturityYear,
      aaa: values[0],
      values
    };
    if (values.length >= 6) {
      row.preRefunded = values[1];
      row.insured = values[2];
      row.aa = values[3];
      row.a = values[4];
      row.baa = values[5];
    } else if (values.length >= 5) {
      row.aa = values[1];
      row.a = values[2];
      row.insured = values[3];
      row.baa = values[4];
    }
    result.curve.push(row);
  }

  const ratioRe = /US\s+TSY\s+(\d+)yr\s+(\d+\.\d+)%\s+(\d+)%/gi;
  let match;
  while ((match = ratioRe.exec(String(text || '')))) {
    result.treasuryRatios.push({
      term: Number(match[1]),
      treasuryYield: Number(match[2]),
      ratioPct: Number(match[3])
    });
  }

  const unchanged = String(text || '').match(/(20\d{2}-20\d{2}:\s*Unchanged)/i);
  if (unchanged) result.notes.push(unchanged[1]);

  if (!result.curve.length) result.warnings.push('MMD PDF was uploaded but the AAA curve could not be extracted.');
  return result;
}

module.exports = { parseMmdCurveText };
