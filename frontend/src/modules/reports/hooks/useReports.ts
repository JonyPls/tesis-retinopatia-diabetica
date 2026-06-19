import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { toast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import api from "@/services/api";
import {
  buscarPacientes,
  obtenerPacientesRecientes,
  obtenerDiagnosticosPaciente,
  DiagnosticoVisita,
} from "@/services/patientService";
import { PatientSearchResult } from "@/services/patientService";
import { TipoInforme, Informe, ReportFormHandle } from "../types";

function withMinDuration<T>(promise: Promise<T>, ms = 400): Promise<T> {
  const delay = new Promise<void>((r) => setTimeout(r, ms));
  return Promise.all([promise, delay]).then(([res]) => res);
}

export function useReports() {
  const navigate = useNavigate();

  // Wizard steps: 1 = tipo, 2 = paciente, 3 = formulario
  const [step, setStep] = useState(1);
  const [selectedTipos, setSelectedTipos] = useState<TipoInforme[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [informes, setInformes] = useState<Informe[]>([]);
  const [isLoadingInformes, setIsLoadingInformes] = useState(false);

  // Tipo selector
  const [tipos, setTipos] = useState<TipoInforme[]>([]);

  // Patient search (step 2)
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PatientSearchResult[]>([]);
  const [recentPatients, setRecentPatients] = useState<PatientSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Visita selector (step 2)
  const [visitas, setVisitas] = useState<DiagnosticoVisita[]>([]);
  const [selectedVisita, setSelectedVisita] = useState<DiagnosticoVisita | null | undefined>(undefined);
  const [hasMoreVisitas, setHasMoreVisitas] = useState(false);
  const [isLoadingVisitas, setIsLoadingVisitas] = useState(false);
  const [visitasExpandidas, setVisitasExpandidas] = useState(false);
  const maxVisitas = 2;

  // Step 3 state
  const [informesExistentes, setInformesExistentes] = useState<Informe[]>([]);
  const [isLoadingInformesExistentes, setIsLoadingInformesExistentes] = useState(false);
  const [activeTipoIndex, setActiveTipoIndex] = useState(0);
  const [showAddTipoModal, setShowAddTipoModal] = useState(false);
  const [formValidity, setFormValidity] = useState<Record<number, boolean>>({});
  const formRefs = useRef<Record<number, ReportFormHandle | null>>({});
  const backupSelectedTipos = useRef<TipoInforme[]>([]);

  // Load tipos on mount
  useEffect(() => {
    api.get("/tipos-informe").then((res) => {
      const todos = res.data.data || [];
      setTipos(todos.filter((t: any) => [2, 3, 4].includes(t.id)));
    }).catch(() => {});
  }, []);

  // Load recent patients on mount
  useEffect(() => {
    obtenerPacientesRecientes()
      .then(setRecentPatients)
      .catch(() => {});
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (selectedPatient) setSelectedPatient(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await withMinDuration(buscarPacientes(value.trim()));
        setSearchResults(data);
      } catch {
        toast({
          title: "Error",
          description: "No se pudo conectar con el servidor.",
          variant: "destructive",
        });
      } finally {
        setIsSearching(false);
      }
    }, 400);
  };

  const selectPatient = (p: PatientSearchResult) => {
    setSelectedPatient(p);
    setQuery(`${p.nombres} ${p.apellidos}`);
    setSearchResults([]);
    setSelectedVisita(undefined);
    setVisitas([]);
    loadInformes(p.id);
    loadVisitas(p.id);
  };

  const loadVisitas = useCallback(async (pacienteId: number) => {
    setIsLoadingVisitas(true);
    setVisitasExpandidas(false);
    try {
      const data = await withMinDuration(obtenerDiagnosticosPaciente(pacienteId));
      const sorted = (data || []).sort(
        (a, b) => new Date(b.fecha_visita).getTime() - new Date(a.fecha_visita).getTime(),
      );
      setHasMoreVisitas(sorted.length > maxVisitas);
      setVisitas(sorted.slice(0, maxVisitas));
    } catch {
      setVisitas([]);
    } finally {
      setIsLoadingVisitas(false);
    }
  }, []);

  const selectVisita = (v: DiagnosticoVisita | null) => {
    setSelectedVisita(v);
    setInformesExistentes([]);
    setActiveTipoIndex(0);
    if (v === null && backupSelectedTipos.current.length > 0) {
      setSelectedTipos(backupSelectedTipos.current);
      backupSelectedTipos.current = [];
    }
  };

  const verMenosVisitas = useCallback(async () => {
    if (!selectedPatient) return;
    setVisitasExpandidas(false);
    try {
      const data = await obtenerDiagnosticosPaciente(selectedPatient.id);
      const sorted = (data || []).sort(
        (a, b) => new Date(b.fecha_visita).getTime() - new Date(a.fecha_visita).getTime(),
      );
      setHasMoreVisitas(sorted.length > maxVisitas);
      setVisitas(sorted.slice(0, maxVisitas));
    } catch {
      // ignore
    }
  }, [selectedPatient]);

  const verMasVisitas = useCallback(async () => {
    if (!selectedPatient) return;
    setVisitasExpandidas(true);
    try {
      const data = await obtenerDiagnosticosPaciente(selectedPatient.id);
      const sorted = (data || []).sort(
        (a, b) => new Date(b.fecha_visita).getTime() - new Date(a.fecha_visita).getTime(),
      );
      setVisitas(sorted);
      setHasMoreVisitas(false);
    } catch {
      setVisitasExpandidas(false);
    }
  }, [selectedPatient]);

  const loadInformes = useCallback(async (pacienteId: number) => {
    setIsLoadingInformes(true);
    try {
      const res = await api.get(`/informes/paciente/${pacienteId}`);
      setInformes(res.data.data || []);
    } catch {
      setInformes([]);
    } finally {
      setIsLoadingInformes(false);
    }
  }, []);

  // Load existing informes when entering step 3 with an existing visita
  useEffect(() => {
    if (step === 3 && selectedVisita?.diagnostico_id) {
      loadInformesExistentes(selectedVisita.diagnostico_id);
    }
  }, [step, selectedVisita?.diagnostico_id]);

  const loadInformesExistentes = async (diagnosticoId: number) => {
    setIsLoadingInformesExistentes(true);
    try {
      const res = await api.get(`/informes/diagnostico/${diagnosticoId}`);
      const existentes: Informe[] = (res.data.data || []).map((inf: any) => {
        if (typeof inf.datos_estructurados === "string") {
          try { inf.datos_estructurados = JSON.parse(inf.datos_estructurados); } catch {}
        }
        return inf as Informe;
      });
      setInformesExistentes(existentes);
      const existingIds = new Set(existentes.map((i) => i.tipo_informe_id));
      setSelectedTipos((prev) => {
        backupSelectedTipos.current = prev;
        return prev.filter((t) => !existingIds.has(t.id));
      });
    } catch {
      setInformesExistentes([]);
    } finally {
      setIsLoadingInformesExistentes(false);
    }
  };

  const availableTipos = useMemo(() => {
    const selectedIds = new Set(selectedTipos.map((t) => t.id));
    const existingIds = new Set(informesExistentes.map((i) => i.tipo_informe_id));
    return tipos.filter((t) => !selectedIds.has(t.id) && !existingIds.has(t.id));
  }, [tipos, selectedTipos, informesExistentes]);

  const handleValidityChange = useCallback((tipoId: number, valid: boolean) => {
    setFormValidity((prev) => {
      if (prev[tipoId] === valid) return prev;
      return { ...prev, [tipoId]: valid };
    });
  }, []);

  const allValid =
    selectedTipos.length > 0 &&
    selectedTipos.every((t) => formValidity[t.id] === true);

  const toggleTipo = (tipo: TipoInforme) => {
    setSelectedTipos((prev) => {
      const exists = prev.find((t) => t.id === tipo.id);
      if (exists) return prev.filter((t) => t.id !== tipo.id);
      return [...prev, tipo];
    });
  };

  const goNext = () => {
    if (step === 1 && selectedTipos.length > 0) {
      setStep(2);
    } else if (step === 2 && selectedPatient && selectedVisita !== undefined) {
      setStep(3);
    }
  };

  const goBack = () => {
    if (step === 2) {
      setStep(1);
    } else if (step === 3) {
      setStep(2);
      setInformesExistentes([]);
      setActiveTipoIndex(0);
    }
  };

  const canNext =
    (step === 1 && selectedTipos.length > 0) ||
    (step === 2 && !!selectedPatient && selectedVisita !== undefined);

  const removeTipo = (tipoId: number) => {
    setSelectedTipos((prev) => prev.filter((t) => t.id !== tipoId));
    setFormValidity((prev) => {
      const next = { ...prev };
      delete next[tipoId];
      return next;
    });
    setActiveTipoIndex(0);
  };

  const addTipo = (tipo: TipoInforme) => {
    setSelectedTipos((prev) => {
      setActiveTipoIndex(prev.length);
      return [...prev, tipo];
    });
    setShowAddTipoModal(false);
  };

  const addTipos = (tipos: TipoInforme[]) => {
    setSelectedTipos((prev) => {
      if (tipos.length > 0) setActiveTipoIndex(prev.length);
      const nuevos = tipos.filter((t) => !prev.some((p) => p.id === t.id));
      return [...prev, ...nuevos];
    });
    setShowAddTipoModal(false);
  };

  const saveAll = async () => {
    if (!selectedPatient || selectedTipos.length === 0) return;

    // Phase 1: validate all forms before saving any
    const invalidIndex = selectedTipos.findIndex(
      (t) => !formRefs.current[t.id]?.isValid(),
    );
    if (invalidIndex !== -1) {
      setActiveTipoIndex(invalidIndex);
      toast({
        title: "Formulario incompleto",
        description: `Completa todos los campos de ${selectedTipos[invalidIndex].nombre} antes de guardar.`,
        variant: "destructive",
      });
      return;
    }

    // Phase 2: save all (all valid at this point)
    setIsSaving(true);
    let hasError = false;
    let savedCount = 0;
    let nuevoDiagnosticoId: number | null = null;

    for (const tipo of selectedTipos) {
      const handle = formRefs.current[tipo.id];
      try {
        const payload: Record<string, any> = {
          paciente_id: selectedPatient.id,
          tipo_informe_id: tipo.id,
          datos_estructurados: handle!.getData(),
        };
        if (selectedVisita) {
          payload.diagnostico_id = selectedVisita.diagnostico_id;
        } else if (nuevoDiagnosticoId !== null) {
          payload.diagnostico_id = nuevoDiagnosticoId;
        }
        const res = await api.post("/informes", payload);
        if (!selectedVisita && nuevoDiagnosticoId === null) {
          nuevoDiagnosticoId = res.data.data?.diagnostico_id ?? null;
        }
        savedCount++;
      } catch (err: any) {
        hasError = true;
        const msg =
          err.response?.data?.message || `Error al guardar ${tipo.nombre}.`;
        toast({ title: "Error", description: msg, variant: "destructive" });
        break;
      }
    }

    setIsSaving(false);

    if (!hasError) {
      toast({
        title: "Informes guardados",
        description: `${savedCount} informe(s) registrado(s) correctamente.`,
      });
      resetAll();
    }
  };

  const clearPatient = () => {
    setSelectedPatient(null);
    setQuery("");
    setSearchResults([]);
    setSelectedVisita(undefined);
    setVisitas([]);
    setHasMoreVisitas(false);
    setInformesExistentes([]);
    setActiveTipoIndex(0);
    backupSelectedTipos.current = [];
  };

  const resetAll = () => {
    setStep(1);
    setSelectedTipos([]);
    setSelectedPatient(null);
    setQuery("");
    setSearchResults([]);
    setInformes([]);
    setVisitas([]);
    setSelectedVisita(undefined);
    setHasMoreVisitas(false);
    setInformesExistentes([]);
    setActiveTipoIndex(0);
    setShowAddTipoModal(false);
    setFormValidity({});
    backupSelectedTipos.current = [];
  };

  return {
    step,
    tipos,
    selectedTipos,
    toggleTipo,
    selectedPatient,
    query,
    searchResults,
    recentPatients,
    isSearching,
    handleQueryChange,
    selectPatient,
    goNext,
    goBack,
    canNext,
    resetAll,
    clearPatient,
    isSaving,
    informes,
    isLoadingInformes,
    visitas,
    selectedVisita,
    selectVisita,
    hasMoreVisitas,
    visitasExpandidas,
    verMasVisitas,
    verMenosVisitas,
    isLoadingVisitas,
    informesExistentes,
    isLoadingInformesExistentes,
    activeTipoIndex,
    setActiveTipoIndex,
    showAddTipoModal,
    openAddTipoModal: () => setShowAddTipoModal(true),
    closeAddTipoModal: () => setShowAddTipoModal(false),
    removeTipo,
    addTipo,
    addTipos,
    availableTipos,
    saveAll,
    formRefs,
    handleValidityChange,
    allValid,
    formValidity,
  };
}
