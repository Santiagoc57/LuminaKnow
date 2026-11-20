// Sonidos muy suaves para las acciones principales, generados al vuelo (sin archivos).
// Se pueden apagar en Ajustes; la preferencia vive en este navegador.

export type SoundName = "save" | "done" | "remove" | "pin" | "tap";

let context: AudioContext | null = null;

export function soundsEnabled() {
  try { return window.localStorage.getItem("lumina-sounds") !== "0"; } catch { return true; }
}
export function setSoundsEnabled(on: boolean) {
  try { window.localStorage.setItem("lumina-sounds", on ? "1" : "0"); } catch { /* sin almacenamiento */ }
}

// Cada sonido: notas (Hz) con su retraso, campana corta y volumen bajo.
const SOUNDS: Record<SoundName, Array<[number, number]>> = {
  save: [[659.25, 0], [987.77, 0.07]],
  done: [[783.99, 0], [1174.66, 0.06]],
  remove: [[523.25, 0], [392, 0.07]],
  pin: [[880, 0]],
  tap: [[1046.5, 0]],
};

export function playSound(name: SoundName) {
  if (typeof window === "undefined" || !soundsEnabled()) return;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    context ??= new Ctor();
    if (context.state === "suspended") void context.resume();
    const now = context.currentTime;
    for (const [frequency, delay] of SOUNDS[name]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const start = now + delay;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(name === "tap" ? 0.035 : 0.05, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.34);
    }
  } catch { /* sin audio */ }
}
