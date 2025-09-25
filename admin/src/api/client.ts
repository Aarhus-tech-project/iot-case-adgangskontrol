import axios from "axios";

const baseURL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api/admin";

export const adminApi = axios.create({
    baseURL,
    withCredentials: false,
    headers: { "Content-Type": "application/json" },
});
export const api = adminApi;
