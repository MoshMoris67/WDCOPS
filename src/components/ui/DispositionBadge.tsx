import React from 'react';

interface DispositionBadgeProps {
  code: string;
  color?: string;
  className?: string;
}

/**
 * Colors disposition codes from the admin-managed hex value rather than a
 * fixed set of Tailwind classes, so a code an admin adds today renders
 * correctly today — no CSS/deploy needed to "recognize" it.
 */
export default function DispositionBadge({ code, color = '#64748B', className = '' }: DispositionBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${className}`}
      style={{ backgroundColor: `${color}1A`, color, border: `1px solid ${color}4D` }}
    >
      {code}
    </span>
  );
}
