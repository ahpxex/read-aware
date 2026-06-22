/**
 * Note Editor Panel for creating/editing annotations
 */

import { useState, useEffect } from "react";
import { Button, TextArea, Body, Heading, IconButton } from "@read-aware/ui";
import { X } from "@phosphor-icons/react";
import { cn } from "@read-aware/ui/cn";

export interface NoteEditorProps {
  isOpen: boolean;
  selectedText: string;
  initialContent?: string;
  onSave: (content: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
  isEditing?: boolean;
}

export function NoteEditor({
  isOpen,
  selectedText,
  initialContent = "",
  onSave,
  onCancel,
  onDelete,
  isEditing = false,
}: NoteEditorProps) {
  const [content, setContent] = useState(initialContent);

  useEffect(() => {
    if (isOpen) {
      setContent(initialContent);
    }
  }, [isOpen, initialContent]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/35 backdrop-blur-sm px-4 py-6">
      <div
        className={cn(
          "flex w-full max-w-lg flex-col border border-border bg-[var(--ra-main-surface-color)]",
          "shadow-[0_12px_32px_rgba(28,25,23,0.15)]"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <Heading size="xl">{isEditing ? "Edit Note" : "Add Note"}</Heading>
          <IconButton
            label="Close"
            size="sm"
            onClick={onCancel}
            className="text-fg-muted hover:text-fg"
            icon={<X size={14} weight="regular" />}
          />
        </div>

        <div className="px-5 py-4">
          <div className="mb-4 rounded-md border border-border bg-fill p-3">
            <Body className="text-sm text-fg-muted line-clamp-3">
              &ldquo;{selectedText}&rdquo;
            </Body>
          </div>

          <TextArea
            label="Your note"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What are your thoughts on this passage?"
            rows={6}
            autoFocus
          />
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          {isEditing && onDelete ? (
            <Button variant="danger" size="sm" onClick={onDelete}>
              Delete
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => onSave(content)}
              disabled={!content.trim()}
            >
              {isEditing ? "Update" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
