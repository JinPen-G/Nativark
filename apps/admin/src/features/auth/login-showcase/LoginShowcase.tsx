/** Login-only illustration carousel. Demonstration callbacks never reach business APIs.
 * Only the active slide mounts; visibility and interaction gate both CSS and timed playback. */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { ADMIN_BRAND_NAME } from "@/app/branding";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { BusinessPreview } from "./source/components/demos/BusinessPreview.jsx";
import { ReturnReminderDemo } from "./source/components/demos/ReturnReminderDemo.jsx";
import { DeliverablesDemo } from "./source/components/demos/DeliverablesDemo.jsx";
import { ScheduledOperationsDemo } from "./source/components/demos/ScheduledOperationsDemo.jsx";
import { ExecutionTraceDemo } from "./source/components/demos/ExecutionTraceDemo.jsx";
import { useTranslations } from "./locale";
import { motionTokens } from "@/lib/motion-tokens";
import "./showcase-source.css";
import "./login-showcase.css";

const slides = [
  { key: "agent", component: BusinessPreview, width: 960, height: 612 },
  // The reminder's 4:3 canvas includes the full expanded card and its controls.
  { key: "plugins", component: ReturnReminderDemo, width: 600, height: 480 },
  { key: "deliverables", component: DeliverablesDemo, width: 600, height: 480 },
  { key: "workflow", component: ScheduledOperationsDemo, width: 600, height: 480 },
  { key: "trace", component: ExecutionTraceDemo, width: 600, height: 400 },
] as const;
// Reference: UIArc sign-in showcase, observed 2026-11-06. CSS completion owns
// the 7-second advance so pause/resume preserves elapsed progress.
const ROTATION_MS = 7000;

interface Props {
  title?: string;
  description?: string;
  footer?: string;
  showTitle?: boolean;
  showDescription?: boolean;
  showFooter?: boolean;
  showHighlights?: boolean;
  highlights?: { title?: string; description?: string }[];
  background?: string;
}

export function LoginShowcase({ title, description, footer, showTitle = true, showDescription = true, showFooter = true, showHighlights = true, highlights, background }: Props) {
  const { locale } = useLocale();
  const en = locale === "en-US";
  const text = (zh: string, english: string) => en ? english : zh;
  const labels = useTranslations("Harness.Capabilities");
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [direction, setDirection] = useState(1);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(true);
  const [scale, setScale] = useState(1);
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const slide = slides[index];
  const Demo = slide.component;
  const demoRunning = visible && foreground && !reduced;
  const running = demoRunning && !paused && !hovered && !focusWithin;

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .2 });
    observer.observe(element);
    const update = () => setForeground(!document.hidden);
    document.addEventListener("visibilitychange", update);
    update();
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, entry.contentRect.width / slide.width, entry.contentRect.height / slide.height));
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [slide]);
  const move = (step: number) => {
    setDirection(step);
    setIndex(current => (current + step + slides.length) % slides.length);
  };
  const slideTitle = slide.key === "agent" ? text("说出目标，Agent 推进工作", "Describe your goal. Agent moves work forward.") : labels(`${slide.key}.title`);
  const slideDescription = slide.key === "agent" ? text("从需求、报价到确认预约，看看一项工作如何完成。", "See a request become a quote and a booking ready for confirmation.") : labels(`${slide.key}.description`);

  return <aside ref={root} className="login-showcase" aria-label={text(`${ADMIN_BRAND_NAME} 工作演示`, `${ADMIN_BRAND_NAME} in action`)}
    data-running={demoRunning} data-reduced-motion={reduced}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocusCapture={() => setFocusWithin(true)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusWithin(false); }}>
    {background && <img className="login-showcase-background" src={background} alt="" onError={event => { event.currentTarget.hidden = true; }} />}
    <div ref={stage} className="login-showcase-stage">
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <motion.div key={slide.key} className="login-showcase-slide"
          custom={direction}
          variants={{ exit: (step: number) => reduced ? { opacity: 0 } : { opacity: 0, scale: .98, filter: "blur(6px)", x: -16 * step } }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .97, filter: "blur(6px)", x: 16 * direction }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)", x: 0 }} exit="exit"
          transition={{ duration: reduced ? .15 : motionTokens.duration.considered, ease: motionTokens.ease.standard }}>
          <div className={`login-showcase-demo login-showcase-demo--${slide.key}`} style={{ width: slide.width, height: slide.height, transform: `scale(${scale})` }}>
            <Demo paused={!demoRunning} />
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
    <div className="login-showcase-footer">
      <div className="login-showcase-caption">
        {showTitle && <h2>{title?.trim() || slideTitle}</h2>}
        {showDescription && <p>{description?.trim() || slideDescription}</p>}
      </div>
      <div className="login-showcase-controls">
        <span className="login-showcase-count">{index + 1} / {slides.length}</span>
        <Button type="text" aria-label={text("上一个演示", "Previous demo")} icon={<ChevronLeft size={16} strokeWidth={1.75} />} onClick={() => move(-1)} />
        {!reduced && <Button type="text" aria-label={text(paused ? "播放演示轮播" : "暂停演示轮播", paused ? "Play demo carousel" : "Pause demo carousel")}
          aria-pressed={paused} icon={<AnimatePresence mode="popLayout" initial={false}><motion.span key={paused ? "play" : "pause"}
            className="login-showcase-toggle-icon" initial={{ opacity: 0, scale: .6, rotate: -45 }} animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: .6, rotate: 45 }} transition={{ ...motionTokens.spring.snappy, bounce: 0 }}>{paused ? <Play size={14} strokeWidth={1.75} /> : <Pause size={14} strokeWidth={1.75} />}</motion.span></AnimatePresence>}
          onClick={() => setPaused(value => !value)} />}
        <Button type="text" aria-label={text("下一个演示", "Next demo")} icon={<ChevronRight size={16} strokeWidth={1.75} />} onClick={() => move(1)} />
      </div>
      <div className="login-showcase-progress" aria-hidden="true">{!reduced && <span key={slide.key}
        style={{ animationDuration: `${ROTATION_MS}ms`, animationPlayState: running ? "running" : "paused" }}
        onAnimationEnd={event => { if (event.target === event.currentTarget && running) move(1); }} />}</div>
      {showHighlights && highlights?.some(item => item.title?.trim() || item.description?.trim()) && <dl className="login-showcase-highlights">
        {highlights.filter(item => item.title?.trim() || item.description?.trim()).map((item, position) => <div key={position}><dt>{item.title}</dt><dd>{item.description}</dd></div>)}
      </dl>}
      <p className="login-showcase-note">{text("交互演示 · 示例数据", "Interactive demo · sample data")}{showFooter && footer?.trim() ? ` · ${footer.trim()}` : ""}</p>
    </div>
  </aside>;
}
