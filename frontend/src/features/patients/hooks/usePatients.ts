import { useState, useMemo, useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import api from "@/lib/api";
import { Patient, PatientFormData, PatientReadScope } from "../types";
import { patientRequestError, type PatientRequestError } from "../patientAccess";

const INITIAL_FORM: PatientFormData = {
  tipo_doc: "DNI",
  nro_documento: "",
  nombres: "",
  apellidos: "",
  sexo: "",
  fecha_nacimiento: "",
  telefono: "",
  correo: "",
  direccion: "",
  antecedentes_clinicos: "",
  alergias: "",
};

function hasFormChanges(formData: PatientFormData, consent: boolean) {
  return (
    consent ||
    Object.entries(INITIAL_FORM).some(
      ([field, initialValue]) =>
        formData[field as keyof PatientFormData] !== initialValue,
    )
  );
}

const DOC_RULES: Record<
  string,
  { pattern: RegExp; message: string; maxLength: number }
> = {
  DNI: {
    pattern: /^\d{8}$/,
    message: "El DNI debe tener exactamente 8 dígitos.",
    maxLength: 8,
  },
  CE: {
    pattern: /^[A-Z0-9]{8,12}$/,
    message: "El CE debe tener entre 8 y 12 caracteres alfanuméricos.",
    maxLength: 12,
  },
  PAS: {
    pattern: /^[A-Z0-9]{3,9}$/,
    message: "El Pasaporte debe tener entre 3 y 9 caracteres alfanuméricos.",
    maxLength: 9,
  },
};

const NAME_PATTERN = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PATIENT_AGE = 120;

function normalizeSpaces(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeDocument(value: string, tipoDoc: string) {
  if (tipoDoc === "DNI") {
    return value.replace(/\D/g, "");
  }
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function calculateAge(birthDate: Date, today = new Date()) {
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }
  return age;
}

function validatePatientForm(formData: PatientFormData, consent: boolean) {
  const tipoDoc = formData.tipo_doc;
  const docRule = DOC_RULES[tipoDoc];
  const documento = normalizeDocument(formData.nro_documento, tipoDoc);
  const nombres = normalizeSpaces(formData.nombres);
  const apellidos = normalizeSpaces(formData.apellidos);
  const telefono = formData.telefono.replace(/\D/g, "");
  const correo = formData.correo.trim();

  if (!docRule) return "Debe seleccionar un tipo de documento válido.";
  if (!docRule.pattern.test(documento)) return docRule.message;

  if (!nombres || !apellidos) return "Debe ingresar nombres y apellidos.";
  if (nombres.length < 2 || nombres.length > 80) {
    return "Los nombres deben tener entre 2 y 80 caracteres.";
  }
  if (apellidos.length < 2 || apellidos.length > 100) {
    return "Los apellidos deben tener entre 2 y 100 caracteres.";
  }
  if (!NAME_PATTERN.test(nombres)) {
    return "Los nombres solo deben contener letras, espacios, guiones o apóstrofes.";
  }
  if (!NAME_PATTERN.test(apellidos)) {
    return "Los apellidos solo deben contener letras, espacios, guiones o apóstrofes.";
  }

  if (!["Masculino", "Femenino"].includes(formData.sexo)) {
    return "Debe seleccionar un sexo válido.";
  }

  if (!formData.fecha_nacimiento) {
    return "Debe ingresar la fecha de nacimiento.";
  }

  const birthDate = parseLocalDate(formData.fecha_nacimiento);
  if (!birthDate) return "La fecha de nacimiento no es válida.";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  birthDate.setHours(0, 0, 0, 0);

  if (birthDate > today) {
    return "La fecha de nacimiento no puede ser futura.";
  }
  if (calculateAge(birthDate, today) > MAX_PATIENT_AGE) {
    return `La edad del paciente no puede superar ${MAX_PATIENT_AGE} años.`;
  }

  if (telefono && !/^9\d{8}$/.test(telefono)) {
    return "El teléfono debe tener 9 dígitos y empezar con 9.";
  }

  if (correo && (!EMAIL_PATTERN.test(correo) || correo.length > 150)) {
    return "Ingrese un correo electrónico válido de máximo 150 caracteres.";
  }

  if (formData.direccion.trim().length > 255) {
    return "La dirección no puede superar 255 caracteres.";
  }
  if (formData.antecedentes_clinicos.trim().length > 2000) {
    return "Los antecedentes clínicos no pueden superar 2000 caracteres.";
  }
  if (formData.alergias.trim().length > 1000) {
    return "Las alergias no pueden superar 1000 caracteres.";
  }

  if (!consent) {
    return "Debe confirmar el archivo físico del consentimiento informado.";
  }

  return null;
}

interface UsePatientsOptions {
  autoFetch?: boolean;
  onCreated?: (patient: Patient) => void;
}

export function usePatients({
  autoFetch = true,
  onCreated,
}: UsePatientsOptions = {}) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [scope, setScope] = useState<PatientReadScope>("administrative");
  const [loadError, setLoadError] = useState<PatientRequestError | null>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [consent, setConsent] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const [viewMode, setViewMode] = useState<"table" | "cards">("table");

  const [formData, setFormData] = useState<PatientFormData>(INITIAL_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchPatients = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get("/pacientes");
      setPatients(data.data || []);
      setScope(data.scope === "clinical" || data.scope === "assistance"
        ? data.scope : "administrative");
    } catch (error) {
      setPatients([]);
      setScope("administrative");
      setLoadError(patientRequestError(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (autoFetch) fetchPatients();
  }, [autoFetch]);

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
    const rawValue = normalizeDocument(value, tipoDoc);
    const maxLength = DOC_RULES[tipoDoc]?.maxLength ?? 25;
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

  const resetPatientForm = () => {
    setConsent(false);
    setFormData(INITIAL_FORM);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationMessage = validatePatientForm(formData, consent);
    if (validationMessage) {
      toast({
        title: "Revise los datos del paciente",
        description: validationMessage,
        variant: "warning",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        tipo_doc: formData.tipo_doc,
        nro_documento: normalizeDocument(formData.nro_documento, formData.tipo_doc),
        nombres: normalizeSpaces(formData.nombres),
        apellidos: normalizeSpaces(formData.apellidos),
        sexo: formData.sexo,
        fecha_nacimiento: formData.fecha_nacimiento,
        telefono: formData.telefono.replace(/\D/g, "") || null,
        correo: formData.correo.trim().toLowerCase() || null,
        direccion: normalizeSpaces(formData.direccion) || null,
        antecedentes_clinicos: formData.antecedentes_clinicos.trim() || null,
        alergias: formData.alergias.trim() || null,
        consentimiento_informado: consent,
      };

      const res = await api.post("/pacientes", payload);

      toast({
        title: "Paciente registrado",
        description: "Los datos se han guardado correctamente.",
        variant: "success",
      });
      if (res.data?.data) {
        onCreated?.(res.data.data);
      }
      setOpen(false);
      resetPatientForm();
      if (autoFetch) fetchPatients();
    } catch (error: any) {
      const msg = error.response?.data?.message;
      toast({
        title: "No se pudo registrar el paciente",
        description: msg || "Error de conexión con el servidor.",
        variant: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    patients,
    isLoading,
    scope,
    loadError,
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
    viewMode,
    setViewMode,
    open,
    setOpen,
    consent,
    setConsent,
    formData,
    setFormData,
    hasPatientFormChanges: hasFormChanges(formData, consent),
    isSubmitting,
    resetPatientForm,
    handleDocumentChange,
    handlePhoneChange,
    handleChange,
    handleSubmit,
    fetchPatients,
  };
}
