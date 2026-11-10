/** Official YouTube IFrame API boundary. Only the fixed public track is loaded;
 * no audio extraction, private credentials, hidden player or fabricated clock. */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { REST_TRACK } from "./restSession";

interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getVolume(): number;
  isMuted(): boolean;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}
interface PlayerEvent { target: YouTubePlayer; data: number }
interface YouTubeApi {
  Player: new (element: HTMLIFrameElement, options: { events: {
    onReady: (event: PlayerEvent) => void;
    onStateChange: (event: PlayerEvent) => void;
    onError: (event: PlayerEvent) => void;
    onAutoplayBlocked: () => void;
  } }) => YouTubePlayer;
}
type YouTubeWindow = Window & { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void };
const API_URL = "https://www.youtube.com/iframe_api";
let apiPromise: Promise<YouTubeApi> | undefined;

function loadYouTubeApi(): Promise<YouTubeApi> {
  const scope = window as YouTubeWindow;
  if (scope.YT?.Player) return Promise.resolve(scope.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const previous = scope.onYouTubeIframeAPIReady;
    const script = document.createElement("script");
    script.src = API_URL;
    script.async = true;
    script.referrerPolicy = "strict-origin-when-cross-origin";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      script.onerror = null;
      if (scope.onYouTubeIframeAPIReady === ready) scope.onYouTubeIframeAPIReady = previous;
      if (error || !scope.YT?.Player) {
        script.remove();
        apiPromise = undefined;
        reject(error ?? new Error("YouTube API unavailable"));
      } else resolve(scope.YT);
    };
    const ready = () => { try { previous?.(); } finally { finish(); } };
    const timeout = window.setTimeout(() => finish(new Error("YouTube API timed out")), 15_000);
    scope.onYouTubeIframeAPIReady = ready;
    script.onerror = () => finish(new Error("YouTube API could not load"));
    document.head.appendChild(script);
  });
  return apiPromise;
}

export type MediaStatus = "loading" | "ready" | "playing" | "paused" | "buffering" | "ended" | "error";
export interface MediaSnapshot {
  status: MediaStatus;
  currentTime: number;
  duration: number;
  volume: number;
  autoplayBlocked: boolean;
  error: "network" | "unavailable" | "embed" | "browser" | null;
  errorCode?: number;
}
const initialSnapshot: MediaSnapshot = { status: "loading", currentTime: 0, duration: 0, volume: 40, autoplayBlocked: false, error: null };
const bounded = (value: number, max: number) => Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;

export function useYouTubePlayer(host: RefObject<HTMLDivElement | null>, canPlay: () => boolean, onEnded: () => boolean, enabled = true) {
  const [snapshot, setSnapshot] = useState<MediaSnapshot>(initialSnapshot);
  const [attempt, setAttempt] = useState(0);
  const player = useRef<YouTubePlayer | null>(null);
  const callbacks = useRef({ canPlay, onEnded });
  callbacks.current = { canPlay, onEnded };
  const desiredVolume = useRef(initialSnapshot.volume);
  const readyRef = useRef(false);

  useEffect(() => {
    const container = host.current;
    if (!container || !enabled) return;
    let disposed = false;
    let instance: YouTubePlayer | null = null;
    let readyTimeout = 0;
    readyRef.current = false;
    setSnapshot({ ...initialSnapshot, volume: desiredVolume.current });
    // This DOM island stays in one location across expanded/mini layouts. Moving
    // an iframe between portals would reload it even if its React key stayed put.
    const frame = document.createElement("iframe");
    frame.title = "Taylor Swift — All Too Well (10 Minute Version), YouTube";
    frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.setAttribute("allowfullscreen", "");
    // Start only after the API has set the intended volume and checked the deadline.
    const params = new URLSearchParams({ enablejsapi: "1", origin: window.location.origin, playsinline: "1", rel: "0", controls: "1", autoplay: "0" });
    frame.src = `https://www.youtube-nocookie.com/embed/${REST_TRACK.id}?${params}`;
    container.appendChild(frame);

    const update = () => {
      if (disposed || !instance || !readyRef.current) return;
      if (!callbacks.current.canPlay()) instance.pauseVideo();
      const duration = bounded(instance.getDuration(), 86_400);
      const currentTime = bounded(instance.getCurrentTime(), duration);
      const volume = instance.isMuted() ? 0 : bounded(instance.getVolume(), 100);
      setSnapshot(previous => previous.currentTime === currentTime && previous.duration === duration && previous.volume === volume
        ? previous : { ...previous, currentTime, duration, volume });
    };
    void loadYouTubeApi().then(api => {
      if (disposed) return;
      readyTimeout = window.setTimeout(() => {
        if (!disposed && !readyRef.current) setSnapshot(previous => ({ ...previous, status: "error", error: "network" }));
      }, 15_000);
      instance = new api.Player(frame, { events: {
        onReady: event => {
          if (disposed) return;
          window.clearTimeout(readyTimeout);
          readyRef.current = true;
          event.target.setVolume(desiredVolume.current);
          setSnapshot(previous => ({ ...previous, status: "ready", error: null }));
          if (callbacks.current.canPlay()) event.target.playVideo(); else event.target.pauseVideo();
          update();
        },
        onStateChange: event => {
          if (disposed) return;
          const status: MediaStatus = ({ [-1]: "ready", 0: "ended", 1: "playing", 2: "paused", 3: "buffering", 5: "ready" } as const)[event.data] ?? "ready";
          setSnapshot(previous => ({ ...previous, status, error: null, autoplayBlocked: status === "playing" ? false : previous.autoplayBlocked }));
          update();
          if (event.data === 0 && callbacks.current.canPlay() && callbacks.current.onEnded()) {
            event.target.seekTo(0, true);
            event.target.playVideo();
          }
        },
        onAutoplayBlocked: () => { if (!disposed) setSnapshot(previous => ({ ...previous, status: "ready", autoplayBlocked: true })); },
        onError: event => {
          if (disposed) return;
          window.clearTimeout(readyTimeout);
          const error = event.data === 101 || event.data === 150 || event.data === 153 ? "embed" : event.data === 100 ? "unavailable" : "browser";
          setSnapshot(previous => ({ ...previous, status: "error", error, errorCode: event.data }));
        },
      } });
      player.current = instance;
    }).catch(() => { if (!disposed) setSnapshot(previous => ({ ...previous, status: "error", error: "network" })); });
    const timer = window.setInterval(update, 500);
    const pauseOnLeave = () => { if (readyRef.current) instance?.pauseVideo(); };
    window.addEventListener("pagehide", pauseOnLeave);
    document.addEventListener("visibilitychange", update);
    return () => {
      disposed = true;
      readyRef.current = false;
      window.clearTimeout(readyTimeout);
      window.clearInterval(timer);
      window.removeEventListener("pagehide", pauseOnLeave);
      document.removeEventListener("visibilitychange", update);
      if (player.current === instance) player.current = null;
      instance?.destroy();
      frame.remove();
    };
  }, [host, attempt, enabled]);

  const play = useCallback(() => { if (readyRef.current && callbacks.current.canPlay()) player.current?.playVideo(); }, []);
  const pause = useCallback(() => { if (readyRef.current) player.current?.pauseVideo(); }, []);
  const seek = useCallback((seconds: number) => {
    if (!readyRef.current || !player.current || !callbacks.current.canPlay()) return;
    player.current.seekTo(bounded(seconds, player.current.getDuration()), true);
  }, []);
  const setVolume = useCallback((volume: number) => {
    desiredVolume.current = bounded(volume, 100);
    if (!readyRef.current || !player.current) return;
    player.current.unMute();
    player.current.setVolume(desiredVolume.current);
    setSnapshot(previous => ({ ...previous, volume: desiredVolume.current }));
  }, []);
  const retry = useCallback(() => { if (callbacks.current.canPlay()) setAttempt(value => value + 1); }, []);
  return { ...snapshot, play, pause, seek, setVolume, retry };
}
