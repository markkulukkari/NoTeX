const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kaava", {
    openFile: () => ipcRenderer.invoke("file:open"),
    saveFile: (payload) => ipcRenderer.invoke("file:save", payload),
    latexToSvg: (latex) => ipcRenderer.invoke("math:svg", latex),
    mathReady: () => ipcRenderer.invoke("math:ready"),
    copyAll: (payload) => ipcRenderer.invoke("clipboard:write", payload),
    confirmUnsaved: (message) => ipcRenderer.invoke("dialog:unsaved", message),
    setDocumentState: (state) => ipcRenderer.send("doc:state", state),
    closeWindow: () => ipcRenderer.send("app:close-ok"),
    onMenuAction: (callback) => {
        ipcRenderer.on("menu:action", (_event, action) => callback(action));
    },
    onBeforeClose: (callback) => {
        ipcRenderer.on("app:before-close", () => callback());
    },
});
