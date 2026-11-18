// src/components/Gesture/SpeechGesture.tsx
import React, { useState, useRef, useEffect } from "react";
import { API_ROOT, resolveApiUrl } from "../../config";
import { apiClient, authHeaders } from "../../services/api";
import { useToast } from "../../contexts/ToastContext";
import type { SignAsset } from "./types";
interface SpeechGestureProps {
  language: string;
  onSpeechDetected?: (gesture: string, language: string) => void;
  onSignsDetected?: (canonicalSignWords: string[]) => void;
  // Bump this (e.g. after a Sign Library upload) to force a re-fetch of
  // /api/signs without needing a page reload — see the loadSigns effect
  // below, which depends on this value.
  refreshSignsVersion?: number;
}
const keywordMap: Record<string, Record<string, string>> = {
  English: {
    red: "red",
    hello: "hello",
    hi: "hello",
    "how are you": "hello",
    peace: "peace",
    calm: "peace",
    i: "i",
    love: "love",
    you: "you",
    "i love you": "i love you",
    stop: "stop",
    halt: "stop",
    "thumbs up": "thumbsUp",
    good: "good",
    great: "good",
    ok: "ok",
    okay: "ok",
    sure: "ok",
    yes: "yes",
    yeah: "yes",
    yep: "yes",
    no: "no",
    nope: "no",
    sorry: "sorry",
    apologize: "sorry",
    help: "help",
    assist: "help",
    eat: "eat",
    food: "eat",
    hungry: "eat",
    drink: "drink",
    water: "drink",
    thirsty: "drink",
    come: "come",
    go: "go",
    wait: "wait",
    fine: "fine",
    bad: "bad",

    please: "please",
    thanks: "thank you",
    "thank you": "thank you",
    friend: "friend",
    family: "family",
    school: "school",
    work: "work",
    play: "play",
    sleep: "sleep",
  },
  Tagalog: {
    red: "red",
    pula: "red",
    kumusta: "hello",
    hello: "hello",
    kapayapaan: "peace",
    mahal: "love",
    hinto: "stop",
    tigil: "stop",
    oo: "yes",
    hindi: "no",
    pasensya: "sorry",
    tulong: "help",
    kumain: "eat",
    kain: "eat",
    gutom: "eat",
    uminom: "drink",
    inom: "drink",
    uhaw: "drink",
    halika: "come",
    pumunta: "go",
    hintay: "wait",
    salamat: "thank you",
    paki: "please",
  },
  Cebuano: {
    red: "red",
    pula: "red",
    kumusta: "hello",
    "gihigugma tika": "i love you",
    undang: "stop",
    maayo: "good",
    oo: "yes",
    dili: "no",
    kaon: "eat",
    imnon: "drink",
    ari: "come",
    lakaw: "go",
    hulat: "wait",
    salamat: "thank you",
  },
  Ilocano: {
    kumusta: "hello",
    "ay-ayaten ka": "i love you",
    agpuesto: "stop",
    nasayaat: "good",
    wen: "yes",
    saan: "no",
    mangan: "eat",
    uminom: "drink",
    umay: "come",
    uray: "wait",
    agyaman: "thank you",
  },
  Bikolano: {
    kamusta: "hello",
    "namumutan ta ka": "i love you",
    undok: "stop",
    marahay: "good",
    iyo: "yes",
    dai: "no",
    kakanon: "eat",
    inom: "drink",
    digdi: "come",
    hulat: "wait",
    salamat: "thank you",
  },
};
const REVEAL_INTERVAL_MS = 500;
const INACTIVITY_FADE_MS = 2000;
const FADE_TRANSITION_MS = 400;
const AUTO_RESTART_DELAY_MS = 300;
const SIGN_ASSET_CACHE_KEY = "sign-library-cache-v1";
// Mirrors the gesture side's SENTENCE_PAUSE_MS in VideoViewport.tsx: as long
// as new final speech is still coming in within this window, it keeps
// getting appended to the same sentence. Once speech pauses for longer than
// this, whatever has accumulated is finalized and emitted as one sentence.
const SENTENCE_PAUSE_MS = 1200;
const FATAL_ERRORS = new Set([
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
]);

// Shared text-matching normalizer for anything that ultimately gets compared
// against spoken words: a raw admin-entered sign name has no guarantees on
// its whitespace, unlike the live transcript (which always comes out as
// clean single-space-separated words via text.split(/\s+/)). Copy-pasting a
// phrase from Word/Docs/a messaging app commonly carries a non-breaking
// space (U+00A0) or a stray double space between words, and JS's \s already
// matches those — but the OLD code only stripped disallowed characters
// ([^a-z0-9 ]), which does NOT include a bare ASCII space in what it keeps,
// so a non-breaking space (not a literal " ") got silently deleted instead
// of collapsed, gluing two words together (e.g. "nice to\u00A0meet you" ->
// "nicetomeetyou"), and a literal double space was kept as two spaces
// instead of one — both cases meaning the recorded phrase could never
// string-equal the spoken one no matter how clearly it was said. Collapsing
// ALL whitespace to a single ASCII space FIRST, before stripping remaining
// punctuation, fixes both.
const normalizeForMatch = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function oneEditAway(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return edits + Number(leftIndex < left.length || rightIndex < right.length) <= 1;
}

const SpeechGesture: React.FC<SpeechGestureProps> = ({
  language,
  onSpeechDetected,
  onSignsDetected,
  refreshSignsVersion,
}) => {
  const { showToast } = useToast();
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [sentenceInput, setSentenceInput] = useState("");
  const [playbackSequence, setPlaybackSequence] = useState<string[]>([]);
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const [currentWord, setCurrentWord] = useState<string | null>(null);
  const [unmatchedWord, setUnmatchedWord] = useState<string | null>(null);
  const [isFading, setIsFading] = useState(false);
  const [slideKey, setSlideKey] = useState(0);
  const [micHover, setMicHover] = useState(false);
  const [signsLoaded, setSignsLoaded] = useState(false);
  // Tracks which asset's media failed to load, so a broken/unsupported
  // file (e.g. a codec the browser can't decode) shows an explicit notice
  // instead of a silently blank sign card.
  const [failedAssetKey, setFailedAssetKey] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const dynamicAssetsRef = useRef<any[]>([]);
  const [dynamicAssets, setDynamicAssets] = useState<any[]>([]);
  const manualStopRef = useRef(false);
  const lastProcessedIndexRef = useRef(0);
  // Where the currently displayed transcript starts inside event.results.
  // With continuous recognition, event.results keeps every phrase of the
  // session, so the display must skip results already shown and faded.
  const transcriptStartIndexRef = useRef(0);
  // Latest results.length, so the fade timer knows where to move the start.
  const latestResultsLengthRef = useRef(0);
  // Tracks how many words from the start of the live transcript have
  // already been permanently resolved into a matched sign (or force-
  // resolved at a flush timeout). Deliberately does NOT advance for
  // words that are still held/pending — see the onresult handler for
  // why: advancing past pending words would cache their current value,
  // and speech recognition can silently REVISE an interim word in place
  // (e.g. "noon" transcribed as "no" for one callback, then corrected)
  // without changing the transcript's total word count. If the cursor
  // had already moved past that position, the correction would never
  // be seen again. Always re-slicing from this cursor keeps re-reading
  // the live word(s) fresh from the current transcript until they're
  // actually committed.
  const committedWordCountRef = useRef(0);
  // Guards against the SpeechRecognition API re-delivering the same final
  // result in a later onresult call (common on short, isolated utterances).
  // Without this, the same word gets matched and enqueued twice.
  const lastFinalSegmentRef = useRef("");
  // Tracks the last matched sign word actually pushed into the reveal
  // queue. Used to strip consecutive duplicates regardless of which
  // onresult batch they came from (covers cases where the browser's
  // phrase segmentation overlaps two final chunks with slightly
  // different surrounding text, so the raw-string dedupe above misses it).
  const lastEnqueuedWordRef = useRef<string | null>(null);
  // Timestamp of when lastEnqueuedWordRef was last set. Used to distinguish
  // the SpeechRecognition API re-delivering one physical utterance across
  // two onresult batches (arrives within milliseconds) from the user
  // genuinely repeating the same word later in the same session (arrives
  // a full pause later) — see dedupeConsecutive below.
  const lastEnqueuedAtRef = useRef<number>(0);
  const wordQueueRef = useRef<string[]>([]);
  const playbackSequenceRef = useRef<string[]>([]);
  const revealTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const fadeOutStartTimerRef = useRef<number | null>(null);
  const [isTranscriptFading, setIsTranscriptFading] = useState(false);
  const transcriptFadeStartTimerRef = useRef<number | null>(null);
  const transcriptFadeTimerRef = useRef<number | null>(null);
  const pendingWordsRef = useRef<string[]>([]);
  const lookupRequestIdRef = useRef(0);
  const pendingFlushTimerRef = useRef<number | null>(null);
  const sentenceWordsRef = useRef<string[]>([]);
  const sentenceTimerRef = useRef<number | null>(null);
  const languageRef = useRef(language);
  const onSpeechDetectedRef = useRef(onSpeechDetected);
  const onSignsDetectedRef = useRef(onSignsDetected);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);
  useEffect(() => {
    onSpeechDetectedRef.current = onSpeechDetected;
  }, [onSpeechDetected]);
  useEffect(() => {
    onSignsDetectedRef.current = onSignsDetected;
  }, [onSignsDetected]);
  const generateSequence = (
    text: string,
    finalWordCount: number = Infinity,
    allowHold: boolean = true,
  ): {
    matched: string[];
    unmatched: string[];
  } => {
    const lower = text.toLowerCase().trim();
    if (!lower)
      return {
        matched: [],
        unmatched: [],
      };
    const words = lower.split(/\s+/).filter(Boolean);
    const map = keywordMap[languageRef.current] ?? keywordMap["English"];
    // Not every regional dictionary lists every English loanword (e.g.
    // Cebuano/Ilocano/Bikolano don't define "hello" — only their native
    // greeting). Falling back to the English map means saying the literal
    // English word always works as a sign trigger, regardless of which
    // language tab is active, instead of silently matching nothing.
    const englishMap = keywordMap["English"];
    // Words/phrases added to the Sign Library (via the record/upload flow
    // in SignLibraryModal.tsx) aren't in the hardcoded keywordMap above —
    // that map only covers the built-in sign set. Checking the live
    // library word list means any word/phrase someone (admin or teacher)
    // adds to the library becomes speech-recognizable immediately, with
    // no code change needed here.
    //
    // Library words are checked FIRST, ahead of the hardcoded map: if a
    // teacher/admin has recorded a specific word or phrase, saying it
    // should show *their* recorded video, not fall through to (or be
    // blocked by) a hardcoded built-in mapping. This also fixed a real
    // bug where the built-in map had "good morning" -> "morning", which
    // pointed at a "morning" asset that never existed anywhere in the
    // app, and — because it was checked first — silently prevented the
    // correctly-recorded "Good Morning" library video from ever showing.
    // Normalized the same way spoken text is (strip punctuation AND
    // collapse any whitespace variant to a single space — see
    // normalizeForMatch) — otherwise a library word typed with any
    // punctuation (e.g. "Nice to Meet You!") or irregular spacing (a
    // double space, or a non-breaking space from a copy-paste) would
    // NEVER match what's spoken, no matter how clearly the phrase was
    // said.
    const libraryAliases = new Map<string, string>();
    dynamicAssetsRef.current.forEach((asset) => {
      const canonicalWord = normalizeForMatch(
        (asset?.word ?? "").toString(),
      );
      if (!canonicalWord) return;
      const translations = asset?.gesture?.translations;
      const translatedAliases =
        translations && typeof translations === "object"
          ? Object.values(translations).filter(
              (value): value is string => typeof value === "string",
            )
          : [];
      const aliases = [
        canonicalWord,
        ...(Array.isArray(asset?.gesture?.aliases)
          ? asset.gesture.aliases
          : []),
        ...(Array.isArray(asset?.aliases) ? asset.aliases : []),
        ...translatedAliases,
      ];
      aliases.forEach((alias) => {
        const normalizedAlias = normalizeForMatch(String(alias));
        if (normalizedAlias) libraryAliases.set(normalizedAlias, canonicalWord);
      });
    });
    const libraryWords = new Set(libraryAliases.keys());
    // The phrase window used to be hardcoded to a max of 3 words, so any
    // sign name/phrase of 4+ words (e.g. "nice to meet you") could never
    // be matched as a whole — it would get chopped into a 3-word chunk
    // plus leftover words checked separately. Deriving the max phrase
    // length from the longest entry actually present (map, English
    // fallback map, or live library words) means phrases of any length
    // are matched correctly, and it stays correct automatically as new
    // multi-word signs get added to the library later.
    const maxPhraseLen = Math.max(
      1,
      ...Object.keys(map).map((k) => k.split(/\s+/).filter(Boolean).length),
      ...Object.keys(englishMap).map(
        (k) => k.split(/\s+/).filter(Boolean).length,
      ),
      ...Array.from(libraryWords).map(
        (k) => k.split(/\s+/).filter(Boolean).length,
      ),
    );
    // Speech recognition delivers interim results incrementally — often
    // one word per onresult callback. If a word is itself a valid sign
    // (e.g. "good", "i") AND also the first word of a longer known phrase
    // (e.g. "good morning", "i love you"), it would otherwise get matched
    // and displayed the instant it's heard, before the rest of the phrase
    // ever arrives — permanently pre-empting the longer sign. To prevent
    // that, build the set of every proper word-prefix of every multi-word
    // entry (across the map, English fallback, and live library words),
    // so a short match that is also one of these prefixes can be held
    // back instead of committed immediately.
    const phrasePrefixes = new Set<string>();
    const registerPrefixes = (key: string) => {
      const parts = key.split(/\s+/).filter(Boolean);
      for (let j = 1; j < parts.length; j++) {
        phrasePrefixes.add(parts.slice(0, j).join(" "));
      }
    };
    Object.keys(map).forEach(registerPrefixes);
    Object.keys(englishMap).forEach(registerPrefixes);
    Array.from(libraryWords).forEach(registerPrefixes);
    const matched: string[] = [];
    const unmatched: string[] = [];
    for (let i = 0; i < words.length; i++) {
      // Check the ENTIRE remaining tail (from i to the end of what's been
      // heard so far this call) against phrasePrefixes first, before
      // trying to resolve any individual word/span within it. This has to
      // be a whole-tail check, not just "does this one match reach the
      // end": with "i love you" said as "i", then "love" arriving in a
      // later batch, the combined segment at that point is "i love" — "i"
      // alone doesn't sit at the tail anymore ("love" follows it), but the
      // pair "i love" together is still a genuine incomplete prefix of
      // "i love you" and needs to be held as a unit, not resolved word by
      // word (which would prematurely commit "i" as its own sign the
      // moment "love" arrives, one word too early).
      if (allowHold) {
        const tailWords = words.slice(i);
        const tailPhrase = tailWords.join(" ");
        const normalizedTail = normalizeForMatch(tailPhrase);
        let shouldHoldTail = phrasePrefixes.has(normalizedTail);
        // The whole-tail check above only catches the case where every
        // word heard so far is genuinely part of a known prefix (e.g.
        // "nice to meet" while awaiting "you"). Speech recognition's
        // interim guess for the NEXT word is often wrong for a moment
        // before it finalizes — e.g. "noon" transcribed as "no", or
        // "tomorrow"/"meet" briefly mis-heard as something else — before
        // correcting itself. That turns the tail into something that
        // ISN'T itself a registered prefix, so without this check it
        // would fall through to word-by-word matching below and
        // immediately commit the earlier words as their own signs,
        // pre-empting the full phrase before the correction ever
        // arrives. To catch this: if every word except the last forms a
        // known prefix, and that last word hasn't been finalized by the
        // browser yet, hold the whole tail a little longer instead of
        // resolving it — the next onresult batch (or the flush timeout)
        // gets to settle whether it was really a false match.
        if (!shouldHoldTail && tailWords.length >= 2) {
          const lastAbsoluteIndex = i + tailWords.length - 1;
          const isLastWordFinal = lastAbsoluteIndex < finalWordCount;
          if (!isLastWordFinal) {
            const withoutLast = tailWords.slice(0, -1).join(" ");
            const normalizedWithoutLast = normalizeForMatch(withoutLast);
            if (
              normalizedWithoutLast &&
              phrasePrefixes.has(normalizedWithoutLast)
            ) {
              shouldHoldTail = true;
            }
          }
        }
        if (shouldHoldTail) {
          for (let k = i; k < words.length; k++) {
            const tailWord = words[k].replace(/[^a-z0-9]/g, "");
            if (tailWord) unmatched.push(tailWord);
          }
          break;
        }
      }
      const word = words[i].replace(/[^a-z0-9]/g, "");
      let wasMatched = false;
      for (let len = maxPhraseLen; len >= 1; len--) {
        if (i + len > words.length) continue;
        const phrase = words.slice(i, i + len).join(" ");
        const normalizedPhrase = normalizeForMatch(phrase);
        let canonical =
          libraryAliases.get(normalizedPhrase) ??
          map[normalizedPhrase] ??
          englishMap[normalizedPhrase];
        if (!canonical && len === 1 && normalizedPhrase.length >= 4) {
          const fuzzyAlias = Array.from(libraryAliases.keys()).find(
            (alias) =>
              alias.length >= 4 && oneEditAway(normalizedPhrase, alias),
          );
          const fuzzyCanonical = fuzzyAlias
            ? libraryAliases.get(fuzzyAlias)
            : undefined;
          if (fuzzyCanonical) canonical = fuzzyCanonical;
        }
        if (!canonical) continue;
        matched.push(canonical);
        i += len - 1;
        wasMatched = true;
        break;
      }
      if (!wasMatched) {
        // A lone letter is far noisier than a real word in interim (not
        // yet finalized) speech results — a stray breath or partial sound
        // frequently gets interim-transcribed as "a", "i", "o", etc.
        // before self-correcting a moment later. Full words and phrases
        // still match instantly on interim results (unaffected below);
        // only this single-letter fingerspelling case waits for the
        // browser to actually finalize the word, trading a small amount
        // of latency on isolated letters for a lot less noise. (The
        // map/englishMap/libraryWords single-word lookup that used to
        // live here as an "else" is gone — the len=1 pass of the phrase
        // loop above already covers every single-word match; keeping a
        // second identical lookup here was dead code.)
        if (word.length === 1 && /^[a-z]$/.test(word) && i < finalWordCount) {
          matched.push(word);
          wasMatched = true;
        }
      }
      if (!wasMatched && word) {
        unmatched.push(word);
      }
    }
    return {
      matched,
      unmatched,
    };
  };
  const clearRevealTimer = () => {
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  };
  const clearFadeStartTimer = () => {
    if (fadeOutStartTimerRef.current !== null) {
      window.clearTimeout(fadeOutStartTimerRef.current);
      fadeOutStartTimerRef.current = null;
    }
  };
  const clearFadeTransitionTimer = () => {
    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  };
  const clearTranscriptFadeStartTimer = () => {
    if (transcriptFadeStartTimerRef.current !== null) {
      window.clearTimeout(transcriptFadeStartTimerRef.current);
      transcriptFadeStartTimerRef.current = null;
    }
  };
  const clearTranscriptFadeTransitionTimer = () => {
    if (transcriptFadeTimerRef.current !== null) {
      window.clearTimeout(transcriptFadeTimerRef.current);
      transcriptFadeTimerRef.current = null;
    }
  };
  const scheduleTranscriptFade = () => {
    clearTranscriptFadeStartTimer();
    clearTranscriptFadeTransitionTimer();
    setIsTranscriptFading(false);
    transcriptFadeStartTimerRef.current = window.setTimeout(() => {
      setIsTranscriptFading(true);
      transcriptFadeTimerRef.current = window.setTimeout(() => {
        setIsTranscriptFading(false);
        // Everything shown so far is now faded: the next phrase must start
        // a fresh transcript instead of re-joining earlier results.
        transcriptStartIndexRef.current = latestResultsLengthRef.current;
        setTranscript("");
      }, FADE_TRANSITION_MS);
    }, INACTIVITY_FADE_MS);
  };
  const scheduleInactivityFade = () => {
    clearFadeStartTimer();
    fadeOutStartTimerRef.current = window.setTimeout(() => {
      setIsFading(true);
      fadeTimerRef.current = window.setTimeout(() => {
        setIsFading(false);
        setCurrentWord(null);
      }, FADE_TRANSITION_MS);
    }, INACTIVITY_FADE_MS);
  };
  const revealNextWord = () => {
    clearFadeStartTimer();
    clearFadeTransitionTimer();
    setIsFading(false);
    const next = wordQueueRef.current.shift();
    if (next === undefined) {
      revealTimerRef.current = null;
      scheduleInactivityFade();
      return;
    }
    setCurrentWord(next);
    setSlideKey((prev) => prev + 1);
    setPlaybackIndex(
      playbackSequenceRef.current.length - wordQueueRef.current.length - 1,
    );
    if (wordQueueRef.current.length > 0) {
      revealTimerRef.current = window.setTimeout(
        revealNextWord,
        REVEAL_INTERVAL_MS,
      );
    } else {
      revealTimerRef.current = null;
      scheduleInactivityFade();
    }
  };
  // Redelivery of the exact same final result normally lands within a few
  // hundred ms of the original (same or very next onresult callback). A
  // window well above that but well below a natural gap between two
  // deliberately-repeated words keeps the original glitch-guard working
  // without also swallowing genuine repeats like "hello ... hello".
  const REPEAT_REDELIVERY_WINDOW_MS = 700;
  const dedupeConsecutive = (words: string[]): string[] => {
    const result: string[] = [];
    let prevWord = lastEnqueuedWordRef.current;
    let prevAt = lastEnqueuedAtRef.current;
    const now = Date.now();
    for (const word of words) {
      if (word === prevWord && now - prevAt < REPEAT_REDELIVERY_WINDOW_MS) {
        continue;
      }
      result.push(word);
      prevWord = word;
      prevAt = now;
    }
    if (result.length > 0) {
      lastEnqueuedWordRef.current = result[result.length - 1];
      lastEnqueuedAtRef.current = now;
    }
    return result;
  };
  const enqueueWords = (words: string[]) => {
    if (words.length === 0) return;
    lookupRequestIdRef.current += 1;
    setUnmatchedWord(null);
    if (wordQueueRef.current.length === 0 && revealTimerRef.current === null) {
      playbackSequenceRef.current = words;
      setPlaybackSequence(words);
      setPlaybackIndex(-1);
    } else {
      playbackSequenceRef.current = [...playbackSequenceRef.current, ...words];
      setPlaybackSequence(playbackSequenceRef.current);
    }
    wordQueueRef.current.push(...words);
    if (revealTimerRef.current === null) {
      revealNextWord();
    }
  };
  const findLocalAsset = (word: string) => {
    const key = normalizeForMatch(word);
    if (!key) return undefined;
    return dynamicAssetsRef.current.find((asset) => {
      const translations = asset?.gesture?.translations;
      const aliases = [
        asset?.word,
        ...(Array.isArray(asset?.gesture?.aliases) ? asset.gesture.aliases : []),
        ...(Array.isArray(asset?.aliases) ? asset.aliases : []),
        ...(translations && typeof translations === "object"
          ? Object.values(translations)
          : []),
      ];
      return aliases.some(
        (alias) =>
          typeof alias === "string" && normalizeForMatch(alias) === key,
      );
    });
  };
  const fallbackLetters = (text: string): string[] =>
    normalizeForMatch(text)
      .split(" ")
      .filter(Boolean)
      .flatMap((token) => {
        const registeredWord = findLocalAsset(token);
        if (registeredWord) return [normalizeForMatch(registeredWord.word)];
        return [...token]
          .filter((character) => /[a-z]/.test(character))
          .map((character) => {
            const letterAsset = findLocalAsset(character);
            return letterAsset
              ? normalizeForMatch(letterAsset.word)
              : character;
          });
      });
  const queueTypedSentence = () => {
    const normalized = normalizeForMatch(sentenceInput);
    if (!normalized) return;
    const wholeSentenceAsset = findLocalAsset(normalized);
    const words = wholeSentenceAsset
      ? [normalizeForMatch(wholeSentenceAsset.word)]
      : fallbackLetters(normalized);
    if (words.length === 0) return;
    wordQueueRef.current = [];
    clearRevealTimer();
    clearFadeStartTimer();
    clearFadeTransitionTimer();
    setCurrentWord(null);
    setIsFading(false);
    setUnmatchedWord(null);
    setSentenceInput("");
    enqueueWords(words);
  };
  const resolveUnmatchedSpeech = async (text: string) => {
    const normalized = normalizeForMatch(text);
    if (!normalized) return;
    const requestId = ++lookupRequestIdRef.current;
    setCurrentWord(null);
    try {
      const response = await apiClient.get<{
        success: boolean;
        signs: SignAsset[];
      }>(`/signs/lookup?text=${encodeURIComponent(normalized)}`);
      if (requestId !== lookupRequestIdRef.current) return;
      if (!response.success || response.signs.length === 0) {
        setUnmatchedWord(text);
        enqueueWords(fallbackLetters(text));
        return;
      }
      const signs = response.signs.map((asset) => ({
        ...asset,
        file: resolveApiUrl(asset.file),
      }));
      const merged = [
        ...dynamicAssetsRef.current.filter(
          (existing) =>
            !signs.some((asset) => asset.id === existing.id),
        ),
        ...signs,
      ];
      dynamicAssetsRef.current = merged;
      setDynamicAssets(merged);
      setUnmatchedWord(null);
      try {
        localStorage.setItem(
          SIGN_ASSET_CACHE_KEY,
          JSON.stringify(merged.filter((asset) => asset.isPublished !== false)),
        );
      } catch (error) {
        console.warn("Could not cache the looked-up sign:", error);
      }
      enqueueWords([normalizeForMatch(signs[0].word)]);
    } catch (error) {
      if (requestId !== lookupRequestIdRef.current) return;
      console.error("Could not search the sign dictionary:", error);
      setUnmatchedWord(text);
      enqueueWords(fallbackLetters(text));
    }
  };
  const startListening = () => {
    const SpeechRecognitionCtor =
      (
        window as Window &
          typeof globalThis & {
            SpeechRecognition?: new () => any;
            webkitSpeechRecognition?: new () => any;
          }
      ).SpeechRecognition ||
      (
        window as Window &
          typeof globalThis & {
            SpeechRecognition?: new () => any;
            webkitSpeechRecognition?: new () => any;
          }
      ).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      return;
    }
    manualStopRef.current = false;
    lastProcessedIndexRef.current = 0;
    committedWordCountRef.current = 0;
    transcriptStartIndexRef.current = 0;
    latestResultsLengthRef.current = 0;
    lastFinalSegmentRef.current = "";
    lastEnqueuedWordRef.current = null;
    lastEnqueuedAtRef.current = 0;
    pendingWordsRef.current = [];
    if (pendingFlushTimerRef.current !== null) {
      window.clearTimeout(pendingFlushTimerRef.current);
      pendingFlushTimerRef.current = null;
    }
    const recognition = new SpeechRecognitionCtor();
    recognitionRef.current = recognition;
    const langCodes: Record<string, string> = {
      English: "en-US",
      Tagalog: "fil-PH",
      Cebuano: "ceb-PH",
      Ilocano: "fil-PH",
      Bikolano: "fil-PH",
    };
    recognition.lang = langCodes[languageRef.current] ?? "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => {
      if (recognition !== recognitionRef.current) return;
      setIsListening(true);
    };
    recognition.onresult = (event: any) => {
      if (recognition !== recognitionRef.current) return;
      // stop() is asynchronous — the browser finalizes whatever was still
      // in-flight and fires one more onresult (the last segment now
      // isFinal) before onend actually runs. stopListening() has already
      // reset committedWordCountRef/pendingWordsRef by the time that
      // trailing event arrives, so without this guard it looks like
      // nothing has been processed yet and the whole session's transcript
      // (e.g. "good noon") gets matched and displayed a second time. Any
      // words the user actually said were already surfaced via earlier
      // interim results, so it's safe to just drop this trailing event.
      if (manualStopRef.current) return;
      const results = Array.from(event.results) as any[];
      // Full session text: still used for sign matching below (unchanged).
      const text = results.map((r: any) => r[0].transcript).join(" ");
      latestResultsLengthRef.current = results.length;
      // Display text: only results since the last fade, so earlier phrases
      // ("hi") are not repeated in front of new ones ("hello").
      const displayText = results
        .slice(transcriptStartIndexRef.current)
        .map((r: any) => r[0].transcript)
        .join(" ")
        .trim();
      setTranscript(displayText);
      scheduleTranscriptFade();

      // Count how many words (from the start of the session transcript)
      // belong to segments the browser has already finalized, vs. words
      // still in the trailing interim (not-yet-final) segment. Used only
      // to gate the noisy single-letter case in generateSequence — full
      // words/phrases still match instantly regardless of finality.
      const finalText = results
        .filter((r: any) => r.isFinal)
        .map((r: any) => r[0].transcript)
        .join(" ");
      const sessionFinalWordCount = finalText
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;

      // --- Instant sign matching, driven off the live transcript ---
      // liveWords includes interim (not-yet-final) words, so a sign can
      // appear the moment a word is recognized rather than waiting for
      // the browser to finalize the segment after a pause.
      const liveWords = text.trim().split(/\s+/).filter(Boolean);
      const committedCount = committedWordCountRef.current;
      // Re-slice from the live transcript fresh every time, rather than
      // reusing a cached snapshot of the held/pending words — see the
      // comment on committedWordCountRef for why this matters (interim
      // corrections like "no" -> "noon" need to be picked up, not stuck
      // with whatever the word looked like the first time it was seen).
      const tailWords = liveWords.slice(committedCount);
      if (tailWords.length > 0) {
        const combinedSegment = tailWords.join(" ");
        const combinedFinalWordCount = Math.max(
          0,
          sessionFinalWordCount - committedCount,
        );
        const { matched, unmatched } = generateSequence(
          combinedSegment,
          combinedFinalWordCount,
        );
        // Must stay >= (longest known phrase's word count - 1), or a
        // legitimate in-progress hold for a long phrase (e.g. "nice to
        // meet you" needs up to 3 words held while awaiting "you") would
        // get truncated here and silently lose its earlier words before
        // the phrase ever completes. Computed the same way generateSequence
        // derives its own phrase-length ceiling, so it stays correct as
        // longer signs get added to the library later.
        const HOLD_MAX = Math.max(
          1,
          ...Object.keys(keywordMap[languageRef.current] ?? keywordMap.English).map(
            (k) => k.split(/\s+/).filter(Boolean).length - 1,
          ),
          ...Object.keys(keywordMap.English).map(
            (k) => k.split(/\s+/).filter(Boolean).length - 1,
          ),
          ...dynamicAssetsRef.current.map(
            (asset) =>
              (asset?.word ?? "").toString().trim().split(/\s+/).filter(Boolean)
                .length - 1,
          ),
        );
        // Previously gated on `!hadPending`, which allowed a word to be
        // held for exactly one extension round and no more. A phrase like
        // "how are you" delivered across three separate onresult batches
        // ("how", then "are", then "you") would hold "how" once, but the
        // second round (combining "how are") was already `hadPending`, so
        // holding was disabled and "how are" got silently dropped before
        // "you" ever arrived to complete the phrase. Holding should
        // continue for as long as new speech keeps extending the still-
        // unmatched tail — HOLD_MAX still caps how much accumulates, and
        // the 900ms flush below still gives up once speech actually stops.
        const canHold = unmatched.length > 0;
        const toHold = canHold ? unmatched.slice(-HOLD_MAX) : [];
        pendingWordsRef.current = toHold;
        // Only words that were actually resolved into a matched sign, or
        // dropped for exceeding HOLD_MAX, are permanently "committed".
        // The remaining held tail (toHold) stays reachable on the next
        // callback so a correction to its value is still picked up (see
        // committedWordCountRef comment above) — it must NOT be marked
        // committed here, or a revision like "no" -> "noon" would never
        // be re-examined.
        committedWordCountRef.current =
          committedCount + (tailWords.length - toHold.length);
        if (pendingFlushTimerRef.current !== null) {
          window.clearTimeout(pendingFlushTimerRef.current);
          pendingFlushTimerRef.current = null;
        }
        if (toHold.length > 0) {
          pendingFlushTimerRef.current = window.setTimeout(() => {
            const held = pendingWordsRef.current;
            pendingWordsRef.current = [];
            pendingFlushTimerRef.current = null;
            // Nothing arrived within the hold window to extend a held
            // word/phrase into something longer (e.g. "good" said alone,
            // never followed by "morning"). These words are now settled
            // one way or the other, so mark them committed — otherwise
            // they'd still sit past committedWordCountRef and get pulled
            // back into the next onresult's tail, getting re-evaluated
            // (and potentially re-flushed) indefinitely.
            committedWordCountRef.current += held.length;
            // Force-resolve it now as its own short match (allowHold=false
            // skips the hold-back check entirely) instead of silently
            // dropping it — otherwise a standalone "good" would never
            // show any sign at all.
            if (held.length > 0) {
              const { matched: finalMatched } = generateSequence(
                held.join(" "),
                held.length,
                false,
              );
              if (finalMatched.length > 0) {
                enqueueWords(dedupeConsecutive(finalMatched));
                onSignsDetectedRef.current?.(finalMatched);
              } else {
                void resolveUnmatchedSpeech(held.join(" "));
              }
            }
          }, 900);
        }
        if (matched.length > 0) {
          enqueueWords(dedupeConsecutive(matched));
          onSignsDetectedRef.current?.(matched);
        } else if (unmatched.length === 0) {
          setUnmatchedWord(null);
        }
      }

      // --- Sentence construction stays isFinal-only ---
      // event.resultIndex marks where this batch's new/updated results
      // start; never re-scan results already advanced past.
      let newFinalSegment = "";
      const startIndex = Math.max(
        event.resultIndex ?? 0,
        lastProcessedIndexRef.current,
      );
      for (let i = startIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          newFinalSegment +=
            (newFinalSegment ? " " : "") + result[0].transcript;
          lastProcessedIndexRef.current = Math.max(
            lastProcessedIndexRef.current,
            i + 1,
          );
        }
      }
      if (!newFinalSegment.trim()) return;
      const normalizedFinalSegment = newFinalSegment.trim();
      if (normalizedFinalSegment === lastFinalSegmentRef.current) return;
      lastFinalSegmentRef.current = normalizedFinalSegment;

      // Sentence construction: keep appending newly finalized speech to the
      // in-progress sentence. Every new segment pushes the finalize timer
      // back out, so continuous speech keeps building one sentence; once
      // the user pauses for SENTENCE_PAUSE_MS with nothing new coming in,
      // the accumulated words are joined and emitted as a single sentence.
      sentenceWordsRef.current.push(
        ...newFinalSegment.trim().split(/\s+/).filter(Boolean),
      );
      if (sentenceTimerRef.current !== null) {
        window.clearTimeout(sentenceTimerRef.current);
      }
      sentenceTimerRef.current = window.setTimeout(() => {
        const finalSentence = sentenceWordsRef.current.join(" ").trim();
        sentenceWordsRef.current = [];
        sentenceTimerRef.current = null;
        if (finalSentence) {
          onSpeechDetectedRef.current?.(finalSentence, languageRef.current);
        }
      }, SENTENCE_PAUSE_MS);
    };
    recognition.onend = () => {
      if (recognition !== recognitionRef.current) return;
      if (!manualStopRef.current) {
        window.setTimeout(() => {
          if (
            recognition === recognitionRef.current &&
            !manualStopRef.current
          ) {
            startListening();
          }
        }, AUTO_RESTART_DELAY_MS);
        return;
      }
      setIsListening(false);
    };
    recognition.onerror = (event: any) => {
      if (recognition !== recognitionRef.current) return;
      if (FATAL_ERRORS.has(event.error)) {
        manualStopRef.current = true;
        setIsListening(false);
        return;
      }
      console.warn("Speech recognition warning:", event.error);
    };
    recognition.start();
  };
  const stopListening = () => {
    manualStopRef.current = true;
    recognitionRef.current?.stop();
    setIsListening(false);
    wordQueueRef.current = [];
    playbackSequenceRef.current = [];
    setPlaybackSequence([]);
    setPlaybackIndex(-1);
    clearRevealTimer();
    clearFadeStartTimer();
    clearFadeTransitionTimer();
    clearTranscriptFadeStartTimer();
    clearTranscriptFadeTransitionTimer();
    setIsTranscriptFading(false);
    setTranscript("");
    pendingWordsRef.current = [];
    lastEnqueuedWordRef.current = null;
    lastEnqueuedAtRef.current = 0;
    committedWordCountRef.current = 0;
    transcriptStartIndexRef.current = 0;
    latestResultsLengthRef.current = 0;
    if (pendingFlushTimerRef.current !== null) {
      window.clearTimeout(pendingFlushTimerRef.current);
      pendingFlushTimerRef.current = null;
    }
    if (sentenceTimerRef.current !== null) {
      window.clearTimeout(sentenceTimerRef.current);
      sentenceTimerRef.current = null;
    }
    if (sentenceWordsRef.current.length > 0) {
      const finalSentence = sentenceWordsRef.current.join(" ").trim();
      sentenceWordsRef.current = [];
      if (finalSentence) {
        onSpeechDetectedRef.current?.(finalSentence, languageRef.current);
      }
    }
  };
  const isFirstLanguageRender = useRef(true);
  useEffect(() => {
    if (isFirstLanguageRender.current) {
      isFirstLanguageRender.current = false;
      return;
    }
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, [language]);
  useEffect(() => {
    let cancelled = false;
    try {
      const cached = localStorage.getItem(SIGN_ASSET_CACHE_KEY);
      if (cached) {
        const parsed: unknown = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          const cachedAssets = parsed.filter(
            (asset) => asset && asset.isPublished !== false,
          );
          dynamicAssetsRef.current = cachedAssets;
          setDynamicAssets(cachedAssets);
          setSignsLoaded(true);
        }
      }
    } catch (error) {
      console.warn("Could not read the cached sign library:", error);
    }
    // Render's free tier can take 30-60s to wake from a cold start. A
    // single fetch attempt used to fail (or just never resolve in time)
    // and silently give up — dynamicAssets stayed empty for the rest of
    // the session, so every word kept getting heard and matched, but
    // never had an image to show, until the page was refreshed. Retrying
    // with backoff (roughly covering a full cold-start window) means a
    // slow/asleep backend delays the sign list rather than permanently
    // breaking it.
    const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];
    const loadSigns = (attempt: number) => {
      fetch(`${API_ROOT}/api/signs`, { headers: authHeaders() })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => {
          if (cancelled) return;
          const updated: SignAsset[] = data.map((item: any) => ({
            ...item,
            file: resolveApiUrl(item.file),
          }));
          dynamicAssetsRef.current = updated;
          setDynamicAssets(updated);
          setSignsLoaded(true);
          try {
            const publishedAssets = updated.filter(
              (asset) => asset.isPublished !== false,
            );
            localStorage.setItem(
              SIGN_ASSET_CACHE_KEY,
              JSON.stringify(publishedAssets),
            );
          } catch (error) {
            console.warn("Could not cache the sign library:", error);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          console.warn(
            `Failed to load signs (attempt ${attempt + 1}):`,
            err,
          );
          if (attempt < RETRY_DELAYS_MS.length) {
            window.setTimeout(
              () => loadSigns(attempt + 1),
              RETRY_DELAYS_MS[attempt],
            );
          } else {
            console.error(
              "Giving up on loading signs after repeated failures.",
            );
            setSignsLoaded(true);
          }
        });
    };
    loadSigns(0);
    const handleSignLibraryUpdate = () => {
      setSignsLoaded(false);
      loadSigns(0);
    };
    window.addEventListener("sign-library-updated", handleSignLibraryUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener(
        "sign-library-updated",
        handleSignLibraryUpdate,
      );
    };
    // refreshSignsVersion intentionally re-runs this whole effect (fresh
    // retry sequence included) whenever a Sign Library upload bumps it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignsVersion]);
  useEffect(() => {
    return () => {
      clearRevealTimer();
      clearFadeStartTimer();
      clearFadeTransitionTimer();
      clearTranscriptFadeStartTimer();
      clearTranscriptFadeTransitionTimer();
      if (pendingFlushTimerRef.current !== null) {
        window.clearTimeout(pendingFlushTimerRef.current);
      }
    };
  }, []);
  // currentWord is always already the clean, fully-normalized canonical
  // form (see generateSequence's normalizedPhrase / normalizeForMatch) —
  // item.word needs the exact same normalization here (punctuation AND
  // whitespace), or a recorded word with any punctuation or irregular
  // spacing would match in generateSequence but then fail to resolve to
  // an actual video right here, showing "No sign available" despite a
  // real match having already happened.
  const currentAsset = dynamicAssets.find(
    (item) =>
      normalizeForMatch(item.word) ===
      (currentWord ? normalizeForMatch(currentWord) : null),
  );
  useEffect(() => {
    setFailedAssetKey(null);
  }, [currentAsset?.file]);
  const micButtonStyle: React.CSSProperties = {
    ...styles.micButtonBase,
    background: isListening
      ? micHover
        ? "#ea8f88"
        : "#f3b3ae"
      : micHover
        ? "#6fc09e"
        : "#9bd8bd",
    color: "#1f2937",
    boxShadow: isListening
      ? "0 4px 18px rgba(234,143,136,0.4)"
      : "0 4px 18px rgba(111,192,158,0.4)",
    animation: isListening ? "micPulse 1.8s infinite" : undefined,
  };
  return (
    <div style={styles.container}>
      <style>{`
        @keyframes signSlideIn {
          from { opacity: 0; transform: translateX(24px) scale(0.96); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes micPulse {
          0% { box-shadow: 0 0 0 0 rgba(234, 143, 136, 0.55); }
          70% { box-shadow: 0 0 0 14px rgba(234, 143, 136, 0); }
          100% { box-shadow: 0 0 0 0 rgba(234, 143, 136, 0); }
        }
      `}</style>

      <div style={styles.header}>
        <h3 style={styles.headerTitle}>Speech to Sign</h3>
        <button
          onClick={isListening ? stopListening : startListening}
          onMouseEnter={() => setMicHover(true)}
          onMouseLeave={() => setMicHover(false)}
          disabled={!signsLoaded}
          title={!signsLoaded ? "Loading sign library..." : undefined}
          style={{
            ...micButtonStyle,
            opacity: signsLoaded ? 1 : 0.5,
            cursor: signsLoaded ? "pointer" : "not-allowed",
          }}
        >
          <span style={styles.micIcon}>{isListening ? "⏹" : "🎤"}</span>
          {!signsLoaded ? "Loading..." : isListening ? "Stop" : "Start"}
        </button>
      </div>

      <div style={styles.mainContent}>
        <div style={styles.sentenceBuilder}>
          <label htmlFor="speech-sentence-input" style={{ fontWeight: 700 }}>
            Play a sentence as signs
          </label>
          <div style={{ display: "flex", width: "100%", gap: 8 }}>
            <input
              id="speech-sentence-input"
              type="text"
              value={sentenceInput}
              onChange={(event) => setSentenceInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") queueTypedSentence();
              }}
              placeholder="Type a sentence to play..."
              style={styles.sentenceInput}
            />
            <button
              type="button"
              onClick={queueTypedSentence}
              disabled={!signsLoaded || !sentenceInput.trim()}
              style={styles.queueButton}
            >
              Play
            </button>
          </div>
          {playbackSequence.length > 0 && (
            <div style={styles.sequenceBar} aria-label="Sentence sign sequence">
              {playbackSequence.map((word, index) => (
                <span
                  key={`${index}-${word}`}
                  aria-current={index === playbackIndex ? "step" : undefined}
                  style={{
                    ...styles.sequenceToken,
                    ...(index === playbackIndex
                      ? styles.activeSequenceToken
                      : {}),
                  }}
                >
                  {word}
                </span>
              ))}
            </div>
          )}
        </div>
        {currentAsset ? (
          <div
            key={`${currentAsset.word}-${slideKey}`}
            style={{
              ...styles.signCard,
              animation: isFading ? undefined : "signSlideIn 0.4s ease-out",
              opacity: isFading ? 0 : 1,
              transform: isFading ? "scale(0.96)" : "scale(1)",
            }}
          >
            <div style={styles.signCardInner}>
              {failedAssetKey === currentAsset.file ? (
                <div style={styles.signMediaError}>
                  <p style={{ margin: 0 }}>
                    Couldn't play this file — it may be in an unsupported
                    format. Try re-uploading it as MP4 (video) or JPG/PNG
                    (image).
                  </p>
                </div>
              ) : currentAsset.type?.includes("video") ? (
                <video
                  key={currentAsset.file}
                  src={currentAsset.file}
                  autoPlay
                  muted
                  loop
                  onError={() => {
                    setFailedAssetKey(currentAsset.file);
                    showToast(
                      `Couldn't play the sign video for "${currentAsset.word}"`,
                      "error",
                    );
                  }}
                  style={styles.signMedia}
                />
              ) : (
                <img
                  src={currentAsset.file}
                  alt={currentAsset.word}
                  onError={() => {
                    setFailedAssetKey(currentAsset.file);
                    showToast(
                      `Couldn't load the sign image for "${currentAsset.word}"`,
                      "error",
                    );
                  }}
                  style={styles.signMedia}
                />
              )}
              <p style={styles.signLabel}>{currentAsset.word}</p>
            </div>
          </div>
        ) : currentWord && /^[a-z]$/.test(currentWord) ? (
          <div style={styles.fingerspellingFallback}>
            <strong>{currentWord.toUpperCase()}</strong>
            <span>
              Fingerspelling fallback. Add an A–Z sign asset to show its hand
              image here.
            </span>
          </div>
        ) : currentWord ? (
          signsLoaded ? (
            <p style={styles.noMatchText}>
              No sign available yet for "{currentWord}" — ask an admin to add
              one.
            </p>
          ) : unmatchedWord ? (
            <p style={styles.noMatchText}>
              No sign found for “{unmatchedWord}” yet. Try another word or ask an
              admin to add it to the sign dictionary.
            </p>
          ) : (
            <p style={styles.playingText}>
              Loading sign for "{currentWord}"...
            </p>
          )
        ) : (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>🎤</div>
            <p style={styles.emptyText}>Speak to see your signs</p>
          </div>
        )}

        {isListening && (
          <div style={styles.transcriptBlock}>
            <p style={styles.transcriptLabel}>Transcript</p>
            <p
              style={{
                ...styles.transcriptCenter,
                opacity: isTranscriptFading ? 0 : 1,
              }}
            >
              {transcript || "Listening..."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
const styles = {
  container: {
    width: "100%",
    maxWidth: 1040,
    minHeight: "min(620px, 90vh)",
    margin: "0 auto",
    background: "var(--pearl-surface, #fff)",
    border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
    boxShadow: "0 10px 30px rgba(15,23,42,0.08)",
    borderRadius: 24,
    overflow: "hidden",
    boxSizing: "border-box",
    position: "relative",
    display: "flex",
    flexDirection: "column",
  } as React.CSSProperties,
  header: {
    padding: "clamp(12px, 3vw, 16px)",
    borderBottom: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
    justifyContent: "space-between",
  } as React.CSSProperties,
  headerTitle: {
    color: "var(--pearl-text, #1f2937)",
    fontWeight: 600,
    margin: 0,
    fontSize: 17,
  } as React.CSSProperties,
  micButtonBase: {
    border: "none",
    cursor: "pointer",
    padding: "12px 24px",
    borderRadius: 999,
    fontWeight: 600,
    fontSize: 14,
    letterSpacing: 0.3,
    color: "#1f2937",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    transition:
      "background 0.2s ease, box-shadow 0.2s ease, transform 0.1s ease",
  } as React.CSSProperties,
  micIcon: {
    fontSize: 16,
    lineHeight: 1,
  } as React.CSSProperties,
  mainContent: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "clamp(12px, 4vw, 32px)",
    position: "relative",
    width: "100%",
    boxSizing: "border-box",
    gap: 16,
  } as React.CSSProperties,
  sentenceBuilder: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 8,
    width: "min(680px, 100%)",
    padding: 14,
    borderRadius: 16,
    background: "var(--pearl-surface-muted, #fbf9f5)",
    border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
    color: "var(--pearl-text, #1f2937)",
    fontSize: 13,
  } as React.CSSProperties,
  sentenceInput: {
    flex: 1,
    minWidth: 0,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--pearl-border, rgba(15,23,42,0.15))",
    fontSize: 14,
  } as React.CSSProperties,
  queueButton: {
    border: 0,
    borderRadius: 10,
    padding: "8px 16px",
    background: "#9bd8bd",
    color: "#1f2937",
    fontWeight: 700,
    cursor: "pointer",
  } as React.CSSProperties,
  sequenceBar: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  } as React.CSSProperties,
  sequenceToken: {
    padding: "4px 8px",
    borderRadius: 8,
    background: "#e5e7eb",
    color: "#374151",
    fontSize: 12,
    fontWeight: 700,
  } as React.CSSProperties,
  activeSequenceToken: {
    background: "#6fc09e",
    color: "#123c30",
    outline: "2px solid rgba(31,122,92,0.25)",
  } as React.CSSProperties,
  fingerspellingFallback: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    maxWidth: 360,
    padding: 28,
    borderRadius: 24,
    background: "var(--pearl-surface-muted, #fbf9f5)",
    color: "#4b5563",
    textAlign: "center",
  } as React.CSSProperties,
  transcriptBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
  } as React.CSSProperties,
  transcriptLabel: {
    color: "var(--pearl-text-muted, #6b7280)",
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    margin: 0,
  } as React.CSSProperties,
  transcriptCenter: {
    color: "var(--pearl-text, #1f2937)",
    fontSize: "clamp(14px, 2.6vw, 17px)",
    fontWeight: 500,
    textAlign: "center",
    maxWidth: "min(600px, 90%)",
    margin: 0,
    transition: `opacity ${FADE_TRANSITION_MS}ms ease-out`,
  } as React.CSSProperties,
  signCard: {
    width: "min(450px, 100%)",
    aspectRatio: "1 / 1",
    maxHeight: "min(450px, 70vh)",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    borderRadius: 32,
    background: "var(--pearl-surface-muted, #fbf9f5)",
    border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
    boxShadow: "0 12px 30px rgba(15,23,42,0.08)",
    overflow: "hidden",
    transition: "opacity 400ms ease-out, transform 400ms ease-out",
  } as React.CSSProperties,
  signCardInner: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    alignItems: "center",
    justifyContent: "center",
    padding: "clamp(12px, 4vw, 24px)",
  } as React.CSSProperties,
  signMedia: {
    width: "min(340px, 90%)",
    maxWidth: "100%",
    aspectRatio: "1 / 1",
    height: "auto",
    objectFit: "contain",
    borderRadius: 16,
    background: "rgba(15,23,42,0.04)",
  } as React.CSSProperties,
  signMediaError: {
    width: "min(340px, 90%)",
    aspectRatio: "1 / 1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    borderRadius: 16,
    background: "rgba(15,23,42,0.04)",
    color: "#b91c1c",
    fontSize: 14,
    padding: 16,
  } as React.CSSProperties,
  signLabel: {
    fontSize: "clamp(20px, 5vw, 30px)",
    fontWeight: 700,
    color: "var(--pearl-text, #1f2937)",
    marginTop: 16,
  } as React.CSSProperties,
  playingText: {
    color: "#b58a00",
    fontSize: 18,
  } as React.CSSProperties,
  noMatchText: {
    color: "#b45309",
    fontSize: 16,
    maxWidth: 360,
    textAlign: "center",
  } as React.CSSProperties,
  emptyState: {
    textAlign: "center",
    maxWidth: 420,
  } as React.CSSProperties,
  emptyIcon: {
    fontSize: 60,
    marginBottom: 16,
    opacity: 0.35,
  } as React.CSSProperties,
  emptyText: {
    color: "var(--pearl-text-muted, #6b7280)",
    fontSize: 18,
    margin: 0,
  } as React.CSSProperties,
};
export default SpeechGesture;