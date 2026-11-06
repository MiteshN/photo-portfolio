import { useEffect } from 'react';

interface Props {
  prev?: string;
  next?: string;
  back: string;
}

/**
 * Photo page controls: ← / → for the previous and next photo, Esc back to the
 * album, and a horizontal swipe on the photo itself on touch screens.
 */
export default function PhotoKeys({ prev, next, back }: Props) {
  useEffect(() => {
    const go = (url?: string) => {
      if (url) window.location.assign(url);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (e.key === 'ArrowLeft') go(prev);
      else if (e.key === 'ArrowRight') go(next);
      else if (e.key === 'Escape') go(back);
    };

    const area = document.querySelector<HTMLElement>('[data-swipe]');
    let startX: number | null = null;
    let startY = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        startX = null;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (startX === null) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      startX = null;
      // A clear sideways swipe, not a scroll or a pinch.
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? next : prev);
    };

    window.addEventListener('keydown', onKey);
    area?.addEventListener('touchstart', onTouchStart, { passive: true });
    area?.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      area?.removeEventListener('touchstart', onTouchStart);
      area?.removeEventListener('touchend', onTouchEnd);
    };
  }, [prev, next, back]);

  return null;
}
