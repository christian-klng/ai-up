import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function UserAvatar({
  user,
  size = 32,
  className,
  variant,
}: {
  user: { name: string; avatarMediaId: string | null };
  size?: number;
  className?: string;
  /** "thumb" for small renderings of uploaded photos */
  variant?: "thumb";
}) {
  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const src = user.avatarMediaId ? `/api/files/${user.avatarMediaId}${variant ? `?v=${variant}` : ""}` : undefined;
  return (
    <Avatar className={cn("shrink-0", className)} style={{ width: size, height: size }}>
      {src && <AvatarImage src={src} alt={user.name} />}
      <AvatarFallback style={{ fontSize: Math.round(size * 0.4) }}>{initials || "?"}</AvatarFallback>
    </Avatar>
  );
}
