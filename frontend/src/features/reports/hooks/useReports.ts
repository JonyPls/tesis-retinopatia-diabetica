import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { toast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { compareVisitGroups } from "@/lib/clinicalDates";
import {
  buscarPacientes,
  obtenerPacientesRecientes,
  obtenerVisitasPaciente,
  DiagnosticoVisita,
  PatientSearchResult,
} from "@/features/patients/api/patientService";
import { TipoInforme, Informe, ReportFormHandle } from "../types";
import { SUPPORTED_REPORT_TYPE_IDS } from "../supportedTypes";
import { patientRequestError, PatientRequestError } from "@/features/patients/patientAccess";

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
  const [searchError, setSearchError] = useState<PatientRequestError | null>(null);
  const [recentError, setRecentError] = useState<PatientRequestError | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoadingRecent, setIsLoadingRecent] = useState(true);
  const searchRequest = useRef(0);
  const patientContext = useRef(0);
  const existingContext = useRef(0);
  const recentDenied = useRef(false);
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
      setTipos(todos.filter((t: any) => SUPPORTED_REPORT_TYPE_IDS.includes(t.id)));
    }).catch(() => {});
  }, []);

  // Load recent patients on mount
  useEffect(() => {
    let active = true;
    obtenerPacientesRecientes()
      .then((data) => { if (active && !recentDenied.current) setRecentPatients(data); })
      .catch((error) => {
        if (active) {
          setRecentPatients([]);
          setRecentError(patientRequestError(error));
        }
      })
      .finally(() => { if (active) setIsLoadingRecent(false); });
    return () => {
      active = false;
      searchRequest.current++;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleQueryChange = (value: string) => {
    const request = ++searchRequest.current;
    setQuery(value);
    setSearchResults([]);
    setSearchError(null);
    setHasSearched(false);
    setIsSearching(false);
    if (selectedPatient) {
      patientContext.current++;
      existingContext.current++;
      setSelectedPatient(null);
      setSelectedVisita(undefined);
      setVisitas([]);
      setIsLoadingVisitas(false);
      setIsLoadingInformes(false);
      setIsLoadingInformesExistentes(false);
      setInformes([]);
      setInformesExistentes([]);
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await withMinDuration(buscarPacientes(value.trim()));
        if (request !== searchRequest.current) return;
        setSearchResults(data);
        setHasSearched(true);
      } catch (error) {
        if (request !== searchRequest.current) return;
        const failure = patientRequestError(error);
        setSearchResults([]);
        setSearchError(failure);
        if (failure.status === 403) {
          recentDenied.current = true;
          setRecentPatients([]);
          setRecentError(failure);
        }
      } finally {
        if (request === searchRequest.current) setIsSearching(false);
      }
    }, 400);
  };

  const selectPatient = (p: PatientSearchResult) => {
    searchRequest.current++;
    patientContext.current++;
    existingContext.current++;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsSearching(false);
    setSearchError(null);
    setSelectedPatient(p);
    setQuery(`${p.nombres} ${p.apellidos}`);
    setSearchResults([]);
    setSelectedVisita(undefined);
    setVisitas([]);
    setInformes([]);
    setInformesExistentes([]);
    loadInformes(p.id);
    loadVisitas(p.id);
  };

  const loadVisitas = useCallback(async (pacienteId: number) => {
    const context = patientContext.current;
    setIsLoadingVisitas(true);
    setVisitasExpandidas(false);
    try {
      const data = await withMinDuration(obtenerVisitasPaciente(pacienteId));
      if (context !== patientContext.current) return;
      const sorted = (data || []).sort(
        (a, b) => compareVisitGroups(a, b),
      );
      setHasMoreVisitas(sorted.length > maxVisitas);
      setVisitas(sorted.slice(0, maxVisitas));
    } catch {
      if (context === patientContext.current) setVisitas([]);
    } finally {
      if (context === patientContext.current) setIsLoadingVisitas(false);
    }
  }, []);

  const selectVisita = (v: DiagnosticoVisita | null) => {
    existingContext.current++;
    setIsLoadingInformesExistentes(false);
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
    const context = patientContext.current;
    setVisitasExpandidas(false);
    try {
      const data = await obtenerVisitasPaciente(selectedPatient.id);
      if (context !== patientContext.current) return;
      const sorted = (data || []).sort(
        (a, b) => compareVisitGroups(a, b),
      );
      setHasMoreVisitas(sorted.length > maxVisitas);
      setVisitas(sorted.slice(0, maxVisitas));
    } catch {
      // ignore
    }
  }, [selectedPatient]);

  const verMasVisitas = useCallback(async () => {
    if (!selectedPatient) return;
    const context = patientContext.current;
    setVisitasExpandidas(true);
    try {
      const data = await obtenerVisitasPaciente(selectedPatient.id);
      if (context !== patientContext.current) return;
      const sorted = (data || []).sort(
        (a, b) => compareVisitGroups(a, b),
      );
      setVisitas(sorted);
      setHasMoreVisitas(false);
    } catch {
      if (context === patientContext.current) setVisitasExpandidas(false);
    }
  }, [selectedPatient]);

  const loadInformes = useCallback(async (pacienteId: number) => {
    const context = patientContext.current;
    setIsLoadingInformes(true);
    try {
      const res = await api.get(`/informes/paciente/${pacienteId}`);
      if (context !== patientContext.current) return;
      setInformes(res.data.data || []);
    } catch {
      if (context === patientContext.current) setInformes([]);
    } finally {
      if (context === patientContext.current) setIsLoadingInformes(false);
    }
  }, []);

  // Load existing informes when entering step 3 with an existing visita
  useEffect(() => {
    if (step === 3 && selectedVisita?.visita_id) {
      loadInformesExistentes(selectedVisita.visita_id);
    }
  }, [step, selectedVisita?.visita_id]);

  const loadInformesExistentes = async (visitaId: number) => {
    const context = ++existingContext.current;
    setIsLoadingInformesExistentes(true);
    try {
      const res = await api.get(`/informes/visita/${visitaId}`);
      if (context !== existingContext.current) return;
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
      if (context === existingContext.current) setInformesExistentes([]);
    } finally {
      if (context === existingContext.current) setIsLoadingInformesExistentes(false);
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
      existingContext.current++;
      setIsLoadingInformesExistentes(false);
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
    let nuevaVisitaId: number | null = null;

    for (const tipo of selectedTipos) {
      const handle = formRefs.current[tipo.id];
      try {
        const payload: Record<string, any> = {
          paciente_id: selectedPatient.id,
          tipo_informe_id: tipo.id,
          datos_estructurados: handle!.getData(),
        };
        if (selectedVisita) {
          payload.visita_id = selectedVisita.visita_id;
        } else if (nuevaVisitaId !== null) {
          payload.visita_id = nuevaVisitaId;
        }
        const res = await api.post("/informes", payload);
        if (!selectedVisita && nuevaVisitaId === null) {
          nuevaVisitaId = res.data.data?.visita_id ?? res.data.data?.diagnostico_id ?? null;
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
    searchRequest.current++;
    patientContext.current++;
    existingContext.current++;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsSearching(false);
    setSearchError(null);
    setHasSearched(false);
    setSelectedPatient(null);
    setQuery("");
    setSearchResults([]);
    setSelectedVisita(undefined);
    setVisitas([]);
    setInformes([]);
    setIsLoadingVisitas(false);
    setIsLoadingInformes(false);
    setIsLoadingInformesExistentes(false);
    setHasMoreVisitas(false);
    setInformesExistentes([]);
    setActiveTipoIndex(0);
    backupSelectedTipos.current = [];
  };

  const resetAll = () => {
    searchRequest.current++;
    patientContext.current++;
    existingContext.current++;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsSearching(false);
    setSearchError(null);
    setHasSearched(false);
    setStep(1);
    setSelectedTipos([]);
    setSelectedPatient(null);
    setQuery("");
    setSearchResults([]);
    setInformes([]);
    setIsLoadingVisitas(false);
    setIsLoadingInformes(false);
    setIsLoadingInformesExistentes(false);
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
    searchError,
    recentError,
    hasSearched,
    isLoadingRecent,
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
