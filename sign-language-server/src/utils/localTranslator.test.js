// backend/src/utils/localTranslator.ts
const phraseMap: Record<string, Record<string, string>> = {
  English: {
    hello: 'kumusta', hi: 'kumusta',
    good: 'maayo', morning: 'maayong buntag',
    goodmorning: 'maayong buntag', 'good morning': 'maayong buntag',
    thank: 'salamat', thanks: 'salamat', thankyou: 'salamat', 'thank you': 'salamat',
    you: 'ikaw', help: 'tabang', water: 'tubig', food: 'pagkaon', hungry: 'gutom',
    i: 'ako', am: 'ay', need: 'kinahanglan', please: 'palihog', sorry: 'pasaylo',
    stop: 'hunong', wait: 'hulat', come: 'ari', go: 'lakaw', yes: 'oo', no: 'dili',
    eat: 'kaon', drink: 'inom',
  },
  Tagalog: {
    hello: 'kumusta', hi: 'kumusta',
    thank: 'salamat', thanks: 'salamat', thankyou: 'salamat', 'thank you': 'salamat',
    help: 'tulong', water: 'tubig', food: 'pagkain', hungry: 'gutom',
    i: 'ako', am: 'ay', need: 'kailangan', please: 'paki', sorry: 'pasensya',
    stop: 'hinto', wait: 'hintay', come: 'halika', go: 'pumunta', yes: 'oo', no: 'hindi',
    eat: 'kumain', drink: 'uminom', good: 'mahusay', morning: 'umaga',
    goodmorning: 'magandang umaga', 'good morning': 'magandang umaga',
    'i am hungry': 'ako ay gutom',
  },
  Visaya: {
    hello: 'kumusta', thank: 'salamat', thanks: 'salamat', help: 'tabang',
    water: 'tubig', food: 'kaon', hungry: 'gutom', i: 'ako', am: 'ay',
    need: 'kinahanglan', sorry: 'pasaylo', stop: 'undang', wait: 'hulat',
    come: 'ari', go: 'lakaw', yes: 'oo', no: 'dili', eat: 'kaon', drink: 'inom',
    good: 'maayo', morning: 'buntag', goodmorning: 'maayong buntag',
    'good morning': 'maayong buntag', 'i am hungry': 'ako gutom',
  },
  Ilocano: {
    hello: 'kumusta', thank: 'agyaman', thanks: 'agyaman', help: 'tulong',
    water: 'danum', food: 'pagkain', hungry: 'gutom', i: 'ak', am: 'ti',
    need: 'masapul', sorry: 'dispensar', stop: 'sardeng', wait: 'uray',
    come: 'umay', go: 'pan', yes: 'wen', no: 'saan', eat: 'mangan', drink: 'inom',
    good: 'naimbag', morning: 'bigat', goodmorning: 'naimbag a bigat',
    'good morning': 'naimbag a bigat', 'i am hungry': 'ak ti gutom',
  },
  Bikolano: {
    hello: 'kumusta', thank: 'salamat', thanks: 'salamat', help: 'tabang',
    water: 'tubig', food: 'kakanon', hungry: 'gutom', i: 'ako', am: 'an',
    need: 'kailangan', sorry: 'pasensya na', stop: 'undok', wait: 'hulat',
    come: 'digdi', go: 'hali', yes: 'iyo', no: 'dai', eat: 'kakanon', drink: 'inom',
    good: 'marahay', morning: 'aga', goodmorning: 'marahay na aga',
    'good morning': 'marahay na aga', 'i am hungry': 'ako an gutom',
  },
};

// Max edit distance for fuzzy single-token fallback. Keep small — this is
// meant to catch typos/ASR mis-hears ("helo" -> "hello"), not to guess
// wildly at unrelated words.
const FUZZY_MAX_DISTANCE = 1;

function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:()\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Standard Levenshtein edit distance. Fine for single-word tokens (short
 * strings) — this is not called on full sentences.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[rows - 1][cols - 1];
}

/**
 * Finds the closest single-token key in the map within FUZZY_MAX_DISTANCE,
 * preferring exact length matches first (cheap early-out) before scanning.
 * Only used as a fallback when an exact lookup misses.
 */
function fuzzyLookup(token: string, map: Record<string, string>): string | null {
  if (token.length < 3) return null; // too short to fuzzy-match safely

  let bestKey: string | null = null;
  let bestDistance = FUZZY_MAX_DISTANCE + 1;

  for (const key of Object.keys(map)) {
    if (key.includes(' ')) continue; // fuzzy matching is single-token only
    if (Math.abs(key.length - token.length) > FUZZY_MAX_DISTANCE) continue;

    const distance = levenshtein(token, key);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestKey = key;
    }
  }

  return bestDistance <= FUZZY_MAX_DISTANCE ? bestKey : null;
}

function translateTokens(tokens: string[], targetMap: Record<string, string>): string[] {
  return tokens.map((token) => {
    if (targetMap[token]) return targetMap[token];
    const fuzzyKey = fuzzyLookup(token, targetMap);
    return fuzzyKey ? targetMap[fuzzyKey] : token;
  });
}

export function shouldUseOllamaFallback(text: string, sourceLanguage: string, targetLanguage: string): boolean {
  const target = (targetLanguage || 'Tagalog').trim();
  const normalized = normalizeText(text);

  if (!normalized) return false;

  const targetMap = phraseMap[target];
  if (!targetMap) return true;

  const direct = targetMap[normalized];
  if (direct) return false;

  const tokens = normalized.split(' ');
  const translatedTokens = translateTokens(tokens, targetMap);

  return translatedTokens.join(' ') === normalized;
}

export function fallbackTranslate(text: string, sourceLanguage: string, targetLanguage: string): string {
  const target = (targetLanguage || 'Tagalog').trim();
  const normalized = normalizeText(text);

  if (!normalized) return text;

  const targetMap = phraseMap[target];
  if (!targetMap) return text;

  const direct = targetMap[normalized];
  if (direct) return direct;

  const tokens = normalized.split(' ');
  const translatedTokens = translateTokens(tokens, targetMap);

  if (translatedTokens.join(' ') !== normalized) {
    return translatedTokens.join(' ').trim();
  }

  return text;
}