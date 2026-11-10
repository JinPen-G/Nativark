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

// Official album audio supplied to YouTube by Universal Music Group, not the lyric video.
// The title says “10 Minute Version”; its actual published duration is 10:13.
export const REST_TRACK = {
  id: "aPnqx56V8-0",
  title: "All Too Well",
  version: "10 Minute Version · Taylor’s Version",
  artist: "Taylor Swift",
  album: "Red (Taylor’s Version)",
  artwork: "https://i.ytimg.com/vi/aPnqx56V8-0/maxresdefault.jpg",
  url: "https://www.youtube.com/watch?v=aPnqx56V8-0",
} as const;
