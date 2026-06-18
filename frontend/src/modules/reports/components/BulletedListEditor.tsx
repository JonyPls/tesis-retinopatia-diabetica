import { useState, useRef, forwardRef, useImperativeHandle } from "react";

interface BulletedListEditorProps {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}

export interface BulletedListEditorHandle {
  flush: () => string[];
}

export const BulletedListEditor = forwardRef<BulletedListEditorHandle, BulletedListEditorProps>(
  ({ items, onChange, placeholder }, ref) => {
    const [input, setInput] = useState("");
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editValue, setEditValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const editRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      flush: () => {
        const trimmed = input.trim();
        if (!trimmed) return items;
        const next = [...items, trimmed];
        onChange(next);
        setInput("");
        return next;
      },
    }));

    const addItem = () => {
      const trimmed = input.trim();
      if (!trimmed) return;
      onChange([...items, trimmed]);
      setInput("");
      inputRef.current?.focus();
    };

    const removeItem = (index: number) => {
      if (editingIndex === index) setEditingIndex(null);
      onChange(items.filter((_, i) => i !== index));
    };

    const startEdit = (index: number) => {
      setEditingIndex(index);
      setEditValue(items[index]);
      setTimeout(() => editRef.current?.focus(), 0);
    };

    const saveEdit = (index: number) => {
      const trimmed = editValue.trim();
      if (!trimmed) {
        removeItem(index);
        return;
      }
      const next = [...items];
      next[index] = trimmed;
      onChange(next);
      setEditingIndex(null);
      setEditValue("");
    };

    const handleEditKeyDown = (e: React.KeyboardEvent, index: number) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveEdit(index);
      }
      if (e.key === "Escape") {
        setEditingIndex(null);
        setEditValue("");
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addItem();
      }
    };

    return (
      <div className="space-y-2">
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {items.map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-3 py-2 text-sm border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => !(editingIndex === i) && startEdit(i)}
            >
              <span className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-primary font-bold shrink-0">•</span>
                {editingIndex === i ? (
                  <input
                    ref={editRef}
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => saveEdit(i)}
                    onKeyDown={(e) => handleEditKeyDown(e, i)}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 bg-muted rounded px-1.5 py-0.5 text-sm outline-none ring-1 ring-primary/30 focus:ring-2 focus:ring-primary"
                  />
                ) : (
                  <span className="truncate">{item}</span>
                )}
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeItem(i); }}
                className="h-6 w-6 rounded-md hover:bg-destructive/10 hover:text-destructive flex items-center justify-center transition-colors text-muted-foreground/60 hover:text-destructive shrink-0 ml-2"
                title="Eliminar"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="text-primary font-bold shrink-0">•</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder || "Escriba y presione Enter para agregar..."}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </div>
    );
  },
);

BulletedListEditor.displayName = "BulletedListEditor";
