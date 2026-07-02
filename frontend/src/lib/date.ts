export const todayBs = (): string => {
  const fallback = new Date().toISOString().slice(0, 10);
  return fallback;
};

