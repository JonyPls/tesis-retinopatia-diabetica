import type { ReactNode } from "react";
import { Eye, FileText, Ruler, ScanEye } from "lucide-react";

export const REPORT_TYPE_PRESENTATION: Record<
  number,
  { bg: string; color: string; icon: ReactNode }
> = {
  2: { icon: <ScanEye className="h-6 w-6" />, bg: "bg-sky-100", color: "text-sky-700" },
  3: { icon: <Eye className="h-6 w-6" />, bg: "bg-purple-100", color: "text-purple-700" },
  4: { icon: <Ruler className="h-6 w-6" />, bg: "bg-amber-100", color: "text-amber-700" },
};

export function getReportTypePresentation(typeId: number, iconClassName = "h-6 w-6") {
  const presentation = REPORT_TYPE_PRESENTATION[typeId];

  if (presentation) {
    return presentation;
  }

  return {
    icon: <FileText className={iconClassName} />,
    bg: "bg-muted",
    color: "text-muted-foreground",
  };
}
