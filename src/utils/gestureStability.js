export class GestureStabilityTracker {
  constructor(confidenceThreshold, stabilityMs, minimumFrames) {
    this.confidenceThreshold = confidenceThreshold;
    this.stabilityMs = stabilityMs;
    this.minimumFrames = minimumFrames;
  }

  reset() {
    this.candidate = null;
    this.candidateSince = 0;
    this.agreeingFrames = 0;
    this.accepted = false;
  }

  hasAccepted(word) {
    return this.candidate === word && this.accepted;
  }

  accepts(word, confidence, now) {
    if (confidence < this.confidenceThreshold) {
      this.reset();
      return false;
    }
    if (this.candidate !== word) {
      this.candidate = word;
      this.candidateSince = now;
      this.agreeingFrames = 1;
      this.accepted = false;
      return false;
    }
    this.agreeingFrames += 1;
    if (
      this.accepted ||
      this.agreeingFrames < this.minimumFrames ||
      now - this.candidateSince < this.stabilityMs
    ) {
      return false;
    }
    this.accepted = true;
    return true;
  }
}

export function shouldSpeakGesture(text, targetLanguage, now, previous, cooldownMs) {
  return (
    previous.text !== text ||
    previous.targetLanguage !== targetLanguage ||
    now - previous.spokenAt >= cooldownMs
  );
}
