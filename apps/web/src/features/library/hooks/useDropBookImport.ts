import { useEffect, useRef, useState } from "react";
import { dragCarriesBooks } from "../../shelf/lib/book-drag";
import { BOOK_FILE_EXTENSIONS } from "../lib/pick-book-files";
import type { BookImportSource } from "../lib/library-types";

function isBookFile(file: File): boolean {
  const dot = file.name.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = file.name.slice(dot + 1).toLowerCase();
  return (BOOK_FILE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Window-wide drag-and-drop book import. Works because the Tauri window has
 * `dragDropEnabled: false` (native interception off for the menus feature's
 * HTML5 drags), which leaves OS file drops to arrive as plain HTML5 drop
 * events. "Files" alone doesn't prove an OS drop: WebKit tags a native image
 * drag (a shelf cover) with "Files" too, so drags carrying the shelf's own
 * book payload are excluded explicitly.
 *
 * Returns whether a file drag is currently hovering the window (drives the
 * drop overlay).
 */
export function useDropBookImport(
  importSources: (sources: BookImportSource[]) => Promise<unknown>,
): boolean {
  const importRef = useRef(importSources);
  importRef.current = importSources;
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    // enter/leave fire per DOM node crossed; the counter nets them out so the
    // overlay survives moving across children and clears on leaving the window.
    let depth = 0;
    const hasFiles = (event: DragEvent) =>
      (event.dataTransfer?.types.includes("Files") ?? false) &&
      !dragCarriesBooks(event.dataTransfer);

    function onDragEnter(event: DragEvent) {
      if (!hasFiles(event)) return;
      depth += 1;
      setDragActive(true);
    }
    function onDragOver(event: DragEvent) {
      if (!hasFiles(event)) return;
      // Without this the webview navigates to the dropped file.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }
    function onDragLeave(event: DragEvent) {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragActive(false);
    }
    function onDrop(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragActive(false);
      const files = Array.from(event.dataTransfer?.files ?? []).filter(isBookFile);
      if (files.length === 0) return;
      void importRef.current(files.map((file) => ({ kind: "file" as const, file })));
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return dragActive;
}
