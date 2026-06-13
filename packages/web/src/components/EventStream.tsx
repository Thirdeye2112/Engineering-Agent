import { useEffect, useRef } from 'react';

interface Event { type: string; [key: string]: unknown; }

function detail(e: Event): string {
  // Debate events
  if (e.type === 'round_started') return `Round ${e.round}`;
  if (e.type === 'agent_thinking') return `${e.role} — ${e.phase}`;
  if (e.type === 'agent_position_ready') return `${e.role} proposal ready`;
  if (e.type === 'round_complete') return `Round ${e.round} complete`;
  if (e.type === 'synthesis_started') return 'Building report…';
  if (e.type === 'deliberation_complete') return 'Done';
  // PR workflow events
  if (e.type === 'debate_started') return 'Planning debate started';
  if (e.type === 'debate_complete') return 'Plan agreed';
  if (e.type === 'implementation_started') return `${e.role} implementing…`;
  if (e.type === 'tool_called') return `${e.tool}.${e.operation}`;
  if (e.type === 'tool_result') return `${e.tool} — ${e.success ? '✓' : '✗'}`;
  if (e.type === 'pr_opened') return `PR #${e.prNumber} opened`;
  if (e.type === 'security_review_started') return 'Security review started';
  if (e.type === 'security_review_complete') return `${e.approved ? '✓ Approved' : '✗ Issues found'} — ${(e.blockingIssues as string[])?.length ?? 0} blocking`;
  if (e.type === 'workflow_complete') return 'PR workflow complete';
  if (e.type === 'permission_requested') return `Permission needed: ${(e.detail as { tool?: string; operation?: string })?.tool}.${(e.detail as { tool?: string; operation?: string })?.operation}`;
  if (e.type === 'permission_approved') return `Approved`;
  if (e.type === 'permission_denied') return `Denied`;
  return JSON.stringify(e).slice(0, 100);
}

const EVENT_COLORS: Record<string, string> = {
  round_started: 'var(--accent)',
  agent_thinking: 'var(--yellow)',
  agent_position_ready: 'var(--green)',
  round_complete: '#60a5fa',
  synthesis_started: '#c084fc',
  deliberation_complete: 'var(--green)',
  debate_started: 'var(--accent)',
  debate_complete: 'var(--green)',
  implementation_started: 'var(--accent)',
  tool_called: 'var(--yellow)',
  tool_result: 'var(--text-muted)',
  pr_opened: 'var(--green)',
  security_review_started: '#c084fc',
  security_review_complete: 'var(--green)',
  workflow_complete: 'var(--green)',
  permission_requested: '#f97316',
  permission_approved: 'var(--green)',
  permission_denied: 'var(--red)',
};

export default function EventStream({ events }: { events: Event[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  if (events.length === 0) {
    return (
      <div className="event-stream" style={{ alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', height: 80 }}>
        <span className="spinner" style={{ marginRight: 10 }} />
        Waiting for events…
      </div>
    );
  }

  return (
    <div className="event-stream">
      {events.map((e, i) => (
        <div key={i} className="event-line">
          <span className="event-time">{new Date().toLocaleTimeString()}</span>
          <span className="event-type" style={{ color: EVENT_COLORS[e.type] ?? 'var(--text-muted)', minWidth: 220 }}>
            {e.type}
          </span>
          <span className="event-detail">{detail(e)}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
