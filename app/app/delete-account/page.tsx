// Public "how to delete your account" page (no sign-in needed), for people and
// for Google Play's account-deletion URL. The delete button itself is on /me.

import type { Metadata } from "next"; // page metadata type
import { PRIVACY_CONTACT } from "@/lib/legal"; // where to write if you can't sign in

// Tab title for this page.
export const metadata: Metadata = { title: "Delete your account · Hush Hall" }; // clear title

export default function DeleteAccount() {
  return (
    <article className="card prose narrow">
      <h1>Delete your Hush Hall account</h1>
      <p>You can delete your Hush Hall account and its data yourself, at any time, in the app or on the website.</p>

      <h2>In the app</h2>
      <ol>
        <li><a href="/signin?next=/me">Sign in</a> with your email link.</li>
        <li>Open <a href="/me#delete-account">My study log &amp; account</a>.</li>
        <li>Under <b>Delete account</b>, type DELETE and confirm.</li>
      </ol>

      <h2>What is deleted</h2>
      <p>Straight away and permanently: your login and email address, profile and settings, sittings and recaps, usual desks, walking position, blocks, study requests, study-room memberships, notices, and reports you filed or that were filed about you. Nothing is kept afterwards. Voice is never recorded, so there is no audio to delete.</p>

      <h2>Can’t sign in?</h2>
      <p>Email <a href={`mailto:${PRIVACY_CONTACT}?subject=Delete%20my%20Hush%20Hall%20account`}>{PRIVACY_CONTACT}</a> from the address on your account, and we’ll delete it for you.</p>

      <p className="small muted"><a href="/privacy">Privacy policy</a> · <a href="/rules">House rules &amp; terms</a></p>
    </article>
  );
}
