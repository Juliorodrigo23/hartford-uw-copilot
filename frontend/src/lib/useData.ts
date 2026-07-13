"use client";

/**
 * useData — one honest way to load exported pipeline JSON.
 *
 * status:
 *   loading  — request in flight
 *   live     — real exported data loaded
 *   missing  — export not generated yet (or fetch failed). Components render
 *              an explicit pending state; they NEVER substitute invented
 *              numbers for missing data.
 */

import { useEffect, useState } from "react";
import { dataPath } from "@/lib/api";

export type DataStatus = "loading" | "live" | "missing";

export function useData<T>(name: string): { data: T | null; status: DataStatus } {
  const [state, setState] = useState<{ data: T | null; status: DataStatus }>({
    data: null,
    status: "loading",
  });

  useEffect(() => {
    let alive = true;
    fetch(dataPath(name))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: T | null) => {
        if (!alive) return;
        setState(d ? { data: d, status: "live" } : { data: null, status: "missing" });
      })
      .catch(() => {
        if (alive) setState({ data: null, status: "missing" });
      });
    return () => {
      alive = false;
    };
  }, [name]);

  return state;
}
