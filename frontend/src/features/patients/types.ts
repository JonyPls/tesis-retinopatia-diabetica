export interface Patient {
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

export interface Diagnosis {
  diagnostico_id: number;
  fecha_visita: string;
  medico_tratante?: string;
  tiene_informes: number;
  tiene_diagnostico_ia: number;
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
}
