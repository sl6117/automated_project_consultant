import { StartForm } from "./start-form";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-6 py-12">
      <p
        role="status"
        className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      >
        Local storage does not mean local inference. Consultation text sent to a
        model leaves this machine.
      </p>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Automated Project Consultant
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Start from a rough idea. Until a live model is wired, proposals are an
          offline restatement of your text, not a consultation. They stay
          proposed until you approve them.
        </p>
      </div>
      <StartForm />
    </main>
  );
}
