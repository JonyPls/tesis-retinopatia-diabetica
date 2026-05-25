import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import Login from "./pages/Login";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Patients from "./pages/Patients";
import PatientProfile from "./pages/PatientProfile";
import Diagnosis from "./pages/Diagnosis";
import Placeholder from "./pages/Placeholder";

const queryClient = new QueryClient();

// Componente para la protección de rutas
// Se verifica si token se encuentra en el almacenamiento local antes de redirigir a la vista
const PrivateRoute = ({ children }: { children: JSX.Element }) => {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/" replace />;
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

          {/* RUTAS PROTEGIDAS (Requieren inicio de sesión) */}
          <Route path="/dashboard" element={<PrivateRoute><Index /></PrivateRoute>} />
          <Route path="/pacientes" element={<PrivateRoute><Patients /></PrivateRoute>} />
          <Route path="/pacientes/:id" element={<PrivateRoute><PatientProfile /></PrivateRoute>} />
          <Route path="/diagnostico" element={<PrivateRoute><Diagnosis /></PrivateRoute>} />
          <Route path="/informes" element={<PrivateRoute><Placeholder title="Informes" subtitle="Centro de generación y descarga de informes PDF" /></PrivateRoute>} />
          <Route path="/configuracion" element={<PrivateRoute><Placeholder title="Configuración" subtitle="Preferencias del sistema y del usuario" /></PrivateRoute>} />
          
          {/* RUTA 404 */}
          <Route path="*" element={<NotFound />} />
          
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
