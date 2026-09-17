'use client';

import clsx from 'clsx';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { shortAddr, timeAgo } from '@/lib/format';
import type { Health } from '@/lib/types';

export const HEALTH_LABEL: Record<Health, string> = {
  ok: 'Healthy',
  warn: 'Degraded',
  down: 'Problem',
  unknown: 'Unknown',
};

export const HEALTH_COLOR: Record<Health, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  down: 'text-down',
  unknown: 'text-unknown',
};

export function HealthDot({ health, live = false, size = 10 }: { health: Health; live?: boolean; size?: number }) {
  return (
    <span
      className={clsx(
        'inline-block shrink-0 rounded-full bg-current',
        HEALTH_COLOR[health],
        live && health === 'ok' && 'dot-live',
      )}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}

export function StatusPill({ health, label, className }: { health: Health; label?: string; className?: string }) {
  const bg = {
    ok: 'bg-ok/12 border-ok/30',
    warn: 'bg-warn/12 border-warn/30',
    down: 'bg-down/12 border-down/30',
    unknown: 'bg-unknown/12 border-unknown/30',
  }[health];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        bg,
        HEALTH_COLOR[health],
        className,
      )}
    >
      <HealthDot health={health} size={7} />
      {label ?? HEALTH_LABEL[health]}
    </span>
  );
}

export function Card({ children, className, accent }: { children: ReactNode; className?: string; accent?: Health }) {
  const ring = accent === 'down' ? 'border-down/40' : accent === 'warn' ? 'border-warn/35' : undefined;
  return <section className={clsx('card p-5', ring, className)}>{children}</section>;
}

export function SectionTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Address({ value, href, chars = 6 }: { value: string; href?: string; chars?: number }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable
    }
  };
  return (
    <span className="mono inline-flex items-center gap-1 text-sm" title={value}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="hover:text-accent-2 hover:underline">
          {shortAddr(value, chars)}
        </a>
      ) : (
        <span>{shortAddr(value, chars)}</span>
      )}
      <button onClick={copy} className="text-muted hover:text-fg" aria-label="Copy" title="Copy">
        {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
      </button>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-muted hover:text-fg"
          aria-label="Open in explorer"
        >
          <ExternalLink size={13} />
        </a>
      )}
    </span>
  );
}

export function TimeAgo({ ts, className }: { ts: number | null | undefined; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className={className} title={ts ? new Date(ts).toLocaleString() : undefined}>
      {timeAgo(ts, now)}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} />;
}

export function Stat({
  label,
  value,
  sub,
  health,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  health?: Health;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={clsx('mono truncate text-base font-semibold', health && HEALTH_COLOR[health])}>{value}</div>
      {sub && <div className="truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}
