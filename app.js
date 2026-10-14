(() => {
    const UNTITLED = "Nimetön";
    const fileNameEl = document.getElementById("file-name");
    const textZoomLabel = document.getElementById("text-zoom-label");
    const fileOpenInput = document.getElementById("file-open");
    const desktop = window.kaava;
    const TEXT_ZOOM_KEY = "notex.textZoom";
    const TEXT_ZOOM_MIN = 0.8;
    const TEXT_ZOOM_MAX = 2.5;
    const TEXT_ZOOM_STEP = 0.1;

    // Työpöytäsovelluksessa kaavapalkki pidetään auki. Kirjasto lukee tämän
    // parametrin käynnistyessään.
    const appUrl = new URL(window.location.href);
    if (appUrl.searchParams.get("forceToolbars") !== "1") {
        appUrl.searchParams.set("forceToolbars", "1");
        window.history.replaceState(null, "", appUrl);
    }

    const state = {
        html: "",
        text: "",
        savedHtml: "",
        filePath: null,
        dirty: false,
        title: UNTITLED,
        ignoreChange: false,
    };

    const editorRef = makeRichText({
        container: document.getElementById("rich-text-editor-root"),
        language: "FI",
        invalidImageSelector:
            'img:not(.equation, img[src^="data"], img[src*="math.svg"], img[src^="/screenshot/"])',
        onValueChange: (answer) => {
            const html = answer?.answerHtml ?? getEditorHtml();
            state.html = html;
            state.text = answer?.answerText ?? "";
            if (state.ignoreChange) {
                state.ignoreChange = false;
                return;
            }
            if (html !== state.savedHtml) markDirty();
        },
        onLatexUpdate: updateLatexImage,
        textAreaProps: {
            id: "kaava-editori",
        },
    });

    document.querySelectorAll("[data-action]").forEach((button) => {
        button.addEventListener("click", () => {
            runAction(button.dataset.action);
        });
    });

    fileOpenInput.addEventListener("change", async () => {
        const file = fileOpenInput.files?.[0];
        fileOpenInput.value = "";
        if (!file) return;
        const text = await file.text();
        loadDocument(extractBody(text), file.name, file.name);
    });

    document.addEventListener("keydown", (event) => {
        const key = event.key.toLowerCase();
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
        if (key === "s") {
            event.preventDefault();
            runAction(event.shiftKey ? "save-as" : "save");
        } else if (key === "o") {
            event.preventDefault();
            runAction("open");
        } else if (key === "n") {
            event.preventDefault();
            runAction("new");
        } else if (!desktop && (key === "+" || key === "=")) {
            event.preventDefault();
            runAction(event.shiftKey ? null : "text-zoom-in");
            if (event.shiftKey) return;
        } else if (!desktop && key === "-") {
            event.preventDefault();
            runAction("text-zoom-out");
        } else if (!desktop && key === "0") {
            event.preventDefault();
            runAction("text-zoom-reset");
        }
    });

    desktop?.onMenuAction((action) => runAction(action));
    desktop?.onBeforeClose(async () => {
        if (await confirmProceed("Suljetaanko ohjelma?")) desktop.closeWindow();
    });

    window.addEventListener("beforeunload", (event) => {
        if (desktop || !state.dirty) return;
        event.preventDefault();
        event.returnValue = "";
    });

    applyTextZoom(readStoredTextZoom(), false);
    syncWindow();
    revealAppWhenReady();

    async function revealAppWhenReady() {
        try {
            await desktop?.mathReady?.();
        } catch (error) {
            console.error(error);
        }
        await new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
        hideBootScreen();
        focusEditor();
    }

    function hideBootScreen() {
        const boot = document.getElementById("boot-screen");
        document.body.removeAttribute("aria-busy");
        document.documentElement.style.background = "#f4f6f8";
        document.body.style.background = "#f4f6f8";
        if (!boot) return;
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            boot.remove();
        };
        boot.classList.add("is-done");
        boot.addEventListener("transitionend", finish, { once: true });
        window.setTimeout(finish, 400);
    }

    async function runAction(action) {
        if (!action) return;
        if (action === "new") return newDocument();
        if (action === "open") return openDocument();
        if (action === "save") return saveDocument(false);
        if (action === "save-as") return saveDocument(true);
        if (action === "copy") return copyAll();
        if (action === "text-zoom-in") return nudgeTextZoom(TEXT_ZOOM_STEP);
        if (action === "text-zoom-out") return nudgeTextZoom(-TEXT_ZOOM_STEP);
        if (action === "text-zoom-reset") return applyTextZoom(1, true);
        if (action === "undo") return sendEditorShortcut("z");
        if (action === "redo") return sendEditorShortcut("y");
    }

    function sendEditorShortcut(key) {
        const editor = document.querySelector('[data-testid="rich-text-editor"]');
        editor?.focus();
        window.dispatchEvent(
            new KeyboardEvent("keydown", {
                key,
                code: `Key${key.toUpperCase()}`,
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
    }

    function readStoredTextZoom() {
        const stored = Number(localStorage.getItem(TEXT_ZOOM_KEY));
        return Number.isFinite(stored) ? stored : 1;
    }

    function nudgeTextZoom(delta) {
        applyTextZoom(readStoredTextZoom() + delta, true);
    }

    function applyTextZoom(value, announce) {
        const zoom = Math.round(Math.min(TEXT_ZOOM_MAX, Math.max(TEXT_ZOOM_MIN, value)) * 10) / 10;
        localStorage.setItem(TEXT_ZOOM_KEY, String(zoom));
        document.documentElement.style.setProperty("--answer-zoom", String(zoom));
        if (textZoomLabel) {
            textZoomLabel.textContent = `${Math.round(zoom * 100)} %`;
        }
    }

    async function newDocument() {
        if (!(await confirmProceed("Aloitetaanko uusi tiedosto?"))) return;
        loadDocument("", UNTITLED, null);
    }

    async function openDocument() {
        if (!(await confirmProceed("Avataanko toinen tiedosto?"))) return;

        if (desktop) {
            const result = await desktop.openFile();
            if (!result) return;
            loadDocument(extractBody(result.content), result.name, result.filePath);
            return;
        }

        fileOpenInput.click();
    }

    async function saveDocument(saveAs) {
        const html = wrapHtmlDocument(getEditorHtml());
        const suggestedName = `${state.title === UNTITLED ? "notex" : state.title}.html`;

        if (desktop) {
            const result = await desktop.saveFile({
                content: html,
                filePath: saveAs ? null : state.filePath,
                suggestedName,
            });
            if (!result) return false;
            state.filePath = result.filePath;
            state.title = result.name.replace(/\.(html|htm|txt)$/i, "");
            state.savedHtml = getEditorHtml();
            state.dirty = false;
            syncWindow();
            return true;
        }

        downloadFile(suggestedName, html);
        state.savedHtml = getEditorHtml();
        state.dirty = false;
        syncWindow();
        return true;
    }

    async function copyAll() {
        const html = getEditorHtml();
        const text = state.text || htmlToText(html);

        try {
            if (desktop) {
                await desktop.copyAll({ html, text });
            } else if (typeof ClipboardItem === "function" && navigator.clipboard?.write) {
                await navigator.clipboard.write([
                    new ClipboardItem({
                        "text/html": new Blob([html], { type: "text/html" }),
                        "text/plain": new Blob([text], { type: "text/plain" }),
                    }),
                ]);
            } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                throw new Error("Leikepöytä ei ole käytettävissä");
            }
        } catch (error) {
            console.error(error);
        }
    }

    function loadDocument(html, title, filePath) {
        state.filePath = filePath;
        state.title = String(title).replace(/\.(html|htm|txt)$/i, "") || UNTITLED;
        state.html = html;
        state.savedHtml = html;
        state.dirty = false;
        state.ignoreChange = true;
        setEditorHtml(html);
        syncWindow();
        focusEditor();
    }

    function markDirty() {
        if (state.dirty) return;
        state.dirty = true;
        syncWindow();
    }

    function syncWindow() {
        const suffix = state.dirty ? " *" : "";
        document.title = `NoTeX — ${state.title}${suffix}`;
        desktop?.setDocumentState({
            dirty: state.dirty,
            title: `NoTeX — ${state.title}${suffix}`,
        });
        if (fileNameEl) {
            fileNameEl.textContent = state.filePath ? `${state.title}${suffix}` : "";
        }
    }

    function getEditorHtml() {
        return document.querySelector('[data-testid="rich-text-editor"]')?.innerHTML ?? "";
    }

    function setEditorHtml(html) {
        const apply = () => {
            if (editorRef.current) {
                editorRef.current.setValue(html);
                return true;
            }
            return false;
        };
        if (!apply()) window.setTimeout(apply, 0);
    }

    function focusEditor() {
        window.setTimeout(() => {
            document.querySelector('[data-testid="rich-text-editor"]')?.focus();
        }, 0);
    }

    async function confirmProceed(message) {
        if (!state.dirty) return true;

        if (desktop) {
            const choice = await desktop.confirmUnsaved(message);
            if (choice === "cancel") return false;
            if (choice === "save") return saveDocument(false);
            return true;
        }

        return window.confirm(`${message}\nTallentamattomat muutokset katoavat.`);
    }

    async function updateLatexImage(img, latex) {
        img.classList.add("equation");
        img.setAttribute("alt", latex);
        img.setAttribute("data-latex", latex);
        try {
            if (!desktop?.latexToSvg) return;
            const svg = await desktop.latexToSvg(latex);
            img.setAttribute("src", `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
        } catch (error) {
            console.error("Kaavan piirto epäonnistui", error);
        }
    }

    function extractBody(content) {
        const match = content.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        return (match ? match[1] : content).trim();
    }

    function wrapHtmlDocument(content) {
        return `<!DOCTYPE html>
<html lang="fi">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(state.title)}</title>
<style>
body { font: 18px "Times New Roman", Times, serif; max-width: 820px; margin: 2em auto; }
img { max-width: 100%; vertical-align: middle; }
</style>
</head>
<body>
${content}
</body>
</html>
`;
    }

    function downloadFile(name, content) {
        const blob = new Blob([content], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.click();
        URL.revokeObjectURL(url);
    }

    function htmlToText(html) {
        const helper = document.createElement("div");
        helper.innerHTML = html;
        return helper.innerText;
    }

    function escapeHtml(value) {
        return value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;");
    }
})();
