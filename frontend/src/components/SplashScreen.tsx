import { useEffect } from "react";

interface SplashScreenProps {
  onFinish: () => void;
}

const SplashScreen = ({ onFinish }: SplashScreenProps) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onFinish();
    }, 1500); // 1.5 seconds

    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-white">
      <img
        src="/college-logo.png"
        alt="PHIT College"
        className="w-40 h-40 object-contain"
        style={{ maxWidth: "160px", maxHeight: "160px" }}
      />
    </div>
  );
};

export default SplashScreen;