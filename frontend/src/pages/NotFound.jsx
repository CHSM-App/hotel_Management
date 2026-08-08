export default function NotFound() {
  return (
    <div style={{ minHeight: '100svh', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24 }}>
      <div>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Page not found</h1>
        <p style={{ color: 'var(--text-muted)' }}>Check the link and try again.</p>
      </div>
    </div>
  );
}
