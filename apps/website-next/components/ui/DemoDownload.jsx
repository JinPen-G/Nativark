"use client";
import { useEffect, useRef, useState, useId } from "react";
import { useTranslations } from "next-intl";
import { Button, ChevronDown } from "./primitives";
import { requestDemo } from "../../lib/site";

export function DemoDownload({
  label,
  size = "m",
  placement = "bottom",
  className,
}) {
  const t = useTranslations("Harness.Index");
  const [open, setOpen] = useState(false);
  const root = useRef(null),
    arrow = useRef(null),
    id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        arrow.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div
      ref={root}
      className={["rentalos-download", className].filter(Boolean).join(" ")}
      data-size={size}
    >
      <div
        className="HarnessDownloadMenu_split__148cc ds-btn-primary"
        data-size={size}
      >
        <Button
          size={size}
          className="HarnessDownloadMenu_action__Qe9nK !rounded-r-none !pr-ds-3"
          type="button"
          aria-haspopup="dialog"
          aria-controls="demo-request"
          onClick={(event) => {
            setOpen(false);
            requestDemo(event.currentTarget);
          }}
        >
          {label || t("harnessDemoAction")}
        </Button>
        <Button
          size={size}
          className="HarnessDownloadMenu_arrow__60_9L !rounded-l-none !pl-ds-3 !pr-[14px]"
          type="button"
          aria-label={t("harnessHeroDownloadDesktop")}
          aria-expanded={open}
          aria-controls={id}
          onClick={(event) => {
            arrow.current = event.currentTarget;
            setOpen(!open);
          }}
        >
          <span
            aria-hidden="true"
            className="HarnessDownloadMenu_divider__Dao4X pointer-events-none absolute left-0 border-l border-[var(--dsw-alias-border-l2)]"
          />
          <ChevronDown size={14} />
        </Button>
      </div>
      {open && (
        <div
          id={id}
          className={
            "rentalos-download-options ds-glass-dropdown " +
            (placement === "bottom-end" ? "is-end" : "")
          }
        >
          {["Mac", "Windows"].map((platform) => (
            <div
              key={platform}
              className="rentalos-download-option"
              aria-disabled="true"
            >
              <span>{t("harnessHeroDownload" + platform)}</span>
              <span className="rentalos-development">
                {t("harnessDownloadDevelopment")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
