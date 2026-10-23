import { cn } from "@/lib/cn";

const palette: Record<string, string> = {
  white: "#eef1f5",
  pearl: "#f3f0ea",
  black: "#1c232d",
  silver: "#b8c0cb",
  grey: "#7d8794",
  gray: "#7d8794",
  blue: "#2f5d9e",
  navy: "#1d3557",
  red: "#b3261e",
  green: "#2e6b4f",
  gold: "#c8962f",
  beige: "#d8c7a8",
  brown: "#6b4a33",
  orange: "#d86f1e",
  yellow: "#e2b52b",
};

function bodyColor(color?: string | null): string {
  if (!color) return palette.silver;
  const key = color.trim().toLowerCase().split(/\s+/).pop() ?? "";
  return palette[key] ?? palette.silver;
}

type Shape = "suv" | "sedan" | "compact" | "van";

function shapeFor(category?: string | null, seats?: number): Shape {
  const c = (category ?? "").toLowerCase();
  if ((seats ?? 0) >= 7 || c.includes("van") || c.includes("people")) return "van";
  if (c.includes("suv") || c.includes("4x4")) return "suv";
  if (c.includes("economy") || c.includes("compact") || c.includes("mini")) return "compact";
  return "sedan";
}

const bodies: Record<Shape, string> = {
  sedan: "M28 92 L40 70 Q50 56 74 54 L118 52 Q140 52 156 66 L176 82 L214 88 Q228 91 230 104 L230 112 L20 112 L20 102 Q20 94 28 92 Z",
  compact: "M34 94 L48 66 Q58 52 80 51 L122 51 Q142 52 154 68 L168 86 L206 92 Q220 95 222 106 L222 112 L28 112 L28 104 Q28 96 34 94 Z",
  suv: "M24 90 L34 60 Q40 46 62 45 L150 45 Q166 46 174 60 L186 80 L218 86 Q230 89 232 102 L232 114 L18 114 L18 100 Q18 92 24 90 Z",
  van: "M22 90 L28 52 Q32 40 52 40 L178 40 Q194 41 200 56 L210 82 L222 88 Q232 92 232 104 L232 114 L18 114 L18 98 Q18 92 22 90 Z",
};

const glass: Record<Shape, string> = {
  sedan: "M62 70 Q70 60 86 59 L116 58 Q134 58 148 70 L156 78 L56 80 Z",
  compact: "M64 70 Q72 58 88 57 L120 57 Q136 58 146 70 L152 80 L58 82 Z",
  suv: "M46 76 L52 58 Q56 51 68 51 L146 51 Q158 52 164 62 L172 78 Z",
  van: "M38 76 L42 52 Q44 46 56 46 L176 46 Q188 47 192 58 L198 78 Z",
};

/** Lightweight SVG illustration of a vehicle, tinted by its colour. Decorative. */
export function CarArt({
  color,
  category,
  seats,
  className,
}: {
  color?: string | null;
  category?: string | null;
  seats?: number;
  className?: string;
}) {
  const shape = shapeFor(category, seats);
  const fill = bodyColor(color);
  return (
    <div className={cn("relative overflow-hidden bg-gradient-to-br from-ink-50 via-white to-gold-50", className)}>
      <svg viewBox="0 0 250 140" className="h-full w-full" aria-hidden focusable="false">
        <ellipse cx="125" cy="122" rx="104" ry="7" fill="#0c1b2c" opacity="0.12" />
        <path d={bodies[shape]} fill={fill} stroke="#0c1b2c" strokeOpacity="0.25" strokeWidth="1.5" />
        <path d={glass[shape]} fill="#0c1b2c" opacity="0.72" />
        <path d="M24 100 L226 100" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="2" />
        <rect x="214" y="94" width="12" height="5" rx="2" fill="#f5d27a" />
        <rect x="22" y="96" width="8" height="5" rx="2" fill="#d9534f" opacity="0.85" />
        {[64, 186].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="112" r="15" fill="#15202d" />
            <circle cx={cx} cy="112" r="8" fill="#b5c0cf" />
            <circle cx={cx} cy="112" r="3" fill="#15202d" />
          </g>
        ))}
      </svg>
    </div>
  );
}
