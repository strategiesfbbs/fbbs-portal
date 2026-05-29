'use strict';

// Size-based log rotation for append-only logs (currently the audit log).
//
// When `filePath` reaches `maxBytes`, the existing numbered backups are shifted
// up (.1 → .2 … dropping the oldest past `keep`) and the active file is moved to
// `.1`, leaving no active file so the next append recreates a fresh one. This
// bounds total disk use at roughly maxBytes × (keep + 1).
//
// Synchronous + best-effort so it composes with a synchronous append: any fs
// error during the shift is swallowed (a rotation hiccup must never block or
// crash the thing being logged). Pure fs — no server coupling — so it unit-tests
// against a temp dir.

const fs = require('fs');

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch (_) {
    return 0; // missing file → nothing to rotate
  }
}

// Returns true if a rotation happened. Call this BEFORE appending the next
// record so the active file never grows far past maxBytes.
function rotateFileIfNeeded(filePath, { maxBytes, keep = 5 } = {}) {
  if (!filePath || !maxBytes || maxBytes <= 0) return false;
  if (fileSize(filePath) < maxBytes) return false;

  const backups = Math.max(1, keep);
  // Drop the oldest backup that would fall off the end.
  try {
    const oldest = `${filePath}.${backups}`;
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
  } catch (_) { /* best-effort */ }

  // Shift .{n} → .{n+1} from the top down so we never overwrite a live backup.
  for (let i = backups - 1; i >= 1; i--) {
    const src = `${filePath}.${i}`;
    const dst = `${filePath}.${i + 1}`;
    try {
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    } catch (_) { /* best-effort */ }
  }

  // Move the active file to .1. If this fails, report no rotation so the caller
  // still appends to the (un-rotated) active file rather than losing the record.
  try {
    fs.renameSync(filePath, `${filePath}.1`);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { rotateFileIfNeeded };
