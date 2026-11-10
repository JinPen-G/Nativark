import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ExternalLink, FolderOpen, Maximize2, Minimize2, RotateCcw, X } from "lucide-react";
import { useLocale } from "@/app/locale";
import { Button } from "@/components/ui";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { MediaPlayer } from "./archive/media-player/MediaPlayer";
import { NowPlaying } from "./archive/now-playing/NowPlaying";
import { useRest } from "./RestContext";
import { formatMediaTime, REST_TRACK } from "./restSession";
import { useYouTubePlayer } from "./youtubePlayer";
import { useLocalAudioPlayer } from "./localAudioPlayer";
import styles from "./rest.module.css";

/** The archive components own their original appearance. This host owns the break,
 * placement and media instance. The iframe never moves between DOM parents. */
export function RestExperience() {
  const rest = useRest();
  const { t } = useLocale();
  const reduced = usePrefersReducedMotion();
  const session = rest.session!;
  const dialog = useRef<HTMLDialogElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const playerArea = useRef<HTMLDivElement>(null);
  const mediaHost = useRef<HTMLDivElement>(null);
  const audioElement = useRef<HTMLAudioElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const viewButton = useRef<HTMLButtonElement>(null);
  const [localFile, setLocalFile] = useState<{ url: string; name: string }>();
  const [mediaBox, setMediaBox] = useState<CSSProperties>();
  const [inlineMedia, setInlineMedia] = useState(() => window.innerWidth >= 560);
  const ended = rest.remaining === 0;
  const canPlay = () => !ended && Date.now() < session.endsAt;
  const remoteMedia = useYouTubePlayer(mediaHost, canPlay, () => session.minutes === 30, !ended && !localFile);
  const localMedia = useLocalAudioPlayer(audioElement, localFile?.url, canPlay, () => session.minutes === 30, !ended);
  const media = localFile ? localMedia : remoteMedia;
  const showVideo = !ended && !localFile;
  const labels = {
    player: t("音乐播放器"), play: t("播放音乐"), pause: t("暂停音乐"),
    previous: t("从头播放"), next: t("重新播放本曲"), position: t("歌曲进度"),
    volume: t("音乐音量"), mute: t("静音"), unmute: t("取消静音"),
    loading: t("正在加载音乐"), error: t("音乐暂时无法播放"), of: t("共"),
    expand: t("展开休息播放器"), collapse: t("缩小播放器"),
    by: "·", playing: t("正在播放"), paused: t("已暂停"),
  };
  const status = ended ? "ready" : media.status === "loading" ? "loading" : media.status === "error" ? "error" : "ready";
  const playerProps = {
    track: { ...REST_TRACK, title: localFile ? localFile.name.replace(/\.[^.]+$/, "") : REST_TRACK.title,
      artist: localFile ? t("本地音频") : REST_TRACK.artist, artworkAlt: "Red (Taylor’s Version) — Taylor Swift" },
    playing: !ended && (media.status === "playing" || media.status === "buffering"), currentTime: media.currentTime, duration: media.duration,
    status, disabled: ended, labels,
    onPlayingChange: (playing: boolean) => playing ? media.play() : media.pause(),
    onSeek: media.seek,
    onPrevious: () => media.seek(0),
    onNext: () => { media.seek(0); media.play(); },
  } as const;

  useLayoutEffect(() => {
    const node = playerArea.current;
    if (!node) return;
    // Keep the original cover ratio. Below this width it cannot hold YouTube's
    // 200px minimum height, so the visible video sits beside the untouched block.
    const measure = () => setInlineMedia(node.clientWidth >= 500);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    // Native top-layer promotion keeps the same iframe alive while giving the
    // expanded player a real focus boundary. Mini mode is a nonmodal dialog.
    if (node.open) node.close();
    if (rest.expanded) node.showModal(); else node.show();
    viewButton.current?.focus({ preventScroll: true });
    return () => { if (node.open) node.close(); };
  }, [rest.expanded]);
  useLayoutEffect(() => {
    const target = anchor.current, parent = dialog.current;
    if (!target || !parent) return;
    const measure = () => {
      const box = target.getBoundingClientRect(), outer = parent.getBoundingClientRect();
      setMediaBox({ left: box.left - outer.left + parent.scrollLeft, top: box.top - outer.top + parent.scrollTop,
        width: box.width, height: box.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    observer.observe(parent);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [rest.expanded, media.status, ended, inlineMedia, showVideo]);
  useEffect(() => {
    if (!localFile) return;
    if (ended) URL.revokeObjectURL(localFile.url);
    return () => URL.revokeObjectURL(localFile.url);
  }, [localFile, ended]);
  useEffect(() => () => { rest.entryRef.current?.focus({ preventScroll: true }); }, [rest.entryRef]);

  const errorMessage = localFile ? t("此音频无法播放，请选择浏览器支持的音频文件。")
    : media.error === "embed" ? t("当前环境无法播放嵌入音源，可在 YouTube 打开官方版本。")
    : media.error === "unavailable" ? t("官方音源暂不可用，请稍后重试。")
    : t("音乐加载失败，请检查网络后重试。");
  const placeholder = <div ref={anchor} className={styles.mediaAnchor} aria-hidden />;
  return createPortal(<dialog id="rental-rest-player" ref={dialog} className={styles.experience}
    data-expanded={rest.expanded} data-reduced={reduced || undefined} data-sound-silent
    data-media-error={media.errorCode}
    aria-modal={rest.expanded || undefined} aria-label={t("休息播放器")}
    onCancel={event => { event.preventDefault(); rest.expanded ? rest.minimize() : rest.close(); }}>
    <header className={styles.toolbar}>
      <div className={styles.timer}>
        <span>{t(ended ? "休息结束" : "休息中")}</span>
        {!ended && <time role="timer" aria-label={t("休息剩余时间")} dateTime={`PT${rest.remaining}S`}>{formatMediaTime(rest.remaining)}</time>}
      </div>
      <div className={styles.windowActions}>
        <Button ref={viewButton} type="text" size="small" icon={rest.expanded ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
          aria-label={t(rest.expanded ? "缩小播放器" : "展开休息播放器")} onClick={rest.expanded ? rest.minimize : rest.expand} />
        <Button type="text" size="small" icon={<X size={17} aria-hidden />} aria-label={t("结束休息并关闭")} onClick={rest.close} />
      </div>
    </header>
    <div ref={playerArea} className={styles.playerArea}>
      {rest.expanded
        ? <>{!inlineMedia && showVideo && <div className={styles.miniMedia}>{placeholder}</div>}
          <MediaPlayer {...playerProps} volume={media.volume / 100} onVolumeChange={value => media.setVolume(value * 100)} coverSlot={inlineMedia && showVideo ? placeholder : undefined} /></>
        : <>{showVideo && <div className={styles.miniMedia}>{placeholder}</div>}<NowPlaying {...playerProps} className={styles.miniPlayer} expanded={false} onExpandedChange={rest.expand} /></>}
    </div>
    {showVideo && <div ref={mediaHost} className={styles.mediaIsland} style={mediaBox} />}
    {localFile && !ended && <audio ref={audioElement} preload="metadata" hidden />}
    <input ref={fileInput} type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac" hidden onChange={event => {
      const file = event.currentTarget.files?.[0];
      if (file && !ended) setLocalFile({ url: URL.createObjectURL(file), name: file.name });
      event.currentTarget.value = "";
    }} />
    {(rest.expanded || ended || media.status === "error" || media.autoplayBlocked) && <footer className={styles.footer}>
      {rest.expanded && <p className={styles.edition}>{localFile ? t("文件仅在当前浏览器播放，不上传。") : REST_TRACK.version}</p>}
      <div className={styles.sourceRow}>{localFile ? <span>{t("本地音频")}</span> : <a href={REST_TRACK.url} target="_blank" rel="noopener noreferrer">{t("YouTube 官方音源")}<ExternalLink size={12} aria-hidden /></a>}
        <span>{t(session.minutes === 30 ? "单曲循环 · 到时停止" : "到时停止")}</span></div>
      <div role="status" className={styles.notice}>
        {ended ? <><span>{t("休息时间到了，音乐已停止。")}</span><Button size="small" onClick={rest.close}>{t("回到工作")}</Button></>
          : media.status === "error" ? <><span>{errorMessage}</span><Button size="small" icon={<RotateCcw size={14} aria-hidden />} onClick={media.retry}>{t("重试播放")}</Button></>
          : media.autoplayBlocked ? <span>{t("点击播放按钮开始音乐，休息计时已开始。")}</span>
          : media.status === "loading" ? <span>{t("正在加载音乐")}</span>
          : media.status === "buffering" ? <span>{t("音乐缓冲中")}</span> : null}
      </div>
      {!ended && (localFile || media.status === "error") && <Button type="text" size="small" className={styles.localFile} icon={<FolderOpen size={14} aria-hidden />}
        onClick={() => fileInput.current?.click()}>{t(localFile ? "更换本地音频" : "选择本地音频")}</Button>}
    </footer>}
  </dialog>, document.body);
}
