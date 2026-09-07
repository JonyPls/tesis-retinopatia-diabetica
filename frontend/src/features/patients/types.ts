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
