/**
 * Recording container/codec candidates in preference order. MP4/H.264 is the
 * easiest to drop into an editor; Chrome (126+) and Safari can record it.
 * Otherwise fall back to WebM. Types naming an audio codec come first so a
 * microphone track can be recorded alongside the video.
 */
export const RECORDING_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function pickRecordingMimeType(isTypeSupported: (type: string) => boolean): string | null {
  for (const type of RECORDING_CANDIDATES) {
    try {
      if (isTypeSupported(type)) return type;
    } catch {
      // Some browsers throw on unknown types; treat as unsupported.
    }
  }
  return null;
}

/**
 * File extension for the format the recorder *actually* produced. A WebM
 * file is never labelled .mp4.
 */
export function extensionForMimeType(mimeType: string): 'mp4' | 'webm' | 'mkv' | null {
  const base = mimeType.split(';')[0].trim().toLowerCase();
  if (base === 'video/mp4') return 'mp4';
  if (base === 'video/webm') return 'webm';
  if (base === 'video/x-matroska') return 'mkv';
  return null;
}
