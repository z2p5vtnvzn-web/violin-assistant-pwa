export type AppPage = "tuner" | "practice" | "metronome";

type Props = { page: AppPage; onSelect: (page: AppPage) => void };

const tabs: { page: AppPage; label: string }[] = [
  { page: "tuner", label: "调音" },
  { page: "practice", label: "音准" },
  { page: "metronome", label: "节拍器" },
];

export function BottomNav({ page, onSelect }: Props) {
  return (
    <nav className={`bottom-nav nav-${page}`} aria-label="功能切换">
      <span className="bottom-nav-slider" aria-hidden="true" />
      {tabs.map((tab) => (
        <button key={tab.page} className={page === tab.page ? "active" : ""} aria-current={page === tab.page ? "page" : undefined} onClick={() => onSelect(tab.page)}>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
