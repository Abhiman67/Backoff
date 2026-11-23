"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";

const emptyForm = {
  name: "",
  institution: "",
  degree: "",
  semester: "",
  studyHours: 2,
  careerTarget: "",
};

const profileResponse = z.object({
  user: z.object({
    name: z.string(),
    email: z.string(),
    profile: z.object({
      institution: z.string().nullable(),
      degree: z.string().nullable(),
      semester: z.string().nullable(),
      studyHours: z.number().nullable(),
      careerTarget: z.string().nullable(),
    }).nullable(),
  }),
});

type SaveState = "idle" | "saving" | "saved" | "error";

export default function ProfileSettings() {
  const router = useRouter();
  const [form, setForm] = useState(emptyForm);
  const [savedForm, setSavedForm] = useState<typeof emptyForm | null>(null);
  const [email, setEmail] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loadError, setLoadError] = useState(false);

  const dirty = savedForm !== null && JSON.stringify(form) !== JSON.stringify(savedForm);
  const saving = saveState === "saving";
  const status = saving ? "Saving changes…"
    : saveState === "error" ? "Couldn’t save your profile. Try again."
    : dirty ? "Unsaved changes"
    : saveState === "saved" ? "All changes saved"
    : "";

  useEffect(() => {
    const controller = new AbortController();
    async function loadProfile() {
      try {
        const response = await fetch("/api/profile", { signal: controller.signal, cache: "no-store" });
        if (response.status === 401) {
          router.push("/login");
          return;
        }
        if (!response.ok) throw new Error("Profile unavailable");
        const { user } = profileResponse.parse(await response.json());
        if (controller.signal.aborted) return;
        const profile = {
          name: user.name,
          institution: user.profile?.institution ?? "",
          degree: user.profile?.degree ?? "",
          semester: user.profile?.semester ?? "",
          studyHours: user.profile?.studyHours ?? 2,
          careerTarget: user.profile?.careerTarget ?? "",
        };
        setEmail(user.email);
        setForm(profile);
        setSavedForm(profile);
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      }
    }
    void loadProfile();
    return () => controller.abort();
  }, [router]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    const submitted = form;
    setSaveState("saving");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitted),
      });
      if (!response.ok) throw new Error("Profile save failed");
      setSavedForm(submitted);
      setSaveState("saved");
      router.refresh();
    } catch {
      setSaveState("error");
    }
  }

  if (loadError) return <main className="p-8" role="alert">Couldn’t load your profile. Refresh to try again.</main>;
  if (!savedForm) return <main className="p-8">Loading profile…</main>;

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", paddingBottom: 40 }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/app/settings" className="button secondary sm">Back to settings</Link>
      </div>

      <div className="page-head" style={{ marginBottom: 20 }}>
        <div>
          <h1>Profile and academic info</h1>
          <p>This context is shared with Study Coach and Career Scout to personalize their guidance.</p>
        </div>
      </div>

      <form onSubmit={save} onChange={() => {
        if (saveState === "error") setSaveState("idle");
      }} className="panel card form-card">
        <div className="field">
          <label>
            Account email (read-only)
          </label>
          <input
            value={email}
            disabled
            aria-label="Account email"
          />
        </div>

        <div className="field">
          <label htmlFor="pf-name">
            Full name
          </label>
          <input
            id="pf-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Your full name"
            required
            className="qa-control"
            style={{ width: "100%" }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field">
            <label htmlFor="pf-inst">
              College / university
            </label>
            <input
              id="pf-inst"
              value={form.institution}
              onChange={(e) => setForm({ ...form, institution: e.target.value })}
              placeholder="e.g. Stanford University"
              className="qa-control"
              style={{ width: "100%" }}
            />
          </div>

          <div className="field">
            <label htmlFor="pf-deg">
              Degree and major
            </label>
            <input
              id="pf-deg"
              value={form.degree}
              onChange={(e) => setForm({ ...form, degree: e.target.value })}
              placeholder="e.g. B.Tech Computer Science"
              className="qa-control"
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field">
            <label htmlFor="pf-sem">
              Current semester / year
            </label>
            <input
              id="pf-sem"
              value={form.semester}
              onChange={(e) => setForm({ ...form, semester: e.target.value })}
              placeholder="e.g. Semester 6"
              className="qa-control"
              style={{ width: "100%" }}
            />
          </div>

          <div className="field">
            <label htmlFor="pf-hours">
              Daily study goal (hours)
            </label>
            <input
              id="pf-hours"
              type="number"
              min={0}
              max={24}
              value={form.studyHours}
              onChange={(e) => setForm({ ...form, studyHours: Number(e.target.value) })}
              className="qa-control"
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="pf-target">
            Career target / dream role
          </label>
          <input
            id="pf-target"
            value={form.careerTarget}
            onChange={(e) => setForm({ ...form, careerTarget: e.target.value })}
            placeholder="e.g. Frontend Engineer at a high-growth startup"
            className="qa-control"
            style={{ width: "100%" }}
          />
        </div>

        <p
          className="profile-save-status"
          data-state={saveState === "saved" && dirty ? "idle" : saveState}
          role="status"
          aria-atomic="true"
        >
          {status}
        </p>

        <button
          type="submit"
          disabled={!dirty || saving}
          className="button primary sm"
          style={{ width: "100%", justifyContent: "center" }}
        >
          {saving ? "Saving changes…" : "Save profile"}
        </button>
      </form>
    </main>
  );
}
