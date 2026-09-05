import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PAGE_URL = 'https://www.base.org/ecosystem';
const OUTPUT_DIRECTORY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'research',
);
const REQUEST_TIMEOUT_MS = 60_000;
const FETCH_CONCURRENCY = 8;

const SIGNALS = [
  ['working capital', 14],
  ['trade finance', 14],
  ['supply chain finance', 14],
  ['commodity', 12],
  ['commodities', 12],
  ['agriculture', 12],
  ['agricultural', 12],
  ['agribusiness', 12],
  ['farmer', 10],
  ['farmers', 10],
  ['coffee', 10],
  ['grain', 10],
  ['inventory finance', 10],
  ['invoice finance', 10],
  ['receivables', 9],
  ['factoring', 9],
  ['credit', 7],
  ['lending', 7],
  ['loans', 7],
  ['loan', 7],
  ['borrower', 7],
  ['foreign exchange', 7],
  ['local currency', 7],
  ['currency', 4],
  ['hedging', 7],
  ['hedge', 7],
  ['stablecoin', 4],
  ['stablecoins', 4],
  ['usdc', 4],
];

const GROUPS = {
  commodity: [
    'commodity',
    'commodities',
    'agriculture',
    'agricultural',
    'agribusiness',
    'farmer',
    'farmers',
    'coffee',
    'grain',
  ],
  credit: [
    'working capital',
    'trade finance',
    'supply chain finance',
    'inventory finance',
    'invoice finance',
    'receivables',
    'factoring',
    'credit',
    'lending',
    'loans',
    'loan',
    'borrower',
  ],
  currency: [
    'foreign exchange',
    'local currency',
    'currency',
    'hedging',
    'hedge',
    'stablecoin',
    'stablecoins',
    'usdc',
  ],
};

const REAL_ECONOMY_SIGNALS = [
  'real business',
  'real businesses',
  'real-world asset',
  'real-world assets',
  'real world asset',
  'real world assets',
  'private credit',
  'working capital',
  'trade finance',
  'supply chain finance',
  'inventory finance',
  'invoice finance',
  'receivables',
  'factoring',
  'commodity',
  'commodities',
  'agriculture',
  'agricultural',
  'agribusiness',
  'farmer',
  'farmers',
  'coffee',
  'grain',
];

function findScriptUrls(html) {
  const urls = new Set();
  const scriptPattern = /<script[^>]+src="([^"]+\.js[^"]*)"/g;

  for (const match of html.matchAll(scriptPattern)) {
    urls.add(new URL(match[1].replaceAll('&amp;', '&'), PAGE_URL).href);
  }

  return [...urls];
}

function findAdvertisedCount(html) {
  const match = html.match(/Explore\s+(\d+\+?)\s+companies building faster on Base/i);
  return match?.[1] ?? null;
}

function readQuotedLiteral(source, quoteIndex) {
  const quote = source[quoteIndex];
  if (quote !== "'" && quote !== '"') return null;

  let escaped = false;
  for (let index = quoteIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === quote) {
      return {
        raw: source.slice(quoteIndex + 1, index),
        endIndex: index,
      };
    }
  }

  return null;
}

function decodeJavaScriptString(raw) {
  let decoded = '';

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character !== '\\') {
      decoded += character;
      continue;
    }

    index += 1;
    if (index >= raw.length) throw new Error('Unterminated string escape');
    const escape = raw[index];

    const simpleEscapes = {
      "'": "'",
      '"': '"',
      '\\': '\\',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      0: '\0',
    };

    if (Object.hasOwn(simpleEscapes, escape)) {
      decoded += simpleEscapes[escape];
      continue;
    }

    if (escape === '\n') continue;
    if (escape === '\r') {
      if (raw[index + 1] === '\n') index += 1;
      continue;
    }

    if (escape === 'x') {
      const hexadecimal = raw.slice(index + 1, index + 3);
      if (!/^[0-9a-f]{2}$/i.test(hexadecimal)) {
        throw new Error('Invalid hexadecimal string escape');
      }
      decoded += String.fromCharCode(Number.parseInt(hexadecimal, 16));
      index += 2;
      continue;
    }

    if (escape === 'u') {
      if (raw[index + 1] === '{') {
        const closingBrace = raw.indexOf('}', index + 2);
        const hexadecimal = raw.slice(index + 2, closingBrace);
        if (closingBrace === -1 || !/^[0-9a-f]+$/i.test(hexadecimal)) {
          throw new Error('Invalid Unicode code-point escape');
        }
        decoded += String.fromCodePoint(Number.parseInt(hexadecimal, 16));
        index = closingBrace;
        continue;
      }

      const hexadecimal = raw.slice(index + 1, index + 5);
      if (!/^[0-9a-f]{4}$/i.test(hexadecimal)) {
        throw new Error('Invalid Unicode string escape');
      }
      decoded += String.fromCharCode(Number.parseInt(hexadecimal, 16));
      index += 4;
      continue;
    }

    decoded += escape;
  }

  return decoded;
}

function extractDirectory(bundleSource) {
  const marker = 'JSON.parse(';
  let searchFrom = 0;

  while (searchFrom < bundleSource.length) {
    const markerIndex = bundleSource.indexOf(marker, searchFrom);
    if (markerIndex === -1) break;

    const quoteIndex = markerIndex + marker.length;
    const literal = readQuotedLiteral(bundleSource, quoteIndex);
    searchFrom = literal ? literal.endIndex + 1 : quoteIndex + 1;
    if (!literal) continue;

    try {
      const candidate = JSON.parse(decodeJavaScriptString(literal.raw));
      if (
        Array.isArray(candidate) &&
        candidate.length >= 100 &&
        candidate.every(
          (entry) =>
            entry &&
            typeof entry === 'object' &&
            typeof entry.name === 'string' &&
            typeof entry.category === 'string',
        )
      ) {
        return candidate;
      }
    } catch {
      // Most JSON.parse calls in application bundles are unrelated to the directory.
    }
  }

  return null;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/javascript;q=0.9,*/*;q=0.8',
      'user-agent': 'BaseBatchesResearchIndexer/1.0',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }

  return response.text();
}

async function findDirectoryBundle(scriptUrls) {
  let nextIndex = 0;
  let result = null;
  const failures = [];

  async function worker() {
    while (!result) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= scriptUrls.length) return;

      const url = scriptUrls[index];
      try {
        const source = await fetchText(url);
        const records = extractDirectory(source);
        if (records && !result) result = { url, records };
      } catch (error) {
        failures.push({ url, error: error.message });
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(FETCH_CONCURRENCY, scriptUrls.length) },
      () => worker(),
    ),
  );

  if (!result) {
    const detail = failures
      .slice(0, 5)
      .map(({ url, error }) => `${url}: ${error}`)
      .join('\n');
    throw new Error(
      `No ecosystem directory found across ${scriptUrls.length} bundles.${
        detail ? `\n${detail}` : ''
      }`,
    );
  }

  return result;
}

function containsSignal(text, signal) {
  const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

function scoreRecord(record) {
  const text = [
    record.name,
    record.description,
    record.category,
    record.subcategory,
  ]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  const matches = SIGNALS.filter(([signal]) => containsSignal(text, signal)).map(
    ([signal]) => signal,
  );
  let score = SIGNALS.reduce(
    (total, [signal, weight]) =>
      total + (matches.includes(signal) ? weight : 0),
    0,
  );

  const groups = Object.fromEntries(
    Object.entries(GROUPS).map(([name, signals]) => [
      name,
      signals.some((signal) => matches.includes(signal)),
    ]),
  );

  if (groups.commodity && groups.credit) score += 25;
  if (groups.credit && groups.currency) score += 12;
  if (groups.commodity && groups.credit && groups.currency) score += 25;

  const category = `${record.category ?? ''} / ${record.subcategory ?? ''}`;
  if (/gaming|dex aggregator|\/ dex$/i.test(category)) score -= 20;
  if (/perpetual|futures|yield farming/i.test(text)) score -= 20;

  score = Math.max(0, score);

  const realEconomyMatches = REAL_ECONOMY_SIGNALS.filter((signal) =>
    containsSignal(text, signal),
  );
  const strictCandidate = groups.credit && realEconomyMatches.length > 0;

  return {
    score,
    matches,
    groups,
    text,
    realEconomyMatches,
    strictCandidate,
  };
}

function normalizeRecords(records) {
  return records
    .map((record, sourceIndex) => {
      const {
        score,
        matches,
        groups,
        text,
        realEconomyMatches,
        strictCandidate,
      } = scoreRecord(record);
      const knownKeys = new Set([
        'name',
        'url',
        'description',
        'imageUrl',
        'category',
        'subcategory',
      ]);
      const metadata = Object.fromEntries(
        Object.entries(record).filter(([key]) => !knownKeys.has(key)),
      );

      return {
        sourceIndex,
        name: record.name.trim(),
        url: typeof record.url === 'string' ? record.url : null,
        description:
          typeof record.description === 'string' ? record.description.trim() : '',
        imageUrl:
          typeof record.imageUrl === 'string' ? record.imageUrl : null,
        category: record.category,
        subcategory:
          typeof record.subcategory === 'string' ? record.subcategory : null,
        metadata,
        searchText: text,
        icpScore: score,
        icpMatches: matches,
        icpGroups: groups,
        realEconomyMatches,
        strictIcpCandidate: strictCandidate,
      };
    })
    .sort((left, right) =>
      left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }),
    );
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function renderCsv(records) {
  const columns = [
    'name',
    'url',
    'category',
    'subcategory',
    'description',
    'icpScore',
    'icpMatches',
  ];
  const rows = records.map((record) =>
    [
      record.name,
      record.url,
      record.category,
      record.subcategory,
      record.description,
      record.icpScore,
      record.icpMatches.join('; '),
    ]
      .map(csvCell)
      .join(','),
  );

  return `${columns.map(csvCell).join(',')}\n${rows.join('\n')}\n`;
}

function escapeMarkdown(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ')
    .trim();
}

function renderIcpReport(snapshot) {
  const strictCandidates = snapshot.records
    .filter((record) => record.strictIcpCandidate)
    .sort(
      (left, right) =>
        right.icpScore - left.icpScore || left.name.localeCompare(right.name),
    );
  const ranked = snapshot.records
    .filter((record) => record.icpScore > 0)
    .sort(
      (left, right) =>
        right.icpScore - left.icpScore || left.name.localeCompare(right.name),
    );
  const top = ranked.slice(0, 100);
  const strictRows = strictCandidates.map((record, index) => {
    const name = record.url
      ? `[${escapeMarkdown(record.name)}](${record.url})`
      : escapeMarkdown(record.name);
    return `| ${index + 1} | ${name} | ${escapeMarkdown(
      record.category,
    )} / ${escapeMarkdown(record.subcategory)} | ${escapeMarkdown(
      [...record.icpMatches, ...record.realEconomyMatches].join(', '),
    )} | ${escapeMarkdown(record.description)} |`;
  });
  const tableRows = top.map((record, index) => {
    const name = record.url
      ? `[${escapeMarkdown(record.name)}](${record.url})`
      : escapeMarkdown(record.name);
    return `| ${index + 1} | ${name} | ${record.icpScore} | ${escapeMarkdown(
      record.category,
    )} / ${escapeMarkdown(record.subcategory)} | ${escapeMarkdown(
      record.icpMatches.join(', '),
    )} | ${escapeMarkdown(record.description)} |`;
  });

  return `# Base Ecosystem ICP Discovery Index

**Generated:** ${snapshot.fetchedAt}  
**Official directory:** [Base Ecosystem](${snapshot.source.pageUrl})  
**Directory headline:** ${snapshot.source.advertisedCount ?? 'Not detected'} companies  
**Indexed records:** ${snapshot.count}  
**Strict real-economy credit candidates:** ${strictCandidates.length}  
**Records with at least one ICP keyword:** ${ranked.length}

## Important boundary

This is a discovery index, not a credibility, liveness, or design-partner ranking. Base states that directory entries are independent third parties and that inclusion is not an endorsement. Every candidate must still pass manual checks for current operations, team identity, facility structure, commodity exposure, material currency mismatch, and control ownership.

The directory headline and extracted record count are reported separately. On this run, the current public bundle contained ${snapshot.count} unique structured listings; the broader headline must not be interpreted as the number of crawlable directory records.

## Scoring method

The strict screen requires both a credit signal and a real-economy signal in the directory text. The broader deterministic screen searches the directory's name, description, category, and subcategory for commodity, agricultural, working-capital, trade-finance, credit, FX, and stablecoin signals. It adds combination bonuses when commodity and credit terms occur together and when credit and currency terms occur together. Scores rank records for manual reading only.

## Strict real-economy credit screen

| # | Directory entry | Category | Matched evidence | Directory description |
|---:|---|---|---|---|
${strictRows.join('\n') || '| — | No strict matches | — | — | — |'}

## Broader keyword discovery set

| Rank | Directory entry | Score | Category | Matched signals | Directory description |
|---:|---|---:|---|---|---|
${tableRows.join('\n')}
`;
}

function summarizeCategories(records) {
  const counts = {};
  for (const record of records) {
    const key = `${record.category} / ${record.subcategory ?? 'uncategorized'}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function main() {
  console.log(`Fetching ${PAGE_URL}`);
  const html = await fetchText(PAGE_URL);
  const advertisedCount = findAdvertisedCount(html);
  const scriptUrls = findScriptUrls(html);
  if (scriptUrls.length === 0) {
    throw new Error('The Base ecosystem page did not expose any JavaScript bundles');
  }

  console.log(`Inspecting ${scriptUrls.length} public JavaScript bundles`);
  const directory = await findDirectoryBundle(scriptUrls);
  const records = normalizeRecords(directory.records);
  const fetchedAt = new Date().toISOString();
  const snapshot = {
    fetchedAt,
    count: records.length,
    source: {
      pageUrl: PAGE_URL,
      bundleUrl: directory.url,
      advertisedCount,
      method:
        'Structured directory array extracted from a JSON.parse payload in the public Base ecosystem page bundle',
      endorsementBoundary:
        'Base states that listed third-party protocols are independent and that directory inclusion is not an endorsement.',
    },
    categoryCounts: summarizeCategories(records),
    records,
  };

  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  await Promise.all([
    writeFile(
      resolve(OUTPUT_DIRECTORY, 'base-ecosystem.json'),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    ),
    writeFile(
      resolve(OUTPUT_DIRECTORY, 'base-ecosystem.csv'),
      renderCsv(records),
    ),
    writeFile(
      resolve(OUTPUT_DIRECTORY, 'base-ecosystem-icp.md'),
      renderIcpReport(snapshot),
    ),
  ]);

  const matched = records.filter((record) => record.icpScore > 0).length;
  console.log(
    `Indexed ${records.length} records (${matched} keyword matches) from ${directory.url}`,
  );
  console.log(`Wrote outputs to ${OUTPUT_DIRECTORY}`);
}

export {
  decodeJavaScriptString,
  extractDirectory,
  findAdvertisedCount,
  findScriptUrls,
  normalizeRecords,
  renderCsv,
  renderIcpReport,
};

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
