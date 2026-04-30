/**
 * Wraps pdf-parse@1.x with a custom page renderer that preserves the
 * spacing between adjacent text runs on the same line.
 *
 * The default v1 renderer concatenates items without whitespace, which
 * collapses tabular layouts (CD Offers, Muni Offerings) into one long
 * token. The render here inserts a single space whenever two items on
 * the same Y position have a horizontal gap between them, matching the
 * shape the downstream parsers were written against.
 */

'use strict';

const pdfParse = require('pdf-parse');

// Items whose Y baselines differ by less than this are treated as the same
// row. The muni offerings PDF spreads cells of one row across Y deltas of
// up to ~0.3; legitimate next-row breaks are several units away.
const LINE_Y_TOLERANCE = 1.5;

function renderPage(pageData) {
  return pageData
    .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
    .then(textContent => {
      let lastY = null;
      let lastEndX = null;
      let out = '';
      for (const item of textContent.items) {
        const y = item.transform[5];
        const x = item.transform[4];
        if (lastY === null) {
          out += item.str;
        } else if (Math.abs(y - lastY) <= LINE_Y_TOLERANCE) {
          const gap = lastEndX !== null && x > lastEndX + 0.5;
          const needsSpace = gap && !out.endsWith(' ') && !item.str.startsWith(' ');
          out += (needsSpace ? ' ' : '') + item.str;
        } else {
          out += '\n' + item.str;
        }
        lastY = y;
        lastEndX = x + (item.width || 0);
      }
      return out;
    });
}

function extractPdfText(buffer) {
  return pdfParse(buffer, { pagerender: renderPage });
}

module.exports = { extractPdfText };
