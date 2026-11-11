// House rules, terms and privacy notice (plain language). This is a DRAFT
// written from the product brief and must be reviewed before a public
// launch. It describes only what the app actually does.

import { TERMS_VERSION } from "@/lib/legal"; // version people accept

export default function Rules() {
  return (
    <article className="card prose">
      <h1>House rules, terms &amp; privacy</h1>
      <p className="small muted">Version {TERMS_VERSION}. Draft: to be reviewed before Hush Hall launches publicly.</p>
      {/* The full privacy policy lives on its own page (also the Google Play policy URL) */}
      <p className="small">Full details: <a href="/privacy">Privacy policy</a> · <a href="/delete-account">Deleting your account</a></p>

      <h2>House rules</h2>
      <ul>
        <li>Be kind. Everyone here is trying to get work done.</li>
        <li>Halls are silent: there is no chat. Desks show a nickname, an avatar and a topic.</li>
        <li>No harassment, hate, sexual content or spam, in nicknames, topics, request notes, or voice rooms.</li>
        <li>Don’t share other people’s personal information.</li>
        <li>Don’t record anyone. Voice rooms are live only.</li>
        <li>Hush Hall is for people aged 18 and over.</li>
      </ul>

      <h2>Using Hush Hall</h2>
      <ul>
        <li>Sign-up is open to anyone aged 18+. You confirm your age with your date of birth when you sign up.</li>
        <li>Anyone can send a short request to study together; the other person can accept or say “Not now”. You can hide yourself from requests at any time.</li>
        <li>You can block someone (you stop seeing each other’s desks and requests, and you are separated from any shared room; they are not told) and report someone to the moderators.</li>
        <li>Moderators review reports at least once a day, and aim to act on harassment and safety reports within 24 hours. Possible actions are a warning, removing a topic, pausing study rooms, or closing an account.</li>
        <li>Hush Hall is free. There are no payments, trials or subscriptions in this version.</li>
      </ul>

      <h2>Privacy notice</h2>
      <h3>What we keep</h3>
      <ul>
        <li>Your email address, to sign you in with a one-time link.</li>
        <li>Your nickname, avatar, lamp colour and settings (rhythm, chime, hide-from-requests).</li>
        <li>That you confirmed you are 18+, when, and which version of these rules you accepted. We do <b>not</b> store your date of birth.</li>
        <li>Your study sittings: hall, desk, topic, times, focused minutes, and the optional one-line recap. Only you can see your history.</li>
        <li>Your usual desk per hall, your block list, the study requests you send or receive, and which study rooms you joined.</li>
        <li>Reports you file. The person you report can’t see them or who filed them; moderators can.</li>
      </ul>
      <h3>What other people see</h3>
      <p>While you’re in a hall: your nickname, avatar, lamp colour, desk number, current topic and whether your timer is on focus or a break. In a study room, the other members see your nickname and avatar, and hear you only while your mic is on.</p>
      <h3>What we don’t do</h3>
      <ul>
        <li>We never record voice rooms and keep no transcripts.</li>
        <li>No ads, no tracking scripts, no selling or sharing of your data.</li>
        <li>No notifications that nudge you to come back.</li>
      </ul>
      <h3>Services we use</h3>
      <p>Accounts and data are stored with Supabase. Voice rooms run through LiveKit. The site is served by our web host.</p>
      <h3>Your choices</h3>
      <p>You can change your nickname and settings at any time, and delete your account and all of its data from <a href="/me#delete-account">My study log</a>. More in the <a href="/privacy">privacy policy</a>.</p>
    </article>
  );
}
