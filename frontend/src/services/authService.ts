import api from "./api";

interface LoginResponse {
  status: string;
  message: string;
  token: string;
  user: {
    id: number;
    username: string;
    nombres: string;
    apellidos: string;
    roles: string[];
  };
}

export const login = async (
  username: string,
  password: string,
): Promise<LoginResponse> => {
  const response = await api.post<LoginResponse>("/login", {
    username,
    password,
  });
  return response.data;
};
