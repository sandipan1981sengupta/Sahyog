// ShankhNaad · Languages (app bundle). Only when the server has keys (body data-lang: "t" translate, "s" speech).
//  • Chat: the 文A button on a message shows it in your language (pick it once; change it in the profile menu)
//  • Voice notes and audio files in chat get "Show text"
// Server: Controllers/LanguageController.cs, Infrastructure/LanguageService.cs
(function () {
    "use strict";
    const flags = document.body?.dataset.lang || "";
    const SN = (window.SN = window.SN || {});
    if (!document.body?.dataset.me || !flags || !SN.wk) return;
    const W = SN.wk, esc = W.esc;
    const NAMES = { en: "English", hi: "हिन्दी", kn: "ಕನ್ನಡ", ta: "தமிழ்", te: "తెలుగు", mr: "मराठी", bn: "বাংলা", gu: "ગુજરાતી", ml: "മലയാളം", pa: "ਪੰਜਾਬੀ", or: "ଓଡ଼ିଆ", ur: "اردو" };
    const EN = { en: "English", hi: "Hindi", kn: "Kannada", ta: "Tamil", te: "Telugu", mr: "Marathi", bn: "Bengali", gu: "Gujarati", ml: "Malayalam", pa: "Punjabi", or: "Odia", ur: "Urdu" };
    const mine = () => { try { return localStorage.getItem("sn-lang") || ""; } catch { return ""; } };
    const setMine = (c) => { try { localStorage.setItem("sn-lang", c); } catch { } paintMenu(); };

    function pick(then) {
        const d = W.dialog("sn-lang-dlg", `${W.head("fa-language", "Translate messages into", "Your choice stays on this device. Each message is translated when you press 文A.")}
            <div class="sn-dlg-body"><div class="sn-lang-grid">${Object.keys(NAMES).map((c) => `<button type="button" class="sn-lang-opt${mine() === c ? " on" : ""}" data-lang-pick="${c}"><b>${NAMES[c]}</b><small>${EN[c]}</small></button>`).join("")}</div></div>`);
        d.onclick = (e) => { const b = e.target.closest("[data-lang-pick]"); if (b) { setMine(b.dataset.langPick); d.close(); then && then(b.dataset.langPick); } };
    }

    // ---------- translate a chat message ----------
    if (flags.includes("t")) {
        document.addEventListener("click", async (e) => {
            const b = e.target.closest("[data-translate]");
            if (!b) return;
            e.preventDefault();
            const id = Number(b.dataset.translate);
            const lang = mine();
            if (!lang) { pick(() => b.click()); return; }
            const body = b.closest(".msg-body");
            let box = body?.querySelector(".sn-tr");
            if (box && box.dataset.lang === lang) { box.remove(); return; }        // pressed again: hide
            if (!box) { box = document.createElement("div"); box.className = "sn-tr"; body?.insertBefore(box, body.querySelector(".msg-reacts")); }
            box.dataset.lang = lang;
            box.innerHTML = `<span class="muted small"><i class="fa fa-spinner fa-spin" aria-hidden="true"></i> Translating…</span>`;
            const x = await W.post("/lang/translate", { messageId: id, to: lang });
            if (!x.ok) { box.remove(); W.toast(x.d.error || "Couldn't translate it.", "warn", "Translate"); return; }
            const from = x.d.from && EN[x.d.from] ? EN[x.d.from] : x.d.from;
            box.innerHTML = `<p>${esc(x.d.text)}</p><small>${from ? `Translated from ${esc(from)}` : "Translated"} · <button type="button" class="sn-link" data-tr-hide>Hide</button> · <button type="button" class="sn-link" data-tr-lang>${esc(NAMES[lang])}</button></small>`;
        });
        document.addEventListener("click", (e) => {
            if (e.target.closest("[data-tr-hide]")) e.target.closest(".sn-tr")?.remove();
            if (e.target.closest("[data-tr-lang]")) pick();
        });
    }

    // ---------- the profile menu: "Translate to: हिन्दी" ----------
    function paintMenu() {
        if (!flags.includes("t")) return;
        const dd = document.querySelector(".strip-user-dropdown[data-strip-user-dropdown]");
        if (!dd) return;
        let item = dd.querySelector("[data-strip-action='lang']");
        if (!item) {
            item = document.createElement("div");
            item.className = "strip-user-dropdown-item sn-lang-item";
            item.setAttribute("data-strip-action", "lang");
            item.setAttribute("role", "menuitem");
            dd.insertBefore(item, dd.querySelector("[data-strip-action='help']") || dd.querySelector("[data-strip-action='logout']"));
        }
        item.innerHTML = `<i class="fa fa-language" aria-hidden="true"></i> Translate to: ${esc(NAMES[mine()] || "pick a language")}`;
    }
    document.addEventListener("strip-header:action", (e) => { if (e.target === document && e.detail && e.detail.action === "lang") pick(); });

    // ---------- voice notes: "Show text" ----------
    const AUDIO = /\.(webm|ogg|oga|opus|mp3|m4a|aac|wav|amr|flac|wma|3gp)$/i;
    function addTranscribe(root) {
        if (!flags.includes("s")) return;
        (root || document).querySelectorAll('#messageList .file-card[href^="/chat/file/"]:not([data-tx])').forEach((a) => {
            a.dataset.tx = "1";
            const name = a.querySelector(".ellipsis")?.textContent || "";
            if (!AUDIO.test(name)) return;
            const b = document.createElement("button");
            b.type = "button"; b.className = "sn-tx-btn"; b.dataset.transcribe = a.getAttribute("href").split("/").pop();
            b.innerHTML = '<i class="fa fa-file-text-o" aria-hidden="true"></i> Show text';
            a.insertAdjacentElement("afterend", b);
        });
    }
    document.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-transcribe]");
        if (!b) return;
        e.preventDefault();
        const next = b.nextElementSibling;
        if (next && next.classList.contains("sn-tx")) { next.remove(); b.innerHTML = '<i class="fa fa-file-text-o" aria-hidden="true"></i> Show text'; return; }
        b.disabled = true;
        b.innerHTML = '<i class="fa fa-spinner fa-spin" aria-hidden="true"></i> Listening…';
        const x = await W.post("/lang/transcribe", { attachmentId: b.dataset.transcribe });
        b.disabled = false;
        if (!x.ok) { b.innerHTML = '<i class="fa fa-file-text-o" aria-hidden="true"></i> Show text'; W.toast(x.d.error || "Couldn't turn it into text.", "warn", "Voice note"); return; }
        const box = document.createElement("div");
        box.className = "sn-tx";
        box.textContent = x.d.text;
        b.insertAdjacentElement("afterend", box);
        b.innerHTML = '<i class="fa fa-eye-slash" aria-hidden="true"></i> Hide text';
    });
    let mo = null;
    function watch() {
        const list = document.getElementById("messageList");
        mo?.disconnect();
        if (!list) return;
        addTranscribe(list);
        mo = new MutationObserver(() => addTranscribe(list));
        mo.observe(list, { childList: true, subtree: true });
    }
    SN.lang = { pick, get: mine, names: NAMES };
    function init() { paintMenu(); watch(); }
    document.addEventListener("sn:page", () => setTimeout(watch, 50));
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
