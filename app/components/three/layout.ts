// Where every desk, chair and student sits in the 3D hall (world units ≈ metres).
// Rows are paired into long double tables: A faces B, C faces D, like a real reading room.

import { ROWS, DESKS_PER_ROW } from "@/lib/halls"; // A-D, 6 desks per row

// World placement for one seat label.
export interface SeatPlace {
  seat: string; // "B4"
  x: number; // desk centre x
  deskZ: number; // desk centre z
  chairZ: number; // where the chair / student sits
  facing: 1 | -1; // +1 = student looks toward +z, -1 = toward -z
}

// Desk centre z per row, and which way each row faces.
const ROW_Z = [-4.45, -3.55, 1.55, 2.45]; // A/B back-to-back, C/D back-to-back
const ROW_FACING: (1 | -1)[] = [1, -1, 1, -1]; // A faces B, B faces A, C faces D, D faces C

// Desk spacing across a row, with a wider centre aisle after desk 3.
const COL_STEP = 2.2; // gap between desk centres
const AISLE = 1.4; // extra space for the centre aisle

// x position of desk column i (0..5).
export function colX(i: number) {
  const base = (i - (DESKS_PER_ROW - 1) / 2) * COL_STEP; // centred around 0
  return base + (i >= DESKS_PER_ROW / 2 ? AISLE / 2 : -AISLE / 2); // push halves apart for the aisle
}

// All seats with their world positions.
export const PLACES: SeatPlace[] = ROWS.flatMap((r, ri) =>
  Array.from({ length: DESKS_PER_ROW }, (_, i) => ({
    seat: `${r}${i + 1}`, // label
    x: colX(i), // column x
    deskZ: ROW_Z[ri], // row z
    chairZ: ROW_Z[ri] - ROW_FACING[ri] * 0.78, // chair sits on the far side from the facing direction
    facing: ROW_FACING[ri], // look direction
  })),
);

// Quick lookup by seat label.
export const PLACE_BY_SEAT = new Map(PLACES.map((p) => [p.seat, p])); // "B4" -> place

// Room bounds used by walls and floor.
export const ROOM = { minX: -10.5, maxX: 10.5, minZ: -7.6, maxZ: 7.2, height: 6 }; // half-open box
