export function initialsOf(name: string) {
  return name.split(' ').filter(Boolean).slice(-2).map(part => part[0]).join('').toUpperCase();
}

/** Round avatar: shows the uploaded image when present, otherwise initials on a gradient. */
export function Avatar({ name, src, className = 'size-9 text-xs' }: { name: string; src?: string; className?: string }) {
  return <span aria-hidden="true" className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#EC4899] font-semibold text-white ${className}`}>
    {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initialsOf(name)}
  </span>;
}
