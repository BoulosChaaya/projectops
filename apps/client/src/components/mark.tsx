/** The ProjectOps mark: a project's path from intake to payment, as three stations on one line. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 18 L12 6 L20 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4" cy="18" r="2.5" fill="currentColor" />
      <circle cx="12" cy="6" r="2.5" fill="currentColor" />
      <circle cx="20" cy="18" r="2.5" className="mark-paid" />
    </svg>
  );
}
