import { useState, useMemo, useEffect, useRef } from "react";
import { toast } from "@/hooks/use-toast";
import api from "@/lib/api";
import { Patient, PatientFormData, PatientReadScope } from "../types";
import { patientRequestError, type PatientRequestError } from "../patientAccess";
import { useAuthStore } from "@/features/auth/store/authStore";
import { isValidEmailAddress, isValidPersonName, normalizePersonName } from "@/lib/fieldValidation";
import { DOC_RULES, normalizeDocument } from "@/lib/documentValidation";
import { validateBirthDate } from "../birthDate";
import { sortPatients, type PatientSort } from "../patientListing";

export type PatientRegistrationScope = "administrative" | "assistance" | "clinical";

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


export type PatientFormField = keyof PatientFormData | "consent";
export type PatientFormErrors = Partial<Record<PatientFormField, string>>;
const FIELD_ORDER: PatientFormField[] = ["tipo_doc", "nro_documento", "nombres", "apellidos",
  "sexo", "fecha_nacimiento", "telefono", "correo", "direccion", "antecedentes_clinicos", "alergias", "consent"];

function firstInvalidField(errors: PatientFormErrors): PatientFormField {
  return FIELD_ORDER.find((field) => !!errors[field]) ?? "nombres";
}

function normalizeSpaces(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function validatePatientForm(formData: PatientFormData, consent: boolean) {
  const errors: PatientFormErrors = {};
  const tipoDoc = formData.tipo_doc;
  const docRule = DOC_RULES[tipoDoc];
  const documento = normalizeDocument(formData.nro_documento, tipoDoc);
  const nombres = normalizePersonName(formData.nombres);
  const apellidos = normalizePersonName(formData.apellidos);
  const telefono = formData.telefono.replace(/\D/g, "");
  const correo = formData.correo.trim();

  if (!docRule) errors.tipo_doc = "Debe seleccionar un tipo de documento válido.";
  else if (!docRule.pattern.test(documento)) errors.nro_documento = docRule.message;

  if (!nombres) errors.nombres = "Debe ingresar nombres.";
  else if (nombres.length < 2 || nombres.length > 80) errors.nombres = "Los nombres deben tener entre 2 y 80 caracteres.";
  else if (!isValidPersonName(formData.nombres)) errors.nombres = "Ingresa un nombre válido, sin números ni símbolos.";
  if (!apellidos) errors.apellidos = "Debe ingresar apellidos.";
  else if (apellidos.length < 2 || apellidos.length > 100) errors.apellidos = "Los apellidos deben tener entre 2 y 100 caracteres.";
  else if (!isValidPersonName(formData.apellidos)) errors.apellidos = "Ingresa un apellido válido, sin números ni símbolos.";

  if (!["Masculino", "Femenino"].includes(formData.sexo)) errors.sexo = "Debe seleccionar un sexo válido.";

  if (!formData.fecha_nacimiento) errors.fecha_nacimiento = "Debe ingresar la fecha de nacimiento.";
  else {
    const birthError = validateBirthDate(formData.fecha_nacimiento);
    if (birthError) errors.fecha_nacimiento = birthError;
  }

  if (telefono && !/^9\d{8}$/.test(telefono)) errors.telefono = "El teléfono debe tener 9 dígitos y empezar con 9.";

  if (correo.length > 150) errors.correo = "El correo no puede superar 150 caracteres.";
  else if (correo && !isValidEmailAddress(correo)) errors.correo = "Ingresa un correo electrónico válido.";

  if (formData.direccion.trim().length > 255) errors.direccion = "La dirección no puede superar 255 caracteres.";
  if (formData.antecedentes_clinicos.trim().length > 2000) errors.antecedentes_clinicos = "Los antecedentes clínicos no pueden superar 2000 caracteres.";
  if (formData.alergias.trim().length > 1000) errors.alergias = "Las alergias no pueden superar 1000 caracteres.";

  if (!consent) errors.consent = "Debe confirmar el archivo físico del consentimiento informado.";

  return errors;
}

function serverFieldErrors(value: unknown): PatientFormErrors {
  const fields = new Set<PatientFormField>([...Object.keys(INITIAL_FORM) as (keyof PatientFormData)[], "consent"]);
  const errors: PatientFormErrors = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [field, message] of Object.entries(value)) {
      if (fields.has(field as PatientFormField) && typeof message === "string" && message.trim()) {
        errors[field as PatientFormField] = message;
      }
    }
  }
  return errors;
}

interface UsePatientsOptions {
  autoFetch?: boolean;
  onCreated?: (patient: Patient) => void;
}

export function usePatients({
  autoFetch = true,
  onCreated,
}: UsePatientsOptions = {}) {
  const user = useAuthStore((state) => state.user);
  // Orientación de la UI; el backend determina el grant y alcance reales.
  const registrationScope: PatientRegistrationScope = user?.roles.some((role) =>
    ["Oftalmologo", "Oftalmólogo"].includes(role)) ? "clinical"
    : user?.roles.includes("Enfermero") ? "assistance" : "administrative";
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [scope, setScope] = useState<PatientReadScope>("administrative");
  const [loadError, setLoadError] = useState<PatientRequestError | null>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [validationErrors, setValidationErrors] = useState<PatientFormErrors>({});
  const [validationFocus, setValidationFocus] = useState<{ field: PatientFormField; attempt: number } | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [sort, setSort] = useState<PatientSort>(null);
  const requestId = useRef(0);

  const [viewMode, setViewMode] = useState<"table" | "cards">("table");

  const [formData, setFormData] = useState<PatientFormData>(INITIAL_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchPatients = async () => {
    const id = ++requestId.current;
    setIsLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get("/pacientes");
      if (id !== requestId.current) return;
      setPatients(data.data || []);
      setScope(data.scope === "clinical" || data.scope === "assistance"
        ? data.scope : "administrative");
    } catch (error) {
      if (id !== requestId.current) return;
      setPatients([]);
      setScope("administrative");
      setLoadError(patientRequestError(error));
    } finally {
      if (id === requestId.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    if (autoFetch) fetchPatients();
    return () => { requestId.current++; };
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

  const ordered = useMemo(() => sortPatients(filtered, sort), [filtered, sort]);
  const totalItems = ordered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const validPage = Math.min(currentPage, totalPages);
  useEffect(() => {
    if (currentPage !== validPage) setCurrentPage(validPage);
  }, [currentPage, validPage]);
  const startIndex = (validPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentData = ordered.slice(startIndex, endIndex);

  const toggleSort = (field: "patient" | "age") => {
    setSort((previous) => ({ field, direction: previous?.field === field && previous.direction === "asc" ? "desc" : "asc" }));
    setCurrentPage(1);
  };

  const handleDocumentChange = (value: string, tipoDoc: string) => {
    setValidationErrors((errors) => { const { nro_documento: _removed, ...rest } = errors; return rest; });
    const rawValue = normalizeDocument(value, tipoDoc);
    const maxLength = DOC_RULES[tipoDoc]?.maxLength ?? 25;
    setFormData((prev) => ({
      ...prev,
      nro_documento: rawValue.slice(0, maxLength),
    }));
  };

  const handleDocumentTypeChange = (value: string) => {
    setValidationErrors((errors) => { const { tipo_doc: _type, nro_documento: _document, ...rest } = errors; return rest; });
    setFormData((previous) => ({ ...previous, tipo_doc: value, nro_documento: "" }));
  };

  const handlePhoneChange = (value: string) => {
    setValidationErrors((errors) => { const { telefono: _removed, ...rest } = errors; return rest; });
    const rawValue = value.replace(/\D/g, "").slice(0, 9);
    const formatted = rawValue.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
    setFormData((prev) => ({ ...prev, telefono: formatted }));
  };

  const handleChange = (field: keyof PatientFormData, value: string) => {
    const next = { ...formData, [field]: value };
    setValidationErrors((errors) => {
      if (!errors[field]) return errors;
      const message = validatePatientForm(next, consent)[field];
      return { ...errors, [field]: message };
    });
    setFormData(next);
  };

  const handleNameBlur = (field: "nombres" | "apellidos") => {
    const value = normalizePersonName(formData[field]);
    const next = { ...formData, [field]: value };
    setFormData(next);
    setValidationErrors((errors) => ({ ...errors, [field]: validatePatientForm(next, consent)[field] }));
  };

  const handleConsentChange = (checked: boolean) => {
    setValidationErrors((errors) => ({ ...errors, consent: checked ? undefined : errors.consent }));
    setConsent(checked);
  };

  const resetPatientForm = () => {
    setConsent(false);
    setValidationErrors({});
    setValidationFocus(null);
    setFormData(INITIAL_FORM);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const errors = validatePatientForm(formData, consent);
    const forbiddenField = (registrationScope !== "clinical" && formData.antecedentes_clinicos.trim()) ||
      (registrationScope === "administrative" && formData.alergias.trim());
    if (forbiddenField) {
      errors[registrationScope === "administrative" && formData.alergias.trim() ? "alergias" : "antecedentes_clinicos"] =
        "El perfil actual no puede registrar información clínica.";
    }
    if (Object.keys(errors).length) {
      setValidationErrors(errors);
      const field = firstInvalidField(errors);
      setValidationFocus((previous) => ({ field, attempt: (previous?.attempt ?? 0) + 1 }));
      toast({
        title: "Revisa los campos señalados",
        variant: "warning",
      });
      return;
    }

    setValidationErrors({});
    setIsSubmitting(true);
    try {
      const payload = {
        tipo_doc: formData.tipo_doc,
        nro_documento: normalizeDocument(formData.nro_documento, formData.tipo_doc),
        nombres: normalizePersonName(formData.nombres),
        apellidos: normalizePersonName(formData.apellidos),
        sexo: formData.sexo,
        fecha_nacimiento: formData.fecha_nacimiento,
        telefono: formData.telefono.replace(/\D/g, "") || null,
        correo: formData.correo.trim().toLowerCase() || null,
        direccion: normalizeSpaces(formData.direccion) || null,
        ...(registrationScope === "clinical" ? {
          antecedentes_clinicos: formData.antecedentes_clinicos.trim() || null,
        } : {}),
        ...(registrationScope !== "administrative" ? {
          alergias: formData.alergias.trim() || null,
        } : {}),
        consentimiento_informado: consent,
      };

      const res = await api.post("/pacientes", payload);

      toast({
        title: "Paciente registrado",
        description: "Los datos se han guardado correctamente.",
        variant: "success",
      });
      if (res.data?.data) {
        onCreated?.({
          id: res.data.data.id,
          tipo_doc: payload.tipo_doc,
          tipo_doc_abrev: res.data.data.tipo_doc_abrev,
          tipo_doc_id: res.data.data.tipo_doc_id,
          nro_documento: payload.nro_documento,
          nombres: payload.nombres,
          apellidos: payload.apellidos,
          sexo: payload.sexo,
          fecha_nacimiento: payload.fecha_nacimiento,
        });
      }
      setOpen(false);
      resetPatientForm();
      if (autoFetch) fetchPatients();
    } catch (error: unknown) {
      const response = (error as { response?: { status?: number; data?: { errors?: unknown; message?: string } } }).response;
      const status = response?.status;
      let fieldErrors = status === 400 || status === 409 ? serverFieldErrors(response?.data?.errors) : {};
      if (status === 409 && !Object.keys(fieldErrors).length) {
        const message = response?.data?.message ?? "";
        if (/documento/i.test(message)) fieldErrors = { nro_documento: "El documento ya se encuentra registrado en el sistema." };
        else if (/correo/i.test(message)) fieldErrors = { correo: "El correo ya se encuentra registrado en el sistema." };
      }
      if (Object.keys(fieldErrors).length) {
        setValidationErrors(fieldErrors);
        setValidationFocus((previous) => ({ field: firstInvalidField(fieldErrors),
          attempt: (previous?.attempt ?? 0) + 1 }));
        toast({ title: "Revisa los campos señalados", variant: "warning" });
        return;
      }
      const msg = status === 401 || status === 403 ? patientRequestError(error).message
        : status === 400 || status === 409 ? response?.data?.message : undefined;
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
    registrationScope,
    loadError,
    query,
    setQuery,
    filtered,
    currentPage: validPage,
    setCurrentPage,
    sort,
    toggleSort,
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
    handleConsentChange,
    validationErrors,
    validationFocus,
    formData,
    setFormData,
    hasPatientFormChanges: hasFormChanges(formData, consent),
    isSubmitting,
    resetPatientForm,
    handleDocumentChange,
    handleDocumentTypeChange,
    handlePhoneChange,
    handleChange,
    handleNameBlur,
    handleSubmit,
    fetchPatients,
  };
}
