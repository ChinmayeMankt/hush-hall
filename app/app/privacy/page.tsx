// Privacy policy (public, plain language). Written from what the code actually
// does: Supabase stores accounts and study data, LiveKit carries live voice
// (never recorded), Vercel serves the site. Linked from sign-in, the lobby,
// the house rules and My study log, and used as the Google Play policy URL.
// Chinmaye should review the wording before a Play submission.

import type { Metadata } from "next"; // page metadata type
import { PRIVACY_CONTACT, PRIVACY_UPDATED } from "@/lib/legal"; // contact address and date shown below

// Tab title for this page.
export const metadata: Metadata = { title: "Privacy policy · Hush Hall" }; // clear title for Play reviewers and people

export default function Privacy() {
  return (
    <article className="card prose">
      <h1>Privacy policy</h1>
      <p className="small muted">Hush Hall · last updated {PRIVACY_UPDATED}. This wording is still being reviewed before Hush Hall is listed on Google Play.</p>

      <p>Hush Hall is a quiet virtual library where adults take a desk, write what they’re studying, and work next to other people. It is made and run by Chinmaye Mankatalia (“we”). This policy covers the website at hush-hall.vercel.app and the Hush Hall Android app, which shows the same website.</p>
      <p>Questions or requests: <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a>.</p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Email address</b>, to send you one-time sign-in links. There are no passwords.</li>
        <li><b>Your 18+ check.</b> You enter your date of birth once at sign-up; it is checked on our server and <b>not stored</b>. We keep only the time you confirmed you’re 18 or over and which version of the house rules you accepted.</li>
        <li><b>Your profile and settings</b>: nickname, avatar, lamp colour, focus and break lengths, chime on or off, whether you hide from study-room requests, and whether this week’s study hours show on your desk.</li>
        <li><b>Your study sittings</b>: which hall and desk, your topic, start and end times, focused minutes, and the optional one-line recap. Only you can see your full history. Other people in a hall may see this week’s total hours on your desk unless you hide them.</li>
        <li><b>Desk notes</b> you write (and optional links). They are private unless you create a share link for one note. Stopping sharing, or deleting the note or your account, drops that link.</li>
        <li><b>Your timetable</b> (day, times and subject). Only you can see it.</li>
        <li><b>Where you are in a hall</b>: the desk you sit at, or your position and direction while you walk around. Walking positions are kept as one small row per person and replaced as you move.</li>
        <li><b>Your usual desk</b> in each hall, your <b>block list</b>, the <b>study requests</b> you send or receive (with their optional short note), and the <b>study rooms</b> you join.</li>
        <li><b>Reports.</b> If you report someone, we keep the reason, your optional note, where it happened, and the reported person’s nickname and topic at that moment. Moderators may add a private note and the action taken. The reported person can’t see the report or who filed it.</li>
        <li><b>Notices</b> a moderator sends to your account, such as a warning.</li>
      </ul>
      <p>We don’t collect your real name, phone number, contacts, location, photos, or payment details. Hush Hall has no ads, no analytics or tracking scripts, and no payments.</p>

      <h2>Voice in study rooms</h2>
      <p>Study rooms can use live voice. You join only after a consent screen, you start muted, and by default your microphone is live only while you hold to talk (open mic is something you choose each time). Voice is carried live through LiveKit and is <b>never recorded</b>; we keep no audio and no transcripts. Room members see your nickname and avatar. The app asks only for the microphone, never the camera.</p>

      <h2>What other people see</h2>
      <p>While you’re in a hall: your nickname, avatar, lamp colour, desk number (or where you’re walking), current topic, whether your timer is on focus or a break, and (unless you hide them) this week’s total study hours. In a study room, the other members see your nickname and avatar and hear you only while your mic is on. Nobody else sees your email, your history, your recaps, your notes (unless you share a link to one), your timetable, your block list, or your reports.</p>

      <h2>How we use it</h2>
      <ul>
        <li>To sign you in, keep you at your desk, show you in the hall, and keep your study log.</li>
        <li>To run study requests, study rooms and voice.</li>
        <li>To keep the library safe: blocks, reports, moderator review, and actions such as a warning, removing a topic, pausing study rooms, or closing an account.</li>
      </ul>
      <p>We don’t sell your data, share it for advertising, or use it to build profiles about you.</p>

      <h2>Services we use</h2>
      <p>These providers process data for us only to run Hush Hall:</p>
      <ul>
        <li><b>Supabase</b>: accounts, sign-in emails and the database (hosted in the Mumbai, India region), and the live hall connection.</li>
        <li><b>LiveKit</b>: live voice in study rooms (no recording).</li>
        <li><b>Vercel</b>: serves the website and runs its server code.</li>
      </ul>
      <p>Like most web services, these providers may keep short-lived technical logs, such as IP addresses and request times, under their own policies.</p>
      <p>We would share information with authorities only if the law requires it.</p>

      <h2>On your device</h2>
      <p>Your browser (or the Android app, which uses your browser) stores your sign-in session so you stay signed in, and (if you use it) a Spotify link you paste for music at your desk. That link stays on your device; we don’t receive your Spotify account. We don’t use advertising or tracking cookies.</p>

      <h2>How long we keep it</h2>
      <p>We keep your account data for as long as you have an account. Walking positions stop showing after about 20 seconds without an update. When you delete your account, your data is deleted straight away, as described below.</p>

      <h2 id="delete">Deleting your account</h2>
      <p>You can delete your account at any time in the app: sign in, open <a href="/me#delete-account">My study log &amp; account</a>, and use <b>Delete account</b>. This permanently deletes your login and email address, profile and settings, sittings and recaps, desk notes and any share links, timetable, usual desks, walking position, blocks you made and blocks against you, study requests, study-room memberships, notices, and reports you filed or that were filed about you. It can’t be undone.</p>
      <p>If you can’t sign in, email <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a> from the address on your account and we’ll delete it for you. More detail: <a href="/delete-account">How to delete your Hush Hall account</a>.</p>

      <h2>Your choices and rights</h2>
      <p>You can see your study history and change your nickname and settings in the app, hide yourself from study requests, block people, and delete your account. You can also email us to ask what we hold about you, to correct it, or to delete it.</p>

      <h2>Age</h2>
      <p>Hush Hall is only for people aged 18 and over. If we learn that an account belongs to someone under 18, we close it.</p>

      <h2>Security</h2>
      <p>Data travels over encrypted connections (HTTPS). Database rules let each person read only what they’re allowed to see, and server keys never reach your browser. No system is perfectly secure, but we keep what we hold small.</p>

      <h2>Changes</h2>
      <p>If this policy changes in a meaningful way, we’ll update this page and the date above.</p>

      <p className="small muted">See also: <a href="/rules">House rules &amp; terms</a>.</p>
    </article>
  );
}
