export const todayBs = () => {
    const fallback = new Date().toISOString().slice(0, 10);
    return fallback;
};
