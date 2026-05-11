const STORAGE_PREFIX = "pdfjs-demo-highlights:";
const SAVE_DEBOUNCE_MS = 250;

function initDemoHighlightStorage({ eventBus, app }) {
  let uiManager = null;
  let pdfDocument = null;
  let storageKey = null;
  let savedByPage = new Map();
  const injectedPages = new Set();
  let saveTimer = 0;

  function readStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeStorage() {
    if (!uiManager || !storageKey || !pdfDocument) {
      return;
    }
    const all = [];
    const pageCount = pdfDocument.numPages;
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      for (const editor of uiManager.getEditors(pageIndex)) {
        if (editor.constructor._type !== "highlight" || editor.isEmpty()) {
          continue;
        }
        const serialized = editor.serialize();
        if (!serialized) {
          continue;
        }
        serialized.pageIndex = pageIndex;
        // Float32Array round-trips through JSON as an object without `.length`,
        // which breaks the array iteration in HighlightEditor.deserialize.
        if (serialized.quadPoints && !Array.isArray(serialized.quadPoints)) {
          serialized.quadPoints = Array.from(serialized.quadPoints);
        }
        all.push(serialized);
      }
    }
    try {
      if (all.length === 0) {
        localStorage.removeItem(storageKey);
      } else {
        localStorage.setItem(storageKey, JSON.stringify(all));
      }
    } catch (ex) {
      console.warn(`demo_highlight_storage: write failed: ${ex?.message}`);
    }
  }

  function scheduleSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      writeStorage();
    }, SAVE_DEBOUNCE_MS);
  }

  async function injectForPage(layer, pageIndex) {
    if (injectedPages.has(pageIndex)) {
      return;
    }
    injectedPages.add(pageIndex);
    const highlights = savedByPage.get(pageIndex);
    if (!highlights?.length) {
      return;
    }
    for (const data of highlights) {
      try {
        const payload = { ...data };
        if (payload.quadPoints && !Array.isArray(payload.quadPoints)) {
          payload.quadPoints = Object.keys(payload.quadPoints)
            .map(Number)
            .sort((a, b) => a - b)
            .map(k => payload.quadPoints[k]);
        }
        const editor = await layer.deserialize(payload);
        if (editor) {
          layer.addOrRebuild(editor);
        }
      } catch (ex) {
        console.warn(`demo_highlight_storage: restore failed: ${ex?.message}`);
      }
    }
  }

  function resetForNewDocument(newDoc) {
    pdfDocument = newDoc;
    savedByPage = new Map();
    injectedPages.clear();
    const fingerprint = newDoc?.fingerprints?.[0];
    if (!fingerprint) {
      storageKey = null;
      return;
    }
    storageKey = STORAGE_PREFIX + fingerprint;
    for (const item of readStorage(storageKey)) {
      const pageIndex = item.pageIndex ?? 0;
      let arr = savedByPage.get(pageIndex);
      if (!arr) {
        arr = [];
        savedByPage.set(pageIndex, arr);
      }
      arr.push(item);
    }
  }

  eventBus.on("annotationeditoruimanager", ({ uiManager: mgr }) => {
    uiManager = mgr;
  });

  eventBus.on("documentloaded", () => {
    resetForNewDocument(app.pdfDocument);
  });

  eventBus.on(
    "annotationeditorlayerrendered",
    ({ source, pageNumber, error }) => {
      if (error || !storageKey) {
        return;
      }
      const layer = source?.annotationEditorLayer?.annotationEditorLayer;
      if (!layer) {
        return;
      }
      injectForPage(layer, pageNumber - 1);
    }
  );

  eventBus.on("editingstateschanged", () => {
    if (!storageKey) {
      return;
    }
    scheduleSave();
  });
}

export { initDemoHighlightStorage };
