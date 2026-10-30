import { PageContent } from "@/components/layout/PageContent";
import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

export default function Placeholder({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <PageContent title={title} subtitle={subtitle}>
      <Card className="shadow-card">
        <CardContent className="py-20 flex flex-col items-center text-center">
          <div className="h-14 w-14 rounded-full bg-accent flex items-center justify-center mb-4">
            <Construction className="h-7 w-7 text-primary" />
          </div>
          <h3 className="text-lg font-semibold">Módulo en construcción</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Esta sección estará disponible en la siguiente iteración del sistema.
          </p>
        </CardContent>
      </Card>
    </PageContent>
  );
}
