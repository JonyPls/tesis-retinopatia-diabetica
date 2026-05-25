import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Search, UserPlus, Eye, Phone, ShieldCheck } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { StatusBadge, Status } from "@/components/medical/StatusBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Patient {
  id?: string | number;
  tipo_doc?: string;
  tipo_doc_abrev?: string;
  nro_documento: string;
  nombres_apellidos?: string;
  nombres?: string;
  apellidos?: string;
  sexo: string;
  fecha_nacimiento: string;
  telefono: string;
  ultima_visita?: string;
  maxima_gravedad?: number | null;
}

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

const formatPhone = (phone: string) => {
  if (!phone) return "";
  const formatted = phone.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
  return `+51 ${formatted}`;
};

const getPatientStatus = (maxLevel?: number | null): Status => {
  if (maxLevel === undefined || maxLevel === null) return "Sin Evaluar";
  if (maxLevel >= 3) return "Crítico";
  if (maxLevel >= 1) return "Seguimiento";
  return "Normal";
};

export default function Patients() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const [formData, setFormData] = useState({
    tipo_doc: "DNI",
    nro_documento: "",
    nombres: "",
    apellidos: "",
    sexo: "",
    fecha_nacimiento: "",
    telefono: "",
  });
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchPatients = async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem("token");
      const response = await fetch("http://localhost:5000/api/pacientes", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        localStorage.removeItem("token");
        window.location.href = "/";
        return;
      }

      const data = await response.json();
      setPatients(data.data || []);
    } catch (error) {
      console.error("Error al obtener pacientes:", error);
      toast({
        title: "Error",
        description: "No se pudieron cargar los pacientes",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPatients();
  }, []);

  const handleDocumentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let rawValue = e.target.value;
    if (formData.tipo_doc === "DNI") {
      rawValue = rawValue.replace(/\D/g, "");
    } else {
      rawValue = rawValue.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    }
    const maxLength = formData.tipo_doc === "DNI" ? 8 : 12;
    setFormData((prev) => ({
      ...prev,
      nro_documento: rawValue.slice(0, maxLength),
    }));
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/\D/g, "").slice(0, 9);
    const formatted = rawValue.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
    setFormData((prev) => ({ ...prev, telefono: formatted }));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.id]: e.target.value }));
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) => {
      const fullName =
        p.nombres_apellidos || `${p.nombres || ""} ${p.apellidos || ""}`;
      return (
        p.nro_documento?.toLowerCase().includes(q) ||
        fullName.toLowerCase().includes(q)
      );
    });
  }, [query, patients]);

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentData = filtered.slice(startIndex, endIndex);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (formData.tipo_doc === "DNI" && formData.nro_documento.length !== 8) {
      setFormError("El DNI debe tener exactamente 8 dígitos.");
      return;
    }
    if (formData.tipo_doc === "CE" && formData.nro_documento.length < 8) {
      setFormError("El CE debe tener al menos 8 dígitos.");
      return;
    }

    if (!consent) {
      toast({
        title: "Consentimiento requerido",
        description:
          "Debe confirmar el archivo físico del consentimiento informado.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.sexo) {
      setFormError("Debe seleccionar un sexo.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        tipo_doc: formData.tipo_doc,
        nro_documento: formData.nro_documento,
        nombres: formData.nombres,
        apellidos: formData.apellidos,
        sexo: formData.sexo,
        fecha_nacimiento: formData.fecha_nacimiento,
        telefono: formData.telefono.replace(/\D/g, ""),
      };

      const token = localStorage.getItem("token");
      const response = await fetch("http://localhost:5000/api/pacientes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        localStorage.removeItem("token");
        window.location.href = "/";
        return;
      }

      const data = await response.json();

      if (response.ok) {
        toast({
          title: "Paciente registrado",
          description: "Los datos se han guardado correctamente.",
        });
        setOpen(false);
        setConsent(false);
        setFormData({
          tipo_doc: "DNI",
          nro_documento: "",
          nombres: "",
          apellidos: "",
          sexo: "",
          fecha_nacimiento: "",
          telefono: "",
        });
        fetchPatients();
      } else {
        setFormError(data.message || "Error al registrar el paciente.");
      }
    } catch (error) {
      setFormError("Error de conexión con el servidor.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppLayout
      title="Gestión de Pacientes"
      subtitle={`${patients.length} pacientes en el sistema`}
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-primary hover:opacity-90">
              <UserPlus className="h-4 w-4" />
              Nuevo Paciente
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>Registrar Nuevo Paciente</DialogTitle>
              <DialogDescription>
                Complete los datos demográficos. Todos los campos son
                obligatorios.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 pt-2">
              {formError && (
                <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm border border-red-200">
                  {formError}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 flex gap-2">
                  <div className="w-1/3 space-y-1.5">
                    <Label htmlFor="tipo_doc">Doc</Label>
                    <Select
                      value={formData.tipo_doc}
                      onValueChange={(val) =>
                        setFormData((prev) => ({
                          ...prev,
                          tipo_doc: val,
                          nro_documento: "",
                        }))
                      }
                      required
                    >
                      <SelectTrigger id="tipo_doc">
                        <SelectValue placeholder="DNI" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DNI">DNI</SelectItem>
                        <SelectItem value="CE">CE</SelectItem>
                        <SelectItem value="PASAPORTE">Pasaporte</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="nro_documento">Número</Label>
                    <Input
                      id="nro_documento"
                      value={formData.nro_documento}
                      onChange={handleDocumentChange}
                      placeholder={
                        formData.tipo_doc === "DNI"
                          ? "8 dígitos"
                          : "Nro Documento"
                      }
                      maxLength={formData.tipo_doc === "DNI" ? 8 : 12}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sexo">Sexo</Label>
                  <Select
                    value={formData.sexo}
                    onValueChange={(val) =>
                      setFormData((prev) => ({ ...prev, sexo: val }))
                    }
                    required
                  >
                    <SelectTrigger id="sexo">
                      <SelectValue placeholder="Seleccione..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Masculino">Masculino</SelectItem>
                      <SelectItem value="Femenino">Femenino</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="nombres">Nombres</Label>
                  <Input
                    id="nombres"
                    value={formData.nombres}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="apellidos">Apellidos</Label>
                  <Input
                    id="apellidos"
                    value={formData.apellidos}
                    onChange={handleChange}
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="fecha_nacimiento">Fecha de Nacimiento</Label>
                  <Input
                    id="fecha_nacimiento"
                    type="date"
                    value={formData.fecha_nacimiento}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="telefono">Teléfono</Label>
                  <Input
                    id="telefono"
                    type="tel"
                    value={formData.telefono}
                    onChange={handlePhoneChange}
                    placeholder="9XX XXX XXX"
                    required
                  />
                </div>
              </div>
              <div className="rounded-md border border-border bg-accent/40 p-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="consent"
                    checked={consent}
                    onCheckedChange={(v) => setConsent(!!v)}
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor="consent"
                    className="text-sm leading-snug cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      Consentimiento Informado Físico Archivado
                    </span>
                    <span className="text-xs text-muted-foreground font-normal">
                      Confirmo que el paciente ha firmado el formulario de
                      consentimiento y se encuentra archivado en historia
                      clínica.
                    </span>
                  </Label>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="bg-gradient-primary hover:opacity-90"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Registrando..." : "Registrar Paciente"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
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
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="pl-9"
                />
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {totalItems} resultado{totalItems !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Mostrar:</span>
              <Select
                value={itemsPerPage.toString()}
                onValueChange={(val) => {
                  setItemsPerPage(Number(val));
                  setCurrentPage(1);
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
          </div>

          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs uppercase tracking-wider">
                    Documento
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">
                    Paciente
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">
                    Edad
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">
                    Teléfono
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">
                    Última Visita
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">
                    Estado
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">
                    Acciones
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-12 text-muted-foreground text-sm"
                    >
                      Cargando pacientes...
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-12 text-muted-foreground text-sm"
                    >
                      No se encontraron pacientes con ese criterio.
                    </TableCell>
                  </TableRow>
                ) : (
                  currentData.map((p) => (
                    <TableRow
                      key={p.id || p.nro_documento}
                      className="hover:bg-muted/30"
                    >
                      <TableCell>
                        <div className="font-mono text-sm">
                          {p.nro_documento}
                        </div>
                        <div className="text-[10px] text-muted-foreground uppercase mt-0.5">
                          {p.tipo_doc_abrev || p.tipo_doc}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {p.nombres_apellidos ||
                            `${p.nombres || ""} ${p.apellidos || ""}`.trim()}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {p.sexo}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {calculateAge(p.fecha_nacimiento)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Phone className="h-3 w-3" />{" "}
                          {formatPhone(p.telefono)}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {p.ultima_visita ? (
                          new Date(p.ultima_visita).toLocaleDateString(
                            "es-PE",
                            { day: "2-digit", month: "short", year: "numeric" },
                          )
                        ) : (
                          <span className="text-muted-foreground text-xs italic opacity-70">
                            Sin registros
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={getPatientStatus(p.maxima_gravedad)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          className="text-primary"
                        >
                          <Link to={`/pacientes/${p.id || p.nro_documento}`}>
                            <Eye className="h-3.5 w-3.5" /> Ver
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {totalItems > 0 && (
            <div className="flex items-center justify-between pt-5">
              <div className="text-sm text-muted-foreground">
                Mostrando{" "}
                <span className="font-medium text-slate-900">
                  {startIndex + 1}
                </span>{" "}
                a{" "}
                <span className="font-medium text-slate-900">
                  {Math.min(endIndex, totalItems)}
                </span>{" "}
                de{" "}
                <span className="font-medium text-slate-900">{totalItems}</span>{" "}
                pacientes
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="hover:text-teal-600 hover:border-teal-600 transition-colors"
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }
                  disabled={currentPage === totalPages}
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
