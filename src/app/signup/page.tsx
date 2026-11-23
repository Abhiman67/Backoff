import SignupForm from "@/components/auth/SignupForm";
import { googleSignInEnabled, passwordSignupEnabled } from "@/lib/auth-options";

export default function SignupPage() {
  return <SignupForm googleEnabled={googleSignInEnabled()} passwordEnabled={passwordSignupEnabled()} />;
}
