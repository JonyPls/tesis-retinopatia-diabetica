import { useState, useMemo, useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import api from "@/services/api";
import { Patient, PatientFormData } from "../types";

const INITIAL_FORM: PatientFormData = {
  tipo_doc: "DNI",
  nro_documento: "",
  nombres: "",
  apellidos: "",
  sexo: "",
  fecha_nacimiento: "",
  telefono: "",
};

export function usePatients() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [consent, setConsent] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const [formData, setFormData] = useState<PatientFormData>(INITIAL_FORM);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchPatients = async () => {
    setIsLoading(true);
    try {
      const { data } = await api.get("/pacientes");
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

  const handleDocumentChange = (value: string, tipoDoc: string) => {
    let rawValue = value;
    if (tipoDoc === "DNI") {
      rawValue = rawValue.replace(/\D/g, "");
    } else {
      rawValue = rawValue.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    }
    const maxLength = tipoDoc === "DNI" ? 8 : 12;
    setFormData((prev) => ({
      ...prev,
      nro_documento: rawValue.slice(0, maxLength),
    }));
  };

  const handlePhoneChange = (value: string) => {
    const rawValue = value.replace(/\D/g, "").slice(0, 9);
    const formatted = rawValue.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
    setFormData((prev) => ({ ...prev, telefono: formatted }));
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

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

      await api.post("/pacientes", payload);

      toast({
        title: "Paciente registrado",
        description: "Los datos se han guardado correctamente.",
      });
      setOpen(false);
      setConsent(false);
      setFormData(INITIAL_FORM);
      fetchPatients();
    } catch (error: any) {
      const msg = error.response?.data?.message;
      setFormError(msg || "Error de conexión con el servidor.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    patients,
    isLoading,
    query,
    setQuery,
    filtered,
    currentPage,
    setCurrentPage,
    itemsPerPage,
    setItemsPerPage,
    totalItems,
    totalPages,
    startIndex,
    endIndex,
    currentData,
    open,
    setOpen,
    consent,
    setConsent,
    formData,
    setFormData,
    formError,
    isSubmitting,
    handleDocumentChange,
    handlePhoneChange,
    handleChange,
    handleSubmit,
    fetchPatients,
  };
}
