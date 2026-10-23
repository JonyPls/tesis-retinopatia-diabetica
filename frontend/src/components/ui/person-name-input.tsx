import { useLayoutEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { filterPersonNameInput } from "@/lib/fieldValidation";

interface PersonNameInputProps extends Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "onBlur"> {
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
}

export function PersonNameInput({ value, onValueChange, onBlur, ...props }: PersonNameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    pendingSelection.current = null;
    if (selection && inputRef.current === document.activeElement) {
      inputRef.current.setSelectionRange(selection.start, selection.end);
    }
  });

  const update = (input: HTMLInputElement) => {
    const filtered = filterPersonNameInput(input.value);
    if (filtered !== input.value) {
      pendingSelection.current = {
        start: filterPersonNameInput(input.value.slice(0, input.selectionStart ?? input.value.length)).length,
        end: filterPersonNameInput(input.value.slice(0, input.selectionEnd ?? input.value.length)).length,
      };
    }
    onValueChange(filtered);
  };

  return <Input {...props} ref={inputRef} value={value} required
    onChange={(event) => {
      if (composing.current) onValueChange(event.target.value);
      else update(event.target);
    }}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={(event) => { composing.current = false; update(event.currentTarget); }}
    onBlur={onBlur} />;
}
