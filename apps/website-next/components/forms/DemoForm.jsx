"use client";
// Anonymous consultation only. Preserve the original request-key/receipt contract;
// never simulate a successful submission, store personal data, or call admin APIs.
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

function endpoint() {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  let base = (process.env.NEXT_PUBLIC_DEMO_API_BASE_URL || "").trim();
  if (!base && local && location.protocol === "http:")
    base = "http://127.0.0.1:3000/api";
  if (!base) return null;
  try {
    const url = new URL(base);
    const localApi = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (
      url.protocol !== "https:" &&
      !(local && localApi && url.protocol === "http:")
    )
      return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/$/, "") + "/public/demo-requests";
  } catch {
    return null;
  }
}
export function DemoForm() {
  const t = useTranslations("Demo"),
    locale = useLocale();
  const dialog = useRef(null),
    form = useRef(null),
    opener = useRef(null),
    message = useRef(null),
    feedback = useRef(null);
  const suggestion = useRef(""),
    overflow = useRef(""),
    request = useRef({ key: "", fingerprint: "" }),
    controller = useRef(null),
    busy = useRef(false);
  const [contactType, setContactType] = useState("phone");
  const [pending, setPending] = useState(false),
    [completed, setCompleted] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const open = (event) => {
      const topic = event.detail?.topic;
      if (
        topic &&
        message.current &&
        (!message.current.value || message.current.value === suggestion.current)
      ) {
        message.current.value = topic;
        suggestion.current = topic;
      }
      if (dialog.current.open) return;
      opener.current = event.detail?.trigger || document.activeElement;
      overflow.current = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      setCompleted(false);
      setError("");
      dialog.current.showModal();
      document.dispatchEvent(new Event("rentalos:demo-open"));
      requestAnimationFrame(() => form.current?.elements.name.focus());
    };
    document.addEventListener("rentalos:request-demo", open);
    return () => {
      document.removeEventListener("rentalos:request-demo", open);
      controller.current?.abort();
      if (dialog.current?.open) document.body.style.overflow = overflow.current;
    };
  }, []);
  useEffect(() => {
    if (error && dialog.current.open) feedback.current?.focus();
  }, [error]);
  function close() {
    dialog.current.close();
  }
  function closed() {
    document.body.style.overflow = overflow.current;
    const trigger = opener.current?.getClientRects().length
      ? opener.current
      : document.querySelector('[aria-controls="harness-mobile-menu"]');
    trigger?.focus();
  }
  function invalid(key, element) {
    setError(key);
    if (element) {
      element.setAttribute("aria-invalid", "true");
      element.setAttribute("aria-describedby", "demo-feedback");
      element.focus();
    }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy.current) return;
    const fields = form.current.elements;
    const payload = {
      name: fields.name.value.trim(),
      contactType,
      contactValue: fields.contactValue.value.trim(),
      company: fields.company.value.trim(),
      message: fields.message.value.trim(),
      language: locale,
    };
    if (!payload.name) return invalid("requiredName", fields.name);
    const digits = payload.contactValue.replace(/\D/g, "");
    const valid =
      contactType === "email"
        ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.contactValue)
        : contactType === "phone"
          ? /^\+?[0-9 ()-]+$/.test(payload.contactValue) &&
            digits.length >= 7 &&
            digits.length <= 20
          : /^[a-zA-Z0-9_-]{3,80}$/.test(payload.contactValue);
    if (!valid) return invalid("invalidContact", fields.contactValue);
    if (
      !form.current.checkValidity() ||
      /[\u0000-\u001f\u007f]/.test(
        payload.name + payload.company + payload.contactValue,
      )
    )
      return invalid("invalidFields");
    const url = endpoint();
    if (!url) return invalid("unconfigured");
    const fingerprint = JSON.stringify(payload);
    if (!request.current.key || request.current.fingerprint !== fingerprint)
      request.current = { key: crypto.randomUUID(), fingerprint };
    busy.current = true;
    setPending(true);
    setError("");
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 12000);
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestKey: request.current.key }),
        signal: abort.signal,
      });
      if (response.status === 429) {
        setError("rateLimited");
        return;
      }
      if (response.status === 400) {
        setError("invalidFields");
        return;
      }
      if (response.status === 409) {
        request.current.key = "";
        setError("conflict");
        return;
      }
      if (!response.ok) throw new Error("request_failed");
      const result = await response.json();
      if (result?.data?.received !== true) throw new Error("invalid_receipt");
      request.current = { key: "", fingerprint: "" };
      suggestion.current = "";
      form.current.reset();
      setContactType("phone");
      setCompleted(true);
    } catch {
      setError("networkError");
    } finally {
      clearTimeout(timeout);
      busy.current = false;
      setPending(false);
      controller.current = null;
    }
  }
  return (
    <dialog
      ref={dialog}
      id="demo-request"
      className="demo-dialog"
      data-theme="dark"
      aria-labelledby="demo-title"
      aria-describedby="demo-intro"
      onClose={closed}
    >
      <button
        className="demo-close"
        type="button"
        onClick={close}
        aria-label={t("close")}
      >
        ×
      </button>
      <h2 id="demo-title">{t("demo")}</h2>
      <p id="demo-intro">{t("intro")}</p>
      <form
        ref={form}
        id="demo-form"
        noValidate
        hidden={completed}
        aria-busy={pending}
        onSubmit={submit}
        onInput={(event) => {
          event.target.removeAttribute("aria-invalid");
          event.target.removeAttribute("aria-describedby");
        }}
      >
        <fieldset id="demo-fields" className="demo-fields" disabled={pending}>
          <label htmlFor="demo-name">
            <span>{t("name")}</span>
            <input
              id="demo-name"
              name="name"
              autoComplete="name"
              maxLength={80}
              required
            />
          </label>
          <div className="demo-contact-row">
            <label htmlFor="demo-contact-type">
              <span>{t("type")}</span>
              <select
                id="demo-contact-type"
                name="contactType"
                value={contactType}
                onChange={(event) => setContactType(event.target.value)}
              >
                {["phone", "email", "wechat"].map((value) => (
                  <option key={value} value={value}>
                    {t(value)}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="demo-contact">
              <span>{t("contact")}</span>
              <input
                id="demo-contact"
                name="contactValue"
                type={
                  contactType === "email"
                    ? "email"
                    : contactType === "phone"
                      ? "tel"
                      : "text"
                }
                autoComplete={
                  contactType === "email"
                    ? "email"
                    : contactType === "phone"
                      ? "tel"
                      : "off"
                }
                maxLength={160}
                required
              />
            </label>
          </div>
          <label htmlFor="demo-company">
            <span>{t("company")}</span>
            <input
              id="demo-company"
              name="company"
              autoComplete="organization"
              maxLength={120}
            />
          </label>
          <label htmlFor="demo-message">
            <span>{t("message")}</span>
            <textarea
              ref={message}
              id="demo-message"
              name="message"
              rows={3}
              maxLength={1000}
            />
          </label>
          <p className="demo-privacy">{t("privacy")}</p>
        </fieldset>
        <p
          ref={feedback}
          id="demo-feedback"
          className="demo-feedback"
          role="status"
          aria-live="polite"
          tabIndex={-1}
        >
          {error ? t(error) : ""}
        </p>
        <button
          className="button dark demo-submit"
          id="demo-submit"
          type="submit"
          disabled={pending}
        >
          <span>{t(pending ? "submitting" : "submit")}</span>
        </button>
      </form>
      <div
        id="demo-success"
        className="demo-success"
        hidden={!completed}
        tabIndex={-1}
        role="status"
      >
        <h3>{t("successTitle")}</h3>
        <p>{t("successBody")}</p>
        <button className="button dark" type="button" onClick={close}>
          {t("done")}
        </button>
      </div>
    </dialog>
  );
}
