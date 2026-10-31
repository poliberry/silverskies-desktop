"use client";

export function AsteroidCountdown({ isActive, secondsLeft }: { isActive: boolean; secondsLeft: number }) {
  if (!isActive) return null;
  return <div id="asteroidCountdown" style={{ display: "block" }}>☄ IMPACT IN {secondsLeft}S</div>;
}
