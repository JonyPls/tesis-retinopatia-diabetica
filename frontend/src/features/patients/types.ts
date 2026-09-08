export interface Patient {
  id?: string | number;
  tipo_doc_id?: number;
  tipo_doc?: string;
  tipo_doc_abrev?: string;
  nro_documento: string;
  nombres_apellidos?: string;
  nombres?: string;
  apellidos?: string;
  sexo: string;
  fecha_nacimiento: string;
  telefono?: string;
  correo?: string | null;
  direccion?: string | null;
  antecedentes_clinicos?: string | null;
  alergias?: string | null;
  consentimiento_informado?: boolean;
  fecha_consentimiento?: string | null;
  ultima_visita?: string;
  maxima_gravedad?: number | null;
}

export interface Diagnosis {
  visita_id: number;
  diagnostico_id?: number;
  diagnostico_retinopatia_id?: number | null;
  fecha_visita: string;
  medico_tratante?: string;
  motivo_consulta?: string | null;
  observaciones?: string | null;
  estado?: string;
  tiene_informes: number;
  tiene_diagnostico_ia: number;
  maxima_gravedad?: number | null;
  ojo_evaluado?: string;
  resultado_ia?: string;
  probabilidad_ia?: number;
  comentario_medico?: string;
  diagnostico_ia?: PatientDiagnosisIA | null;
  informes?: PatientVisitReport[];
}

export interface PatientDiagnosisIA {
  id: number;
  estado: "PENDIENTE" | "PROCESADO" | "VALIDADO" | "ANULADO";
  modelo_nombre?: string | null;
  modelo_version?: string | null;
  detalles: PatientDiagnosisEyeDetail[];
}

export interface PatientDiagnosisEyeDetail {
  detalle_id: number;
  ojo_evaluado: "Derecho" | "Izquierdo";
  resultado_ia_id: number | null;
  resultado_ia_nombre?: string | null;
  resultado_final_id: number | null;
  resultado_final_nombre?: string | null;
  probabilidad_ia?: number | null;
  estado_validacion: "PENDIENTE" | "APROBADO" | "CORREGIDO";
  comentario_medico?: string | null;
  motivo_correccion?: string | null;
  imagen_original_url?: string | null;
  imagen_gradcam_url?: string | null;
  nombre_archivo_original?: string | null;
  fecha_validacion?: string | null;
}

export interface PatientVisitReport {
  id: number;
  tipo_informe_id: number;
  tipo_informe_nombre: string;
  conclusion?: string | null;
  estado: "ACTIVO" | "INACTIVO" | "ANULADO";
  fecha_creado: string;
  fecha_actualizado: string;
}

export interface PatientFormData {
  tipo_doc: string;
  nro_documento: string;
  nombres: string;
  apellidos: string;
  sexo: string;
  fecha_nacimiento: string;
  telefono: string;
  correo: string;
  direccion: string;
  antecedentes_clinicos: string;
  alergias: string;
}
