// Voice input for Smart Entry, using the browser's built-in speech recognition
// (Web Speech API). Spendly itself never records, stores or uploads audio; the
// browser's own recognizer does the transcription (on iPhone this is Apple's
// dictation service). Only the resulting text is used, and only after the user
// reviews it — a transcript can never save anything by itself.

const MESSAGES = {
  'not-allowed': 'Microphone or speech-recognition permission was denied. To allow it on iPhone: Settings → Apps → Safari → Microphone (and Settings → Siri → Siri & Dictation must be on). You can always type, or use the 🎤 key on your keyboard.',
  'service-not-allowed': 'Speech recognition is turned off on this device. On iPhone, turn on Dictation (Settings → General → Keyboard → Enable Dictation), or just type.',
  'no-speech': 'No speech was heard. Tap the microphone and try again.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition could not reach your device’s speech service. Check your connection, or type instead.',
  'language-not-supported': 'Speech recognition does not support this language here. Type instead.',
  unsupported: 'Voice input is not available in this browser. Tap the text box and use the 🎤 key on your keyboard instead.',
};

export function speechSupport(win = globalThis) {
  const Ctor = win?.SpeechRecognition || win?.webkitSpeechRecognition || null;
  return { supported: typeof Ctor === 'function', Ctor };
}

/**
 * @param {{ win?: object, lang?: string, maxMs?: number,
 *           onText?: (text: string, isFinal: boolean) => void,
 *           onState?: (state: 'listening'|'idle') => void,
 *           onError?: (err: { code: string, message: string }) => void }} opts
 */
export function createVoiceInput({ win = globalThis, lang = 'en-IN', maxMs = 20000, onText, onState, onError } = {}) {
  const { supported, Ctor } = speechSupport(win);
  let rec = null;
  let timer = null;
  let active = false;
  let finalText = '';

  const fail = (code, detail) => onError?.({ code, message: MESSAGES[code] || `Voice input stopped (${detail || code}). You can type instead.` });

  function start() {
    if (!supported) {
      fail('unsupported');
      return false;
    }
    if (active) return true;
    finalText = '';
    try {
      rec = new Ctor();
      rec.lang = lang;
      rec.interimResults = true;
      rec.continuous = false; // one utterance — never keeps listening in the background
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex ?? 0; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += `${r[0].transcript} `;
          else interim += r[0].transcript;
        }
        onText?.(`${finalText}${interim}`.replace(/\s+/g, ' ').trim(), !interim);
      };
      rec.onerror = (e) => {
        if (e.error !== 'aborted') fail(e.error, e.message);
      };
      rec.onend = () => {
        active = false;
        clearTimeout(timer);
        onState?.('idle');
      };
      rec.start();
    } catch (err) {
      active = false;
      fail(err?.name === 'NotAllowedError' ? 'not-allowed' : 'start-failed', err?.message);
      return false;
    }
    active = true;
    onState?.('listening');
    timer = setTimeout(stop, maxMs); // hard stop: no long recordings
    return true;
  }

  function stop() {
    clearTimeout(timer);
    try { rec?.stop(); } catch { /* already stopped */ }
  }

  function abort() {
    clearTimeout(timer);
    try { rec?.abort?.(); } catch { /* ignore */ }
    active = false;
  }

  return { start, stop, abort, supported, get active() { return active; } };
}
