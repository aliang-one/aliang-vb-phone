// Pure helpers for assembling the visible transcript from STT events.
// Kept side-effect free so they are trivially unit-testable.

/**
 * Append a finalized sentence to the running transcript. Empty/whitespace
 * finals are ignored; the sentence is trimmed. Chinese needs no separator.
 */
export function appendFinalTranscript(current: string, sentence: string): string {
  const trimmed = sentence.trim();
  if (!trimmed) return current;
  return current + trimmed;
}

/**
 * Build the live caption shown while recording: the committed transcript plus
 * the current (still-changing) partial of the in-flight sentence.
 */
export function buildLiveCaption(transcript: string, partial: string): string {
  return transcript + (partial ?? '');
}
