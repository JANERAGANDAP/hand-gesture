export function shouldThrottleRecognition(now, lastCall, minInterval) {
  return now - lastCall < minInterval;
}
