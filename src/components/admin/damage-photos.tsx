/** Thumbnails for private damage photos, loaded through the authorised /files route. */
export function DamagePhotos({ keys }: { keys: string[] }) {
  if (keys.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {keys.map((k, i) => {
        const src = `/files/${k.split("/").map(encodeURIComponent).join("/")}`;
        return (
          <li key={k}>
            <a href={src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-ink-100">
              {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked file; not optimisable */}
              <img src={src} alt={`Damage photo ${i + 1}`} className="size-24 object-cover" loading="lazy" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
