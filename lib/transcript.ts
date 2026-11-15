import { existsSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseVtt } from "./utils";
import type { TranscriptCue } from "./types";

const execFileAsync = promisify(execFile);

function ytDlpPath() {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  const bundled = path.join(/* turbopackIgnore: true */ process.cwd(), "bin", "yt-dlp");
  return existsSync(bundled) ? bundled : "yt-dlp";
}

type SubtitleFormat = { ext?: string; url?: string; name?: string };
type YoutubeMetadata = {
  id: string;
  title?: string;
  channel?: string;
  uploader?: string;
  thumbnail?: string;
  duration?: number;
  description?: string;
  language?: string;
  subtitles?: Record<string, SubtitleFormat[]>;
  automatic_captions?: Record<string, SubtitleFormat[]>;
};

export type ExtractedYoutube = {
  youtubeId: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
  durationSeconds: number;
  description: string;
  sourceLanguage: string;
  transcriptSource: "manual" | "automatic" | "";
  cues: TranscriptCue[];
};

// YouTube a veces declara mal el idioma (p. ej. «ar» en un video en español). Se deduce del título y la descripción.
export function guessTextLanguage(text: string) {
  const sample = ` ${text.toLocaleLowerCase()} `;
  const latin = (sample.match(/[a-záéíóúñü]/g) ?? []).length;
  const other = (sample.match(/[\u0400-\u04ff\u0590-\u06ff\u0900-\u0dff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/g) ?? []).length;
  if (other > latin) return "";
  const count = (words: string[]) => words.reduce((total, word) => total + (sample.split(` ${word} `).length - 1), 0);
  const es = count(["el", "la", "los", "las", "de", "del", "que", "por", "para", "con", "una", "es", "y", "en", "se", "su"]) + (/[ñáéíóú¿¡]/.test(sample) ? 3 : 0);
  const en = count(["the", "and", "of", "to", "is", "in", "for", "with", "this", "that", "you", "how", "what"]);
  const pt = count(["não", "uma", "você", "com", "para", "dos", "das", "é"]);
  if (es >= 3 && es > en && es >= pt) return "es";
  if (en >= 3 && en > es) return "en";
  if (pt >= 3 && pt > es) return "pt";
  return "";
}

function languageCandidates(preferredLanguages: string[], tracks: Record<string, SubtitleFormat[]>, automatic: boolean) {
  const keys = Object.keys(tracks).filter((key) => key !== "live_chat");
  // En los subtítulos automáticos, «xx-orig» es lo que se dijo de verdad; el resto son traducciones automáticas.
  const ordered = automatic
    ? [...preferredLanguages.map((language) => `${language}-orig`), ...keys.filter((key) => key.endsWith("-orig")), ...preferredLanguages]
    : preferredLanguages;
  return [...new Set(ordered)].filter((key) => keys.includes(key));
}

function subtitleTracks(metadata: YoutubeMetadata) {
  const guessed = guessTextLanguage(`${metadata.title ?? ""} ${metadata.description ?? ""}`);
  const declared = metadata.language?.split("-")[0];
  const preferred = [guessed, metadata.language, declared, "es", "es-419", "en", "en-US"].filter(Boolean) as string[];
  const candidates: Array<{ source: "manual" | "automatic"; language: string; formats: SubtitleFormat[] }> = [];
  const manual = metadata.subtitles ?? {};
  const automatic = metadata.automatic_captions ?? {};
  // Subtítulos escritos a mano solo si están en el idioma del video; si no, mejor los automáticos originales.
  const original = guessed || declared || "";
  for (const language of languageCandidates(original ? [original, `${original}-419`] : preferred, manual, false).slice(0, 1)) candidates.push({ source: "manual", language, formats: manual[language] ?? [] });
  for (const language of languageCandidates(preferred, automatic, true).slice(0, 2)) candidates.push({ source: "automatic", language, formats: automatic[language] ?? [] });
  return candidates;
}

async function downloadSubtitle(metadata: YoutubeMetadata, url: string) {
  const tracks = subtitleTracks(metadata);
  if (!tracks.length) {
    return { cues: [] as TranscriptCue[], source: "" as const, language: metadata.language ?? "" };
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-subs-"));
  const ytDlp = ytDlpPath();
  try {
    for (const track of tracks) {
      const format = track.formats.find((item) => item.ext === "vtt" && item.url);
      if (format?.url) {
        try {
          const response = await fetch(format.url, {
            headers: { "User-Agent": "Mozilla/5.0" },
            signal: AbortSignal.timeout(12_000),
          });
          if (response.ok) {
            const cues = parseVtt(await response.text());
            if (cues.length) return { cues, source: track.source, language: track.language };
          }
        } catch {
          // Signed subtitle URLs occasionally expire or are throttled; yt-dlp gets a fresh one below.
        }
      }

      try {
        await execFileAsync(ytDlp, [
          "--skip-download",
          "--no-playlist",
          "--no-warnings",
          track.source === "manual" ? "--write-subs" : "--write-auto-subs",
          "--sub-langs", track.language,
          "--sub-format", "vtt",
          "-o", path.join(directory, "%(id)s.%(ext)s"),
          url,
        ], { maxBuffer: 10 * 1024 * 1024, timeout: 60_000 });
      } catch {
        // Try the next available language/source before declaring that a transcript is needed.
      }

      const subtitleFile = (await fs.readdir(directory)).find((name) => name.endsWith(".vtt"));
      if (subtitleFile) {
        const cues = parseVtt(await fs.readFile(path.join(directory, subtitleFile), "utf8"));
        if (cues.length) return { cues, source: track.source, language: track.language };
        await fs.rm(path.join(directory, subtitleFile), { force: true });
      }
    }
    return { cues: [] as TranscriptCue[], source: "" as const, language: metadata.language ?? tracks[0]?.language ?? "" };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function extractYoutube(url: string): Promise<ExtractedYoutube> {
  const ytDlp = ytDlpPath();
  const { stdout } = await execFileAsync(ytDlp, [
    "--dump-single-json",
    "--skip-download",
    "--ignore-no-formats-error",
    "--no-playlist",
    "--no-warnings",
    url,
  ], { maxBuffer: 20 * 1024 * 1024, timeout: 60_000 });
  const metadata = JSON.parse(stdout) as YoutubeMetadata;
  const transcript = await downloadSubtitle(metadata, url);
  return {
    youtubeId: metadata.id,
    title: metadata.title || "Video sin título",
    channel: metadata.channel || metadata.uploader || "Canal desconocido",
    thumbnailUrl: metadata.thumbnail || `https://i.ytimg.com/vi/${metadata.id}/hqdefault.jpg`,
    durationSeconds: Math.round(metadata.duration || 0),
    description: metadata.description || "",
    sourceLanguage: transcript.language || metadata.language || "",
    transcriptSource: transcript.source,
    cues: transcript.cues,
  };
}

// Tramos de 10 minutos: por debajo del límite de duración y tamaño de la transcripción de OpenAI.
export const AUDIO_SEGMENT_SECONDS = 600;

function audioSplitterPath() {
  const bundled = path.join(/* turbopackIgnore: true */ process.cwd(), "bin", "lumina-audio-split");
  return existsSync(bundled) ? bundled : "";
}

export async function downloadAudioSegments(url: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-audio-"));
  const original = path.join(directory, "source.m4a");
  // Se pide el audio ya en m4a: así no hace falta ffmpeg para convertirlo.
  await execFileAsync(ytDlpPath(), [
    "--no-playlist",
    "-f", "bestaudio[ext=m4a]/best[ext=mp4]",
    "-o", original,
    url,
  ], { maxBuffer: 10 * 1024 * 1024, timeout: 10 * 60_000 });

  const splitter = audioSplitterPath();
  if (splitter) {
    // Corta con AVFoundation (incluido en macOS, funciona en Apple Silicon e Intel).
    const { stdout } = await execFileAsync(splitter, [original, directory, String(AUDIO_SEGMENT_SECONDS)], { maxBuffer: 1024 * 1024, timeout: 10 * 60_000 });
    // Los tramos casi vacíos (cola de silencio o duración mal declarada) no se envían.
    const files = stdout.split("\n").map((line) => line.trim()).filter((file) => file && existsSync(file) && statSync(file).size > 8_000);
    if (files.length) return { directory, files };
  }
  const segmentPattern = path.join(directory, "segment-%03d.m4a");
  await execFileAsync(process.env.FFMPEG_PATH || "ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", original,
    "-f", "segment",
    "-segment_time", String(AUDIO_SEGMENT_SECONDS),
    "-c", "copy",
    segmentPattern,
  ], { timeout: 10 * 60_000 });
  const files = (await fs.readdir(directory))
    .filter((name) => name.startsWith("segment-") && name.endsWith(".m4a"))
    .sort()
    .map((name) => path.join(directory, name));
  return { directory, files };
}

export async function removeTemporaryAudio(directory: string) {
  await fs.rm(directory, { recursive: true, force: true });
}
