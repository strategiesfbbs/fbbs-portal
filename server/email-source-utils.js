'use strict';

const path = require('path');

function unfoldEmailHeaders(text) {
  return String(text || '').replace(/\r\n[ \t]+/g, ' ').replace(/\n[ \t]+/g, ' ');
}

function emailHeader(text, name) {
  const match = unfoldEmailHeaders(text).match(new RegExp(`^${name}:\\s*(.+)$`, 'im'));
  return match ? match[1].trim() : '';
}

function decodeQuotedPrintable(text) {
  return String(text || '')
    .replace(/=\r?\n/g, '')
    .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#43;/g, '+')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function decodeMimeWord(value) {
  return String(value || '').replace(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi, (_, charset, enc, text) => {
    try {
      if (enc.toUpperCase() === 'B') return Buffer.from(text, 'base64').toString(/utf-?8/i.test(charset) ? 'utf8' : 'latin1');
      return decodeQuotedPrintable(text.replace(/_/g, ' '));
    } catch (_) {
      return text;
    }
  });
}

function decodeTransfer(text, encoding) {
  const body = String(text || '').trim();
  if (/base64/i.test(encoding || '')) {
    try {
      return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch (_) {
      return body;
    }
  }
  if (/quoted-printable/i.test(encoding || '')) return decodeQuotedPrintable(body);
  return decodeQuotedPrintable(body);
}

function emailBody(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const plainHeader = normalized.match(/Content-Type:\s*text\/plain[\s\S]*?\n\n/i);
  if (plainHeader) {
    const start = plainHeader.index + plainHeader[0].length;
    const tail = normalized.slice(start);
    const end = tail.search(/\n--[^\n]+/);
    const raw = end === -1 ? tail : tail.slice(0, end);
    const headerBlock = plainHeader[0];
    const transfer = (headerBlock.match(/Content-Transfer-Encoding:\s*([^\n;]+)/i) || [])[1] || '';
    return decodeTransfer(raw, transfer);
  }
  const idx = normalized.search(/\n\n/);
  return idx === -1 ? normalized : normalized.slice(idx).trim();
}

function cleanEmailText(text) {
  return decodeHtmlEntities(String(text || ''))
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter(line => !/^--/.test(line))
    .filter(line => !/^Content-(Type|Transfer-Encoding|ID|Disposition):/i.test(line))
    .filter(line => !/^boundary=/i.test(line))
    .filter(line => !/^\[cid:/i.test(line));
}

function emailSummary(text, filename = '') {
  const subject = decodeMimeWord(emailHeader(text, 'Subject')) || path.basename(filename || '', path.extname(filename || ''));
  return {
    subject,
    from: decodeMimeWord(emailHeader(text, 'From')),
    date: emailHeader(text, 'Date'),
    body: cleanEmailText(emailBody(text)).join('\n')
  };
}

function attachmentFilenames(text) {
  const names = [];
  const re = /filename\*?=(?:"([^"]+)"|([^;\r\n]+))/gi;
  let match;
  while ((match = re.exec(String(text || '')))) {
    let name = (match[1] || match[2] || '').trim();
    name = name.replace(/^UTF-8''/i, '');
    try { name = decodeURIComponent(name); } catch (_) {}
    name = decodeMimeWord(name);
    name = path.basename(name);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

module.exports = {
  attachmentFilenames,
  cleanEmailText,
  decodeHtmlEntities,
  emailBody,
  emailHeader,
  emailSummary
};
