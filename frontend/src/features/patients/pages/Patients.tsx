import { AppLayout } from "@/components/layout/AppLayout";
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
import { usePatients } from "../hooks/usePatients";
import { civilAge } from "@/lib/clinicalDates";
import { PatientTable } from "../components/PatientTable";
import { PatientCardGrid } from "../components/PatientCardGrid";
import { CreatePatientDialog } from "../components/CreatePatientDialog";
import { PatientLookupError } from "../components/PatientLookupError";

const calculateAge = (birthDate: string) => {
  return civilAge(birthDate) ?? "-";
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
          registrationScope={hook.registrationScope}
          isSubmitting={hook.isSubmitting}
          consent={hook.consent}
          onConsentChange={hook.setConsent}
          onDocumentChange={handleDocumentChange}
          onPhoneChange={hook.handlePhoneChange}
          onFieldChange={handleFieldChange}
          onSubmit={hook.handleSubmit}
          onTipoDocChange={handleTipoDocChange}
          hasUnsavedChanges={hook.hasPatientFormChanges}
          onDiscard={hook.resetPatientForm}
        />
      }
    >
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1 max-w-md">
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
          <div className="ml-auto flex items-center gap-2">
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

        <div className="border-t border-border p-4">
          {hook.loadError ? (
            <PatientLookupError error={hook.loadError} />
          ) : hook.viewMode === "table" ? (
            <PatientTable
              patients={hook.currentData}
              isLoading={hook.isLoading}
              scope={hook.scope}
              calculateAge={calculateAge}
            />
          ) : (
            <PatientCardGrid
              patients={hook.currentData}
              isLoading={hook.isLoading}
              scope={hook.scope}
              calculateAge={calculateAge}
            />
          )}
        </div>

        {hook.totalItems > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
              <div className="text-sm text-muted-foreground">
                Mostrando{" "}
                <span className="font-medium text-foreground">
                  {hook.startIndex + 1}
                </span>{" "}
                a{" "}
                <span className="font-medium text-foreground">
                  {Math.min(hook.endIndex, hook.totalItems)}
                </span>{" "}
                de{" "}
                <span className="font-medium text-foreground">
                  {hook.totalItems}
                </span>{" "}
                pacientes
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => hook.setCurrentPage(Math.max(1, hook.currentPage - 1))}
                  disabled={hook.currentPage === 1}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => hook.setCurrentPage(Math.min(hook.totalPages, hook.currentPage + 1))}
                  disabled={hook.currentPage === hook.totalPages}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          )}
      </div>
    </AppLayout>
  );
}
