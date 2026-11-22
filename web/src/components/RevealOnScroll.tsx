import React, { useEffect, useRef, useState } from 'react';
import { useMotionOk } from '../hooks/useMotionOk';
import type { ThemePackMotionVariant } from '../utils/themePacks';

export interface RevealOnScrollProps {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'header' | 'article';
  variant?: ThemePackMotionVariant;
  distancePx?: number;
  durationMs?: number;
  delayMs?: number;
  threshold?: number;
  rootMargin?: string;
}

function getHiddenTransform(variant: ThemePackMotionVariant, distancePx: number): string {
  switch (variant) {
    case 'calm-fade':
      return 'none';
    case 'crest-reveal':
      return `translate3d(0, ${distancePx}px, 0) scale(0.99)`;
    case 'warm-rise':
    case 'fade-up':
    default:
      return distancePx > 0 ? `translate3d(0, ${distancePx}px, 0)` : 'none';
  }
}

/**
 * Lightweight, zero-dependency reveal wrapper for a single signature landing moment.
 * - Uses native CSS transitions + IntersectionObserver.
 * - Reveals once and disconnects immediately.
 * - Renders immediately with no opacity/transform hiding when prefers-reduced-motion
 *   is active or IntersectionObserver is unavailable.
 */
export function RevealOnScroll({
  children,
  className = '',
  as = 'div',
  variant = 'fade-up',
  distancePx = 14,
  durationMs = 460,
  delayMs = 0,
  threshold = 0.05,
  rootMargin = '0px 0px -16px 0px',
}: RevealOnScrollProps) {
  const motionOk = useMotionOk();
  const supportsObserver = typeof IntersectionObserver !== 'undefined';
  const ref = useRef<HTMLElement | null>(null);
  const [revealed, setRevealed] = useState<boolean>(() => !motionOk || !supportsObserver);

  useEffect(() => {
    if (!motionOk || !supportsObserver) {
      setRevealed(true);
      return;
    }

    if (revealed) return;

    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [motionOk, supportsObserver, revealed, threshold, rootMargin]);

  const Component = as;

  // When reduced motion is active, render immediately with zero opacity/transform hiding.
  if (!motionOk) {
    return (
      <Component
        className={className || undefined}
        data-reveal-state="immediate"
        data-motion-reduced="true"
      >
        {children}
      </Component>
    );
  }

  const isVisible = revealed || !supportsObserver;
  const style: React.CSSProperties = {
    opacity: isVisible ? 1 : 0,
    transform: isVisible ? 'none' : getHiddenTransform(variant, distancePx),
    transitionProperty: 'opacity, transform',
    transitionDuration: `${durationMs}ms`,
    transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
    transitionDelay: `${delayMs}ms`,
  };

  return (
    <Component
      ref={(node: HTMLElement | null) => {
        ref.current = node;
      }}
      className={className || undefined}
      style={style}
      data-reveal-state={isVisible ? 'visible' : 'pending'}
      data-reveal-variant={variant}
    >
      {children}
    </Component>
  );
}
