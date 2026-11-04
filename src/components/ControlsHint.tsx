// The controls, drawn: arrow keys on a laptop, the game's on-screen buttons on a phone.
// Student-facing text: plain English, no dashes.

function Key({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-slate-300 bg-white text-2xl font-bold text-slate-800 shadow-[0_4px_0_0_#94a3b8]">
        {children}
      </div>
      {label && <span className="text-sm text-slate-200">{label}</span>}
    </div>
  );
}

function ArrowKeys() {
  return (
    <div className="flex flex-col items-center gap-2" aria-label="Arrow keys: up to speed up, down to brake, left and right to steer">
      <Key label="speed up">↑</Key>
      <div className="flex gap-2">
        <Key label="steer">←</Key>
        <Key label="brake">↓</Key>
        <Key label="steer">→</Key>
      </div>
    </div>
  );
}

// Looks like the game's own touch buttons (bottom left: steer; bottom right: brake and gas).
function TouchButtons() {
  const base = 'flex h-14 items-center justify-center rounded-xl text-white shadow-lg';
  return (
    <div className="flex w-full max-w-sm items-end justify-between" aria-label="Buttons: left and right arrows to steer, BRAKE, GAS">
      <div className="flex flex-col items-center gap-1">
        <div className="flex gap-2">
          <div className={`${base} w-14 bg-slate-700 text-2xl`}>◀</div>
          <div className={`${base} w-14 bg-slate-700 text-2xl`}>▶</div>
        </div>
        <span className="text-sm text-slate-200">steer</span>
      </div>
      <div className="flex gap-2">
        <div className="flex flex-col items-center gap-1">
          <div className={`${base} w-16 bg-red-500/90 text-sm font-bold`}>BRAKE</div>
          <span className="text-sm text-slate-200">brake</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className={`${base} w-16 bg-teal-500/90 text-sm font-bold`}>GAS</div>
          <span className="text-sm text-slate-200">speed up</span>
        </div>
      </div>
    </div>
  );
}

export function ControlsHint({ touch }: { touch: boolean }) {
  return (
    <div className="flex flex-col items-center gap-6">
      <p className="text-xl font-semibold">{touch ? 'Drive with these buttons' : 'Drive with the arrow keys'}</p>
      {touch ? <TouchButtons /> : <ArrowKeys />}
      <p className="text-base text-slate-200">Deliver the package in time and avoid crashes.</p>
      <p className="text-base text-slate-300">
        After each round, press <span className="rounded bg-orange-500 px-2 py-0.5 font-semibold text-white">NEXT DELIVERY</span> to go on.
      </p>
    </div>
  );
}
