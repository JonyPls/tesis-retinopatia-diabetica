import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ModuleRoute } from "@/features/auth/components/ModuleRoute";
import { SessionRoute } from "@/features/auth/components/SessionRoute";
import { AppLayout } from "@/components/layout/AppLayout";

import Login from "./features/auth/pages/Login";
import Dashboard from "./features/dashboard/pages/Dashboard";
import NotFound from "./pages/NotFound.tsx";
import Patients from "./features/patients/pages/Patients";
import PatientProfile from "./features/patients/pages/PatientProfile";
import PatientVisitDetail from "./features/patients/pages/PatientVisitDetail";
import Diagnosis from "./features/diagnosis/pages/Diagnosis";
import Configuration from "./features/configuration/pages/Configuration";
import ClinicalReports from "./features/reports/pages/ClinicalReports";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* RUTA PÚBLICA */}
          <Route path="/" element={<Login />} />

          {/* El shell permanece montado; B1 protege cada contenido del Outlet. */}
          <Route element={<SessionRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/dashboard"     element={<ModuleRoute module="dashboard"><Dashboard /></ModuleRoute>} />
              <Route path="/pacientes"     element={<ModuleRoute module="patients"><Patients /></ModuleRoute>} />
              <Route path="/pacientes/:id" element={<ModuleRoute module="patients"><PatientProfile /></ModuleRoute>} />
              <Route path="/pacientes/:pacienteId/visitas/:visitaId" element={<ModuleRoute module="patientVisit"><PatientVisitDetail /></ModuleRoute>} />
              <Route path="/diagnostico"   element={<ModuleRoute module="diagnosis"><Diagnosis /></ModuleRoute>} />
              <Route path="/informes"      element={<ModuleRoute module="reports"><ClinicalReports /></ModuleRoute>} />
              <Route path="/configuracion" element={<ModuleRoute module="configuration"><Configuration /></ModuleRoute>} />
            </Route>
          </Route>

          {/* RUTA 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
