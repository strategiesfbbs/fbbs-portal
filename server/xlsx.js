'use strict';

// Pinned SheetJS build from the official SheetJS CDN. The npm `xlsx`
// package is stuck at 0.18.5 and carries known audit findings.
module.exports = require('../vendor/sheetjs/xlsx-0.20.3/xlsx.js');
