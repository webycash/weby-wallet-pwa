// Browser keep-alive utilities for background mining.
//
// 1. Screen Wake Lock — prevents screen dimming on laptops.
// 2. Silent AudioContext — prevents Chrome's "intensive throttling"
//    (timers throttled to 1/min after 5 min background). A page
//    "playing audio" stays in normal throttling mode.

// ── Screen Wake Lock ────────────────────────────────────────────

let wakeLock: WakeLockSentinel | null = null;

export const acquireWakeLock = async (): Promise<void> => {
	if (!('wakeLock' in navigator)) return;
	try {
		wakeLock = await navigator.wakeLock.request('screen');
		wakeLock.addEventListener('release', () => { wakeLock = null; });
	} catch { /* user denied or not supported */ }
};

export const releaseWakeLock = (): void => {
	wakeLock?.release();
	wakeLock = null;
};

/** Re-acquire after browser releases it on visibility:hidden. */
export const reacquireWakeLock = async (): Promise<void> => {
	if (!wakeLock && 'wakeLock' in navigator) await acquireWakeLock();
};

// ── Silent AudioContext keep-alive ──────────────────────────────

let audioCtx: AudioContext | null = null;
let oscillator: OscillatorNode | null = null;

export const startAudioKeepAlive = (): void => {
	if (audioCtx) return;
	try {
		audioCtx = new AudioContext();
		const gain = audioCtx.createGain();
		gain.gain.value = 0; // silent
		gain.connect(audioCtx.destination);
		oscillator = audioCtx.createOscillator();
		oscillator.connect(gain);
		oscillator.start();
	} catch { /* AudioContext not available */ }
};

export const stopAudioKeepAlive = (): void => {
	oscillator?.stop();
	oscillator = null;
	audioCtx?.close();
	audioCtx = null;
};
