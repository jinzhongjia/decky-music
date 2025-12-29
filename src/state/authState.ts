import { useEffect, useState } from "react";

type Listener = (loggedIn: boolean) => void;

let loggedIn = false;
const listeners = new Set<Listener>();

export function getAuthLoggedIn(): boolean {
  return loggedIn;
}

export function setAuthLoggedIn(value: boolean) {
  if (loggedIn === value) return;
  loggedIn = value;
  listeners.forEach((cb) => {
    try {
      cb(loggedIn);
    } catch {
      // ignore individual listener errors
    }
  });
}

export function subscribeAuth(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useAuthStatus(): boolean {
  const [value, setValue] = useState(loggedIn);

  useEffect(() => {
    setValue(loggedIn);
    const unsubscribe = subscribeAuth(setValue);
    return unsubscribe;
  }, []);

  return value;
}
