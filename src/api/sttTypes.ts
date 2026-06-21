// Phone-side mirror of the /ws/stt protocol (see server src/stt/types.ts).
// JSON control messages; binary frames (sent separately) carry PCM audio.

/** Phone -> Server control messages. */
export type SttControlIn =
  // session_id/project_path scope the persisted recording to its vibecoding
  // session; channels/bits describe the PCM stream so the saved WAV is correct.
  | {
      type: 'stt.start';
      request_id: string;
      lang: string;
      sample_rate: number;
      session_id?: string;
      project_path?: string;
      channels?: number;
      bits?: number;
    }
  | { type: 'stt.stop'; request_id: string };

/** Server -> Phone control messages. */
export type SttControlOut =
  | { type: 'stt.started'; request_id: string; stt_session_id: string }
  | { type: 'stt.partial'; text: string }
  | { type: 'stt.final'; text: string; sentence_id: string }
  | { type: 'stt.completed'; request_id: string; full_text: string }
  | { type: 'stt.error'; code: string; message: string };

export function isSttControlOut(value: unknown): value is SttControlOut {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === 'stt.started' ||
    type === 'stt.partial' ||
    type === 'stt.final' ||
    type === 'stt.completed' ||
    type === 'stt.error'
  );
}
