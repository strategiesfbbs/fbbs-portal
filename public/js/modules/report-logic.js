(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FbbsReportLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Pure engine behind the dynamic report builder: field/operator/value
  // conditions, Group By, and aggregations. No DOM, no fetch — portal.js wires
  // it to the custom-bank dataset and the node tests drive it directly.

  const CONDITION_OPS = {
    numeric: [
      { op: 'gt', label: '>' },
      { op: 'gte', label: '≥' },
      { op: 'lt', label: '<' },
      { op: 'lte', label: '≤' },
      { op: 'eq', label: '=' },
      { op: 'between', label: 'between' },
      { op: 'blank', label: 'is blank' }
    ],
    text: [
      { op: 'is', label: 'is' },
      { op: 'contains', label: 'contains' },
      { op: 'oneOf', label: 'is one of' },
      { op: 'startsWith', label: 'starts with' },
      { op: 'blank', label: 'is blank' }
    ],
    boolean: [
      { op: 'isYes', label: 'is yes' },
      { op: 'isNo', label: 'is no' }
    ]
  };

  const AGG_FUNCTIONS = ['sum', 'avg', 'min', 'max'];

  // Display type (money/percent/number/text/boolean/...) → operator vocabulary.
  function conditionFieldKind(type) {
    if (['money', 'percent', 'number'].includes(type)) return 'numeric';
    if (type === 'boolean') return 'boolean';
    return 'text';
  }

  function operatorsFor(type) {
    return CONDITION_OPS[conditionFieldKind(type)];
  }

  // "$1,250,000" → 1250000; '' / garbage → null.
  function parseNumericInput(value) {
    const clean = String(value == null ? '' : value).replace(/[$,]/g, '').trim();
    if (!clean) return null;
    const n = Number(clean);
    return Number.isFinite(n) ? n : null;
  }

  // One condition against one resolved cell value. Unknown ops and
  // unparseable numeric input PASS — a half-typed value must never silently
  // empty a report.
  function evaluateCondition(raw, cond, type) {
    if (!cond || !cond.op) return true;
    const kind = conditionFieldKind(type);
    if (cond.op === 'blank') return raw == null || raw === '';
    if (kind === 'boolean') {
      const truthy = raw === true || raw === 'Yes';
      return cond.op === 'isYes' ? truthy : !truthy;
    }
    if (kind === 'numeric') {
      const num = Number(raw);
      const a = parseNumericInput(cond.value);
      if (a == null) return true; // value not typed yet
      if (raw == null || raw === '' || !Number.isFinite(num)) return false;
      if (cond.op === 'gt') return num > a;
      if (cond.op === 'gte') return num >= a;
      if (cond.op === 'lt') return num < a;
      if (cond.op === 'lte') return num <= a;
      if (cond.op === 'eq') return num === a;
      if (cond.op === 'between') {
        const b = parseNumericInput(cond.value2);
        if (b == null) return num >= a;
        return num >= Math.min(a, b) && num <= Math.max(a, b);
      }
      return true;
    }
    const text = String(raw == null ? '' : raw).toLowerCase();
    const want = String(cond.value || '').trim().toLowerCase();
    if (!want) return true;
    if (cond.op === 'is') return text === want;
    if (cond.op === 'contains') return text.includes(want);
    if (cond.op === 'startsWith') return text.startsWith(want);
    if (cond.op === 'oneOf') {
      return want.split(/[\s,;]+/).filter(Boolean).some(token => text === token);
    }
    return true;
  }

  function aggregateValues(values, fn) {
    // Drop empty cells BEFORE coercion — Number(null) is 0 and would silently
    // drag sums and averages down for banks that don't report the field.
    const nums = values
      .filter(v => v != null && v !== '')
      .map(Number)
      .filter(Number.isFinite);
    if (!nums.length) return null;
    if (fn === 'sum') return nums.reduce((s, n) => s + n, 0);
    if (fn === 'avg') return nums.reduce((s, n) => s + n, 0) / nums.length;
    if (fn === 'min') return Math.min(...nums);
    if (fn === 'max') return Math.max(...nums);
    return null;
  }

  // rows → [{ key, rows, count, aggregates: { col: number|null }, subgroups }]
  // sorted biggest-group-first. `getValue(row, field)` resolves cells so
  // synthetic fields (status labels, owners) group like raw ones.
  function groupRows(rows, { field, thenBy = '', aggs = {}, getValue }) {
    const read = getValue || ((row, key) => row[key]);
    const buckets = new Map();
    (rows || []).forEach(row => {
      const raw = read(row, field);
      const key = raw == null || raw === '' ? '(blank)' : String(raw);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    });
    const aggEntries = Object.entries(aggs || {}).filter(([, fn]) => AGG_FUNCTIONS.includes(fn));
    const groups = [...buckets.entries()].map(([key, members]) => {
      const aggregates = {};
      aggEntries.forEach(([col, fn]) => {
        aggregates[col] = aggregateValues(members.map(r => read(r, col)), fn);
      });
      return {
        key,
        rows: members,
        count: members.length,
        aggregates,
        subgroups: thenBy ? groupRows(members, { field: thenBy, aggs, getValue: read }) : null
      };
    });
    groups.sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
    return groups;
  }

  return {
    CONDITION_OPS,
    AGG_FUNCTIONS,
    conditionFieldKind,
    operatorsFor,
    parseNumericInput,
    evaluateCondition,
    aggregateValues,
    groupRows
  };
});
