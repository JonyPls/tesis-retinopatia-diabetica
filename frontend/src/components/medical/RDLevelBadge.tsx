import { cn } from "@/lib/utils";
import { RDLevel, RD_LEVELS } from "@/data/mockData";

interface Props {
  level: RDLevel;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
}

export function RDLevelBadge({ level, showLabel = true, size = "md" }: Props) {
  const info = RD_LEVELS[level];
  const sizeCls = {
    sm: "text-[10px] px-1.5 py-0.5 gap-1",
    md: "text-xs px-2 py-1 gap-1.5",
    lg: "text-sm px-3 py-1.5 gap-2",
  }[size];

  const dotSize = { sm: "h-1.5 w-1.5", md: "h-2 w-2", lg: "h-2.5 w-2.5" }[size];

  return (
    <span
      className={cn(
        "inline-flex items-center font-medium rounded-md border",
        sizeCls
      )}
      style={{
        backgroundColor: `hsl(var(--rd-${level}) / 0.12)`,
        color: `hsl(var(--rd-${level}))`,
        borderColor: `hsl(var(--rd-${level}) / 0.3)`,
      }}
    >
      <span className={cn("rounded-full", dotSize)} style={{ backgroundColor: `hsl(var(--rd-${level}))` }} />
      Nivel {level}
      {showLabel && <span className="opacity-90">· {info.label}</span>}
    </span>
  );
}
