export function SetupNotice() {
  return (
    <div className="rounded border border-line bg-card p-6">
      <h2 className="font-display text-xl font-semibold uppercase tracking-wide">Database not configured</h2>
      <p className="mt-2 max-w-prose text-sm text-steel">
        Champscope reads from Supabase Postgres. Copy <code className="font-mono">.env.example</code> to{" "}
        <code className="font-mono">.env.local</code>, fill in <code className="font-mono">SUPABASE_URL</code> and{" "}
        <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code>, and apply{" "}
        <code className="font-mono">schema.sql</code> in the Supabase SQL editor.
      </p>
    </div>
  );
}
