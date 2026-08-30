/**
 * The end of a book — the container half.
 *
 * It owns exactly one thing the screen cannot render without: the reader's own
 * marks, loaded from the annotation store. Everything else — the palette, the
 * figures, the actions — lives in `ReaderCompletionScreenView`.
 */
import type { ComponentProps } from "react";
import { useBookMarks } from "../hooks/useBookMarks";
import { ReaderCompletionScreenView } from "./ReaderCompletionScreenView";

type ReaderCompletionScreenProps = Omit<
  ComponentProps<typeof ReaderCompletionScreenView>,
  "marks" | "marksFailed"
>;

export function ReaderCompletionScreen(props: ReaderCompletionScreenProps) {
  const { marks, failed } = useBookMarks(props.book.id);
  return <ReaderCompletionScreenView {...props} marks={marks} marksFailed={failed} />;
}
