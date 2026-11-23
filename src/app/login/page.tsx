import LoginForm from "@/components/auth/LoginForm";
import { googleSignInEnabled } from "@/lib/auth-options";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const initialError = error === "GoogleLinkRequired"
    ? "Sign in with your password first, then link Google from your profile."
    : error ? "Google sign-in didn’t complete. Try again or sign in with your password." : "";
  return <LoginForm googleEnabled={googleSignInEnabled()} initialError={initialError} />;
}
