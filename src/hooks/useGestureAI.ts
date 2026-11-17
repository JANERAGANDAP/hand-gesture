import { useRef, useCallback } from "react";
import {
  findAISentence,
  saveAISentenceHistory,
} from "../services/aiHistoryApi";
import { buildSmartSentence } from "../utils/sentenceBuilder";
interface Point {
  x: number;
  y: number;
}
export function calculateAngle(a: Point, b: Point, c: Point): number {
  const ab = {
    x: a.x - b.x,
    y: a.y - b.y,
  };
  const cb = {
    x: c.x - b.x,
    y: c.y - b.y,
  };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.sqrt(ab.x * ab.x + ab.y * ab.y);
  const magCB = Math.sqrt(cb.x * cb.x + cb.y * cb.y);
  const denom = magAB * magCB;
  if (denom === 0) return 0;
  const cosine = Math.max(-1, Math.min(1, dot / denom));
  return Math.acos(cosine) * (180 / Math.PI);
}
export function detectPoseGesture(pose: any[]) {
  if (!pose) return "detecting";
  const LEFT_SHOULDER = pose[11];
  const LEFT_ELBOW = pose[13];
  const LEFT_WRIST = pose[15];
  const RIGHT_SHOULDER = pose[12];
  const RIGHT_ELBOW = pose[14];
  const RIGHT_WRIST = pose[16];
  const visible = (p: any) => p && p.visibility > 0.65;
  if (
    !visible(LEFT_SHOULDER) ||
    !visible(LEFT_ELBOW) ||
    !visible(LEFT_WRIST) ||
    !visible(RIGHT_SHOULDER) ||
    !visible(RIGHT_ELBOW) ||
    !visible(RIGHT_WRIST)
  ) {
    return "detecting";
  }
  const leftArmAngle = calculateAngle(LEFT_SHOULDER, LEFT_ELBOW, LEFT_WRIST);
  const rightArmAngle = calculateAngle(
    RIGHT_SHOULDER,
    RIGHT_ELBOW,
    RIGHT_WRIST,
  );
  const leftHandUp = LEFT_WRIST.y < LEFT_SHOULDER.y;
  const rightHandUp = RIGHT_WRIST.y < RIGHT_SHOULDER.y;
  const bothHandsUp = leftHandUp && rightHandUp;
  const armsStraight = leftArmAngle > 155 && rightArmAngle > 155;
  const leftOnly = leftHandUp && leftArmAngle > 145;
  const rightOnly = rightHandUp && rightArmAngle > 145;
  if (bothHandsUp && armsStraight) return "hands_up";
  if (leftOnly && !rightHandUp) return "left_hand_up";
  if (rightOnly && !leftHandUp) return "right_hand_up";
  return "detecting";
}
const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
export function useGestureAI() {
  const abortRef = useRef<AbortController | null>(null);
  const composeSentence = useCallback(
    async (
      words: string[],
      language: string,
      onToken: (partial: string) => void,
      onDone: (final: string) => void,
    ) => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const input = words.slice(-10).join(" ");
      const existing = await findAISentence(language, input);
      if (existing) {
        onToken(existing.composedSentence);
        onDone(existing.composedSentence);
        return;
      }
      // Try the AI server. If it's not available, fall back to the local
      // smart sentence builder (works fully offline).
      const localFallback = () => {
        const result = buildSmartSentence(words.slice(-10));
        onToken(result);
        onDone(result);
      };
      const systemPrompt = `
        You are a Filipino Sign Language (FSL) sentence reconstruction engine that supports English, Tagalog, and Cebuano/Bisaya output.

        ROLE:
        Convert a sequence of recognized sign-language gloss tokens into a natural, grammatically correct spoken sentence.
        Detect the language context from the tokens: Cebuano glosses (kaon, karon, dili, asa, unsa, etc.) → output Cebuano.
        Tagalog glosses (kain, saan, gutom, etc.) → output Tagalog. English-only tokens → output English.
        Default output language is Cebuano/Bisaya unless tokens clearly indicate otherwise.

        STRICT RULES:
        - Output ONLY the final sentence.
        - Do NOT explain, describe, analyze, or comment.
        - Do NOT mention gestures, signs, tokens, translations, confidence scores, or corrections.
        - Do NOT use quotation marks.
        - Do NOT use bullet points, numbering, labels, or markdown.
        - Return exactly ONE sentence.
        - Maximum 15 words.
        - Preserve the original meaning and intent.
        - Infer missing connecting words (linkers, aspect markers, etc.) naturally.
        - Fix grammar, word order, tense, and pronouns naturally.
        - Remove accidental repetitions unless repetition changes meaning.
        - If tokens are incomplete, produce the most natural sentence possible.
        - If the input already forms a correct sentence, return it with proper punctuation.
        - Always end with appropriate punctuation (. ? !).

        EXAMPLES (English FSL):

        Input: good morning
        Output: Good morning.

        Input: good morning you
        Output: Good morning, how are you?

        Input: hello you
        Output: Hello, how are you?

        Input: help help
        Output: I need help.

        Input: i hungry
        Output: I am hungry.

        Input: thank you
        Output: Thank you.

        Input: where bathroom
        Output: Where is the bathroom?

        Input: me go school
        Output: I am going to school.

        Input: you name what
        Output: What is your name?

        Input: sorry late
        Output: I am sorry I am late.

        Input: need water
        Output: I need water.

        Input: me want eat
        Output: I want to eat.

        EXAMPLES (Cebuano/Bisaya FSL glosses):

        Input: ako kaon karon lunch
        Output: Mukaon ko og lunch karon.

        Input: ako gigutom
        Output: Gigutom ko.

        Input: ako giuhaw tubig
        Output: Giuhaw ko, gusto ko og tubig.

        Input: asa cr
        Output: Asa ang comfort room?

        Input: unsa imong ngalan
        Output: Unsa may imong ngalan?

        Input: salamat
        Output: Salamat.

        Input: dili ako andam
        Output: Dili pa ko andam.

        Input: ako adto eskwelahan karon
        Output: Moadto ko sa eskwelahan karon.

        Input: tabang tabang
        Output: Tabang! Kinahanglan ko og tabang!

        Input: ako kaon paniudto ugma
        Output: Mukaon ko og paniudto ugma.

        Input: ikaw maayo
        Output: Okay ka ba?

        Input: ako kapoy
        Output: Kapoy kaayo ko.

        Input: palihug tubig
        Output: Palihug og tubig, salamat.

        Input: stop
        Output: Hunong.

        EXAMPLES (Tagalog FSL glosses):

        Input: ako kain ngayon lunch
        Output: Kakain ako ng lunch ngayon.

        Input: saan banyo
        Output: Nasaan ang banyo?

        Input: gutom ako
        Output: Gutom ako.

        FINAL INSTRUCTION:
        Your entire response must contain only the completed sentence and nothing else.
      `.trim();
      try {
        const res = await fetch(`${API_BASE}/ai`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: abortRef.current.signal,
          body: JSON.stringify({
            messages: [
              {
                role: "system",
                content: systemPrompt,
              },
              {
                role: "user",
                content: input,
              },
            ],
          }),
        });
        if (res.status === 429) {
          console.warn(
            "AI sentence composition rate-limited — using local sentence builder.",
          );
          localFallback();
          return;
        }
        if (!res.ok) {
          console.warn(
            `AI sentence composition failed with status ${res.status} — using local sentence builder.`,
          );
          localFallback();
          return;
        }
        const data = await res.json();
        const text = data.message?.content?.trim() || "";
        if (!text) {
          // Groq returned empty — use local fallback
          localFallback();
          return;
        }
        saveAISentenceHistory(language, input, text).catch((error) => {
          console.warn("AI sentence history save failed:", error);
        });
        onToken(text);
        onDone(text);
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.warn("[AI Error] — using local sentence builder:", err);
          // Network error or Groq not configured → local fallback
          localFallback();
        }
      }
    },
    [],
  );
  const cleanup = useCallback(() => {
    abortRef.current?.abort();
  }, []);
  return {
    composeSentence,
    cleanup,
  };
}
