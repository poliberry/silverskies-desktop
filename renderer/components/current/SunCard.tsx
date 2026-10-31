"use client";

import { computeSunArc } from "@/lib/sun-arc";
import { fmtTime } from "@/lib/units";

export function SunCard({ sunrise, sunset }: { sunrise: string; sunset: string }) {
  const arc = computeSunArc(sunrise, sunset);

  return (
    <div className="sun-card">
      <div className="sun-arc-wrap">
        <svg className="sun-arc-svg" viewBox="0 0 300 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <line x1="10" y1="100" x2="290" y2="100" stroke="var(--arc-line)" strokeWidth="1" />
          <line x1="10" y1="96" x2="10" y2="104" stroke="var(--arc-tick)" strokeWidth="1" />
          <line x1="290" y1="96" x2="290" y2="104" stroke="var(--arc-tick)" strokeWidth="1" />
          <path d="M 10 100 Q 150 -10 290 100" stroke="var(--arc-dash)" strokeWidth="1" strokeDasharray="4 3" />
          <path
            d="M 10 100 Q 150 -10 290 100"
            stroke="url(#sunGrad)"
            strokeWidth="2"
            strokeDasharray="390"
            strokeDashoffset={arc.dashOffset}
          />
          <circle cx={arc.cx} cy={arc.cy} r="8" fill="#ffdd44" opacity="0.9" filter="url(#sunGlow)" />
          <circle cx={arc.cx} cy={arc.cy} r="12" fill="rgba(255,220,50,0.12)" />
          <defs>
            <linearGradient id="sunGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ff8844" />
              <stop offset="50%" stopColor="#ffdd44" />
              <stop offset="100%" stopColor="#ff6644" />
            </linearGradient>
            <filter id="sunGlow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <text x="10" y="115" fill="var(--sun-label)" fontSize="13" fontFamily="'Google Sans Code', monospace">
            {fmtTime(sunrise)}
          </text>
          <text x="230" y="115" fill="var(--sun-label)" fontSize="13" fontFamily="'Google Sans Code', monospace">
            {fmtTime(sunset)}
          </text>
        </svg>
      </div>
      <div className="sun-times">
        <div className="sun-time-item">
          <div className="sun-time-label">Sunrise</div>
          <div className="sun-time-val">{fmtTime(sunrise)}</div>
        </div>
        <div className="sun-time-item">
          <div className="sun-time-label">Sunset</div>
          <div className="sun-time-val">{fmtTime(sunset)}</div>
        </div>
        <div className="sun-daylight">
          DAYLIGHT · {arc.daylightHours}h {arc.daylightMinutes}m
        </div>
      </div>
    </div>
  );
}
