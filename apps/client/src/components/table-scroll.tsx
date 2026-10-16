import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A table that scrolls sideways when it is wider than the screen (a phone, a narrow window).
 * While it scrolls, keyboard users need to reach it: it becomes a labelled region in the tab
 * order, so the arrow keys scroll it. When it fits, it is a plain box and adds no tab stop.
 */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const check = () => setScrolls(box.scrollWidth > box.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(box);
    if (box.firstElementChild) observer.observe(box.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="table-scroll" {...(scrolls ? { role: 'region', 'aria-label': label, tabIndex: 0 } : {})}>
      {children}
    </div>
  );
}
