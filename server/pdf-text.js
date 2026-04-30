/**
 * Wraps pdf-parse@1.x with a custom page renderer that reconstructs
 * tabular layouts the way the downstream FBBS parsers were written
 * against (which assumed pdf-parse@2.x output).
 *
 * Differences from v1's default render:
 *
 * 1. Whitespace is inserted between adjacent text runs that share a Y
 *    baseline. The default concatenates them with no separator and the
 *    resulting glob is unparseable for tabular content.
 *
 * 2. Items are walked in PDF stream emit order (the same order the
 *    default v1 renderer uses) rather than sorted. Several FBBS
 *    parsers — notably the Economic Update parser — rely on stream
 *    order to pair date/time stamps with their adjacent event names.
 *
 * 3. A small Y tolerance treats baselines that differ by ≤ 1 unit as
 *    the same line. Some PDFs nudge cell baselines by fractions of a
 *    point; this keeps those cells together.
 *
 * Multi-line cell wraps (e.g. the muni offerings PDF, where an issuer
 * name can wrap across 2-3 Y values) are handled in the parser via
 * `recombineWrappedRows` rather than here, since fixing it here would
 * collapse legitimate row breaks elsewhere.
 */

'use strict';

const pdfParse = require('pdf-parse');

const SAME_LINE_Y_TOLERANCE = 1;

function renderPage(pageData) {
  return pageData
    .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
    .then(textContent => {
      let out = '';
      let lastY = null;
      let lastEndX = null;
      for (const item of textContent.items) {
        const y = item.transform[5];
        const x = item.transform[4];
        const sameLine = lastY !== null && Math.abs(y - lastY) <= SAME_LINE_Y_TOLERANCE;
        if (!sameLine) {
          if (out.length) out += '\n';
          out += item.str;
        } else {
          const xGap = lastEndX !== null && x > lastEndX + 0.5;
          const xWrappedBack = lastEndX !== null && x < lastEndX - 0.5;
          const needsSpace =
            (xGap || xWrappedBack) &&
            !out.endsWith(' ') &&
            !item.str.startsWith(' ');
          out += (needsSpace ? ' ' : '') + item.str;
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
