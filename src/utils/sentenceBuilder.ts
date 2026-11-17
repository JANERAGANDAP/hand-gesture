export class FrameBuffer {
  private frames: any[] = [];
  private readonly capacity: number;
  constructor(capacity: number = 20) {
    this.capacity = capacity;
  }
  push(features: any) {
    this.frames.push(features);
    if (this.frames.length > this.capacity) {
      this.frames.shift();
    }
  }
  snapshot(): any[] {
    return [...this.frames];
  }
  get length(): number {
    return this.frames.length;
  }
  clear() {
    this.frames = [];
  }
}

// ---------------------------------------------------------------------------
// Smart Sentence Builder — composes natural sentences from sign word tokens
// without requiring any external AI/API. Works 100% offline.
// ---------------------------------------------------------------------------

type WordRole = "subject" | "verb" | "object" | "adjective" | "greeting" | "interjection" | "question" | "negation" | "other";

interface WordInfo {
  role: WordRole;
  baseForm: string;       // canonical English form
  verbForm?: string;      // "am/is/are going" etc.
}

// Canonical word registry — maps lowercase input → metadata
const WORD_REGISTRY: Record<string, WordInfo> = {
  // ── Subjects / Pronouns ──
  i:       { role: "subject", baseForm: "I" },
  me:      { role: "subject", baseForm: "I" },
  you:     { role: "subject", baseForm: "you" },
  he:      { role: "subject", baseForm: "he" },
  she:     { role: "subject", baseForm: "she" },
  we:      { role: "subject", baseForm: "we" },
  they:    { role: "subject", baseForm: "they" },
  it:      { role: "subject", baseForm: "it" },

  // ── Verbs ──
  am:      { role: "verb", baseForm: "am", verbForm: "am" },
  is:      { role: "verb", baseForm: "is", verbForm: "is" },
  are:     { role: "verb", baseForm: "are", verbForm: "are" },
  need:    { role: "verb", baseForm: "need", verbForm: "need" },
  want:    { role: "verb", baseForm: "want", verbForm: "want" },
  go:      { role: "verb", baseForm: "go", verbForm: "go" },
  eat:     { role: "verb", baseForm: "eat", verbForm: "eat" },
  drink:   { role: "verb", baseForm: "drink", verbForm: "drink" },
  come:    { role: "verb", baseForm: "come", verbForm: "come" },
  stop:    { role: "verb", baseForm: "stop", verbForm: "stop" },
  wait:    { role: "verb", baseForm: "wait", verbForm: "wait" },
  help:    { role: "verb", baseForm: "help", verbForm: "help" },
  like:    { role: "verb", baseForm: "like", verbForm: "like" },
  love:    { role: "verb", baseForm: "love", verbForm: "love" },
  know:    { role: "verb", baseForm: "know", verbForm: "know" },
  see:     { role: "verb", baseForm: "see", verbForm: "see" },
  have:    { role: "verb", baseForm: "have", verbForm: "have" },
  give:    { role: "verb", baseForm: "give", verbForm: "give" },
  take:    { role: "verb", baseForm: "take", verbForm: "take" },
  learn:   { role: "verb", baseForm: "learn", verbForm: "learn" },
  teach:   { role: "verb", baseForm: "teach", verbForm: "teach" },
  play:    { role: "verb", baseForm: "play", verbForm: "play" },
  work:    { role: "verb", baseForm: "work", verbForm: "work" },
  study:   { role: "verb", baseForm: "study", verbForm: "study" },
  sleep:   { role: "verb", baseForm: "sleep", verbForm: "sleep" },
  read:    { role: "verb", baseForm: "read", verbForm: "read" },
  write:   { role: "verb", baseForm: "write", verbForm: "write" },
  talk:    { role: "verb", baseForm: "talk", verbForm: "talk" },
  walk:    { role: "verb", baseForm: "walk", verbForm: "walk" },
  run:     { role: "verb", baseForm: "run", verbForm: "run" },
  feel:    { role: "verb", baseForm: "feel", verbForm: "feel" },
  understand: { role: "verb", baseForm: "understand", verbForm: "understand" },

  // ── Adjectives / States ──
  hungry:  { role: "adjective", baseForm: "hungry" },
  thirsty: { role: "adjective", baseForm: "thirsty" },
  tired:   { role: "adjective", baseForm: "tired" },
  sick:    { role: "adjective", baseForm: "sick" },
  happy:   { role: "adjective", baseForm: "happy" },
  sad:     { role: "adjective", baseForm: "sad" },
  angry:   { role: "adjective", baseForm: "angry" },
  scared:  { role: "adjective", baseForm: "scared" },
  hot:     { role: "adjective", baseForm: "hot" },
  cold:    { role: "adjective", baseForm: "cold" },
  good:    { role: "adjective", baseForm: "good" },
  bad:     { role: "adjective", baseForm: "bad" },
  big:     { role: "adjective", baseForm: "big" },
  small:   { role: "adjective", baseForm: "small" },
  black:   { role: "adjective", baseForm: "black" },
  white:   { role: "adjective", baseForm: "white" },
  red:     { role: "adjective", baseForm: "red" },
  blue:    { role: "adjective", baseForm: "blue" },
  green:   { role: "adjective", baseForm: "green" },
  yellow:  { role: "adjective", baseForm: "yellow" },
  deaf:    { role: "adjective", baseForm: "deaf" },
  mute:    { role: "adjective", baseForm: "mute" },
  beautiful: { role: "adjective", baseForm: "beautiful" },
  late:    { role: "adjective", baseForm: "late" },
  early:   { role: "adjective", baseForm: "early" },
  ready:   { role: "adjective", baseForm: "ready" },
  okay:    { role: "adjective", baseForm: "okay" },
  ok:      { role: "adjective", baseForm: "okay" },
  fine:    { role: "adjective", baseForm: "fine" },
  busy:    { role: "adjective", baseForm: "busy" },
  bored:   { role: "adjective", baseForm: "bored" },
  lost:    { role: "adjective", baseForm: "lost" },

  // ── Objects / Nouns ──
  water:   { role: "object", baseForm: "water" },
  food:    { role: "object", baseForm: "food" },
  school:  { role: "object", baseForm: "school" },
  home:    { role: "object", baseForm: "home" },
  house:   { role: "object", baseForm: "house" },
  hospital: { role: "object", baseForm: "hospital" },
  bathroom: { role: "object", baseForm: "bathroom" },
  restroom: { role: "object", baseForm: "restroom" },
  toilet:  { role: "object", baseForm: "toilet" },
  doctor:  { role: "object", baseForm: "a doctor" },
  medicine: { role: "object", baseForm: "medicine" },
  money:   { role: "object", baseForm: "money" },
  phone:   { role: "object", baseForm: "phone" },
  book:    { role: "object", baseForm: "book" },
  teacher: { role: "object", baseForm: "teacher" },
  friend:  { role: "object", baseForm: "friend" },
  family:  { role: "object", baseForm: "family" },
  name:    { role: "object", baseForm: "name" },
  time:    { role: "object", baseForm: "time" },
  morning: { role: "object", baseForm: "morning" },
  afternoon: { role: "object", baseForm: "afternoon" },
  evening: { role: "object", baseForm: "evening" },
  today:   { role: "other", baseForm: "today" },
  tomorrow: { role: "other", baseForm: "tomorrow" },
  yesterday: { role: "other", baseForm: "yesterday" },

  // ── Greetings ──
  hello:   { role: "greeting", baseForm: "Hello" },
  hi:      { role: "greeting", baseForm: "Hi" },
  bye:     { role: "greeting", baseForm: "Goodbye" },
  goodbye: { role: "greeting", baseForm: "Goodbye" },
  "good morning": { role: "greeting", baseForm: "Good morning" },
  "good afternoon": { role: "greeting", baseForm: "Good afternoon" },
  "good evening": { role: "greeting", baseForm: "Good evening" },
  "good night":  { role: "greeting", baseForm: "Good night" },

  // ── Affirmation / Negation ──
  yes:     { role: "interjection", baseForm: "Yes" },
  no:      { role: "negation", baseForm: "No" },
  not:     { role: "negation", baseForm: "not" },
  dont:    { role: "negation", baseForm: "don't" },
  "don't": { role: "negation", baseForm: "don't" },

  // ── Politeness ──
  please:  { role: "other", baseForm: "please" },
  sorry:   { role: "interjection", baseForm: "I'm sorry" },
  thanks:  { role: "interjection", baseForm: "Thank you" },
  thank:   { role: "interjection", baseForm: "Thank you" },
  "thank you": { role: "interjection", baseForm: "Thank you" },

  // ── Question words ──
  what:    { role: "question", baseForm: "What" },
  where:   { role: "question", baseForm: "Where" },
  when:    { role: "question", baseForm: "When" },
  who:     { role: "question", baseForm: "Who" },
  why:     { role: "question", baseForm: "Why" },
  how:     { role: "question", baseForm: "How" },

  // ── Direction/Location ──
  here:    { role: "other", baseForm: "here" },
  there:   { role: "other", baseForm: "there" },
  left:    { role: "other", baseForm: "left" },
  right:   { role: "other", baseForm: "right" },
  up:      { role: "other", baseForm: "up" },
  down:    { role: "other", baseForm: "down" },

  // ── Filipino / Tagalog FSL Word Aliases ──
  ako:     { role: "subject", baseForm: "I" },
  ikaw:    { role: "subject", baseForm: "you" },
  siya:    { role: "subject", baseForm: "he" },
  kami:    { role: "subject", baseForm: "we" },
  sila:    { role: "subject", baseForm: "they" },
  gutom:   { role: "adjective", baseForm: "hungry" },
  uhaw:    { role: "adjective", baseForm: "thirsty" },
  pagod:   { role: "adjective", baseForm: "tired" },
  may_sakit: { role: "adjective", baseForm: "sick" },
  itim:    { role: "adjective", baseForm: "black" },
  puti:    { role: "adjective", baseForm: "white" },
  pula:    { role: "adjective", baseForm: "red" },
  tubig:   { role: "object", baseForm: "water" },
  pagkain: { role: "object", baseForm: "food" },
  kain:    { role: "verb", baseForm: "eat", verbForm: "eat" },
  inom:    { role: "verb", baseForm: "drink", verbForm: "drink" },
  tulong:  { role: "verb", baseForm: "help", verbForm: "help" },
  salamat: { role: "interjection", baseForm: "Thank you" },
  kumusta: { role: "greeting", baseForm: "Hello" },
  oo:      { role: "interjection", baseForm: "Yes" },
  hindi:   { role: "negation", baseForm: "No" },
  pakiusap: { role: "other", baseForm: "please" },
  patawad: { role: "interjection", baseForm: "I'm sorry" },
  saan:    { role: "question", baseForm: "Where" },
  ano:     { role: "question", baseForm: "What" },
  kailan:  { role: "question", baseForm: "When" },
  banyo:   { role: "object", baseForm: "bathroom" },
  "magandang umaga": { role: "greeting", baseForm: "Good morning" },
  "magandang hapon": { role: "greeting", baseForm: "Good afternoon" },
  "magandang gabi":  { role: "greeting", baseForm: "Good evening" },

  // ── Cebuano / Bisaya FSL Gloss Aliases ──
  // Pronouns
  ko:      { role: "subject", baseForm: "I" },
  ka:      { role: "subject", baseForm: "you" },
  siya_ceb:{ role: "subject", baseForm: "he" },
  mi:      { role: "subject", baseForm: "we" },
  mo:      { role: "subject", baseForm: "you" },
  sila_ceb:{ role: "subject", baseForm: "they" },

  // Verbs (Cebuano)
  kaon:    { role: "verb", baseForm: "eat", verbForm: "eat" },
  paniudto: { role: "verb", baseForm: "eat lunch", verbForm: "eat lunch" },
  panihapon: { role: "verb", baseForm: "eat dinner", verbForm: "eat dinner" },
  pamahaw: { role: "verb", baseForm: "eat breakfast", verbForm: "eat breakfast" },
  inom_ceb:{ role: "verb", baseForm: "drink", verbForm: "drink" },
  adto:    { role: "verb", baseForm: "go", verbForm: "go" },
  moadto:  { role: "verb", baseForm: "go", verbForm: "go" },
  tabang:  { role: "verb", baseForm: "help", verbForm: "help" },
  sulti:   { role: "verb", baseForm: "talk", verbForm: "talk" },
  tan_aw:  { role: "verb", baseForm: "look", verbForm: "look" },
  basa:    { role: "verb", baseForm: "read", verbForm: "read" },
  tuon:    { role: "verb", baseForm: "study", verbForm: "study" },
  trabaho: { role: "verb", baseForm: "work", verbForm: "work" },
  dula:    { role: "verb", baseForm: "play", verbForm: "play" },
  hinay:   { role: "verb", baseForm: "slow down", verbForm: "slow down" },
  hunong:  { role: "verb", baseForm: "stop", verbForm: "stop" },
  hatod:   { role: "verb", baseForm: "bring", verbForm: "bring" },
  palita:  { role: "verb", baseForm: "buy", verbForm: "buy" },

  // Adjectives (Cebuano)
  gigutom: { role: "adjective", baseForm: "hungry" },
  giuhaw:  { role: "adjective", baseForm: "thirsty" },
  kapoy:   { role: "adjective", baseForm: "tired" },
  masakiton: { role: "adjective", baseForm: "sick" },
  busog:   { role: "adjective", baseForm: "full" },
  buotan:  { role: "adjective", baseForm: "good" },
  daotan:  { role: "adjective", baseForm: "bad" },
  gwapa:   { role: "adjective", baseForm: "beautiful" },
  guwapo:  { role: "adjective", baseForm: "handsome" },
  dagko:   { role: "adjective", baseForm: "big" },
  gamay:   { role: "adjective", baseForm: "small" },
  init:    { role: "adjective", baseForm: "hot" },
  bugnaw:  { role: "adjective", baseForm: "cold" },
  sayo:    { role: "adjective", baseForm: "early" },
  ulahi:   { role: "adjective", baseForm: "late" },
  andam:   { role: "adjective", baseForm: "ready" },
  okey:    { role: "adjective", baseForm: "okay" },
  maayo:   { role: "adjective", baseForm: "good" },
  dili_maayo: { role: "adjective", baseForm: "not well" },

  // Nouns / Objects (Cebuano)
  tubig_ceb: { role: "object", baseForm: "water" },
  pagkaon: { role: "object", baseForm: "food" },
  sud_an:  { role: "object", baseForm: "food" },
  kwarta:  { role: "object", baseForm: "money" },
  balay:   { role: "object", baseForm: "house" },
  eskwelahan: { role: "object", baseForm: "school" },
  ospital: { role: "object", baseForm: "hospital" },
  cr:      { role: "object", baseForm: "comfort room" },
  comfort_room: { role: "object", baseForm: "comfort room" },
  doktor:  { role: "object", baseForm: "a doctor" },
  tambal:  { role: "object", baseForm: "medicine" },
  telepono: { role: "object", baseForm: "phone" },
  libro:   { role: "object", baseForm: "book" },
  maestra: { role: "object", baseForm: "teacher" },
  maestro: { role: "object", baseForm: "teacher" },
  amigo:   { role: "object", baseForm: "friend" },
  pamilya: { role: "object", baseForm: "family" },
  ngalan:  { role: "object", baseForm: "name" },
  breakfast: { role: "object", baseForm: "breakfast" },
  lunch:   { role: "object", baseForm: "lunch" },
  dinner:  { role: "object", baseForm: "dinner" },
  almusal: { role: "object", baseForm: "breakfast" },
  paniudto_n: { role: "object", baseForm: "lunch" },

  // Time adverbs / Temporal (Cebuano)
  karon:   { role: "other", baseForm: "now" },
  karon_adlaw: { role: "other", baseForm: "today" },
  ugma:    { role: "other", baseForm: "tomorrow" },
  gahapon: { role: "other", baseForm: "yesterday" },
  ganina:  { role: "other", baseForm: "earlier" },
  hapon:   { role: "other", baseForm: "this afternoon" },
  gabii:   { role: "other", baseForm: "tonight" },
  buntag:  { role: "other", baseForm: "this morning" },

  // Greetings (Cebuano)
  kumusta_ceb: { role: "greeting", baseForm: "Hello" },
  maayong_buntag: { role: "greeting", baseForm: "Good morning" },
  maayong_hapon:  { role: "greeting", baseForm: "Good afternoon" },
  maayong_gabii:  { role: "greeting", baseForm: "Good evening" },
  amping:  { role: "greeting", baseForm: "Take care" },

  // Affirmation / Negation (Cebuano)
  oo_ceb:  { role: "interjection", baseForm: "Yes" },
  dili:    { role: "negation", baseForm: "No" },
  wala:    { role: "negation", baseForm: "No" },

  // Politeness (Cebuano)
  salamat_ceb: { role: "interjection", baseForm: "Thank you" },
  pasensya: { role: "interjection", baseForm: "I'm sorry" },
  palihug:  { role: "other", baseForm: "please" },

  // Question words (Cebuano)
  asa:     { role: "question", baseForm: "Where" },
  unsa:    { role: "question", baseForm: "What" },
  kanus_a: { role: "question", baseForm: "When" },
  kinsa:   { role: "question", baseForm: "Who" },
  nganong: { role: "question", baseForm: "Why" },
  pila:    { role: "question", baseForm: "How much" },
  unsaon:  { role: "question", baseForm: "How" },
};

// Get verb "to be" form for a subject
function getToBeVerb(subject: string): string {
  const lc = subject.toLowerCase();
  if (lc === "i") return "am";
  if (lc === "you" || lc === "we" || lc === "they") return "are";
  return "is"; // he, she, it, and all nouns
}

// Capitalize first letter
function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Determine punctuation based on content
function inferPunctuation(tokens: string[]): string {
  const hasQuestion = tokens.some(t => WORD_REGISTRY[t.toLowerCase()]?.role === "question");
  return hasQuestion ? "?" : ".";
}

// Remove consecutive duplicate words
function deduplicateWords(tokens: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i === 0 || tokens[i].toLowerCase() !== tokens[i - 1].toLowerCase()) {
      result.push(tokens[i]);
    }
  }
  return result;
}

/**
 * Compose a natural English sentence from an array of sign word tokens.
 *
 * Rules:
 * 1. Standalone greetings / interjections → return as-is with punctuation.
 * 2. Subject + adjective → "I am hungry."
 * 3. Subject + verb + object → "I need water." / "I want to eat."
 * 4. Question word + (subject) + verb/noun → "Where is the bathroom?"
 * 5. Negation + verb → "I don't understand."
 * 6. Unknown words → keep them, join naturally.
 */
export function buildSmartSentence(rawTokens: string[]): string {
  if (!rawTokens.length) return "";

  // Normalize: lowercase, deduplicate
  const tokens = deduplicateWords(rawTokens.map(t => t.trim().toLowerCase())).filter(Boolean);
  if (!tokens.length) return "";

  // Single-word check
  if (tokens.length === 1) {
    const word = tokens[0];
    const info = WORD_REGISTRY[word];
    if (!info) return capitalize(word) + ".";
    switch (info.role) {
      case "subject":     return capitalize(info.baseForm) + "...";
      case "greeting":    return info.baseForm + "!";
      case "interjection": return info.baseForm + ".";
      case "negation":    return info.baseForm === "No" ? "No." : info.baseForm + ".";
      case "question":    return info.baseForm + "?";
      case "adjective":   return "I am " + info.baseForm + ".";
      case "object":
        if (word === "water") return "I need water.";
        if (word === "food") return "I want food.";
        return "I need " + info.baseForm + ".";
      case "verb":
        if (word === "help") return "I need help.";
        if (word === "eat") return "I want to eat.";
        if (word === "drink") return "I want to drink.";
        return "I " + (info.verbForm ?? info.baseForm) + ".";
      default:            return capitalize(info.baseForm) + ".";
    }
  }

  const punct = inferPunctuation(tokens);

  // ── Pattern 1: starts with a greeting or "good" + time of day ──────────
  if (tokens.length >= 2 && tokens[0] === "good" && ["morning", "afternoon", "evening", "night"].includes(tokens[1])) {
    return `Good ${tokens[1]}!`;
  }

  const firstInfo = WORD_REGISTRY[tokens[0]];
  if (firstInfo?.role === "greeting") {
    if (tokens.length === 1) return firstInfo.baseForm + "!";
    // "good morning you" → "Good morning!"  |  "hello friend" → "Hello, friend!"
    const rest = tokens.slice(1);
    const restStr = rest.map(t => WORD_REGISTRY[t]?.baseForm ?? t).join(" ");
    return `${firstInfo.baseForm}, ${restStr}!`;
  }

  // ── Pattern 2: standalone interjection ("thank you", "sorry", "yes", "no")
  if (firstInfo?.role === "interjection" && tokens.length <= 2) {
    return firstInfo.baseForm + ".";
  }

  // ── Pattern 3: Question pattern ──────────────────────────────────────────
  if (firstInfo?.role === "question") {
    // "where bathroom" → "Where is the bathroom?"
    // "what your name" → "What is your name?"
    const qWord = firstInfo.baseForm;
    const restTokens = tokens.slice(1);
    const restWords = restTokens.map(t => {
      const inf = WORD_REGISTRY[t];
      if (!inf) return t;
      if (inf.role === "subject") return inf.baseForm;
      return inf.baseForm;
    });
    // Inject "is" if no verb present
    const hasVerb = restTokens.some(t => WORD_REGISTRY[t]?.role === "verb");
    if (!hasVerb && restWords.length > 0) {
      return `${qWord} is the ${restWords.join(" ")}?`;
    }
    return `${qWord} ${restWords.join(" ")}?`;
  }

  // ── Pattern 4: Negation ──────────────────────────────────────────────────
  if (firstInfo?.role === "negation" && firstInfo.baseForm === "No") {
    // "no water" → "There is no water."
    const restStr = tokens.slice(1).map(t => WORD_REGISTRY[t]?.baseForm ?? t).join(" ");
    return restStr ? `There is no ${restStr}.` : "No.";
  }

  // ── Pattern 5: Subject-based sentence ────────────────────────────────────
  const subjectIdx = tokens.findIndex(t => WORD_REGISTRY[t]?.role === "subject");
  const verbIdx = tokens.findIndex(t => WORD_REGISTRY[t]?.role === "verb");
  const adjIdx = tokens.findIndex(t => WORD_REGISTRY[t]?.role === "adjective");
  const objIdx = tokens.findIndex(t => WORD_REGISTRY[t]?.role === "object");

  let subject = "I"; // default subject
  if (subjectIdx !== -1) {
    subject = WORD_REGISTRY[tokens[subjectIdx]]?.baseForm ?? "I";
  }

  const toBeVerb = getToBeVerb(subject);

  // ── Pattern 5a: Subject + interjection (e.g. "I sorry" → "I'm sorry.") ──
  const interjIdx = tokens.findIndex(t => WORD_REGISTRY[t]?.role === "interjection");
  if (subjectIdx !== -1 && interjIdx !== -1 && verbIdx === -1 && adjIdx === -1) {
    const interj = WORD_REGISTRY[tokens[interjIdx]]?.baseForm ?? tokens[interjIdx];
    // "I" + "sorry" → "I'm sorry." ; "I" + "thank you" → "Thank you."
    if (tokens[interjIdx] === "sorry" || tokens[interjIdx] === "patawad" || tokens[interjIdx] === "pasensya") {
      return "I'm sorry.";
    }
    return `${capitalize(interj)}.`;
  }

  // ── Pattern 5b: Subject + object (no verb) → "<Subject> need <object>." ──
  if (subjectIdx !== -1 && objIdx !== -1 && verbIdx === -1 && adjIdx === -1) {
    const obj = WORD_REGISTRY[tokens[objIdx]]?.baseForm ?? tokens[objIdx];
    const needVerb = subject.toLowerCase() === "i" ? "need" : "needs";
    return `${capitalize(subject)} ${needVerb} ${obj}.`;
  }

  // Subject + adjective (e.g. "i hungry" → "I am hungry.")
  if (subjectIdx !== -1 && adjIdx !== -1 && verbIdx === -1) {
    const adj = WORD_REGISTRY[tokens[adjIdx]]?.baseForm ?? tokens[adjIdx];
    // Include any "not" negation
    const notIdx = tokens.findIndex(t => WORD_REGISTRY[t]?.role === "negation" && t === "not");
    if (notIdx !== -1) {
      return `${capitalize(subject)} ${toBeVerb} not ${adj}${punct}`;
    }
    // Add extra objects if present
    if (objIdx !== -1) {
      const obj = WORD_REGISTRY[tokens[objIdx]]?.baseForm ?? tokens[objIdx];
      return `${capitalize(subject)} ${toBeVerb} ${adj} for ${obj}${punct}`;
    }
    return `${capitalize(subject)} ${toBeVerb} ${adj}${punct}`;
  }

  // Subject + verb + object (e.g. "i need water" → "I need water.")
  if (subjectIdx !== -1 && verbIdx !== -1) {
    const verb = WORD_REGISTRY[tokens[verbIdx]];
    const verbWord = verb?.verbForm ?? tokens[verbIdx];
    const isToBeVerb = ["am", "is", "are"].includes(verbWord);

    // Collect remaining tokens after verb as the object/complement
    const afterVerb = tokens.slice(verbIdx + 1);

    let complement = afterVerb
      .filter(t => t !== tokens[subjectIdx])
      .map(t => {
        const inf = WORD_REGISTRY[t];
        if (!inf) return t;
        if (inf.role === "verb" && !["am","is","are"].includes(t)) {
          return "to " + inf.baseForm;
        }
        return inf.baseForm;
      })
      .join(" ");

    // Adjective complement without explicit "am/is/are"
    if (!isToBeVerb && adjIdx !== -1 && adjIdx > verbIdx) {
      const adj = WORD_REGISTRY[tokens[adjIdx]]?.baseForm ?? tokens[adjIdx];
      complement = complement.replace(adj, `and ${adj}`);
    }

    // "i want eat" → "I want to eat."
    const nextToken = tokens[verbIdx + 1];
    const nextIsVerb = nextToken && WORD_REGISTRY[nextToken]?.role === "verb";
    if (nextIsVerb && !complement.startsWith("to ")) {
      const restStr = afterVerb.map(t => {
        const inf = WORD_REGISTRY[t];
        return inf?.role === "verb" ? "to " + (inf.verbForm ?? t) : (inf?.baseForm ?? t);
      }).join(" ");
      return `${capitalize(subject)} ${verbWord} ${restStr}${punct}`;
    }

    if (!complement) {
      return `${capitalize(subject)} ${verbWord}${punct}`;
    }

    if (isToBeVerb) {
      return `${capitalize(subject)} ${verbWord} ${complement}${punct}`;
    }

    return `${capitalize(subject)} ${verbWord} ${complement}${punct}`;
  }

  // ── Pattern 6: verb + object without explicit subject (e.g. "need water") ─
  if (subjectIdx === -1 && verbIdx !== -1) {
    const verbWord = WORD_REGISTRY[tokens[verbIdx]]?.verbForm ?? tokens[verbIdx];
    const afterVerb = tokens.slice(verbIdx + 1).map(t => WORD_REGISTRY[t]?.baseForm ?? t).join(" ");
    if (afterVerb) {
      return `I ${verbWord} ${afterVerb}${punct}`;
    }
    return `I ${verbWord}${punct}`;
  }

  // ── Pattern 7: adjective only (no subject, no verb) ──────────────────────
  if (adjIdx !== -1 && subjectIdx === -1 && verbIdx === -1) {
    const adj = WORD_REGISTRY[tokens[adjIdx]]?.baseForm ?? tokens[adjIdx];
    return `I am ${adj}${punct}`;
  }

  // ── Fallback: join all words naturally ───────────────────────────────────
  const joined = tokens.map(t => WORD_REGISTRY[t]?.baseForm ?? t).join(" ");
  return capitalize(joined) + punct;
}

/**
 * Quick test helper — returns true if the word is known in the registry.
 */
export function isKnownWord(word: string): boolean {
  return word.toLowerCase() in WORD_REGISTRY;
}
