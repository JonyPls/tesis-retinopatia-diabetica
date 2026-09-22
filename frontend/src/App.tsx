import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuthStore } from "@/features/auth/store/authStore";

import Login from "./features/auth/pages/Login";
import Dashboard from "./features/dashboard/pages/Dashboard";
import NotFound from "./pages/NotFound.tsx";
import Patients from "./features/patients/pages/Patients";
import PatientProfile from "./features/patients/pages/PatientProfile";
import PatientVisitDetail from "./features/patients/pages/PatientVisitDetail";
import Diagnosis from "./features/diagnosis/pages/Diagnosis";
import Placeholder from "./pages/Placeholder";
import ClinicalReports from "./features/reports/pages/ClinicalReports";

const queryClient = new QueryClient();

// Protege rutas que requieren autenticación
const PrivateRoute = ({ children }: { children: JSX.Element }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return isAuthenticated ? children : <Navigate to="/" replace />;
};

// Protege rutas que requieren roles específicos
const RoleRoute = ({
  children,
  roles,
  permission,
}: {
  children: JSX.Element;
  roles: string[];
  permission?: string;
}) => {
  const { isAuthenticated, hasRole, hasPermission } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (!hasRole(roles) && (!permission || !hasPermission(permission))) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* RUTA PÚBLICA */}
          <Route path="/" element={<Login />} />

          {/* RUTAS PROTEGIDAS — cualquier usuario autenticado */}
          <Route path="/dashboard"     element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/pacientes"     element={<PrivateRoute><Patients /></PrivateRoute>} />
          <Route path="/pacientes/:id" element={<PrivateRoute><PatientProfile /></PrivateRoute>} />
          <Route path="/pacientes/:pacienteId/visitas/:visitaId" element={<PrivateRoute><PatientVisitDetail /></PrivateRoute>} />
          <Route path="/diagnostico"   element={<PrivateRoute><Diagnosis /></PrivateRoute>} />
          <Route path="/informes"      element={<PrivateRoute><ClinicalReports /></PrivateRoute>} />

          {/* RUTAS PROTEGIDAS — solo Admin y Gerente General */}
          <Route path="/configuracion" element={
            <RoleRoute
              roles={["Admin", "Gerente General", "Administrador del sistema"]}
              permission="configuracion.ver"
            >
              <Placeholder title="Configuración" subtitle="Preferencias del sistema y del usuario" />
            </RoleRoute>
          } />

          {/* RUTA 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
