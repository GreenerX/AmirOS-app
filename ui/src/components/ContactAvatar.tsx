import { useEffect, useRef, useState } from "react";
import { initials } from "../format";

type ContactAvatarProps = {
  name: string;
  src?: string;
  tone?: number;
  className?: string;
};

export function ContactAvatar({
  name,
  src,
  tone = 0,
  className = "",
}: ContactAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const avatarRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setImageFailed(false);
    setShouldLoad(false);
    if (!src) return;
    const element = avatarRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "180px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [src]);

  return (
    <span ref={avatarRef} className={`avatar avatar-${tone % 5} ${className}`.trim()}>
      {src && shouldLoad && !imageFailed ? (
        <img
          className="avatar-image"
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
