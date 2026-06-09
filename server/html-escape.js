'use strict';

// Shared HTML-escaping + blank-check helpers for the server-side printable
// renderers (swap-render.js, portfolio-review-render.js). Tiny and
// dependency-free; previously duplicated byte-for-byte in both.

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function isBlank(value) {
  return value == null || value === '' || (typeof value === 'string' && !value.trim());
}

module.exports = { escapeHtml, isBlank };
