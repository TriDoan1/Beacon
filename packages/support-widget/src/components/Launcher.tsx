interface LauncherProps {
  onClick: () => void;
  label: string;
}

export function Launcher({ onClick, label }: LauncherProps) {
  return (
    <button
      type="button"
      className="launcher"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">?</span>
    </button>
  );
}
