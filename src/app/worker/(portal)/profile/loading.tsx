export default function WorkerProfileLoading(): React.JSX.Element {
  return (
    <div className="profile-page" aria-busy="true" aria-live="polite">
      <div className="profile-loading-heading" />
      <div className="profile-loading-summary" />
      <div className="profile-loading-steps" />
      <div className="profile-loading-editor" />
      <span className="sr-only">Loading Worker Profile…</span>
    </div>
  );
}
