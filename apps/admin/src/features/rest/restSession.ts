/** Browser-local break timing. Music position is supplied separately by the media
 * provider; pausing, seeking or looping a track never changes the break deadline. */
export const REST_MINUTES = [10, 30] as const;
export type RestMinutes = typeof REST_MINUTES[number];
export interface RestSession {
  id: number;
  minutes: RestMinutes;
  startedAt: number;
  endsAt: number;
}

export function createRestSession(id: number, minutes: RestMinutes, now: number): RestSession {
  if (!REST_MINUTES.includes(minutes) || !Number.isFinite(now)) throw new Error("Invalid break duration");
  return { id, minutes, startedAt: now, endsAt: now + minutes * 60_000 };
}

export function restSecondsRemaining(session: RestSession, now: number): number {
  return Math.max(0, Math.min(session.minutes * 60, Math.ceil((session.endsAt - now) / 1000)));
}

export function formatMediaTime(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

// Default audio is the owner-supplied MP3 in the deployment's local media folder.
// Relative asset paths are resolved against Vite's base by the host. The optional
// YouTube adapter retains its original video ID; it is not loaded by this player.
export const REST_TRACK = {
  id: "aPnqx56V8-0",
  title: "All Too Well",
  version: "10 Minute Version · Taylor’s Version",
  artist: "Taylor Swift",
  album: "Red (Taylor’s Version)",
  audio: "media/rest-player/all-too-well-10-minute-version.mp3",
  artwork: "media/rest-player/red-taylors-version.jpg",
  albumUrl: "https://music.apple.com/cn/album/red-taylors-version-a-message-from-taylor/1590368448",
  url: "https://www.youtube.com/watch?v=aPnqx56V8-0",
} as const;
