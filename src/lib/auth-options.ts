export function googleSignInEnabled() {
  return process.env.ENABLE_GOOGLE_SIGN_IN === "true"
    && Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function passwordSignupEnabled() {
  return !googleSignInEnabled() || process.env.GOOGLE_ONLY_SIGNUP !== "true";
}

export const GOOGLE_LINK_COOKIE = "vidyasarthi-google-link";
