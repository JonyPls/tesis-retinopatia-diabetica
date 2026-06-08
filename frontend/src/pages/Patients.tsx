import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Table2, LayoutGrid } from "lucide-react";
import { usePatients } from "@/modules/patients/hooks/usePatients";
import { PatientTable } from "@/modules/patients/components/PatientTable";
import { PatientCardGrid } from "@/modules/patients/components/PatientCardGrid";
import { CreatePatientDialog } from "@/modules/patients/components/CreatePatientDialog";

const calculateAge = (birthDate: string) => {
  if (!birthDate) return "-";
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
};

export default function Patients() {
  const hook = usePatients();

  const handleTipoDocChange = (val: string) => {
    hook.setFormData((prev) => ({
      ...prev,
      tipo_doc: val,
      nro_documento: "",
    }));
  };

  const handleDocumentChange = (value: string) => {
    hook.handleDocumentChange(value, hook.formData.tipo_doc);
  };

  const handleFieldChange = (field: string, value: string) => {
    hook.handleChange(field, value);
  };

  return (
    <AppLayout
      title="Gestión de Pacientes"
      subtitle={`${hook.patients.length} pacientes en el sistema`}
      actions={
        <CreatePatientDialog
          open={hook.open}
          onOpenChange={hook.setOpen}
          formData={hook.formData}
          formError={hook.formError}
          isSubmitting={hook.isSubmitting}
          consent={hook.consent}
          onConsentChange={hook.setConsent}
          onDocumentChange={handleDocumentChange}
          onPhoneChange={hook.handlePhoneChange}
          onFieldChange={handleFieldChange}
          onSubmit={hook.handleSubmit}
          onTipoDocChange={handleTipoDocChange}
        />
      }
    >
      <Card className="shadow-card">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-[250px]">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por documento o nombres"
                  value={hook.query}
                  onChange={(e) => {
                    hook.setQuery(e.target.value);
                    hook.setCurrentPage(1);
                  }}
                  className="pl-9"
                />
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {hook.totalItems} resultado{hook.totalItems !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Mostrar:</span>
              <Select
                value={hook.itemsPerPage.toString()}
                onValueChange={(val) => {
                  hook.setItemsPerPage(Number(val));
                  hook.setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-[70px] h-9">
                  <SelectValue placeholder="10" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center border border-border rounded-md overflow-hidden">
              <button
                onClick={() => hook.setViewMode("table")}
                className={`p-2 transition-colors ${
                  hook.viewMode === "table"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
                title="Vista tabla"
              >
                <Table2 className="h-4 w-4" />
              </button>
              <button
                onClick={() => hook.setViewMode("cards")}
                className={`p-2 transition-colors ${
                  hook.viewMode === "cards"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
                title="Vista cards"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
            </div>
          </div>

          {hook.viewMode === "table" ? (
            <PatientTable
              patients={hook.currentData}
              isLoading={hook.isLoading}
              calculateAge={calculateAge}
            />
          ) : (
            <PatientCardGrid
              patients={hook.currentData}
              isLoading={hook.isLoading}
              calculateAge={calculateAge}
            />
          )}

          {hook.totalItems > 0 && (
            <div className="flex items-center justify-between pt-5">
              <div className="text-sm text-muted-foreground">
                Mostrando{" "}
                <span className="font-medium text-slate-900">
                  {hook.startIndex + 1}
                </span>{" "}
                a{" "}
                <span className="font-medium text-slate-900">
                  {Math.min(hook.endIndex, hook.totalItems)}
                </span>{" "}
                de{" "}
                <span className="font-medium text-slate-900">
                  {hook.totalItems}
                </span>{" "}
                pacientes
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => hook.setCurrentPage(Math.max(1, hook.currentPage - 1))}
                  disabled={hook.currentPage === 1}
                  className="hover:text-teal-600 hover:border-teal-600 transition-colors"
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => hook.setCurrentPage(Math.min(hook.totalPages, hook.currentPage + 1))}
                  disabled={hook.currentPage === hook.totalPages}
                  className="hover:text-teal-600 hover:border-teal-600 transition-colors"
                >
                  Siguiente
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  );
}
