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
    <div className="fixed inset-0 z-[99999] flex items-center justify-center overflow-hidden bg-white">
      <img
        src="/college-logo.png"
        alt="PHIT College"
        decoding="sync"
        fetchPriority="high"
        className="pointer-events-none block select-none object-contain object-center"
        style={{
          width: "clamp(4.5rem, 22vmin, 7rem)",
          height: "clamp(4.5rem, 22vmin, 7rem)",
          maxWidth: "36vw",
          maxHeight: "36vh",
        }}
      />
    </div>
  );
};

export default SplashScreen;