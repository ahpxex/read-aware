import { useEffect, useRef } from "react";
import { useLocalAtom } from "@read-aware/ui/state";
import { useTranslation } from "../../../i18n";

type PageJumpInputProps = {
  numPages: number;
  currentPage: number;
  onJump: (page: number) => void;
};

export function PageJumpInput({
  numPages,
  currentPage,
  onJump,
}: PageJumpInputProps) {
  const { t } = useTranslation("reader");
  const [value, setValue] = useLocalAtom(String(currentPage));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setValue(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseInt(value, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= numPages) {
      onJump(parsed);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        ref={inputRef}
        type="number"
        min={1}
        max={numPages}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full border border-border-strong bg-surface px-3 py-1.5 font-sans text-sm text-fg focus:border-fg focus:outline-none"
      />
      <button
        type="submit"
        className="shrink-0 border border-border-strong px-3 py-1.5 font-sans text-sm font-medium text-fg transition-colors hover:bg-fg/5"
      >
        {t("go")}
      </button>
    </form>
  );
}
