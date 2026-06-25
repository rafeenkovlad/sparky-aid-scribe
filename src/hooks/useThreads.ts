import { useSyncExternalStore } from "react";
import { loadThreads, subscribeThreads } from "@/lib/carreports/threadStore";
import { subscribeToken, getToken } from "@/lib/carreports/tokenStore";

export function useThreads() {
  return useSyncExternalStore(subscribeThreads, loadThreads, loadThreads);
}

export function useToken(): string | null {
  return useSyncExternalStore(subscribeToken, getToken, () => null);
}
