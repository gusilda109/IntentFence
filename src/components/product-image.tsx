"use client";

/* eslint-disable @next/next/no-img-element -- Channel3 image hosts are dynamic. */
import { useState } from "react";

export function ProductImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <div className="item-image">
      <img
        src={src}
        alt={alt}
        width={112}
        height={112}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
