import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A live waveform of the microphone input, painted from an `AnalyserNode`'s
 * time-domain data on each animation frame. Used by the composer while recording
 * (audio plugin STT). Inherits its stroke from the CSS text color, so it follows
 * the theme — set a text color via `className`.
 */
export function SoundWave({
  analyser,
  className,
}: {
  analyser: AnalyserNode | null;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      // Size the backing store to the element (DPR-aware) so it stays crisp.
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      analyser.getByteTimeDomainData(buffer);
      ctx.lineWidth = 2;
      ctx.strokeStyle = getComputedStyle(canvas).color;
      ctx.beginPath();
      const step = w / buffer.length;
      for (let i = 0; i < buffer.length; i++) {
        // 0..255 centered at 128 → -1..1 around the vertical middle.
        const v = (buffer[i] - 128) / 128;
        const y = h / 2 + v * (h / 2) * 0.9;
        const x = i * step;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("text-primary h-8 w-full", className)}
      aria-hidden
    />
  );
}
