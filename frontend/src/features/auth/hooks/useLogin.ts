import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { login as loginService } from "../api/authService";

export function useLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const navigate = useNavigate();
  const { login } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    setIsSuccess(false);

    try {
      const data = await loginService(username, password);
      
      setIsLoading(false);
      setIsSuccess(true);
      
      setTimeout(() => {
        login(data.token, data.user);
        navigate("/dashboard");
      }, 700);
      
    } catch (err: any) {
      const msg = err.response?.data?.message;
      setError(msg || "Error al iniciar sesión. Verifica tus credenciales.");
      setIsLoading(false);
    }
  };

  return {
    username,
    setUsername,
    password,
    setPassword,
    error,
    isLoading,
    isSuccess,
    showPassword,
    setShowPassword,
    handleSubmit,
  };
}
