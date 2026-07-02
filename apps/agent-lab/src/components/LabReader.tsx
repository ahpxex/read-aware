/**
 * lab 的真·阅读视图：foliate 渲染、翻页、实时进度；选中文字可引用进对话
 * （带真实 CFI 锚点 —— ask-note 的锚点从这里来）。
 */
import { useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight, Quotes } from "@phosphor-icons/react";
import { Caption, IconButton, Spinner } from "@read-aware/ui";
import {
  createFoliateView,
  type FoliateLoadDetail,
  type FoliateRelocateDetail,
  type FoliateView,
} from "../lib/foliate";

export interface ReaderQuote {
  text: string;
  cfi?: string;
  chapter?: string;
}

export interface ReaderPosition {
  fraction: number;
  cfi?: string;
  chapter?: string;
}

type LabReaderProps = {
  url: string;
  onRelocate?: (position: ReaderPosition) => void;
  onQuote?: (quote: ReaderQuote) => void;
};

export function LabReader({ url, onRelocate, onQuote }: LabReaderProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [chapter, setChapter] = useState<string | undefined>();
  const [selection, setSelection] = useState<ReaderQuote | null>(null);

  const onRelocateRef = useRef(onRelocate);
  onRelocateRef.current = onRelocate;
  const onQuoteRef = useRef(onQuote);
  onQuoteRef.current = onQuote;
  const chapterRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let view: FoliateView | null = null;
    setIsLoading(true);
    setError(null);
    setSelection(null);
    setProgress(0);
    setChapter(undefined);

    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`fetch ${url}: ${response.status}`);
        const blob = await response.blob();
        const file = new File([blob], url.split("/").pop() ?? "book.epub");
        view = await createFoliateView();
        if (cancelled || !hostRef.current) return;
        view.style.width = "100%";
        view.style.height = "100%";
        view.style.display = "block";
        hostRef.current.replaceChildren(view);

        view.addEventListener("relocate", (event) => {
          const detail = (event as CustomEvent<FoliateRelocateDetail>).detail;
          const fraction = detail.fraction ?? 0;
          const label = detail.tocItem?.label ?? undefined;
          chapterRef.current = label ?? chapterRef.current;
          setProgress(fraction);
          setChapter(chapterRef.current);
          onRelocateRef.current?.({ fraction, cfi: detail.cfi, chapter: chapterRef.current });
        });

        view.addEventListener("load", (event) => {
          const { doc, index } = (event as CustomEvent<FoliateLoadDetail>).detail;
          doc.addEventListener("mouseup", () => {
            const docSelection = doc.getSelection();
            const text = docSelection?.toString().trim();
            if (!text || !docSelection || docSelection.rangeCount === 0) {
              setSelection(null);
              return;
            }
            let cfi: string | undefined;
            try {
              cfi = view?.getCFI(index, docSelection.getRangeAt(0));
            } catch {
              cfi = undefined;
            }
            setSelection({ text, cfi, chapter: chapterRef.current });
          });
        });

        await view.open(file);
        if (cancelled) return;
        await view.renderer?.next();
        viewRef.current = view;
        setIsLoading(false);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      view?.remove();
      viewRef.current = null;
    };
  }, [url]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="h-full" />
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface">
            <Spinner size="sm" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Caption className="text-fg-muted">阅读器加载失败：{error}</Caption>
          </div>
        )}
        {selection && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center">
            <button
              type="button"
              onClick={() => {
                onQuoteRef.current?.(selection);
                setSelection(null);
              }}
              className="flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3 py-1.5 text-sm text-fg shadow-sm transition-colors hover:bg-fill"
            >
              <Quotes size={14} weight="fill" /> 引用到对话
            </button>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-border px-2 py-1">
        <IconButton
          label="上一页"
          size="sm"
          onClick={() => void viewRef.current?.goLeft()}
          icon={<CaretLeft size={14} />}
        />
        <Caption className="truncate px-2 text-fg-subtle">
          {chapter ? `${chapter} · ` : ""}
          {Math.round(progress * 100)}%
        </Caption>
        <IconButton
          label="下一页"
          size="sm"
          onClick={() => void viewRef.current?.goRight()}
          icon={<CaretRight size={14} />}
        />
      </div>
    </div>
  );
}
