import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Okta from "next-auth/providers/okta";
import { getDb } from "@/db";
import { membershipForEmail, provisionMemberFromSso } from "@/services/org";

/**
 * SSO (D20). Each provider turns on when its env vars are set; Auth.js reads
 * AUTH_<PROVIDER>_ID / _SECRET (/ _ISSUER) itself. SAML IdPs plug in through
 * an OIDC bridge such as BoxyHQ SAML Jackson via the generic OIDC provider.
 * JWT sessions, no adapter: identity lives in our users/memberships tables.
 */
function configuredProviders(): Provider[] {
  const env = process.env;
  const list: Provider[] = [];
  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) list.push(Google);
  if (env.AUTH_MICROSOFT_ENTRA_ID_ID && env.AUTH_MICROSOFT_ENTRA_ID_SECRET) list.push(MicrosoftEntraID);
  if (env.AUTH_OKTA_ID && env.AUTH_OKTA_SECRET && env.AUTH_OKTA_ISSUER) list.push(Okta);
  if (env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET) list.push(GitHub);
  if (env.AUTH_OIDC_ISSUER && env.AUTH_OIDC_ID && env.AUTH_OIDC_SECRET) {
    list.push({
      id: "oidc",
      name: env.AUTH_OIDC_NAME ?? "Company SSO",
      type: "oidc",
      issuer: env.AUTH_OIDC_ISSUER,
      clientId: env.AUTH_OIDC_ID,
      clientSecret: env.AUTH_OIDC_SECRET,
    });
  }
  return list;
}

export const ssoProviders = configuredProviders();

export function isSsoConfigured(): boolean {
  return ssoProviders.length > 0;
}

/** Display list for the login page. */
export function ssoProviderList(): { id: string; name: string }[] {
  return ssoProviders.map((p) => {
    const resolved = typeof p === "function" ? p() : p;
    return { id: resolved.id, name: resolved.name };
  });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: ssoProviders,
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return "/login?error=NoEmail";
      const db = await getDb();
      const member = await provisionMemberFromSso(db, { email: user.email, name: user.name ?? null });
      return member ? true : "/login?error=NotProvisioned";
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const db = await getDb();
        const member = await membershipForEmail(db, user.email);
        if (member) token.membershipId = member.membershipId;
      }
      return token;
    },
    async session({ session, token }) {
      return { ...session, membershipId: token.membershipId as string | undefined };
    },
  },
});
