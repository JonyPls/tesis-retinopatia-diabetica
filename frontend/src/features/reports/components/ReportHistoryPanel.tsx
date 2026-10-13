import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatClinicalInstant } from "@/lib/clinicalDates";
import { getPatientReportHistory, getReportVersions } from "../api/reportHistoryService";
import type {
  HistoricalReportDetail,
  HistoricalReportSummary,
  HistoricalReportVersion,
  ReportHistoryPagination,
  ReportOperation,
  ReportStatus,
} from "../types";

const operationLabel: Record<ReportOperation, string> = {
  CREACION: "Creación",
  MIGRACION_INICIAL: "Migración inicial",
  CORRECCION: "Corrección",
  ANULACION: "Anulación",
  INACTIVACION: "Inactivación",
};

const statusLabel: Record<ReportStatus, string> = {
  ACTIVO: "Activo",
  ANULADO: "Anulado · no vigente",
  INACTIVO: "Inactivo · no vigente",
};

function historyError(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 401) return "La sesión no está disponible. Inicia sesión nuevamente.";
  if (status === 403) return "El historial no está disponible o el acceso está restringido.";
  if (status === 404) return "Historial no encontrado.";
  if (status === 409) return "El historial requiere conciliación antes de consultarse.";
  return "No se pudo consultar el historial. Inténtalo más tarde.";
}

const formatDate = formatClinicalInstant;

function Pager({ pagination, onPage }: {
  pagination: ReportHistoryPagination;
  onPage: (page: number) => void;
}) {
  if (pagination.total <= pagination.per_page) return null;
  const lastPage = Math.min(Math.ceil(pagination.total / pagination.per_page), 1000000);
  return (
    <nav aria-label="Páginas del historial" className="flex items-center justify-end gap-2 pt-3 text-xs text-muted-foreground">
      <Button variant="outline" size="sm" disabled={pagination.page === 1}
        onClick={() => onPage(pagination.page - 1)}>Anterior</Button>
      <span>Página {pagination.page} de {lastPage}</span>
      <Button variant="outline" size="sm" disabled={!pagination.has_more || pagination.page >= lastPage}
        onClick={() => onPage(pagination.page + 1)}>Siguiente</Button>
      <Button variant="outline" size="sm" disabled={pagination.page >= lastPage}
        onClick={() => onPage(lastPage)}>Última</Button>
    </nav>
  );
}

function VersionContent({ version }: { version: HistoricalReportVersion }) {
  return (
    <section aria-label={`Contenido de la revisión ${version.numero_version}`} className="space-y-3 border-t border-border pt-4">
      <p className="text-sm font-semibold">
        Revisión {version.numero_version} · {version.es_actual ? "Última instantánea" : "Instantánea histórica"}
      </p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Operación</dt><dd>{operationLabel[version.operacion]}</dd></div>
        <div><dt className="text-muted-foreground">Estado de esta versión</dt><dd>{statusLabel[version.estado]}</dd></div>
        <div><dt className="text-muted-foreground">Profesional responsable</dt><dd>
          {version.autor_operacion
            ? `${version.autor_operacion.nombres} ${version.autor_operacion.apellidos}`
            : "Autor histórico no acreditado"}
        </dd></div>
        <div><dt className="text-muted-foreground">Fecha de operación</dt><dd>{formatDate(version.fecha_operacion, version.fecha_operacion_origen)}</dd></div>
      </dl>
      {version.operacion === "MIGRACION_INICIAL" && (
        <p className="text-sm text-muted-foreground">
          Estado conocido en la migración. No acredita la creación ni las correcciones anteriores.
        </p>
      )}
      {version.motivo && <p className="text-sm"><span className="font-medium">Motivo:</span> {version.motivo}</p>}
      <div>
        <h5 className="text-sm font-medium">Datos clínicos de esta revisión</h5>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed">
          {version.datos_estructurados === null
            ? "Sin datos estructurados registrados."
            : JSON.stringify(version.datos_estructurados, null, 2)}
        </pre>
      </div>
      <div>
        <h5 className="text-sm font-medium">Conclusión de esta revisión</h5>
        <p className="mt-1 whitespace-pre-wrap text-sm">{version.conclusion || "Sin conclusión registrada."}</p>
      </div>
      <p className="text-xs text-muted-foreground">Formato clínico (schema_version): {version.schema_version}. No es el número de revisión.</p>
    </section>
  );
}

export function ReportHistoryPanel({ patient }: {
  patient: { id: number; nombres: string; apellidos: string };
}) {
  const [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState<HistoricalReportSummary[]>([]);
  const [catalogPagination, setCatalogPagination] = useState<ReportHistoryPagination | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [versionPage, setVersionPage] = useState(1);
  const [detail, setDetail] = useState<HistoricalReportDetail | null>(null);
  const [versionsPagination, setVersionsPagination] = useState<ReportHistoryPagination | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setCatalog([]);
    setCatalogPagination(null);
    setCatalogError(null);
    setCatalogLoading(true);
    getPatientReportHistory(patient.id, page, controller.signal)
      .then((response) => {
        if (!active) return;
        setCatalog(response.data);
        setCatalogPagination(response.pagination);
      })
      .catch((error) => {
        if (active) setCatalogError(historyError(error));
      })
      .finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [patient.id, page]);

  useEffect(() => {
    if (selectedReportId === null) return;
    const controller = new AbortController();
    let active = true;
    setDetail(null);
    setSelectedVersion(null);
    setVersionsPagination(null);
    setDetailError(null);
    setDetailLoading(true);
    getReportVersions(selectedReportId, versionPage, controller.signal)
      .then((response) => {
        if (!active || response.data.informe.paciente_id !== patient.id ||
            response.data.informe.id !== selectedReportId) return;
        setDetail(response.data);
        setVersionsPagination(response.pagination);
        setSelectedVersion(response.data.versiones[0]?.numero_version ?? null);
      })
      .catch((error) => { if (active) setDetailError(historyError(error)); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [patient.id, selectedReportId, versionPage]);

  const chooseReport = (reportId: number) => {
    if (selectedReportId === reportId) return;
    setDetail(null);
    setDetailError(null);
    setSelectedVersion(null);
    setVersionPage(1);
    setSelectedReportId(reportId);
  };
  const changeCatalogPage = (next: number) => {
    setCatalog([]);
    setCatalogPagination(null);
    setSelectedReportId(null);
    setDetail(null);
    setPage(next);
  };
  const changeVersionPage = (next: number) => {
    setDetail(null);
    setSelectedVersion(null);
    setVersionPage(next);
  };
  const activeVersion = detail?.versiones.find((version) => version.numero_version === selectedVersion);

  return (
    <section aria-label="Historial de informes clínicos" className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 border-b border-border pb-3">
        <h3 className="text-sm font-semibold">Historial de informes clínicos</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {patient.nombres} {patient.apellidos} · Incluye informes no vigentes; solo lectura.
        </p>
      </div>
      {catalogLoading && <p role="status" className="text-sm text-muted-foreground">Cargando historial...</p>}
      {!catalogLoading && catalogError && <p role="alert" className="text-sm text-destructive">{catalogError}</p>}
      {!catalogLoading && !catalogError && catalog.length === 0 && (
        <p className="text-sm text-muted-foreground">No se encontraron informes históricos para este paciente.</p>
      )}
      {!catalogLoading && !catalogError && catalog.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div>
            <ul className="divide-y divide-border">
              {catalog.map((report) => (
                <li key={report.id}>
                  <button type="button" aria-pressed={selectedReportId === report.id}
                    className="w-full px-2 py-3 text-left text-sm hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary aria-pressed:bg-muted/50"
                    onClick={() => chooseReport(report.id)}>
                    <span className="block font-medium">{report.tipo_informe_nombre}</span>
                    <span className="block text-xs text-muted-foreground">
                      Visita {report.visita_id} · {formatDate(report.fecha_visita, report.fecha_visita_origen)} · {statusLabel[report.estado]} · Revisión {report.revision_actual}
                    </span>
                    <span className="block text-xs text-muted-foreground">Estado de la visita: {report.estado_visita}</span>
                    <span className="block text-xs text-muted-foreground">
                      Autor original: {report.autor_original.nombres} {report.autor_original.apellidos} · Registrado: {formatDate(report.fecha_creado, report.fecha_creado_origen)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {catalogPagination && <Pager pagination={catalogPagination} onPage={changeCatalogPage} />}
          </div>
          <div aria-live="polite" className="min-w-0 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            {selectedReportId === null && <p className="text-sm text-muted-foreground">Selecciona un informe para ver sus revisiones.</p>}
            {selectedReportId !== null && detailLoading && <p role="status" className="text-sm text-muted-foreground">Cargando revisiones...</p>}
            {selectedReportId !== null && !detailLoading && detailError && <p role="alert" className="text-sm text-destructive">{detailError}</p>}
            {selectedReportId !== null && !detailLoading && detail && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-semibold">{detail.informe.tipo_informe_nombre}</h4>
                  <p className="text-xs text-muted-foreground">Paciente {patient.nombres} {patient.apellidos} · Visita {detail.informe.visita_id} · {formatDate(detail.informe.fecha_visita, detail.informe.fecha_visita_origen)} · {detail.informe.estado_visita}</p>
                  <p className="mt-1 text-xs">{statusLabel[detail.informe.estado]} · Revisión clínica actual {detail.informe.revision_actual}</p>
                </div>
                {detail.informe.estado !== "ACTIVO" && (
                  <p role="note" className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                    Este informe no está vigente. Sus instantáneas se conservan para consulta histórica.
                  </p>
                )}
                <div>
                  <p className="mb-2 text-xs font-medium">Selecciona una revisión</p>
                  <div className="flex flex-wrap gap-2">
                    {detail.versiones.map((version) => (
                      <Button key={version.numero_version} variant={selectedVersion === version.numero_version ? "default" : "outline"}
                        size="sm" aria-pressed={selectedVersion === version.numero_version}
                        onClick={() => setSelectedVersion(version.numero_version)}>
                        {version.numero_version} · {operationLabel[version.operacion]}
                        {version.es_actual ? " (última)" : " (histórica)"}
                      </Button>
                    ))}
                  </div>
                  {versionsPagination && <Pager pagination={versionsPagination} onPage={changeVersionPage} />}
                </div>
                {activeVersion && <VersionContent version={activeVersion} />}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
