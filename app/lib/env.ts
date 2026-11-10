// Small browser capability checks used to pick the 3D or 2D hall.

// True if this browser can create a WebGL context.
export function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas"); // throwaway canvas
    return !!(c.getContext("webgl2") || c.getContext("webgl")); // any WebGL works
  } catch {
    return false; // blocked or unsupported
  }
}

// True if the user asked the OS for less motion.
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches; // media query
}
