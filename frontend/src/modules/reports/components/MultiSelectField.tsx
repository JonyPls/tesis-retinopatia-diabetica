import { useState, useRef, useEffect, useMemo } from "react";
import { SearchableOption } from "../types";

interface MultiSelectFieldProps {
  label: string;
  options: SearchableOption[];
  selected: string[];
  onSelectionChange: (values: string[]) => void;
  placeholder?: string;
}

export function MultiSelectField({
  label,
  options,
  selected,
  onSelectionChange,
  placeholder = "Buscar opción...",
}: MultiSelectFieldProps) {
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

  // Grupos bloqueados: grupos de las selecciones actuales + AO si hay alguna selección de ojo
  const blockedGroups = useMemo(() => {
    const groups = new Set<string>();
    for (const val of selected) {
      const opt = options.find((o) => o.value === val);
      if (opt?.group) {
        groups.add(opt.group);
        if (opt.group === "AO") {
          groups.add("OD");
          groups.add("OI");
        } else {
          groups.add("AO");
        }
      }
    }
    return groups;
  }, [selected, options]);

  const available = options.filter((o) => {
    if (!o.group) return true;
    return !blockedGroups.has(o.group);
  });

  const filtered = available.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase()),
  );

  const grouped = filtered.reduce<Record<string, SearchableOption[]>>((acc, opt) => {
    const g = opt.group || "_";
    if (!acc[g]) acc[g] = [];
    acc[g].push(opt);
    return acc;
  }, {});

  const handleSelect = (opt: SearchableOption) => {
    if (selected.includes(opt.value)) return;
    onSelectionChange([...selected, opt.value]);
    setSearch("");
    setIsOpen(false);
  };

  const removeItem = (value: string) => {
    onSelectionChange(selected.filter((v) => v !== value));
  };

  const selectedLabels = useMemo(() => {
    return selected.map((val) => {
      const opt = options.find((o) => o.value === val);
      return { value: val, label: opt?.label || val, group: opt?.group || "" };
    });
  }, [selected, options]);

  const groupLabel = (g: string) =>
    g === "AO" ? "AO" : g === "OD" ? "OD" : g === "OI" ? "OI" : g;

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
          <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border border-border bg-white shadow-lg max-h-56 overflow-y-auto">
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
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                    {opt.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedLabels.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {selectedLabels.map((item) => (
            <div
              key={item.value}
              className="flex items-center justify-between px-3 py-2 text-sm border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-primary font-bold">•</span>
                <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                  {groupLabel(item.group)}
                </span>
                <span>{item.label}</span>
              </div>
              <button
                type="button"
                onClick={() => removeItem(item.value)}
                className="h-6 w-6 rounded-md hover:bg-destructive/10 hover:text-destructive flex items-center justify-center transition-colors text-muted-foreground"
                title="Quitar"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
