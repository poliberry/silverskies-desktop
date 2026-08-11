"use client";

import { useState } from "react";

export interface LocationSearchProps {
  onSearch: (query: string) => void | Promise<void>;
  onGps: () => void;
  isLocating: boolean;
  error: string | null;
}

export function LocationSearch({ onSearch, onGps, isLocating, error }: LocationSearchProps) {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || isSearching) return;
    setIsSearching(true);
    try {
      await onSearch(query.trim());
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
      <div className="flex gap-2">
        <input
          className="search-input"
          type="text"
          placeholder="Search city… (e.g. Tucson, AZ)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className={`gps-btn ${isLocating ? "locating" : ""}`}
          onClick={onGps}
          title="Use my GPS location"
          aria-label="Use my GPS location"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: "rotate(45deg)" }}>
            <path d="M12 2L4 20l8-4 8 4L12 2z" />
          </svg>
        </button>
      </div>
      <button type="submit" className="search-btn" disabled={isSearching || !query.trim()}>
        {isSearching ? "Searching…" : "Search"}
      </button>
      {error && <div className="error-box">⚠ {error}</div>}
    </form>
  );
}
