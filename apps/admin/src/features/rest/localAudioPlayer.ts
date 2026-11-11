/** Optional user-selected local audio. Object URLs stay in this browser session;
 * no file upload, storage, remote fallback or assumptions about the file's song. */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { MediaSnapshot } from "./youtubePlayer";

const initial: MediaSnapshot = { status: "loading", currentTime: 0, duration: 0, volume: 40, autoplayBlocked: false, error: null };
const bounded = (value: number, max: number) => Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;

export function useLocalAudioPlayer(element: RefObject<HTMLAudioElement | null>, source: string | undefined,
  canPlay: () => boolean, onEnded: () => boolean, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<MediaSnapshot>(initial);
  const [attempt, setAttempt] = useState(0);
  const callbacks = useRef({ canPlay, onEnded });
  callbacks.current = { canPlay, onEnded };
  const playRef = useRef<() => void>(() => undefined);
  const desiredVolume = useRef(initial.volume);
  const wantsPlayback = useRef(true);
  const playRequest = useRef(0);

  useEffect(() => {
    const audio = element.current;
    if (!audio || !source || !enabled) return;
    let disposed = false;
    wantsPlayback.current = true;
    setSnapshot({ ...initial, volume: desiredVolume.current });
    audio.volume = desiredVolume.current / 100;
    const play = () => {
      if (disposed || !wantsPlayback.current || !callbacks.current.canPlay()) return;
      const request = ++playRequest.current;
      void audio.play().catch((error: unknown) => {
        // A pause or a newer play request owns the UI now. Its interrupted
        // promise must not overwrite that state with an apparent media failure.
        if (disposed || request !== playRequest.current || !wantsPlayback.current) return;
        if (error instanceof DOMException && error.name === "AbortError") {
          setSnapshot(previous => ({ ...previous, status: "paused" }));
          return;
        }
        const blocked = error instanceof DOMException && error.name === "NotAllowedError";
        setSnapshot(previous => ({ ...previous, status: blocked ? "ready" : "error", autoplayBlocked: blocked,
          error: blocked ? null : "browser" }));
      });
    };
    playRef.current = () => { wantsPlayback.current = true; play(); };
    const update = () => {
      if (disposed) return;
      if (!callbacks.current.canPlay()) audio.pause();
      setSnapshot(previous => ({ ...previous, duration: bounded(audio.duration, 86_400),
        currentTime: bounded(audio.currentTime, Number.isFinite(audio.duration) ? audio.duration : 0), volume: audio.muted ? 0 : audio.volume * 100 }));
    };
    const ready = () => {
      update();
      setSnapshot(previous => ({ ...previous, status: wantsPlayback.current ? "ready" : "paused" }));
      play();
    };
    const playing = () => {
      if (!wantsPlayback.current || !callbacks.current.canPlay()) { audio.pause(); return; }
      setSnapshot(previous => ({ ...previous, status: "playing", autoplayBlocked: false, error: null }));
    };
    const paused = () => { if (!disposed) setSnapshot(previous => ({ ...previous, status: "paused" })); };
    const waiting = () => setSnapshot(previous => ({ ...previous, status: "buffering" }));
    const failed = () => setSnapshot(previous => ({ ...previous, status: "error", error: "browser" }));
    const ended = () => {
      update();
      setSnapshot(previous => ({ ...previous, status: "ended" }));
      if (callbacks.current.canPlay() && callbacks.current.onEnded()) { audio.currentTime = 0; play(); }
    };
    const handlers = { loadedmetadata: ready, durationchange: update, timeupdate: update, volumechange: update,
      playing, pause: paused, waiting, ended, error: failed };
    for (const [name, handler] of Object.entries(handlers)) audio.addEventListener(name, handler);
    const pagehide = () => audio.pause();
    window.addEventListener("pagehide", pagehide);
    audio.src = source;
    audio.load();
    return () => {
      disposed = true;
      ++playRequest.current;
      playRef.current = () => undefined;
      for (const [name, handler] of Object.entries(handlers)) audio.removeEventListener(name, handler);
      window.removeEventListener("pagehide", pagehide);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, [element, source, enabled, attempt]);

  const play = useCallback(() => playRef.current(), []);
  const pause = useCallback(() => {
    wantsPlayback.current = false;
    ++playRequest.current;
    element.current?.pause();
  }, [element]);
  const seek = useCallback((seconds: number) => {
    const audio = element.current;
    if (audio && callbacks.current.canPlay() && Number.isFinite(audio.duration)) {
      audio.currentTime = bounded(seconds, audio.duration);
      // The property reflects the browser's accepted seek immediately. Updating
      // from it keeps successive keyboard/range inputs from using an old thumb.
      setSnapshot(previous => ({ ...previous, currentTime: audio.currentTime }));
    }
  }, [element]);
  const setVolume = useCallback((volume: number) => {
    desiredVolume.current = bounded(volume, 100);
    const audio = element.current;
    if (audio) {
      audio.muted = false;
      audio.volume = desiredVolume.current / 100;
      setSnapshot(previous => ({ ...previous, volume: audio.volume * 100 }));
    }
  }, [element]);
  const retry = useCallback(() => { if (callbacks.current.canPlay()) setAttempt(value => value + 1); }, []);
  return { ...snapshot, play, pause, seek, setVolume, retry };
}
