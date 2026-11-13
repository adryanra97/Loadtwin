import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card stack-sm" style={{ textAlign: "center", padding: 40 }}>
      <h1>Page not found</h1>
      <p className="muted">This page does not exist.</p>
      <p>
        <Link href="/">Go to the overview</Link>
      </p>
    </div>
  );
}
