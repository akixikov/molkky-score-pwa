// The bar at the top of every screen but home: back on the left, the title centred, an action on the right.
import { type ReactNode } from 'react';

export function TopBar({ back, onBack, title, sub, action }: {
  /** Label of the back button, e.g. "Back" or "Matches". */
  back: string; onBack: () => void;
  /** Screen name (bold) and an optional second line (muted), e.g. which side threw first. */
  title: ReactNode; sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="topbar">
      <button className="back" onClick={onBack}>← {back}</button>
      <div className="topbar-title">
        <div className="ellipsis">{title}</div>
        {sub && <div className="topbar-sub ellipsis">{sub}</div>}
      </div>
      <div className="topbar-action">{action}</div>
    </div>
  );
}
