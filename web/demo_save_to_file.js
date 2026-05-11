let pendingHandle = null;
let currentHandle = null;
let savedClean = false;

function pickerAvailable() {
  return typeof window !== "undefined" && "showOpenFilePicker" in window;
}

async function pickPdfFile() {
  const [handle] = await window.showOpenFilePicker({
    types: [
      {
        description: "PDF",
        accept: { "application/pdf": [".pdf"] },
      },
    ],
    excludeAcceptAllOption: false,
    multiple: false,
  });
  const file = await handle.getFile();
  pendingHandle = handle;
  return { file, handle };
}

async function writeToHandle(handle, data) {
  if (handle.queryPermission) {
    const perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      const req = await handle.requestPermission({ mode: "readwrite" });
      if (req !== "granted") {
        return false;
      }
    }
  }
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
  return true;
}

function initDemoSaveToFile({ eventBus, app }) {
  // Promote the just-picked handle to "current" when its document finishes
  // loading. Any other load (drag-drop, URL, toolbar input) clears it, so
  // Save falls through to the standard download path.
  eventBus.on("documentloaded", () => {
    currentHandle = pendingHandle;
    pendingHandle = null;
    savedClean = false;
  });

  // After a successful FSA write the bytes are on disk, so the upstream
  // beforeunload guard (which warns whenever annotationStorage.size > 0)
  // becomes a false positive. Suppress it until the next edit flips the
  // storage's modified flag back on.
  const origHasChanges = app._hasChanges?.bind(app);
  if (origHasChanges) {
    app._hasChanges = function () {
      if (savedClean && !app._annotationStorageModified) {
        return false;
      }
      return origHasChanges();
    };
  }

  // Patch the hidden <input type="file"> click so every open path (overlay
  // button, toolbar Open) prefers the FSA picker. Falls back to the native
  // dialog if FSA isn't available or the user cancels.
  const input = app._openFileInput;
  if (input && pickerAvailable()) {
    const nativeClick = input.click.bind(input);
    input.click = async function () {
      try {
        const picked = await pickPdfFile();
        app.eventBus.dispatch("fileinputchange", {
          source: input,
          fileInput: { files: [picked.file] },
        });
      } catch (ex) {
        if (ex?.name === "AbortError") {
          return;
        }
        console.warn(
          `demo_save_to_file: picker failed, falling back: ${ex?.message}`
        );
        nativeClick();
      }
    };
  }

  // Intercept Save: if we have a handle for the current document, write the
  // bytes back to it. Otherwise let the original download manager run.
  const dm = app.downloadManager;
  if (dm) {
    const originalDownload = dm.download.bind(dm);
    dm.download = async function (data, url, filename) {
      if (currentHandle && data) {
        try {
          const ok = await writeToHandle(currentHandle, data);
          if (ok) {
            savedClean = true;
            app.pdfDocument?.annotationStorage.resetModified();
            return;
          }
        } catch (ex) {
          console.warn(
            `demo_save_to_file: write-back failed, downloading instead: ${ex?.message}`
          );
        }
      }
      originalDownload(data, url, filename);
    };
  }
}

export { initDemoSaveToFile };
