import { useEffect, useRef } from "react";

const DARK_COLORS = ["#60a5fa", "#3b82f6", "#38bdf8", "#2563eb", "#ffffff"];
const LIGHT_COLORS = ["#2563eb", "#1d4ed8", "#0284c7", "#0ea5e9", "#3b82f6"];

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
}

function isDark(): boolean {
  if (typeof document === "undefined") return true;
  return (
    document.documentElement.getAttribute("data-theme") !== "light" &&
    !document.documentElement.classList.contains("light")
  );
}

export default function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const count = w < 640 ? 260 : w < 1024 ? 460 : 800;
    const dark = isDark();
    const palette = dark ? DARK_COLORS : LIGHT_COLORS;

    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: (Math.random() - 0.5) * w,
        y: (Math.random() - 0.5) * h,
        z: Math.random() * w,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.2 + 0.15,
        size: Math.random() * 1.5 + 0.5,
        color: palette[(Math.random() * palette.length) | 0],
      });
    }

    ctx.globalCompositeOperation = dark ? "lighter" : "source-over";

    let raf: number;
    const draw = () => {
      ctx.clearRect(0, 0, w * dpr, h * dpr);
      ctx.save();
      ctx.scale(dpr, dpr);

      const cx = w / 2;
      const cy = h / 2;

      for (const p of particles) {
        p.z -= 1.2;
        if (p.z <= 0) {
          p.x = (Math.random() - 0.5) * w;
          p.y = (Math.random() - 0.5) * h;
          p.z = w;
        }

        const scale = w / p.z;
        const sx = p.x * scale + cx;
        const sy = p.y * scale + cy;
        const r = p.size * scale * 0.6;

        if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;

        const alpha = Math.min(1, Math.max(0, 1 - p.z / w)) * (dark ? 0.7 : 0.45);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();

        p.x += p.vx;
        p.y += p.vy;
      }

      ctx.restore();
      raf = requestAnimationFrame(draw);
    };

    draw();

    const onResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ position: "fixed", inset: 0, width: "100%", height: "100%", display: "block", zIndex: 0, pointerEvents: "none" }}
      />
      <div
        className="starfield-overlay"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: "min(500px, 55vh)",
          background: "linear-gradient(80.22deg, #3b82f6 1.49%, #38bdf8 99.95%)",
          opacity: 0.07,
          WebkitMaskImage: "radial-gradient(ellipse 150% 120% at top, black 0%, black 30%, transparent 70%)",
          maskImage: "radial-gradient(ellipse 150% 120% at top, black 0%, black 30%, transparent 70%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
    </>
  );
}
