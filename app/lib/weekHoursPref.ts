// Preference: whether other people may see this week's hours on my desk (default on).

import { hasSupabase, supabase } from "./backend/client"; // real backend (if configured)

// Load the "show this week's hours on my desk" choice (default on).
export async function loadShowWeeklyHours(): Promise<boolean> {
  if (!hasSupabase) {
    if (typeof localStorage === "undefined") return true; // server
    return localStorage.getItem("hh.showWeeklyHours") !== "0"; // demo: off only when set to 0
  }
  const { data, error } = await supabase().from("profiles").select("show_weekly_hours").maybeSingle(); // my row
  if (error || !data) return true; // column missing or unread: default shown
  return (data as { show_weekly_hours?: boolean }).show_weekly_hours !== false; // default on
}

export async function saveShowWeeklyHours(on: boolean): Promise<boolean> {
  if (!hasSupabase) {
    localStorage.setItem("hh.showWeeklyHours", on ? "1" : "0"); // this browser only
    return true; // demo always saves
  }
  const { error } = await supabase().from("profiles").update({ show_weekly_hours: on }); // own row, own column (RLS)
  return !error; // false if 0005 is not applied yet
}
