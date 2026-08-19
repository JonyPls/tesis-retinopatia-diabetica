import { useState, useRef, useEffect } from "react";
import { SearchableOption } from "../types";

interface SearchableFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  textareaPlaceholder?: string;
}

export function SearchableField({
  label,
  value,
  onChange,
  options,
  placeholder = "Buscar opción...",
  textareaPlaceholder = "Escriba o seleccione una opción...",
}: SearchableFieldProps) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase()),
  );

  const grouped = filtered.reduce<Record<string, SearchableOption[]>>((acc, opt) => {
    const g = opt.group || "_";
    if (!acc[g]) acc[g] = [];
    acc[g].push(opt);
    return acc;
  }, {});

  const handleSelect = (option: SearchableOption) => {
    onChange(option.value);
    setSearch("");
    setIsOpen(false);
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <div ref={wrapperRef} className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {isOpen && filtered.length > 0 && (
          <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border border-border bg-white shadow-lg max-h-48 overflow-y-auto">
            {Object.entries(grouped).map(([group, opts]) => (
              <div key={group}>
                {group !== "_" && (
                  <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary bg-primary/5 border-l-2 border-primary">
                    {group === "AO" ? "Ambos Ojos" : group === "OD" ? "Ojo Derecho" : group === "OI" ? "Ojo Izquierdo" : group}
                  </div>
                )}
                {opts.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelect(opt)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={textareaPlaceholder}
        rows={3}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
      />
    </div>
  );
}
