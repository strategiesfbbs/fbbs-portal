'use strict';

const TREASURY_TENORS = ['3MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'];
const MARKET_LABELS = [
  'DJIA FUTURES',
  'CRUDE FUTURE',
  'S&P 500',
  'NASDAQ',
  'EURO - USD',
  'GOLD',
  'DJIA',
  'SPX',
  'VIX'
];
const RATE_LABELS = [
  'Fed Funds Target - Lower Bound',
  'Fed Funds Target - Upper Bound',
  'Fed Funds Effective Rate',
  'Fed Funds Futures 1 Year',
  'Fed Funds Futures 3 Mo',
  'Discount Rate',
  'Prime Rate',
  'Ameribor',
  'SOFR'
];
const BOND_LABELS = [
  'Credit Default - IG Spread',
  'U.S. Avg 30 Year Mtge Rate'
];

function asNumber(value) {
  if (value === null || value === undefined) return null;
  const clean = String(value).replace(/,/g, '').replace(/%/g, '').trim();
  if (!clean || clean === '--') return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function normalizeLines(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function parseDate(text) {
  const explicit = String(text || '').match(/ECONOMIC UPDATE\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
  const first = explicit || String(text || '').match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
  if (!first) return null;
  const [m, d, y] = first[1].split('/').map(Number);
  if (!m || !d || !y) return first[1];
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseTrailingNumbers(rest) {
  const tokens = rest.split(' ');
  const values = [];
  while (tokens.length && /^-?\d[\d,]*(?:\.\d+)?%?$/.test(tokens[tokens.length - 1])) {
    values.unshift(tokens.pop());
  }
  return { prefix: tokens.join(' ').trim(), values };
}

function parseTreasuries(lines) {
  return lines.map(line => {
    const match = line.match(/^(3MO|6MO|1YR|2YR|3YR|5YR|7YR|10YR|20YR|30YR)\s+([0-9.]+)%\s+(-?[0-9.]+)\s+(-?[0-9.]+)/);
    if (!match) return null;
    return {
      tenor: match[1],
      label: match[1].replace('MO', 'M').replace('YR', 'Y'),
      yield: asNumber(match[2]),
      dailyChange: asNumber(match[3]),
      weeklyChange: asNumber(match[4])
    };
  }).filter(Boolean);
}

function parseLabelTable(lines, labels, { percent = false } = {}) {
  const rows = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    const label = labels.find(item => {
      const needle = item.toLowerCase();
      const idx = lower.indexOf(needle);
      return idx >= 0 && (idx === 0 || /\s/.test(line[idx - 1])) && /\s/.test(line[idx + item.length] || ' ');
    });
    if (!label) continue;
    const rest = line.slice(line.toLowerCase().indexOf(label.toLowerCase()) + label.length).trim();
    const { prefix, values } = parseTrailingNumbers(rest);
    if (!values.length) continue;
    rows.push({
      label,
      status: prefix || null,
      value: asNumber(values.length >= 3 ? values[0] : null),
      priorClose: asNumber(values.length >= 3 ? values[1] : values.length === 2 ? values[0] : null),
      change: asNumber(values.length >= 3 ? values[2] : values.length === 2 ? values[1] : values[0]),
      isPercent: percent || /rate|sofr|ameribor|funds|mortge/i.test(label)
    });
  }
  return rows;
}

function parseHeadlines(text) {
  const match = String(text || '').match(/TREASURY YIELD CURVE\s+([\s\S]*?)(?:The information set forth|-- 1 of 1 --)/i);
  if (!match) return [];
  return match[1]
    .split(/\n\s*\*\s+/)
    .map(item => item.replace(/^\*\s*/, '').replace(/\s+/g, ' ').trim())
    .filter(item => item.length > 40)
    .slice(0, 4);
}

function isDateTimeLine(line) {
  return /^(?:\d{2}\/\d{2}\/\d{2}\s+\d{1,2}:\d{2}\s+[AP]M|Last Week)$/i.test(line);
}

function splitInlineDateTime(line) {
  const match = String(line || '').match(/^(.*?)\s+(\d{2}\/\d{2}\/\d{2}\s+\d{1,2}:\d{2}\s+[AP]M)$/i);
  if (!match) return null;
  return { event: match[1].trim(), dateTime: match[2].trim() };
}

function isEconomicEventName(line) {
  if (!line || line.length < 5) return false;
  if (isDateTimeLine(line)) return false;
  if (/^(EVENT|DATE\/TIME|PERIOD|SURVEY|ACTUAL|PRIOR|Last Week|BOND INDICES)$/i.test(line)) return false;
  if (/^(ECONOMIC UPDATE|FUTURES AND VOLATILITY|MARKET RATES|TREASURY RATES MARKET DATA|TREASURY YIELD CURVE)$/i.test(line)) return false;
  if (/^(The information set forth|Investment products|Certificate of Deposit|First Bankers|lose value|Market information|Bloomberg .* Economic Survey)/i.test(line)) return false;
  if (/^\d/.test(line)) return false;
  if (/^[A-Z][a-z]{2}\s+(?:F\s+)?[-\d.]+%?(?:\s+--|\s+[-\d.]+%?)+$/.test(line)) return false;
  if (TREASURY_TENORS.some(t => line.startsWith(t + ' '))) return false;
  if ([...MARKET_LABELS, ...RATE_LABELS, ...BOND_LABELS].some(label => line.toLowerCase().startsWith(label.toLowerCase()))) return false;
  return true;
}

function parseEconomicEvents(lines) {
  const start = lines.findIndex(line => /^ECONOMIC RELEASES$/i.test(line));
  if (start < 0) return [];

  const section = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^TREASURY YIELD CURVE$/i.test(lines[i])) break;
    section.push(lines[i]);
  }

  const events = [];
  const pendingNames = [];
  const pendingDates = [];

  for (const line of section) {
    const inline = splitInlineDateTime(line);
    if (inline && isEconomicEventName(inline.event)) {
      events.push(inline);
      continue;
    }
    if (isDateTimeLine(line)) {
      pendingDates.push(line);
      continue;
    }
    if (isEconomicEventName(line)) pendingNames.push(line);
  }

  pendingNames.forEach((event, index) => {
    events.push({ event, dateTime: pendingDates[index] || null });
  });

  return events.slice(0, 16);
}

function buildSalesCues(treasuries, marketRates, marketData) {
  const cues = [];
  const two = treasuries.find(row => row.tenor === '2YR');
  const ten = treasuries.find(row => row.tenor === '10YR');
  const thirty = treasuries.find(row => row.tenor === '30YR');
  const sofr = marketRates.find(row => row.label === 'SOFR');
  const prime = marketRates.find(row => row.label === 'Prime Rate');
  const vix = marketData.find(row => row.label === 'VIX');

  if (two && ten) {
    const slope = ten.yield - two.yield;
    cues.push({
      title: slope >= 0 ? 'Curve is positively sloped' : 'Front end remains above 10Y',
      body: `2Y is ${two.yield.toFixed(3)}% and 10Y is ${ten.yield.toFixed(3)}%, putting the 2s/10s slope at ${slope.toFixed(3)}%.`
    });
  }
  if (ten && thirty) {
    cues.push({
      title: 'Long-end reference point',
      body: `10Y is ${ten.yield.toFixed(3)}% and 30Y is ${thirty.yield.toFixed(3)}%, useful for duration and extension conversations.`
    });
  }
  if (sofr || prime) {
    const sofrValue = sofr ? (sofr.value ?? sofr.priorClose) : null;
    const primeValue = prime ? (prime.value ?? prime.priorClose) : null;
    cues.push({
      title: 'Funding backdrop',
      body: [sofr ? `SOFR ${sofr.change >= 0 ? 'up' : 'down'} ${Math.abs(sofr.change).toFixed(3)} to ${sofrValue}%` : null, prime ? `Prime at ${primeValue}%` : null]
        .filter(Boolean)
        .join('; ') + '.'
    });
  }
  if (vix) {
    cues.push({
      title: 'Volatility watch',
      body: `VIX is ${vix.value ?? vix.priorClose} with a ${vix.change >= 0 ? '+' : ''}${vix.change} move, a quick read on risk tone.`
    });
  }
  return cues.slice(0, 4);
}

function parseEconomicUpdateText(text, options = {}) {
  const lines = normalizeLines(text);
  const asOfDate = parseDate(text) || options.asOfDate || null;
  const treasuries = parseTreasuries(lines);
  const marketData = parseLabelTable(lines, MARKET_LABELS);
  const marketRates = parseLabelTable(lines, RATE_LABELS, { percent: true });
  const bondIndices = parseLabelTable(lines, BOND_LABELS);
  const headlines = parseHeadlines(text);
  const releases = parseEconomicEvents(lines);
  const salesCues = buildSalesCues(treasuries, marketRates, marketData);

  return {
    asOfDate,
    extractedAt: new Date().toISOString(),
    sourceFile: options.sourceFile || null,
    treasuries,
    marketRates,
    marketData,
    bondIndices,
    headlines,
    releases,
    salesCues,
    warnings: [
      treasuries.length ? null : 'No Treasury rate rows were extracted.',
      headlines.length ? null : 'No headline highlights were extracted.'
    ].filter(Boolean)
  };
}

module.exports = { parseEconomicUpdateText };
