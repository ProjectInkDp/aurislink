export interface FiltersConfig {
  // Default filter values applied to every new player.
  // Clients can override per-player via PATCH /v4/sessions/:id/players/:guildId
  defaultVolume?: number
  equalizer?:  { band: number; gain: number }[]
  lowPass?:    { smoothing?: number } | null
  timescale?:  { speed?: number; pitch?: number; rate?: number } | null
  tremolo?:    { frequency?: number; depth?: number } | null
  vibrato?:    { frequency?: number; depth?: number } | null
  rotation?:   { rotationHz?: number } | null
  channelMix?: { leftToLeft?: number; leftToRight?: number; rightToLeft?: number; rightToRight?: number } | null
  echo?:       { delay?: number; feedback?: number; mix?: number } | null        // AurisLink exclusive
  reverb?:     { mix?: number; roomSize?: number; damping?: number } | null      // AurisLink exclusive
}
