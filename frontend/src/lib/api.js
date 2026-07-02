import axios from "axios";
export const api = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api",
    withCredentials: true,
    headers: {
        "Content-Type": "application/json"
    }
});
export const unwrap = async (promise) => {
    const response = await promise;
    return response.data.data;
};
