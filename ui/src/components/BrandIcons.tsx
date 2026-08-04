import { SiWhatsapp } from "react-icons/si";

type BrandIconProps = {
  className?: string;
  size?: number;
};

export function WhatsAppIcon({ className = "", size = 18 }: BrandIconProps) {
  return (
    <SiWhatsapp
      aria-hidden="true"
      className={`official-brand-icon whatsapp ${className}`.trim()}
      size={size}
    />
  );
}
