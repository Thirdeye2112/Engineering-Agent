interface Event { type: string; [key: string]: unknown; }

function detail(e: Event): string {
  if (e.type === 'round_started') return `Round ${e.round}`;
  if (e.type === 'agent_thinking') return `${e.role} — ${e.phase}`;
  if (e.type === 'agent_position_ready') return `${e.role} proposal ready`;
  if (e.type === 'round_complete') return `Round ${e.round} complete`;
  if (e.type === 'synthesis_started') return 'Building report…';
  if (e.type === 'deliberation_complete') return 'Done';
  return JSON.stringify(e).slice(0, 80);
}

export default function EventStream({ events }: { events: Event[] }) {
  if (events.length === 0) {
    return (
      <div className="event-stream" style={{ alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <span className="spinner" style={{ marginBottom: 8 }} />
        Waiting for events…
      </div>
    );
  }

  return (
    <div className="event-stream">
      {events.map((e, i) => (
        <div key={i} className="event-line">
          <span className="event-time">{new Date().toLocaleTimeString()}</span>
          <span className={`event-type ${e.type}`}>{e.type}</span>
          <span className="event-detail">{detail(e)}</span>
        </div>
      ))}
    </div>
  );
}
