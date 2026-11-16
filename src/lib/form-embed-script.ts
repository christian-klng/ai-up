/**
 * The script other websites load to embed a collection's public form (docs/externe-formulare.md 3):
 *
 *   <script src="https://<host>/api/forms/embed.js" async></script>
 *   <aiup-form token="…"></aiup-form>                              in the text
 *   <aiup-form token="…" mode="button" label="Feedback"></aiup-form> floating button
 *   <aiup-form token="…" mode="link" label="Idee einreichen"></aiup-form> link that opens the form
 *   <a href="#" data-aiup-form="…">…</a>                             any element of the page
 *
 * The form itself always runs in an iframe on our own origin: the host page's styles and scripts
 * cannot reach into it, and nothing here needs CORS. This script only places the frame, sizes it
 * from the messages the form sends, and opens the overlay. It runs on somebody else's page, so it
 * is plain, dependency-free ES2017 and touches nothing but its own elements.
 */
export const FORM_EMBED_SCRIPT = String.raw`(function () {
  if (window.__aiupFormEmbed) return;
  window.__aiupFormEmbed = true;
  var current = document.currentScript;
  var origin;
  try { origin = new URL(current && current.src ? current.src : "").origin; } catch (e) { return; }
  var frames = [];
  var TOKEN = /^[A-Za-z0-9_-]{8,64}$/;

  function makeFrame(token, host) {
    var iframe = document.createElement("iframe");
    iframe.src = origin + "/f/" + encodeURIComponent(token) + "?embed=1";
    iframe.title = host.getAttribute("label") || host.getAttribute("title") || "Form";
    iframe.setAttribute("loading", "lazy");
    iframe.style.cssText = "display:block;width:100%;height:480px;border:0;border-radius:12px;background:transparent;color-scheme:normal";
    frames.push({ iframe: iframe, host: host });
    return iframe;
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== origin) return;
    var data = event.data;
    if (!data || typeof data !== "object" || typeof data.type !== "string") return;
    var entry = null;
    for (var i = 0; i < frames.length; i++) if (frames[i].iframe.contentWindow === event.source) entry = frames[i];
    if (!entry) return;
    if (data.type === "aiup-form:height" && typeof data.height === "number") {
      entry.iframe.style.height = Math.max(120, Math.min(6000, Math.ceil(data.height))) + "px";
    } else if (data.type === "aiup-form:submitted") {
      entry.host.dispatchEvent(new CustomEvent("aiup-form:submitted", { bubbles: true }));
    } else if (data.type === "aiup-form:redirect" && typeof data.url === "string" && /^https:\/\//.test(data.url)) {
      window.location.assign(data.url);
    }
  });

  var overlay = null;
  function closeOverlay() {
    if (!overlay) return;
    var frame = overlay.querySelector("iframe");
    frames = frames.filter(function (f) { return f.iframe !== frame; });
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    overlay = null;
  }
  function onKey(event) { if (event.key === "Escape") closeOverlay(); }

  function openOverlay(token, host) {
    if (!TOKEN.test(token || "")) return;
    closeOverlay();
    overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:5vh 16px;background:rgba(15,23,42,.55);box-sizing:border-box";
    var panel = document.createElement("div");
    panel.style.cssText = "position:relative;width:100%;max-width:600px;margin:auto;border-radius:14px;background:#fff;box-shadow:0 20px 50px rgba(0,0,0,.3);padding:12px;box-sizing:border-box";
    var close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    close.style.cssText = "position:absolute;top:-14px;right:-6px;width:32px;height:32px;border:0;border-radius:999px;background:#111827;color:#fff;font:400 20px/1 system-ui,sans-serif;cursor:pointer";
    close.addEventListener("click", closeOverlay);
    panel.appendChild(close);
    var iframe = makeFrame(token, host);
    iframe.removeAttribute("loading");
    panel.appendChild(iframe);
    overlay.appendChild(panel);
    overlay.addEventListener("click", function (event) { if (event.target === overlay) closeOverlay(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    close.focus();
  }

  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest ? event.target.closest("[data-aiup-form]") : null;
    if (!target) return;
    event.preventDefault();
    openOverlay(target.getAttribute("data-aiup-form"), target);
  });

  if (!window.customElements || customElements.get("aiup-form")) return;
  customElements.define("aiup-form", class extends HTMLElement {
    connectedCallback() {
      if (this.__aiupReady) return;
      this.__aiupReady = true;
      var host = this;
      var token = this.getAttribute("token") || "";
      if (!TOKEN.test(token)) return;
      var mode = this.getAttribute("mode") || "inline";
      if (mode === "inline") {
        this.style.display = "block";
        this.appendChild(makeFrame(token, this));
        return;
      }
      var label = this.getAttribute("label") || (this.textContent || "").trim() || "Feedback";
      this.textContent = "";
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      if (mode === "button") {
        var color = this.getAttribute("color") || "#111827";
        var side = this.getAttribute("position") === "left" ? "left" : "right";
        button.style.cssText = "position:fixed;bottom:20px;" + side + ":20px;z-index:2147482000;padding:12px 18px;border:0;border-radius:999px;background:" + color + ";color:#fff;font:600 15px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer";
      } else {
        button.style.cssText = "display:inline;padding:0;border:0;background:none;color:inherit;font:inherit;text-decoration:underline;cursor:pointer";
      }
      button.addEventListener("click", function () { openOverlay(token, host); });
      this.appendChild(button);
    }
  });
})();
`;
