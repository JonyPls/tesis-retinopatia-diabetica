import api from "./api";

interface UserData {
  id: number;
  username: string;
  nombres: string;
  apellidos: string;
  roles: string[];
}

interface LoginData {
  token: string;
  user: UserData;
}

export const login = async (
  username: string,
  password: string,
): Promise<LoginData> => {
  const response = await api.post("/login", {
    username,
    password,
  });
  return response.data.data;
};
