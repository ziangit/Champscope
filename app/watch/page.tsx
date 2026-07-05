import { SetupNotice } from "@/components/SetupNotice";
import { dbConfigured } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function WatchPage() {
  if (!dbConfigured()) return <SetupNotice />;
  return (
    <div>
      <h1 className="font-display text-3xl font-bold uppercase tracking-wide">Ladder watch</h1>
      <p className="mt-2 max-w-prose text-sm text-steel">
        The watcher snapshots the top 50 daily and scouts anyone with public replays. Dashboard lands with Phase 2.
      </p>
    </div>
  );
}
