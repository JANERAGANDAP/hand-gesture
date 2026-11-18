export interface LastGestureSpeech {
  text: string;
  targetLanguage: string;
  spokenAt: number;
}

export class GestureStabilityTracker {
  constructor(
    confidenceThreshold: number,
    stabilityMs: number,
    minimumFrames: number,
  );
  reset(): void;
  hasAccepted(word: string): boolean;
  accepts(word: string, confidence: number, now: number): boolean;
}

export function shouldSpeakGesture(
  text: string,
  targetLanguage: string,
  now: number,
  previous: LastGestureSpeech,
  cooldownMs: number,
): boolean;
