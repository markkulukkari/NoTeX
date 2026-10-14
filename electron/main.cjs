const { app, BrowserWindow, Menu, dialog, ipcMain, clipboard } = require("electron");
const path = require("path");
const fs = require("fs/promises");

let mainWindow = null;
let allowClose = false;
let latexToSvg = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 560,
        title: "NoTeX",
        icon: path.join(__dirname, "notex.ico"),
        backgroundColor: "#1f4b6e",
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    mainWindow.loadFile(path.join(__dirname, "..", "index.html"));
    mainWindow.setMenu(buildMenu());
    registerZoomKeys(mainWindow);

    mainWindow.on("close", (event) => {
        if (allowClose) return;
        event.preventDefault();
        mainWindow.webContents.send("app:before-close");
    });
}

function buildMenu() {
    return Menu.buildFromTemplate([
        {
            label: "Tiedosto",
            submenu: [
                { label: "Uusi", accelerator: "CmdOrCtrl+N", click: () => sendAction("new") },
                { label: "Avaa...", accelerator: "CmdOrCtrl+O", click: () => sendAction("open") },
                { label: "Tallenna", accelerator: "CmdOrCtrl+S", click: () => sendAction("save") },
                { label: "Tallenna nimellä...", accelerator: "CmdOrCtrl+Shift+S", click: () => sendAction("save-as") },
                { type: "separator" },
                { role: "quit", label: "Lopeta" },
            ],
        },
        {
            label: "Muokkaa",
            submenu: [
                { role: "undo", label: "Kumoa" },
                { role: "redo", label: "Tee uudelleen" },
                { type: "separator" },
                { role: "cut", label: "Leikkaa" },
                { role: "copy", label: "Kopioi" },
                { role: "paste", label: "Liitä" },
                { type: "separator" },
                { label: "Kopioi kaikki", accelerator: "CmdOrCtrl+Shift+C", click: () => sendAction("copy") },
            ],
        },
        {
            label: "Näytä",
            submenu: [
                { label: "Suurenna tekstiä", accelerator: "CmdOrCtrl+Plus", click: () => sendAction("text-zoom-in") },
                { label: "Suurenna tekstiä", accelerator: "CmdOrCtrl+=", visible: false, click: () => sendAction("text-zoom-in") },
                { label: "Pienennä tekstiä", accelerator: "CmdOrCtrl+-", click: () => sendAction("text-zoom-out") },
                { label: "Normaali tekstikoko", accelerator: "CmdOrCtrl+0", click: () => sendAction("text-zoom-reset") },
                { type: "separator" },
                {
                    label: "Lähennä ikkunaa",
                    accelerator: "CmdOrCtrl+Shift+numadd",
                    registerAccelerator: false,
                    click: () => adjustZoom(1),
                },
                { label: "Loitonna ikkunaa", accelerator: "CmdOrCtrl+Shift+-", click: () => adjustZoom(-1) },
                { label: "Normaali ikkunan koko", accelerator: "CmdOrCtrl+Shift+0", click: () => setZoom(0) },
                { type: "separator" },
                { role: "togglefullscreen", label: "Koko näyttö" },
                { role: "toggleDevTools", label: "Kehittäjätyökalut" },
            ],
        },
    ]);
}

function sendAction(action) {
    mainWindow?.webContents.send("menu:action", action);
}

function currentZoom() {
    return mainWindow?.webContents.getZoomLevel() ?? 0;
}

function setZoom(level) {
    mainWindow?.webContents.setZoomLevel(Math.min(5, Math.max(-5, level)));
}

function adjustZoom(delta) {
    setZoom(currentZoom() + delta);
}

function registerZoomKeys(win) {
    win.webContents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt) return;

        const zoomReset = input.key === "0" || input.code === "Digit0" || input.code === "Numpad0";
        const numpadAdd = input.code === "NumpadAdd";
        const numpadSub = input.code === "NumpadSubtract";
        const equalKey = input.code === "Equal";
        const minusCode = input.code === "Minus";
        const plusChar = input.key === "+" || input.key === "=";
        const minusChar = input.key === "-" || input.key === "_";

        if (input.shift) {
            const windowZoomIn =
                numpadAdd || equalKey || plusChar || (minusCode && !minusChar);
            const windowZoomOut = numpadSub || (minusCode && minusChar) || minusChar;
            if (windowZoomIn) {
                event.preventDefault();
                adjustZoom(1);
            } else if (windowZoomOut) {
                event.preventDefault();
                adjustZoom(-1);
            } else if (zoomReset) {
                event.preventDefault();
                setZoom(0);
            }
            return;
        }

        const textZoomIn = plusChar || equalKey || numpadAdd;
        const textZoomOut = minusChar || minusCode || numpadSub;
        if (textZoomIn) {
            event.preventDefault();
            sendAction("text-zoom-in");
        } else if (textZoomOut) {
            event.preventDefault();
            sendAction("text-zoom-out");
        } else if (zoomReset) {
            event.preventDefault();
            sendAction("text-zoom-reset");
        }
    });
}

function htmlFilters() {
    return [
        { name: "HTML-tiedostot", extensions: ["html", "htm"] },
        { name: "Tekstitiedostot", extensions: ["txt"] },
        { name: "Kaikki tiedostot", extensions: ["*"] },
    ];
}

ipcMain.handle("file:open", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: "Avaa tiedosto",
        properties: ["openFile"],
        filters: htmlFilters(),
    });
    if (canceled || !filePaths[0]) return null;
    const filePath = filePaths[0];
    const content = await fs.readFile(filePath, "utf8");
    return { filePath, content, name: path.basename(filePath) };
});

ipcMain.handle("file:save", async (_event, payload) => {
    let filePath = payload.filePath;
    if (!filePath) {
        const result = await dialog.showSaveDialog(mainWindow, {
            title: "Tallenna tiedosto",
            defaultPath: payload.suggestedName || "notex.html",
            filters: htmlFilters(),
        });
        if (result.canceled || !result.filePath) return null;
        filePath = result.filePath;
        if (!path.extname(filePath)) filePath += ".html";
    }
    await fs.writeFile(filePath, payload.content, "utf8");
    return { filePath, name: path.basename(filePath) };
});

ipcMain.handle("math:svg", async (_event, latex) => {
    return await localLatexToSvg(latex);
});

ipcMain.handle("clipboard:write", (_event, payload) => {
    clipboard.write({ html: payload.html || "", text: payload.text || "" });
});

ipcMain.handle("dialog:unsaved", async (_event, message) => {
    const { response } = await dialog.showMessageBox(mainWindow, {
        type: "question",
        buttons: ["Tallenna", "Älä tallenna", "Peruuta"],
        defaultId: 0,
        cancelId: 2,
        message: "Tallentamattomia muutoksia",
        detail: message,
    });
    if (response === 0) return "save";
    if (response === 1) return "discard";
    return "cancel";
});

ipcMain.on("doc:state", (_event, doc) => {
    if (doc?.title) mainWindow?.setTitle(doc.title);
});

ipcMain.on("app:close-ok", () => {
    allowClose = true;
    mainWindow?.close();
});

function getLatexToSvg() {
    if (!latexToSvg) {
        latexToSvg = require("rich-text-editor/server/mathSvg").latexToSvg;
    }
    return latexToSvg;
}

function localLatexToSvg(latex) {
    return new Promise((resolve, reject) => {
        try {
            getLatexToSvg()(latex, (svg) => resolve(svg));
        } catch (error) {
            reject(error);
        }
    });
}

let mathReadyPromise = null;

function ensureMathReady() {
    if (!mathReadyPromise) {
        mathReadyPromise = localLatexToSvg("x").then(() => true).catch(() => true);
    }
    return mathReadyPromise;
}

ipcMain.handle("math:ready", () => ensureMathReady());

app.whenReady().then(() => {
    createWindow();
    mainWindow.webContents.once("did-finish-load", () => {
        ensureMathReady();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
