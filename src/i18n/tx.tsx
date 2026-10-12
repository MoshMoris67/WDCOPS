import React from 'react';
import { t } from '@/i18n';

/**
 * Like t(), but the {0}, {1}… slots can hold React elements (a bold name, a code tag…), so a
 * sentence that contains markup stays ONE translatable string and the translator can move the
 * highlighted part wherever their language needs it.
 *
 *   tx('Client ({0}) can't be changed', <strong>{name}</strong>)
 *
 * In English (and on the Uganda system) it renders exactly what the equivalent JSX would.
 */
export function tx(text: string, ...nodes: React.ReactNode[]): React.ReactNode {
  const parts = t(text).split(/(\{\d+\})/g);
  return parts.map((part, i) => {
    const m = part.match(/^\{(\d+)\}$/);
    if (m) return <React.Fragment key={i}>{nodes[Number(m[1])]}</React.Fragment>;
    return part === '' ? null : <React.Fragment key={i}>{part}</React.Fragment>;
  });
}
