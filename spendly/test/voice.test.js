import test from 'node:test';
import assert from 'node:assert/strict';
import { speechSupport, createVoiceInput } from '../public/js/ui/voice.js';

/** A stand-in for the browser's speech recognizer. */
function fakeWindow({ deny = false } = {}) {
  const instances = [];
  class FakeRecognition {
    constructor() { instances.push(this); this.started = false; }
    start() {
      this.started = true;
      if (deny) queueMicrotask(() => { this.onerror?.({ error: 'not-allowed' }); this.onend?.(); });
    }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
    say(text, isFinal = true) { this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] }); }
  }
  return { win: { webkitSpeechRecognition: FakeRecognition }, instances };
}

test('speech recognition is feature-detected', () => {
  assert.equal(speechSupport({}).supported, false);
  assert.equal(speechSupport(fakeWindow().win).supported, true);
  assert.equal(speechSupport({ SpeechRecognition: function S() {} }).supported, true);
});

test('unsupported browsers get a typing / keyboard-dictation fallback message', () => {
  const errors = [];
  const v = createVoiceInput({ win: {}, onError: (e) => errors.push(e) });
  assert.equal(v.supported, false);
  assert.equal(v.start(), false);
  assert.equal(errors[0].code, 'unsupported');
  assert.match(errors[0].message, /keyboard/);
});

test('transcript is delivered as editable text; one utterance only; nothing else happens', () => {
  const { win, instances } = fakeWindow();
  const texts = [];
  const states = [];
  const v = createVoiceInput({ win, onText: (t, f) => texts.push([t, f]), onState: (s) => states.push(s) });
  assert.equal(v.start(), true);
  const rec = instances[0];
  assert.equal(rec.continuous, false);
  assert.equal(rec.lang, 'en-IN');
  rec.say('I spent forty rupees', false);
  rec.say('I spent forty rupees on dosa for breakfast', true);
  v.stop();
  assert.deepEqual(texts.at(-1), ['I spent forty rupees on dosa for breakfast', true]);
  assert.deepEqual(states, ['listening', 'idle']);
  assert.equal(v.active, false);
});

test('denied microphone permission is reported gracefully', async () => {
  const { win } = fakeWindow({ deny: true });
  const errors = [];
  const states = [];
  const v = createVoiceInput({ win, onError: (e) => errors.push(e), onState: (s) => states.push(s) });
  v.start();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(errors[0].code, 'not-allowed');
  assert.match(errors[0].message, /permission was denied/);
  assert.equal(states.at(-1), 'idle');
});

test('listening stops automatically after the time limit', async () => {
  const { win } = fakeWindow();
  const states = [];
  const v = createVoiceInput({ win, maxMs: 20, onState: (s) => states.push(s) });
  v.start();
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(states, ['listening', 'idle']);
});
