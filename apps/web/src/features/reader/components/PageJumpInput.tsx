import { useEffect, useRef } from "react";
import { useLocalAtom } from "@read-aware/ui/state";

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
        className="w-full border border-stone-300 bg-white px-3 py-1.5 font-sans text-sm text-stone-950 focus:border-stone-950 focus:outline-none"
      />
      <button
        type="submit"
        className="shrink-0 border border-stone-300 px-3 py-1.5 font-sans text-sm font-medium text-stone-950 transition-colors hover:bg-stone-100"
      >
        Go
      </button>
    </form>
  );
}
