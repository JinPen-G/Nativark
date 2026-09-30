/* Anonymous demo requests only. No admin credentials or personal data in localStorage. */
(() => {
  "use strict";
  const dialog = document.getElementById("demo-request");
  const form = document.getElementById("demo-form");
  const fields = document.getElementById("demo-fields");
  const submit = document.getElementById("demo-submit");
  const feedback = document.getElementById("demo-feedback");
  const success = document.getElementById("demo-success");
  const contact = document.getElementById("demo-contact");
  const contactType = document.getElementById("demo-contact-type");
  const name = document.getElementById("demo-name");
  const t = (key) => window.RentalOSCopy.text(key);
  let pending = false;
  let completed = false;
  let opener;
  let previousOverflow = "";
  let errorKey = "";
  let requestKey = "";
  let lastPayload = "";

  function endpoint() {
    let base = window.RentalOSWebsiteConfig?.apiBaseUrl?.trim();
    const local = ["localhost", "127.0.0.1"].includes(location.hostname);
    if (!base && local && location.protocol === "http:") base = "http://127.0.0.1:3000/api";
    if (!base) return null;
    try {
      const url = new URL(base);
      const localApi = ["localhost", "127.0.0.1"].includes(url.hostname);
      if (url.protocol !== "https:" && !(local && localApi && url.protocol === "http:")) return null;
      if (url.username || url.password || url.search || url.hash) return null;
      return `${url.href.replace(/\/$/, "")}/public/demo-requests`;
    } catch { return null; }
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }

  function render() {
    submit.disabled = pending;
    fields.disabled = pending;
    form.setAttribute("aria-busy", String(pending));
    const label = submit.querySelector("span");
    label.dataset.i18n = pending ? "demo.submitting" : "demo.submit";
    label.textContent = t(label.dataset.i18n);
    feedback.textContent = errorKey ? t(errorKey) : "";
  }

  function showError(key, element) {
    errorKey = key;
    render();
    if (element) {
      element.setAttribute("aria-invalid", "true");
      element.setAttribute("aria-describedby", "demo-feedback");
    }
    if (dialog.open) (element || feedback).focus();
  }

  function open(trigger) {
    if (dialog.open) return;
    opener = trigger;
    if (completed) {
      completed = false;
      success.hidden = true;
      form.hidden = false;
      errorKey = "";
    }
    document.dispatchEvent(new Event("rentalos:demo-open"));
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    render();
    if (!pending) name.focus();
  }

  document.querySelectorAll("[data-demo-open]").forEach((trigger) => {
    trigger.addEventListener("click", (event) => { event.preventDefault(); open(trigger); });
    trigger.addEventListener("keydown", (event) => {
      if (event.key === " ") { event.preventDefault(); trigger.click(); }
    });
  });
  dialog.querySelectorAll("[data-demo-close]").forEach((button) => {
    button.addEventListener("click", () => dialog.close());
  });
  dialog.addEventListener("close", () => {
    document.body.style.overflow = previousOverflow;
    const target = opener?.getClientRects().length ? opener : document.querySelector(".menu-toggle");
    target?.focus();
  });

  contactType.addEventListener("change", () => {
    contact.type = contactType.value === "email" ? "email" : contactType.value === "phone" ? "tel" : "text";
    contact.autocomplete = contactType.value === "email" ? "email" : contactType.value === "phone" ? "tel" : "off";
    contact.removeAttribute("aria-invalid");
  });
  form.addEventListener("input", (event) => {
    event.target.removeAttribute("aria-invalid");
    event.target.removeAttribute("aria-describedby");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending) return;
    form.querySelectorAll('[aria-invalid="true"]').forEach((element) => element.removeAttribute("aria-invalid"));
    const payload = {
      name: name.value.trim(),
      contactType: contactType.value,
      contactValue: contact.value.trim(),
      company: form.elements.company.value.trim(),
      message: form.elements.message.value.trim(),
      language: window.RentalOSCopy.language
    };
    if (!payload.name) return showError("demo.requiredName", name);
    const digits = payload.contactValue.replace(/\D/g, "");
    const validContact = payload.contactType === "email"
      ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.contactValue)
      : payload.contactType === "phone"
        ? /^\+?[0-9 ()-]+$/.test(payload.contactValue) && digits.length >= 7 && digits.length <= 20
        : /^[a-zA-Z0-9_-]{3,80}$/.test(payload.contactValue);
    if (!validContact) return showError("demo.invalidContact", contact);
    if (!form.checkValidity() || /[\u0000-\u001f\u007f]/.test(payload.name + payload.company + payload.contactValue)) {
      return showError("demo.invalidFields");
    }
    const url = endpoint();
    if (!url) return showError("demo.unconfigured");
    const fingerprint = JSON.stringify(payload);
    if (!requestKey || fingerprint !== lastPayload) {
      requestKey = uuid();
      lastPayload = fingerprint;
    }
    pending = true;
    errorKey = "";
    render();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        method: "POST", credentials: "omit", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestKey }), signal: controller.signal
      });
      if (response.status === 429) { errorKey = "demo.rateLimited"; return; }
      if (response.status === 400) { errorKey = "demo.invalidFields"; return; }
      if (response.status === 409) { requestKey = ""; errorKey = "demo.conflict"; return; }
      if (!response.ok) throw new Error("request_failed");
      const result = await response.json();
      if (result?.data?.received !== true) throw new Error("invalid_receipt");
      completed = true;
      requestKey = lastPayload = "";
      form.reset();
      contactType.dispatchEvent(new Event("change"));
      form.hidden = true;
      success.hidden = false;
      if (dialog.open) success.focus();
    } catch {
      errorKey = "demo.networkError";
    } finally {
      clearTimeout(timeout);
      pending = false;
      render();
      if (errorKey && dialog.open) feedback.focus();
    }
  });
  document.addEventListener("rentalos:languagechange", render);
  render();
})();
