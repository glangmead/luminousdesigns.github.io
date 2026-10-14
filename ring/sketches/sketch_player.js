// Plays Motif Sketch performances on the app's piano samples, for the tempo page
// (`tempo_page.py`) and the web site's sketch page (`site_page.py`).
//
// - **Notes** are `[pitch, onset, duration, velocity]`, onsets and durations in
//   quarter-note beats, as `dump_performances.swift` prints them.
// - **Piano** zones are `{min, max, root, minVelocity, maxVelocity, file}`: each note
//   plays the sample of the zone holding its pitch and velocity, pitch-shifted from the
//   root key, through a light synthetic reverb.
// - **Loudness** scales in proportion to velocity, relative to an unmarked note's 80, as
//   the app's `AVAudioUnitSampler` does with `piano.aupreset` (rendered offline, a note at
//   105 is 105/95 as loud as at 95 at every pitch tried).
// - **A fresh AudioContext per play.** A context that sat idle across a sleep can be left
//   "interrupted", or "running" with its clock stopped, and its `resume()` may never settle,
//   so Play went silent with no error. A new context costs a few milliseconds; the decoded
//   samples and the reverb's impulse are reused across contexts.

const UNMARKED_VELOCITY = 80;

class SketchPlayer {
  #zones;
  #buffers = null;
  #loading = null;
  #impulse = null;
  #context = null;
  #output = null;
  #current = null; // { id, sources, timer, onStop }
  #generation = 0;

  constructor(zones) {
    this.#zones = zones;
    // Safari on iPhone mutes Web Audio with the ring/silent switch unless the session plays.
    if (navigator.audioSession) navigator.audioSession.type = "playback";
  }

  get playingID() {
    return this.#current?.id ?? null;
  }

  // Call synchronously in the click handler: a browser only lets a user gesture start
  // audio, and an `await` before the context is made can lose the gesture (Safari).
  // Rejects if the audio can't start; `onStop` runs when the sketch ends or is stopped.
  async play(id, notes, quartersPerMinute, onStop = () => {}) {
    this.stop();
    const generation = ++this.#generation;
    const context = this.#freshContext();
    await withTimeout(Promise.all([context.resume(), this.#load(context)]), 8000);
    if (generation !== this.#generation) return; // a later play or stop superseded this one
    if (context.state !== "running") throw new Error(`audio is ${context.state}`);

    const secondsPerBeat = 60 / quartersPerMinute;
    const start = context.currentTime + 0.1;
    const sources = [];
    let end = 0;
    for (const [pitch, onset, duration, velocity = UNMARKED_VELOCITY] of notes) {
      const index = this.#zoneIndex(pitch, velocity);
      const source = context.createBufferSource();
      source.buffer = this.#buffers[index];
      source.playbackRate.value = Math.pow(2, (pitch - this.#zones[index].root) / 12);
      const gain = context.createGain();
      const on = start + onset * secondsPerBeat;
      const off = on + duration * secondsPerBeat;
      const level = velocity / UNMARKED_VELOCITY;
      gain.gain.setValueAtTime(level, on);
      gain.gain.setValueAtTime(level, off);
      gain.gain.exponentialRampToValueAtTime(0.001, off + 0.3);
      source.connect(gain).connect(this.#output);
      source.start(on);
      source.stop(off + 0.35);
      sources.push(source);
      end = Math.max(end, off + 0.35);
    }
    const timer = setTimeout(() => this.stop(), (end - context.currentTime) * 1000);
    this.#current = { id, sources, timer, onStop };
  }

  stop() {
    this.#generation++;
    const current = this.#current;
    this.#current = null;
    if (!current) return;
    clearTimeout(current.timer);
    for (const source of current.sources) source.stop();
    current.onStop();
  }

  #freshContext() {
    this.#context?.close().catch(() => {});
    const context = new AudioContext();
    this.#impulse ??= impulse(context, 2.5);
    const output = context.createGain();
    output.gain.value = 0.5;
    const reverb = context.createConvolver();
    reverb.buffer = this.#impulse;
    const wet = context.createGain();
    wet.gain.value = 0.25;
    output.connect(context.destination);
    output.connect(reverb).connect(wet).connect(context.destination);
    context.addEventListener("statechange", () => {
      if (context === this.#context && context.state !== "running" && this.#current) this.stop();
    });
    this.#context = context;
    this.#output = output;
    return context;
  }

  // The samples, decoded once. A failed load is forgotten, so the next play retries it.
  // A page opened from disk gets status 0 for a file it read fine (Safari), so there an
  // empty body is the only failure.
  #load(context) {
    const fromDisk = location.protocol === "file:";
    this.#loading ??= Promise.all(this.#zones.map(async zone => {
      const response = await fetch(zone.file);
      if (!response.ok && !(fromDisk && response.status === 0)) {
        throw new Error(`${zone.file}: HTTP ${response.status}`);
      }
      const data = await response.arrayBuffer();
      if (data.byteLength === 0) {
        throw new Error(`${zone.file} is empty${fromDisk ? "; the browser may not read files from disk, so serve the page" : ""}`);
      }
      return context.decodeAudioData(data);
    })).then(loaded => { this.#buffers = loaded; }, error => { this.#loading = null; throw error; });
    return this.#loading;
  }

  // The zone for `pitch` in `velocity`'s layer, else the nearest zone in that layer.
  #zoneIndex(pitch, velocity) {
    const layer = this.#zones
      .map((zone, index) => ({ zone, index }))
      .filter(({ zone }) => zone.minVelocity <= velocity && velocity <= zone.maxVelocity);
    const zones = layer.length ? layer : this.#zones.map((zone, index) => ({ zone, index }));
    const match = zones.find(({ zone }) => zone.min <= pitch && pitch <= zone.max);
    if (match) return match.index;
    return pitch < zones[0].zone.min ? zones[0].index : zones[zones.length - 1].index;
  }
}

function impulse(context, seconds) {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) samples[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
  }
  return buffer;
}

function withTimeout(promise, milliseconds) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("audio didn't start")), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
