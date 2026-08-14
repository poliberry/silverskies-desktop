"use client";

import { useEffect, useRef, useState } from "react";

export interface AsteroidShooterGameProps {
  onClose: () => void;
}

const HIGH_SCORE_KEY = "silverSkies.asteroidHighScore";
const SHIP_RADIUS = 12;
const THRUST = 0.15;
const DRAG = 0.99;
const TURN_SPEED = 0.06;
const BULLET_SPEED = 6;
const BULLET_LIFE = 60;
const FIRE_COOLDOWN = 10;
const STARTING_LIVES = 3;
const INVULN_FRAMES = 120;

interface Vec {
  x: number;
  y: number;
}

interface Ship {
  pos: Vec;
  vel: Vec;
  angle: number;
  invuln: number;
}

interface Bullet {
  pos: Vec;
  vel: Vec;
  life: number;
}

interface Asteroid {
  pos: Vec;
  vel: Vec;
  radius: number;
}

function wrap(v: number, max: number): number {
  if (v < 0) return v + max;
  if (v > max) return v - max;
  return v;
}

function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function spawnAsteroid(width: number, height: number, avoid: Vec): Asteroid {
  let pos: Vec;
  do {
    const edge = Math.floor(Math.random() * 4);
    pos =
      edge === 0
        ? { x: Math.random() * width, y: 0 }
        : edge === 1
          ? { x: width, y: Math.random() * height }
          : edge === 2
            ? { x: Math.random() * width, y: height }
            : { x: 0, y: Math.random() * height };
  } while (distance(pos, avoid) < 150);
  const angle = Math.random() * Math.PI * 2;
  const speed = 0.6 + Math.random() * 1.2;
  return { pos, vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed }, radius: 24 + Math.random() * 16 };
}

function readHighScore(): number {
  try {
    return Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeHighScore(score: number): void {
  try {
    localStorage.setItem(HIGH_SCORE_KEY, String(score));
  } catch {
    /* storage unavailable — high score just won't persist across sessions */
  }
}

/**
 * A tiny arcade-style asteroid shooter, opened by clicking the "Silver
 * Skies" logo 10 times in a row (see useLogoClickCounter). Classic
 * top-down mechanics: thrust/rotate ship, screen-wraparound movement,
 * shoot drifting asteroids for points, 3 lives, high score persisted via
 * localStorage (a fun easter egg, not real app state, so it deliberately
 * doesn't go through the ConfigFile/IPC settings path everything else
 * uses). Plain canvas 2D — no game-engine dependency needed at this scope.
 */
export function AsteroidShooterGame({ onClose }: AsteroidShooterGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(STARTING_LIVES);
  const [gameOver, setGameOver] = useState(false);
  const [highScore, setHighScore] = useState(() => readHighScore());
  const [restartTick, setRestartTick] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    // Re-bound so TS's null-narrowing above holds inside the nested tick()
    // closure below too (a closure over a `const` doesn't otherwise carry
    // the enclosing function's flow-narrowing across the function boundary).
    const ctx: CanvasRenderingContext2D = ctx2d;

    const width = canvas.width;
    const height = canvas.height;
    const ship: Ship = { pos: { x: width / 2, y: height / 2 }, vel: { x: 0, y: 0 }, angle: -Math.PI / 2, invuln: INVULN_FRAMES };
    let bullets: Bullet[] = [];
    let asteroids: Asteroid[] = Array.from({ length: 5 }, () => spawnAsteroid(width, height, ship.pos));
    let fireCooldown = 0;
    let localScore = 0;
    let localLives = STARTING_LIVES;
    let over = false;
    let rafId = 0;

    const keys = new Set<string>();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      keys.add(e.key.toLowerCase());
    }
    function onKeyUp(e: KeyboardEvent) {
      keys.delete(e.key.toLowerCase());
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    function resetShip() {
      ship.pos = { x: width / 2, y: height / 2 };
      ship.vel = { x: 0, y: 0 };
      ship.angle = -Math.PI / 2;
      ship.invuln = INVULN_FRAMES;
    }

    function tick() {
      if (over) return;

      if (keys.has("arrowleft") || keys.has("a")) ship.angle -= TURN_SPEED;
      if (keys.has("arrowright") || keys.has("d")) ship.angle += TURN_SPEED;
      if (keys.has("arrowup") || keys.has("w")) {
        ship.vel.x += Math.cos(ship.angle) * THRUST;
        ship.vel.y += Math.sin(ship.angle) * THRUST;
      }
      ship.vel.x *= DRAG;
      ship.vel.y *= DRAG;
      ship.pos.x = wrap(ship.pos.x + ship.vel.x, width);
      ship.pos.y = wrap(ship.pos.y + ship.vel.y, height);
      if (ship.invuln > 0) ship.invuln -= 1;

      if (fireCooldown > 0) fireCooldown -= 1;
      if (keys.has(" ") && fireCooldown <= 0) {
        fireCooldown = FIRE_COOLDOWN;
        bullets.push({
          pos: { x: ship.pos.x, y: ship.pos.y },
          vel: { x: Math.cos(ship.angle) * BULLET_SPEED, y: Math.sin(ship.angle) * BULLET_SPEED },
          life: BULLET_LIFE,
        });
      }

      bullets = bullets
        .map((b) => ({ ...b, pos: { x: wrap(b.pos.x + b.vel.x, width), y: wrap(b.pos.y + b.vel.y, height) }, life: b.life - 1 }))
        .filter((b) => b.life > 0);

      asteroids = asteroids.map((a) => ({ ...a, pos: { x: wrap(a.pos.x + a.vel.x, width), y: wrap(a.pos.y + a.vel.y, height) } }));

      const survivingAsteroids: Asteroid[] = [];
      for (const a of asteroids) {
        const hitByBullet = bullets.find((b) => distance(b.pos, a.pos) < a.radius);
        if (hitByBullet) {
          bullets = bullets.filter((b) => b !== hitByBullet);
          localScore += 10;
          setScore(localScore);
          if (a.radius > 18) {
            for (let i = 0; i < 2; i++) {
              const angle = Math.random() * Math.PI * 2;
              const speed = 0.8 + Math.random() * 1.2;
              survivingAsteroids.push({
                pos: { ...a.pos },
                vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
                radius: a.radius * 0.55,
              });
            }
          }
          continue;
        }
        survivingAsteroids.push(a);
      }
      asteroids = survivingAsteroids;
      if (asteroids.length === 0) {
        asteroids = Array.from({ length: 5 }, () => spawnAsteroid(width, height, ship.pos));
      }

      if (ship.invuln <= 0) {
        const hitShip = asteroids.some((a) => distance(a.pos, ship.pos) < a.radius + SHIP_RADIUS * 0.6);
        if (hitShip) {
          localLives -= 1;
          setLives(localLives);
          if (localLives <= 0) {
            over = true;
            setGameOver(true);
            if (localScore > readHighScore()) {
              writeHighScore(localScore);
              setHighScore(localScore);
            }
          } else {
            resetShip();
          }
        }
      }

      ctx.fillStyle = "#05050a";
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = "#7fd4ff";
      ctx.lineWidth = 1.5;
      for (const a of asteroids) {
        ctx.beginPath();
        ctx.arc(a.pos.x, a.pos.y, a.radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = "#ffe27a";
      for (const b of bullets) {
        ctx.beginPath();
        ctx.arc(b.pos.x, b.pos.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.save();
      ctx.translate(ship.pos.x, ship.pos.y);
      ctx.rotate(ship.angle);
      ctx.strokeStyle = ship.invuln > 0 && ship.invuln % 10 < 5 ? "rgba(255,255,255,0.3)" : "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(SHIP_RADIUS, 0);
      ctx.lineTo(-SHIP_RADIUS * 0.7, SHIP_RADIUS * 0.7);
      ctx.lineTo(-SHIP_RADIUS * 0.3, 0);
      ctx.lineTo(-SHIP_RADIUS * 0.7, -SHIP_RADIUS * 0.7);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [onClose, restartTick]);

  return (
    <div
      className="flex flex-col items-center justify-center gap-3"
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.85)" }}
    >
      <div className="flex items-center gap-4 font-mono text-sm" style={{ color: "var(--text2)" }}>
        <span>SCORE {score}</span>
        <span>LIVES {lives}</span>
        <span>HIGH SCORE {highScore}</span>
      </div>
      <div style={{ position: "relative" }}>
        <canvas ref={canvasRef} width={720} height={480} style={{ border: "1px solid var(--border)", background: "#05050a" }} />
        {gameOver && (
          <div
            className="flex flex-col items-center justify-center gap-3 font-mono"
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", color: "#fff" }}
          >
            <div style={{ fontSize: "1.5rem" }}>GAME OVER</div>
            <div>Score: {score}</div>
            <button
              className="unit-btn"
              onClick={() => {
                setScore(0);
                setLives(STARTING_LIVES);
                setGameOver(false);
                setRestartTick((t) => t + 1);
              }}
            >
              Restart
            </button>
          </div>
        )}
      </div>
      <div className="font-mono text-xs" style={{ color: "var(--text3)" }}>
        Arrows/WASD to move · Space to fire · Esc to close
      </div>
      <button className="unit-btn" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
