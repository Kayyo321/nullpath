/* This Source Code Form is subject to the terms of the MPL 2.0. */
export class NullpathNewTabChild extends JSWindowActorChild {
  #screen = null;
  #touched = false;
  #state = null;
  #onClick = event => {
    if (event.target?.closest?.("#nullpath-connection-button")) {
      return;
    }
    if (this.#screen) this.#touched = true;
  };

  actorCreated() {
    this.contentWindow.document.addEventListener("click", this.#onClick);
    this.contentWindow.addEventListener("pagehide", () => this.#remove(), { once: true });
    this.sendAsyncMessage("NullpathNewTab:Action", { action: "state" });
  }

  handleEvent(event) {
    if (event.type == "DOMContentLoaded") {
      this.sendAsyncMessage("NullpathNewTab:Action", { action: "state" });
    }
    if (event.type == "DOMContentLoaded" || event.type == "DOMDocElementInserted") this.#update(this.#state);
  }

  didDestroy() { this.contentWindow.document.removeEventListener("click", this.#onClick); this.#remove(); }

  receiveMessage(message) {
    if (message.name == "NullpathNewTab:State") { this.#state = message.data; this.#update(message.data); }
  }

  #remove() {
    this.#screen?.remove();
    this.#screen = null;
    this.contentWindow.document.documentElement.removeAttribute("nullpath-disconnected");
  }

  #update(data) {
    let doc = this.contentWindow.document;
    if (!doc.head) return;
    if (data) {
      if (!doc.getElementById("nullpath-local-home-style")) {
        let style = doc.createElement("style");
        style.id = "nullpath-local-home-style";
        style.textContent = `
          html[nullpath-theme="light"]{--home-canvas:#f7f7f7;--home-surface:#fff;--home-text:#181818;--home-secondary:#5c5c5c;--home-border:#dcdcdc;--home-accent:#181818}
          html[nullpath-theme="dark"]{--home-canvas:#111111;--home-surface:#1c1c1c;--home-text:#f5f5f5;--home-secondary:#bcbcbc;--home-border:#505050;--home-accent:#ffffff}
          html[nullpath-theme]:not([nullpath-disconnected]) body{background:var(--home-canvas)!important;color:var(--home-text)!important}
          html[nullpath-theme="dark"]:not([nullpath-disconnected]) #root,html[nullpath-theme="dark"]:not([nullpath-disconnected]) .outer-wrapper,html[nullpath-theme="dark"]:not([nullpath-disconnected]) .body-wrapper{background-color:var(--home-canvas)!important;color:var(--home-text)!important}
          html[nullpath-theme]:not([nullpath-disconnected]) #root{filter:grayscale(1)}
          html[nullpath-theme="light"] .logo-and-wordmark .logo{background-image:url("chrome://browser/skin/nullpath/logo-mark-light.svg");background-size:contain}
          html[nullpath-theme="dark"] .logo-and-wordmark .logo{background-image:url("chrome://browser/skin/nullpath/logo-mark-dark.svg");background-size:contain}
          html[nullpath-theme="light"] .logo-and-wordmark .wordmark{background-image:url("chrome://browser/skin/nullpath/logo-wordmark-light.svg");background-size:contain}
          html[nullpath-theme="dark"] .logo-and-wordmark .wordmark{background-image:url("chrome://browser/skin/nullpath/logo-wordmark-dark.svg");background-size:contain}
          html[nullpath-theme] .logo-and-wordmark{filter:grayscale(1)}
          html[nullpath-disconnected],html[nullpath-disconnected] body{width:100%;height:100%;margin:0;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
          html[nullpath-disconnected] body>*:not(#nullpath-connection-screen){display:none!important}
          #nullpath-connection-screen{position:fixed;z-index:2147483647;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;box-sizing:border-box;padding:24px 24px 72px;background:var(--home-canvas);color:var(--home-text);text-align:center;font:13px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
          .nullpath-home-brand{display:flex;flex-direction:column;align-items:center;gap:12px;margin-block-end:24px;filter:grayscale(1)}
          .nullpath-home-mark{display:block;width:72px;height:72px;object-fit:contain}.nullpath-home-wordmark{display:block;width:min(240px,70vw);max-height:66px;object-fit:contain}
          #nullpath-connection-screen h1{margin:0;font:700 24px/30px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
          #nullpath-connection-screen p{max-width:360px;margin:8px 0 24px;color:var(--home-secondary)}
          #nullpath-connection-button{min-width:40px;min-height:40px;padding:0 16px;border:1px solid var(--home-accent);border-radius:8px;background:var(--home-accent);color:var(--home-canvas);font:600 13px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
          #nullpath-connection-screen :focus-visible{outline:2px solid var(--home-accent);outline-offset:2px}
          @media(forced-colors:active){#nullpath-connection-screen{background:Canvas;color:CanvasText}#nullpath-connection-screen p{color:CanvasText}#nullpath-connection-button{border:1px solid ButtonText;background:ButtonFace;color:ButtonText}#nullpath-connection-screen :focus-visible{outline:2px solid Highlight}}
        `;
        doc.head.append(style);
      }
      doc.documentElement.setAttribute("nullpath-theme", data.dark ? "dark" : "light");
    }
    if (!doc.body) return;
    if (!data?.show) { this.#remove(); return; }
    if (this.#touched && this.#screen) return;
    if (!this.#screen) {
      this.#screen = doc.createElement("main");
      this.#screen.id = "nullpath-connection-screen";
      doc.body.append(this.#screen);
      doc.documentElement.setAttribute("nullpath-disconnected", "true");
    }
    let noSetup = !data.setup;
    let connecting = data.state == "connecting";
    let attention = data.state == "attention";
    let title = noSetup ? "Set up I2P" : connecting ? "Connecting to I2P" : attention ? "I2P needs attention" : "Connect to I2P";
    let body = noSetup ? "Set up an I2P router before browsing." : connecting ? "This can take a few minutes. Check the router panel for progress." : attention ? "Open the router panel to see what needs fixing." : "Open the I2P router panel to connect before browsing.";
    let button = noSetup ? "Set up I2P" : connecting ? "View connection progress" : "Open router panel";
    let logo = doc.createElement("img");
    logo.className = "nullpath-home-mark";
    logo.alt = "";
    logo.src = `chrome://browser/skin/nullpath/logo-mark-${data.dark ? "dark" : "light"}.svg`;
    let wordmark = doc.createElement("img");
    wordmark.className = "nullpath-home-wordmark";
    wordmark.alt = "Nullpath";
    wordmark.src = `chrome://browser/skin/nullpath/logo-wordmark-${data.dark ? "dark" : "light"}.svg`;
    let brand = doc.createElement("div"); brand.className = "nullpath-home-brand"; brand.append(logo, wordmark);
    let heading = doc.createElement("h1"); heading.textContent = title;
    let description = doc.createElement("p"); description.textContent = body;
    let action = doc.createElement("button"); action.id = "nullpath-connection-button"; action.textContent = button;
    action.addEventListener("click", event => { event.preventDefault(); this.sendAsyncMessage("NullpathNewTab:Action", { action: "open-panel" }); });
    this.#screen.replaceChildren(brand, heading, description, action);
  }
}
