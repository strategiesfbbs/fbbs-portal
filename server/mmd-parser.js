'use strict';

function parseMmdDate(text) {
  const s = String(text || '');
  const named = s.match(/\b(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\b/i);
  if (named) {
    return `${named[4]}-${String(Number(named[2])).padStart(2, '0')}-${String(Number(named[3])).padStart(2, '0')}`;
  }
  // The Excel export drops the weekday prefix — accept a bare MM/DD/YYYY date too.
  const bare = s.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (bare) {
    return `${bare[3]}-${String(Number(bare[1])).padStart(2, '0')}-${String(Number(bare[2])).padStart(2, '0')}`;
  }
  return null;
}

function rateValues(segment) {
  return String(segment || '').match(/\d+\.\d{2}/g)?.map(Number) || [];
}

// The text-derived bits of the MMD scale (date, headline coupon, UST ratios,
// the "Unchanged" note). Shared by the PDF-text and Excel-workbook parsers so
// both produce the same payload shape — the workbook feeds in a blob built from
// every cell value, the PDF feeds in the extracted page text.
function extractMmdMeta(text, result) {
  if (!result.asOfDate) result.asOfDate = parseMmdDate(text);

  const couponMatch = String(text || '').match(/\((\d+(?:\.\d+)?)%\s*Coupon\)/i);
  if (couponMatch) result.coupon = Number(couponMatch[1]);

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
}

// Build one curve row from a term, maturity year, and the per-grade rate values
// in the canonical column order [AAA, P/R, INS'D, AA, A, BAA]. `values` may carry
// nulls (a blank P/R cell in the workbook) so the grade columns stay aligned.
function curveRowFrom(term, maturityYear, values) {
  const present = values.filter(v => v != null);
  const row = {
    term,
    label: `${term}Y`,
    maturityYear,
    aaa: values[0] != null ? values[0] : present[0],
    values: present
  };
  if (values.length >= 6 && values[1] != null) {
    // Full row with the P/R column present: fixed column mapping.
    row.preRefunded = values[1];
    row.insured = values[2];
    row.aa = values[3];
    row.a = values[4];
    row.baa = values[5];
  } else if (values.length >= 6) {
    // Workbook row with a blank P/R cell — keep the remaining columns aligned.
    row.insured = values[2];
    row.aa = values[3];
    row.a = values[4];
    row.baa = values[5];
  } else if (present.length >= 6) {
    row.preRefunded = present[1];
    row.insured = present[2];
    row.aa = present[3];
    row.a = present[4];
    row.baa = present[5];
  } else if (present.length >= 5) {
    // P/R column blank (terms 9+): the printed/celled order is AAA INS'D AA A BAA.
    row.insured = present[1];
    row.aa = present[2];
    row.a = present[3];
    row.baa = present[4];
  }
  return row;
}

function parseMmdCurveText(text) {
  const result = {
    asOfDate: null,
    coupon: null,
    curve: [],
    treasuryRatios: [],
    notes: [],
    warnings: []
  };

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
    result.curve.push(curveRowFrom(term, maturityYear, values));
  }

  extractMmdMeta(sourceText, result);

  if (!result.curve.length) result.warnings.push('MMD PDF was uploaded but the AAA curve could not be extracted.');
  return result;
}

const HEADER_KEY = {
  YEAR: 'year',
  AAA: 'aaa',
  PR: 'preRefunded',
  INSD: 'insured',
  INSURED: 'insured',
  AA: 'aa',
  A: 'a',
  BAA: 'baa'
};

function normalizeHeader(cell) {
  return String(cell == null ? '' : cell).toUpperCase().replace(/[^A-Z]/g, '');
}

// Parse the desk's MMD scale when it arrives as an Excel workbook instead of a
// PDF (the grid is identical — YEAR/AAA/P-R/INS'D/AA/A/BAA — just in cells). Curve
// rows are read by column position off the header so a blank P/R cell can't shift
// the grades; date/coupon/ratios/notes reuse the shared text extractor over a blob
// of every cell value.
function parseMmdCurveWorkbook(buffer) {
  const result = {
    asOfDate: null,
    coupon: null,
    curve: [],
    treasuryRatios: [],
    notes: [],
    warnings: []
  };

  let XLSX;
  try {
    XLSX = require('./xlsx');
  } catch (err) {
    result.warnings.push('MMD workbook could not be read (Excel library unavailable).');
    return result;
  }

  let rows = [];
  const cellBlob = [];
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      const sheetRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
      sheetRows.forEach(r => cellBlob.push((r || []).map(c => (c == null ? '' : c)).join(' ')));
      // The first (annual) grid lives on whichever sheet has the AAA header.
      if (!rows.length && sheetRows.some(r => (r || []).some(c => normalizeHeader(c) === 'AAA'))) {
        rows = sheetRows;
      }
    }
  } catch (err) {
    result.warnings.push('MMD workbook could not be parsed as Excel.');
    return result;
  }

  const headerIdx = rows.findIndex(r => (r || []).some(c => normalizeHeader(c) === 'AAA'));
  if (headerIdx >= 0) {
    const header = rows[headerIdx] || [];
    const colKeys = header.map(normalizeHeader).map(k => HEADER_KEY[k] || null);
    const aaaCol = colKeys.indexOf('aaa');
    let yearCol = colKeys.indexOf('year');
    if (yearCol < 0 || yearCol >= aaaCol) yearCol = aaaCol - 1;   // YEAR sits just left of AAA
    const termCol = yearCol - 1 >= 0 ? yearCol - 1 : 0;           // term column is unlabeled
    // Grade columns, in canonical order, from the header. Falls back to the fixed
    // AAA..BAA span when a header label is missing.
    const gradeOrder = ['aaa', 'preRefunded', 'insured', 'aa', 'a', 'baa'];
    let gradeCols = gradeOrder.map(key => colKeys.indexOf(key));
    if (gradeCols.some(c => c < 0)) {
      gradeCols = [0, 1, 2, 3, 4, 5].map(off => aaaCol + off);
    }

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const term = Number(row[termCol]);
      const maturityYear = Number(row[yearCol]);
      // Stop at the monthly grid / any non-curve row.
      if (!Number.isInteger(term) || term < 1 || term > 60) {
        if (row.some(c => /^(JAN|FEB|MAR)/i.test(String(c || '')))) break;
        continue;
      }
      if (!Number.isInteger(maturityYear) || maturityYear < 2000 || maturityYear > 2100) continue;
      const values = gradeCols.map(c => {
        const raw = c >= 0 ? row[c] : undefined;
        if (raw === null || raw === undefined || raw === '') return null; // blank cell, not 0
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      });
      if (!values.some(v => v != null)) continue;
      result.curve.push(curveRowFrom(term, maturityYear, values));
    }
  }

  extractMmdMeta(cellBlob.join('\n'), result);

  if (!result.curve.length) {
    result.warnings.push('MMD workbook was uploaded but the AAA curve could not be extracted.');
  }
  return result;
}

module.exports = { parseMmdCurveText, parseMmdCurveWorkbook };
