'use strict';

// Builds a single-sheet .xlsx workbook buffer from a header row + data rows.
// Reuses the vendored SheetJS build server.js already requires for reading
// uploaded workbooks (server/xlsx.js -> vendor/sheetjs/xlsx-0.20.3) — no new
// dependency, same pinned build used for parsing.
const XLSX = require('./xlsx');

// Same formula-injection guard as csvEscape() (public/js/portal.js) and
// escapeCsvCell() (server.js): a text cell that opens with = + - @ (or a
// leading control char) can be reinterpreted as a formula when the workbook
// is opened in Excel. Numbers pass through untouched so they stay numeric
// (sortable/summable) instead of becoming display-formatted text.
function xlsxSafeCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  const s = String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

// Excel sheet names: max 31 chars, and \ / ? * [ ] : are illegal.
function sanitizeSheetName(name) {
  const cleaned = String(name || 'Report').replace(/[\\/?*[\]:]/g, ' ').trim();
  return (cleaned || 'Report').slice(0, 31);
}

function buildXlsxBuffer(sheetName, headers, rows) {
  const aoa = [
    (headers || []).map(xlsxSafeCell),
    ...(rows || []).map(row => (row || []).map(xlsxSafeCell))
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName(sheetName));
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { buildXlsxBuffer, xlsxSafeCell, sanitizeSheetName };
